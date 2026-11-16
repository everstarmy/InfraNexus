import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, Eye, History, Info, Lock } from "lucide-react"
import { PageHeader } from "@/components/common/page-header"
import {
  AssetStatusBadge,
  formatSpecSummary,
  useCompanyOptions,
  useReceivingMetadata,
} from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import { VersionConflictAlert, type VersionConflictState } from "@/components/receiving/version-conflict-alert"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getErrorMessage, getReceivingError, isVersionConflict } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { queryKeys } from "@/lib/query-keys"
import { assetsService, type ConfigurationDiffKind } from "@/services/assets"
import { attachmentContentUrl, type AssetAttachmentDTO } from "@/services/receipts"
import { useAuth } from "@/stores/auth-context"

export default function DeviceAssetDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { can } = useAuth()

  const canRead = can("assets:devices:read")
  const canHistory = can("assets:devices:history")
  const canReadComponents = can("assets:components:read")

  const [includeCurrentIdentity, setIncludeCurrentIdentity] = useState(false)
  const [diffFilter, setDiffFilter] = useState<"all" | ConfigurationDiffKind>("all")
  const [expectedConfigVersion, setExpectedConfigVersion] = useState<number | undefined>(undefined)
  const [conflict, setConflict] = useState<VersionConflictState | null>(null)
  const [previewPhoto, setPreviewPhoto] = useState<AssetAttachmentDTO | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const metadataQuery = useReceivingMetadata(canRead)
  const companiesQuery = useCompanyOptions(canRead)
  const companyMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companiesQuery.data?.data.items ?? []) m.set(c.id, c.name)
    return m
  }, [companiesQuery.data])

  const deviceQuery = useQuery({
    queryKey: queryKeys.assetDevice(id),
    queryFn: ({ signal }) => assetsService.getDevice(id, signal),
    enabled: canRead && Boolean(id),
  })

  const originalQuery = useQuery({
    queryKey: queryKeys.assetDeviceOriginal(id),
    queryFn: ({ signal }) => assetsService.getOriginalConfiguration(id, signal),
    enabled: canRead && Boolean(id),
  })

  const originalItemsQuery = useQuery({
    queryKey: queryKeys.assetDeviceOriginalItems(id, {
      page: 1,
      page_size: 100,
      include_current_identity: includeCurrentIdentity,
    }),
    queryFn: ({ signal }) =>
      assetsService.listOriginalConfigurationItems(
        id,
        { page: 1, page_size: 100, include_current_identity: includeCurrentIdentity },
        signal,
      ),
    enabled: canRead && Boolean(id),
  })

  const handleConfigError = (err: unknown) => {
    if (isVersionConflict(err)) {
      const info = getReceivingError(err)
      setConflict({
        message: getErrorMessage(err, "设备配置版本已变更，请重新加载当前配置"),
        currentVersion: info?.current_version,
      })
    }
  }

  const currentSummaryQuery = useQuery({
    queryKey: queryKeys.assetDeviceCurrent(id, expectedConfigVersion),
    queryFn: async ({ signal }) => {
      try {
        const res = await assetsService.getCurrentConfiguration(id, expectedConfigVersion, signal)
        if (!expectedConfigVersion) {
          setExpectedConfigVersion(res.data.configuration_version)
        }
        return res
      } catch (err) {
        handleConfigError(err)
        throw err
      }
    },
    enabled: canRead && Boolean(id),
  })

  const currentItemsQuery = useQuery({
    queryKey: queryKeys.assetDeviceCurrentItems(id, {
      page: 1,
      page_size: 100,
      expected_configuration_version: expectedConfigVersion,
    }),
    queryFn: async ({ signal }) => {
      try {
        return await assetsService.listCurrentConfigurationItems(
          id,
          { page: 1, page_size: 100, expected_configuration_version: expectedConfigVersion },
          signal,
        )
      } catch (err) {
        handleConfigError(err)
        throw err
      }
    },
    enabled: canRead && Boolean(id),
  })

  const diffQuery = useQuery({
    queryKey: queryKeys.assetDeviceDiff(id, {
      page: 1,
      page_size: 100,
      filter: diffFilter === "all" ? undefined : diffFilter,
      expected_configuration_version: expectedConfigVersion,
    }),
    queryFn: async ({ signal }) => {
      try {
        return await assetsService.getConfigurationDiff(
          id,
          {
            page: 1,
            page_size: 100,
            filter: diffFilter === "all" ? undefined : diffFilter,
            expected_configuration_version: expectedConfigVersion,
          },
          signal,
        )
      } catch (err) {
        handleConfigError(err)
        throw err
      }
    },
    enabled: canRead && Boolean(id),
  })

  const device = deviceQuery.data?.data
  const original = originalQuery.data?.data
  const originalItems = originalItemsQuery.data?.data.items ?? []
  const currentSummary = currentSummaryQuery.data?.data
  const currentItems = currentItemsQuery.data?.data.items ?? []
  const diffItems = diffQuery.data?.data.items ?? []
  const canMoveComponents = Boolean(metadataQuery.data?.data.capabilities.component_movement)

  if (deviceQuery.isLoading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={device ? `${device.asset_code} · SN ${device.serial_number}` : "设备资产详情"}
        description={
          device
            ? `制造商：${companyMap.get(device.manufacturer_id) ?? device.manufacturer_id} · 供应商：${companyMap.get(device.supplier_id) ?? device.supplier_id} · 当前配置版本 v${device.configuration_version}`
            : ""
        }
        badge={device ? <AssetStatusBadge state={device.lifecycle_state} /> : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/assets/devices")}>
              <ArrowLeft className="mr-1.5 size-4" />
              返回列表
            </Button>
            {canReadComponents && device && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/assets/components?current_device_id=${device.id}`)}
              >
                查看当前机内组件台账
              </Button>
            )}
            {canHistory && device && (
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
                <History className="mr-1.5 size-4" />
                操作历史
              </Button>
            )}
          </div>
        }
      />

      <VersionConflictAlert
        conflict={conflict}
        onDismiss={() => setConflict(null)}
        onReload={async () => {
          setExpectedConfigVersion(undefined)
          setConflict(null)
          await Promise.all([
            deviceQuery.refetch(),
            currentSummaryQuery.refetch(),
            currentItemsQuery.refetch(),
            diffQuery.refetch(),
          ])
        }}
      />

      {device && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">当前保管位置</CardDescription>
                <CardTitle className="text-sm font-medium">
                  {device.location?.path ||
                    [device.location?.warehouse_name, device.location?.bin_name].filter(Boolean).join(" / ") ||
                    device.current_custody_location_id}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                入库时间：{formatDateTime(device.created_at, "yyyy-MM-dd HH:mm")}
              </CardContent>
            </Card>
          </div>

          <div className="col-span-12 md:col-span-4">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">来源验收单明细 / 基线记录</CardDescription>
                <CardTitle className="text-xs font-mono">
                  验收明细：{device.source_receipt_item_id}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <div>原始型号名称：{original?.snapshot.name ?? "—"}</div>
                <div>入库验收时间：{formatDateTime(original?.accepted_at, "yyyy-MM-dd HH:mm")}</div>
              </CardContent>
            </Card>
          </div>

          <div className="col-span-12 md:col-span-4">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">当前实装组件汇总</CardDescription>
                <CardTitle className="text-2xl font-semibold">
                  {currentSummary?.component_count ?? "—"} 件
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                未分配槽位：{currentSummary?.unknown_slot_count ?? 0} 件 · 配置版本 v{currentSummary?.configuration_version ?? device.configuration_version}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Tabs defaultValue="original" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="original">
            到货原始配置（验收基线 · 只读）
          </TabsTrigger>
          <TabsTrigger value="current">
            当前配置（v{currentSummary?.configuration_version ?? device?.configuration_version ?? 1}）
          </TabsTrigger>
          <TabsTrigger value="diff">配置差异对比</TabsTrigger>
        </TabsList>

        <TabsContent value="original" className="mt-4 space-y-4">
          <Alert>
            <Lock className="size-4" />
            <AlertTitle className="text-xs font-medium">到货原始配置不可修改</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              此处忠实保留设备在「到货验收通过瞬间」确认的配置快照与验收照片；后续组件补录序列号或变更安装位置，均不会修改此原始基线。
            </AlertDescription>
          </Alert>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    到货原始组件基线 ({original?.component_count ?? originalItems.length} 件)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {original?.snapshot.manufacturer_name} · {original?.snapshot.name} · 基线动作 {original?.action_id}
                  </CardDescription>
                </div>

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={includeCurrentIdentity}
                    onCheckedChange={(checked) => setIncludeCurrentIdentity(Boolean(checked))}
                  />
                  <span>附加对照：显示当前补录后的组件序列号</span>
                </label>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {originalItems.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  验收基线无组件条目
                </div>
              ) : (
                <div className="space-y-2">
                  {originalItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[11px]">
                            #{idx + 1}
                          </Badge>
                          <span className="font-medium">{item.snapshot.name}</span>
                          <AssetStatusBadge state={item.original_placement} />
                          {item.original_slot_key && (
                            <Badge variant="outline" className="font-mono text-[11px]">
                              原始槽位: {item.original_slot_key}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-3">
                          <span>规格：{formatSpecSummary(item.snapshot.spec)}</span>
                          <span>
                            到货时序列号：
                            <span className="font-mono text-foreground">
                              {item.serial_number_at_receipt ?? "（验收时未录/待补）"}
                            </span>
                          </span>
                          {includeCurrentIdentity && item.current_identity && (
                            <span className="text-primary">
                              当前序列号：<span className="font-mono">{item.current_identity.serial_number ?? "仍待补"}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {canReadComponents && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => navigate(`/assets/components/${item.part_item_id}`)}
                        >
                          组件详情
                          <ArrowRight className="ml-1 size-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">验收照片凭证 ({original?.photos.length ?? 0})</CardTitle>
              <CardDescription className="text-xs">验收归档后的原始照片附件</CardDescription>
            </CardHeader>
            <CardContent>
              {!original?.photos || original.photos.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  暂无关联照片
                </div>
              ) : (
                <div className="grid grid-cols-12 gap-3">
                  {original.photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="col-span-6 sm:col-span-4 md:col-span-3 rounded-lg border overflow-hidden cursor-pointer bg-muted/20"
                      onClick={() => setPreviewPhoto(photo)}
                    >
                      <div className="aspect-video overflow-hidden bg-muted">
                        <img
                          src={attachmentContentUrl(photo.id)}
                          alt={photo.original_filename}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px]">
                        <span className="truncate">{photo.original_filename}</span>
                        <Eye className="size-3.5 shrink-0 text-muted-foreground" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="current" className="mt-4 space-y-4">
          {!canMoveComponents && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle className="text-xs font-medium">组件安装变更状态说明</AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground">
                本期系统暂未开放设备间组件拆装/移动操作，当前配置反映最新实物在位分配与补录后的序列号状态。
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">当前机内配置明细 ({currentItems.length} 件)</CardTitle>
              <CardDescription className="text-xs">
                配置版本 v{currentSummary?.configuration_version ?? device?.configuration_version} · 最近确认时间{" "}
                {formatDateTime(currentSummary?.confirmed_at, "yyyy-MM-dd HH:mm")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {currentItems.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  当前无在位安装的组件
                </div>
              ) : (
                currentItems.map((alloc, idx) => (
                  <div
                    key={alloc.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[11px]">
                          #{idx + 1}
                        </Badge>
                        <span className="font-mono font-semibold">{alloc.part.internal_code}</span>
                        <AssetStatusBadge state={alloc.part.quality_state} />
                        {alloc.slot_key && (
                          <Badge variant="outline" className="font-mono text-[11px]">
                            当前槽位: {alloc.slot_key}
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-3">
                        <span>
                          当前序列号：
                          {alloc.part.serial_number ? (
                            <span className="font-mono text-foreground">{alloc.part.serial_number}</span>
                          ) : (
                            <span className="text-amber-600 font-medium">待补录</span>
                          )}
                        </span>
                        <span>记录时间：{formatDateTime(alloc.recorded_at, "yyyy-MM-dd HH:mm")}</span>
                      </div>
                    </div>

                    {canReadComponents && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => navigate(`/assets/components/${alloc.part_item_id}`)}
                      >
                        {alloc.part.serial_number ? "查看组件详情" : "前往补录 SN"}
                        <ArrowRight className="ml-1 size-3.5" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diff" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">到货原始配置 vs 当前配置差异</CardTitle>
                  <CardDescription className="text-xs">
                    比对组件去向与槽位变化（不包含组件序列号补录本身，补录属于同一组件身份完善）
                  </CardDescription>
                </div>
                <NativeSelect
                  aria-label="筛选配置差异类型"
                  value={diffFilter}
                  onChange={(e) => setDiffFilter(e.target.value as "all" | ConfigurationDiffKind)}
                >
                  <NativeSelectOption value="all">全部差异条目</NativeSelectOption>
                  <NativeSelectOption value="added">新增 (added)</NativeSelectOption>
                  <NativeSelectOption value="removed">移除 (removed)</NativeSelectOption>
                  <NativeSelectOption value="moved">槽位变更 (moved)</NativeSelectOption>
                  <NativeSelectOption value="unchanged">一致 (unchanged)</NativeSelectOption>
                </NativeSelect>
              </div>
            </CardHeader>

            <CardContent className="space-y-2">
              {diffItems.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  当前筛选条件下无差异记录
                </div>
              ) : (
                diffItems.map((row) => (
                  <div
                    key={row.part_item_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <AssetStatusBadge state={row.change} />
                      <span className="font-mono">组件 ID: {row.part_item_id}</span>
                      <span className="text-muted-foreground">
                        原始槽位：{row.original_slot_key ?? "未指定"} → 当前槽位：{row.current_slot_key ?? "未指定"}
                      </span>
                    </div>
                    {canReadComponents && (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => navigate(`/assets/components/${row.part_item_id}`)}
                      >
                        组件详情
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(previewPhoto)} onOpenChange={(open) => !open && setPreviewPhoto(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm truncate">{previewPhoto?.original_filename}</DialogTitle>
          </DialogHeader>
          {previewPhoto && (
            <div className="max-h-[75vh] overflow-auto flex items-center justify-center rounded-md bg-muted/30 p-2">
              <img
                src={attachmentContentUrl(previewPhoto.id)}
                alt={previewPhoto.original_filename}
                className="max-h-[70vh] w-auto object-contain rounded"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ReceivingHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="设备资产"
        recordLabel={device ? `${device.asset_code} (${device.serial_number})` : undefined}
        recordId={id}
        queryKey={(page) => queryKeys.assetDeviceHistory(id, page)}
        fetchHistory={(targetId, params, signal) => assetsService.getDeviceHistory(targetId, params, signal)}
      />
    </div>
  )
}
