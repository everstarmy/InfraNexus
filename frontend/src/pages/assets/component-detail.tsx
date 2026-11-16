import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, ArrowRight, CheckCircle2, History, KeyRound } from "lucide-react"
import { PageHeader } from "@/components/common/page-header"
import { AssetStatusBadge, useCompanyOptions } from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import { VersionConflictAlert, type VersionConflictState } from "@/components/receiving/version-conflict-alert"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { getErrorMessage, getReceivingError, isVersionConflict } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { assetsService } from "@/services/assets"
import { createIdempotencyKey } from "@/services/receiving-metadata"
import { useAuth } from "@/stores/auth-context"

export default function ComponentAssetDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()

  const canRead = can("assets:components:read")
  const canFillSerial = can("assets:components:serial")
  const canHistory = can("assets:components:history")
  const canReadDevices = can("assets:devices:read")

  const [serialNumber, setSerialNumber] = useState("")
  const [reason, setReason] = useState("现场拆机核对后补录厂商序列号")
  const [conflict, setConflict] = useState<VersionConflictState | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const companiesQuery = useCompanyOptions(canRead)
  const companyMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companiesQuery.data?.data.items ?? []) m.set(c.id, c.name)
    return m
  }, [companiesQuery.data])

  const partQuery = useQuery({
    queryKey: queryKeys.assetComponent(id),
    queryFn: ({ signal }) => assetsService.getComponent(id, signal),
    enabled: canRead && Boolean(id),
  })

  const part = partQuery.data?.data

  const fillMutation = useMutation({
    mutationFn: () =>
      assetsService.fillComponentSerialNumber(
        part!.id,
        part!.version,
        serialNumber.trim(),
        reason.trim(),
        createIdempotencyKey("part-sn"),
      ),
    onSuccess: async () => {
      notify.success("组件序列号已补录并记录审计事件")
      setConflict(null)
      setSerialNumber("")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.assetComponent(id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.assetComponentsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.assetDevicesAll }),
      ])
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        const info = getReceivingError(err)
        setConflict({
          message: getErrorMessage(err, "组件记录版本已被更新"),
          currentVersion: info?.current_version,
          localSummary: `已保留您输入的序列号 (${serialNumber}) 与原因说明`,
        })
        return
      }
      notify.error(getErrorMessage(err, "补录组件序列号失败"))
    },
  })

  if (partQuery.isLoading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={part ? `${part.internal_code} · 组件资产详情` : "组件资产详情"}
        description={
          part
            ? `制造商：${companyMap.get(part.manufacturer_id) ?? part.manufacturer_id} · 版本 v${part.version} · 入库于 ${formatDateTime(part.created_at)}`
            : ""
        }
        badge={part ? <AssetStatusBadge state={part.quality_state} /> : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/assets/components")}>
              <ArrowLeft className="mr-1.5 size-4" />
              返回列表
            </Button>
            {canHistory && part && (
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
                <History className="mr-1.5 size-4" />
                变更历史
              </Button>
            )}
          </div>
        }
      />

      <VersionConflictAlert
        conflict={conflict}
        onDismiss={() => setConflict(null)}
        onReload={async () => {
          await partQuery.refetch()
          setConflict(null)
        }}
      />

      {part && (
        <div className="grid grid-cols-12 gap-4 md:gap-6">
          <div className="col-span-12 lg:col-span-7 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">实物位置与来源追溯</CardTitle>
                <CardDescription className="text-xs">
                  明确区分「入库来源设备」与「当前安装设备 / 保管位置」，后续补录序列号不会改动原验收基线。
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-12 gap-4 text-xs">
                <div className="col-span-12 sm:col-span-6 rounded-lg border p-3 space-y-1.5">
                  <div className="text-muted-foreground">入库来源设备 (Source Device)</div>
                  <div className="font-mono font-medium break-all">{part.source_device_id}</div>
                  {canReadDevices && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => navigate(`/assets/devices/${part.source_device_id}`)}
                    >
                      打开来源设备
                      <ArrowRight className="ml-1 size-3.5" />
                    </Button>
                  )}
                </div>

                <div className="col-span-12 sm:col-span-6 rounded-lg border p-3 space-y-1.5">
                  <div className="text-muted-foreground flex items-center gap-2">
                    <span>当前安装设备 (Current Device)</span>
                    <AssetStatusBadge state={part.placement.kind} />
                  </div>
                  {part.current_device_id ? (
                    <>
                      <div className="font-mono font-medium break-all">{part.current_device_id}</div>
                      <div className="text-muted-foreground">安装槽位：{part.slot_key || "未指定槽位"}</div>
                      {canReadDevices && (
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => navigate(`/assets/devices/${part.current_device_id}`)}
                        >
                          打开当前所在设备
                          <ArrowRight className="ml-1 size-3.5" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground">当前暂存库房（未安装在设备内）</div>
                  )}
                </div>

                <div className="col-span-12 rounded-lg border bg-muted/20 p-3 space-y-1">
                  <div className="text-muted-foreground">当前保管库房 / 库位</div>
                  <div className="font-medium">
                    {part.location?.path ||
                      [part.location?.warehouse_name, part.location?.bin_name].filter(Boolean).join(" / ") ||
                      part.placement.custody_location_id ||
                      "—"}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="col-span-12 lg:col-span-5 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-4 text-primary" />
                  <CardTitle className="text-base">组件序列号 (SN)</CardTitle>
                </div>
                <CardDescription className="text-xs">
                  验收时允许先留空生成组件资产，后续由授权人员在此按件补录唯一厂商序列号。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {part.serial_number ? (
                  <Alert>
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    <AlertTitle className="text-xs font-medium">序列号已录入</AlertTitle>
                    <AlertDescription className="mt-1 space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span>当前序列号：</span>
                        <Badge variant="outline" className="font-mono text-xs">
                          {part.serial_number}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground">
                        已有序列号不支持直接覆盖，若录入有误需走专门更正流程。到货原始验收基线仍保留验收当时的状态。
                      </p>
                    </AlertDescription>
                  </Alert>
                ) : canFillSerial ? (
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!serialNumber.trim() || !reason.trim()) {
                        notify.warning("请填写组件序列号及补录原因")
                        return
                      }
                      fillMutation.mutate()
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="fill-part-sn" className="text-xs">
                        厂商序列号 (1～128 位可打印 ASCII 字符) *
                      </Label>
                      <Input
                        id="fill-part-sn"
                        value={serialNumber}
                        disabled={fillMutation.isPending}
                        placeholder="扫描或输入内存/硬盘标签序列号"
                        onChange={(e) => setSerialNumber(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="fill-part-reason" className="text-xs">
                        补录原因说明 *
                      </Label>
                      <Textarea
                        id="fill-part-reason"
                        rows={2}
                        value={reason}
                        disabled={fillMutation.isPending}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </div>
                    <Button type="submit" size="sm" className="w-full" disabled={fillMutation.isPending}>
                      {fillMutation.isPending ? "提交中..." : "确认补录序列号"}
                    </Button>
                  </form>
                ) : (
                  <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                    该组件尚未录入序列号，当前账号暂无补录权限 (`assets:components:serial`)。
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <ReceivingHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        title="组件资产"
        recordLabel={part?.internal_code}
        recordId={id}
        queryKey={(page) => queryKeys.assetComponentHistory(id, page)}
        fetchHistory={(targetId, params, signal) => assetsService.getComponentHistory(targetId, params, signal)}
      />
    </div>
  )
}
