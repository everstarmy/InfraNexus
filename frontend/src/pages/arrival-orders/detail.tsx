import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  History,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react"
import { useConfirm } from "@/components/common/confirm-dialog"
import { PageHeader } from "@/components/common/page-header"
import { ReasonPromptDialog } from "@/components/receiving/reason-dialog"
import {
  AssetStatusBadge,
  MOUNTING_TYPE_LABELS,
  filterSuppliers,
  hasAllowedAction,
  labelComponentKind,
  labelDeviceCategory,
  useCompanyOptions,
  useReceivingMetadata,
} from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import { VersionConflictAlert, type VersionConflictState } from "@/components/receiving/version-conflict-alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getErrorMessage, getReceivingError, isVersionConflict } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import {
  arrivalOrdersService,
  type ArrivalComponentEditInput,
  type ArrivalLineDTO,
} from "@/services/arrival-orders"
import { receiptsService } from "@/services/receipts"
import { createIdempotencyKey } from "@/services/receiving-metadata"
import {
  deviceModelsService,
  formatCompatibleComponentLabel,
  formatRevisionTitle,
  listPublishedComponentRevisions,
  listPublishedDeviceRevisions,
  listSelectableDeviceRevisions,
  type CatalogRevisionDTO,
  type CompatibleComponentOptionDTO,
  type ModelSlotDTO,
} from "@/services/receiving-models"
import { useAuth } from "@/stores/auth-context"

export default function ArrivalOrderDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()

  const canRead = can("arrival-orders:read")
  const canUpdate = can("arrival-orders:update")
  const canOpen = can("arrival-orders:open")
  const canClose = can("arrival-orders:close")
  const canCancel = can("arrival-orders:cancel")
  const canHistory = can("arrival-orders:history")
  const canCreateReceipt = can("receipts:create")
  const canReadReceipts = can("receipts:read")

  const [headerForm, setHeaderForm] = useState({
    name: "",
    supplier_id: "",
    external_order_no: "",
    expected_arrival_date: "",
    description: "",
  })
  const [headerDirty, setHeaderDirty] = useState(false)
  const [conflict, setConflict] = useState<VersionConflictState | null>(null)
  const [addLineOpen, setAddLineOpen] = useState(false)
  const [editingLine, setEditingLine] = useState<ArrivalLineDTO | null>(null)
  const [reasonMode, setReasonMode] = useState<"close" | "cancel" | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const orderQuery = useQuery({
    queryKey: queryKeys.arrivalOrder(id),
    queryFn: ({ signal }) => arrivalOrdersService.get(id, signal),
    enabled: canRead && Boolean(id),
  })

  const linesQuery = useQuery({
    queryKey: queryKeys.arrivalOrderLines(id),
    queryFn: ({ signal }) => arrivalOrdersService.listLines(id, { page: 1, page_size: 100 }, signal),
    enabled: canRead && Boolean(id),
  })

  const relatedReceiptsQuery = useQuery({
    queryKey: queryKeys.receipts({ purchase_batch_id: id, page: 1, page_size: 20 }),
    queryFn: ({ signal }) => receiptsService.list({ purchase_batch_id: id, page: 1, page_size: 20 }, signal),
    enabled: canRead && canReadReceipts && Boolean(id),
  })

  const companiesQuery = useCompanyOptions(canRead)
  const suppliers = useMemo(
    () => filterSuppliers(companiesQuery.data?.data.items ?? []),
    [companiesQuery.data],
  )
  const supplierName = useMemo(() => {
    const sid = orderQuery.data?.data.supplier_id
    return companiesQuery.data?.data.items.find((c) => c.id === sid)?.name ?? sid ?? "—"
  }, [companiesQuery.data, orderQuery.data])

  const canReadDeviceModels = canRead && can("model-management:device-models:read")

  const deviceRevisionsQuery = useQuery({
    queryKey: queryKeys.publishedDeviceRevisions,
    queryFn: ({ signal }) => listPublishedDeviceRevisions(signal),
    enabled: canReadDeviceModels,
    staleTime: 60 * 1000,
  })
  const componentRevisionsQuery = useQuery({
    queryKey: queryKeys.publishedComponentRevisions,
    queryFn: ({ signal }) => listPublishedComponentRevisions(signal),
    enabled: canRead && can("model-management:component-models:read"),
    staleTime: 60 * 1000,
  })

  const deviceRevMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const opt of deviceRevisionsQuery.data ?? []) m.set(opt.revision.id, opt.label)
    return m
  }, [deviceRevisionsQuery.data])

  const deviceRevModelMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const opt of deviceRevisionsQuery.data ?? []) m.set(opt.revision.id, opt.revision.model_id)
    return m
  }, [deviceRevisionsQuery.data])

  const componentRevMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const opt of componentRevisionsQuery.data ?? []) m.set(opt.revision.id, opt.label)
    return m
  }, [componentRevisionsQuery.data])

  const order = orderQuery.data?.data
  const lines = linesQuery.data?.data.items ?? []

  useEffect(() => {
    if (order && !headerDirty) {
      setHeaderForm({
        name: order.name,
        supplier_id: order.supplier_id,
        external_order_no: order.external_order_no ?? "",
        expected_arrival_date: order.expected_arrival_date ? order.expected_arrival_date.slice(0, 10) : "",
        description: order.description ?? "",
      })
    }
  }, [order, headerDirty])

  const invalidateOrder = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.arrivalOrdersAll })
  }

  const handleVersionConflict = (err: unknown, summary?: string) => {
    if (isVersionConflict(err)) {
      const info = getReceivingError(err)
      setConflict({
        message: getErrorMessage(err, "到货单已被他人更新"),
        currentVersion: info?.current_version,
        localSummary: summary,
      })
      return true
    }
    return false
  }

  const updateHeaderMutation = useMutation({
    mutationFn: () => {
      if (!order) throw new Error("missing order")
      return arrivalOrdersService.update(order.id, order.version, {
        name: headerForm.name.trim(),
        supplier_id: headerForm.supplier_id,
        external_order_no: headerForm.external_order_no.trim() || null,
        expected_arrival_date: headerForm.expected_arrival_date || null,
        description: headerForm.description.trim(),
      })
    },
    onSuccess: () => {
      notify.success("到货单基本资料已更新")
      setHeaderDirty(false)
      setConflict(null)
      invalidateOrder()
    },
    onError: (err) => {
      if (!handleVersionConflict(err, "已保留主单据表单修改")) {
        notify.error(getErrorMessage(err, "保存基本资料失败"))
      }
    },
  })

  const openMutation = useMutation({
    mutationFn: () => arrivalOrdersService.open(order!.id, order!.version, createIdempotencyKey("arr-open")),
    onSuccess: () => {
      notify.success("到货单已开放收货，可发起分批验收")
      setConflict(null)
      invalidateOrder()
    },
    onError: (err) => {
      if (!handleVersionConflict(err)) {
        notify.error(getErrorMessage(err, "开放收货失败"))
      }
    },
  })

  const closeOrCancelMutation = useMutation({
    mutationFn: ({ mode, reason }: { mode: "close" | "cancel"; reason: string }) => {
      if (mode === "close") {
        return arrivalOrdersService.close(order!.id, order!.version, reason, createIdempotencyKey("arr-close"))
      }
      return arrivalOrdersService.cancel(order!.id, order!.version, reason, createIdempotencyKey("arr-cancel"))
    },
    onSuccess: (_res, vars) => {
      notify.success(vars.mode === "close" ? "到货单已提前关闭" : "到货单已取消")
      setReasonMode(null)
      setConflict(null)
      invalidateOrder()
    },
    onError: (err) => {
      setReasonMode(null)
      if (!handleVersionConflict(err)) {
        notify.error(getErrorMessage(err, "操作失败"))
      }
    },
  })

  const deleteLineMutation = useMutation({
    mutationFn: (line: ArrivalLineDTO) => arrivalOrdersService.deleteLine(order!.id, line.id, order!.version),
    onSuccess: () => {
      notify.success("计划明细已删除")
      setConflict(null)
      invalidateOrder()
    },
    onError: (err) => {
      if (!handleVersionConflict(err)) {
        notify.error(getErrorMessage(err, "删除明细失败"))
      }
    },
  })

  const launchReceiptMutation = useMutation({
    mutationFn: () =>
      receiptsService.create(order!.id, `来自到货单 ${order!.number}`, createIdempotencyKey("rcpt-create")),
    onSuccess: (res) => {
      notify.success(`已创建验收单 ${res.data.number}`)
      queryClient.invalidateQueries({ queryKey: queryKeys.receiptsAll })
      navigate(`/receipts/${res.data.id}`)
    },
    onError: (err) => notify.error(getErrorMessage(err, "发起验收失败")),
  })

  const allowEdit = hasAllowedAction(order?.allowed_actions, "update", canUpdate)
  const allowOpen = hasAllowedAction(order?.allowed_actions, "open", canOpen)
  const allowClose = hasAllowedAction(order?.allowed_actions, "close", canClose)
  const allowCancel = hasAllowedAction(order?.allowed_actions, "cancel", canCancel)
  const allowReceive = hasAllowedAction(order?.allowed_actions, "receive", canCreateReceipt)

  if (orderQuery.isLoading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={order ? `${order.number} · ${order.name}` : "到货单详情"}
        description={
          order
            ? `供应商：${supplierName} · 外部单号：${order.external_order_no || "无"} · 单据版本 v${order.version}`
            : ""
        }
        badge={order ? <AssetStatusBadge state={order.state} /> : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/arrival-orders")}>
              <ArrowLeft className="mr-1.5 size-4" />
              返回列表
            </Button>
            {canHistory && order && (
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
                <History className="mr-1.5 size-4" />
                操作历史
              </Button>
            )}
            {allowOpen && (
              <Button
                size="sm"
                onClick={() => {
                  if (headerDirty) {
                    notify.warning("主单据存在未保存更改，请先保存后再开放收货")
                    return
                  }
                  confirm({
                    title: `开放到货单「${order?.number}」收货`,
                    description: "开放后计划配置将被锁定为只读，随后即可创建分批验收单。",
                    confirmText: "确认开放",
                    onConfirm: () => openMutation.mutateAsync(),
                  })
                }}
              >
                <CheckCircle2 className="mr-1.5 size-4" />
                开放收货
              </Button>
            )}
            {allowReceive && (
              <Button size="sm" disabled={launchReceiptMutation.isPending} onClick={() => launchReceiptMutation.mutate()}>
                <ClipboardCheck className="mr-1.5 size-4" />
                {launchReceiptMutation.isPending ? "创建验收单..." : "发起分批验收"}
              </Button>
            )}
            {allowClose && (
              <Button size="sm" variant="outline" onClick={() => setReasonMode("close")}>
                <Lock className="mr-1.5 size-4" />
                提前关闭
              </Button>
            )}
            {allowCancel && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setReasonMode("cancel")}>
                <Ban className="mr-1.5 size-4" />
                取消到货单
              </Button>
            )}
          </div>
        }
      />

      <VersionConflictAlert
        conflict={conflict}
        onDismiss={() => setConflict(null)}
        onReload={async () => {
          setHeaderDirty(false)
          await Promise.all([orderQuery.refetch(), linesQuery.refetch()])
          setConflict(null)
        }}
      />

      {order && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">计划设备总数</CardDescription>
                <CardTitle className="text-2xl font-semibold">{order.planned_quantity} 台</CardTitle>
              </CardHeader>
            </Card>
          </div>
          <div className="col-span-12 md:col-span-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">累计通过验收</CardDescription>
                <CardTitle className="text-2xl font-semibold text-primary">{order.accepted_quantity} 台</CardTitle>
              </CardHeader>
            </Card>
          </div>
          <div className="col-span-12 md:col-span-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="text-xs">剩余可收货数量</CardDescription>
                <CardTitle className="text-2xl font-semibold">{order.remaining_quantity} 台</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </div>
      )}

      {order && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">单据基本信息</CardTitle>
                <CardDescription className="text-xs">
                  {allowEdit ? "草稿阶段可修改供应商、采购单号与预计到货日期" : "单据开放或终态后基本信息只读"}
                  {order.close_reason ? ` · 关闭/取消原因：${order.close_reason}` : ""}
                </CardDescription>
              </div>
              {allowEdit && (
                <Button
                  size="sm"
                  disabled={updateHeaderMutation.isPending || !headerDirty}
                  onClick={() => updateHeaderMutation.mutate()}
                >
                  <Save className="mr-1.5 size-3.5" />
                  {updateHeaderMutation.isPending ? "保存中..." : "保存基本资料"}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-12 gap-4">
            <div className="col-span-12 sm:col-span-4 space-y-1.5">
              <Label className="text-xs">名称 *</Label>
              <Input
                disabled={!allowEdit}
                value={headerForm.name}
                onChange={(e) => {
                  setHeaderForm((p) => ({ ...p, name: e.target.value }))
                  setHeaderDirty(true)
                }}
              />
            </div>
            <div className="col-span-12 sm:col-span-4 space-y-1.5">
              <Label className="text-xs">供应商 *</Label>
              <NativeSelect
                disabled={!allowEdit}
                value={headerForm.supplier_id}
                onChange={(e) => {
                  setHeaderForm((p) => ({ ...p, supplier_id: e.target.value }))
                  setHeaderDirty(true)
                }}
              >
                {suppliers.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="col-span-6 sm:col-span-2 space-y-1.5">
              <Label className="text-xs">采购单号</Label>
              <Input
                disabled={!allowEdit}
                value={headerForm.external_order_no}
                onChange={(e) => {
                  setHeaderForm((p) => ({ ...p, external_order_no: e.target.value }))
                  setHeaderDirty(true)
                }}
              />
            </div>
            <div className="col-span-6 sm:col-span-2 space-y-1.5">
              <Label className="text-xs">预计到货日期</Label>
              <Input
                type="date"
                disabled={!allowEdit}
                value={headerForm.expected_arrival_date}
                onChange={(e) => {
                  setHeaderForm((p) => ({ ...p, expected_arrival_date: e.target.value }))
                  setHeaderDirty(true)
                }}
              />
            </div>
            <div className="col-span-12 space-y-1.5">
              <Label className="text-xs">备注</Label>
              <Textarea
                rows={2}
                disabled={!allowEdit}
                value={headerForm.description}
                onChange={(e) => {
                  setHeaderForm((p) => ({ ...p, description: e.target.value }))
                  setHeaderDirty(true)
                }}
              />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">设备明细与每台计划配置 ({lines.length})</CardTitle>
              <CardDescription className="text-xs">
                添加已发布设备型号后自动带出标配组件清单，支持按采购合同微调每台计划组件及数量。
              </CardDescription>
            </div>
            {allowEdit && (
              <Button size="sm" onClick={() => setAddLineOpen(true)}>
                <Plus className="mr-1.5 size-4" />
                添加设备明细
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {lines.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
              暂无设备明细，请点击右上角「添加设备明细」选择已发布的设备型号版本。
            </div>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        行 #{line.line_no}
                      </Badge>
                      <span className="font-medium text-sm">
                        {deviceRevMap.get(line.device_model_revision_id) ?? line.device_model_revision_id}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      计划 {line.planned_quantity} 台 · 已收 {line.accepted_quantity} 台 · 剩余 {line.remaining_quantity} 台
                      {line.note ? ` · 备注：${line.note}` : ""}
                    </div>
                  </div>

                  {allowEdit && order && (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditingLine(line)}>
                        <Pencil className="mr-1.5 size-3.5" />
                        调整数量与计划配置
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          confirm({
                            title: `删除明细行 #${line.line_no}`,
                            description: "将移除该设备行及对应的每台计划组件清单。",
                            confirmText: "确认删除",
                            tone: "destructive",
                            onConfirm: () => deleteLineMutation.mutateAsync(line),
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-muted/30 p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    每台计划组件清单（{line.expected_components.length} 项）
                  </div>
                  {line.expected_components.length === 0 ? (
                    <div className="text-xs text-muted-foreground">无计划组件要求（空机框验收）</div>
                  ) : (
                    <div className="grid grid-cols-12 gap-2 text-xs">
                      {line.expected_components.map((comp) => (
                        <div
                          key={comp.id}
                          className="col-span-12 md:col-span-6 flex items-center justify-between rounded border bg-background px-3 py-2"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-medium truncate">
                              {componentRevMap.get(comp.part_model_revision_id) ?? comp.part_model_revision_id}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {comp.slot_key ? `槽位 ${comp.slot_key}` : "整机汇总"} · {comp.required ? "必配" : "选配"}
                            </div>
                          </div>
                          <Badge variant="secondary" className="shrink-0 font-mono">
                            x {comp.quantity}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {canReadReceipts && (relatedReceiptsQuery.data?.data.items.length ?? 0) > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">关联分批验收单</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedReceiptsQuery.data?.data.items.map((rec) => (
              <div
                key={rec.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="font-mono font-semibold text-primary hover:underline"
                    onClick={() => navigate(`/receipts/${rec.id}`)}
                  >
                    {rec.number}
                  </button>
                  <AssetStatusBadge state={rec.state} />
                  <span className="text-muted-foreground">
                    设备 {rec.device_count} 台（通过 {rec.passed_count} / 拒收 {rec.rejected_count}）· 组件 {rec.component_count} 件
                  </span>
                </div>
                <div className="text-muted-foreground">{formatDateTime(rec.updated_at)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {order && (
        <>
          <AddArrivalLineDialog
            open={addLineOpen}
            onOpenChange={setAddLineOpen}
            orderId={order.id}
            orderVersion={order.version}
            canReadDeviceModels={canReadDeviceModels}
            componentRevMap={componentRevMap}
            onConflict={(err) => handleVersionConflict(err)}
            onAdded={() => invalidateOrder()}
          />

          <EditArrivalLineDialog
            orderId={order.id}
            orderVersion={order.version}
            line={editingLine}
            deviceModelId={editingLine ? deviceRevModelMap.get(editingLine.device_model_revision_id) : undefined}
            deviceLabel={editingLine ? deviceRevMap.get(editingLine.device_model_revision_id) : undefined}
            onOpenChange={(open) => !open && setEditingLine(null)}
            componentRevMap={componentRevMap}
            onConflict={(err, msg) => handleVersionConflict(err, msg)}
            onSaved={() => invalidateOrder()}
          />

          <ReasonPromptDialog
            open={reasonMode !== null}
            onOpenChange={(open) => !open && setReasonMode(null)}
            title={reasonMode === "close" ? `提前关闭到货单 ${order.number}` : `取消到货单 ${order.number}`}
            description={
              reasonMode === "close"
                ? "提前关闭后将不能继续发起新的验收，已入库资产保留。"
                : "仅未入库任何设备时允许取消到货单。"
            }
            destructive={reasonMode === "cancel"}
            pending={closeOrCancelMutation.isPending}
            onConfirm={(reason) =>
              closeOrCancelMutation.mutateAsync({
                mode: reasonMode!,
                reason,
              })
            }
          />

          <ReceivingHistorySheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            title="到货单"
            recordLabel={order.number}
            recordId={order.id}
            queryKey={(page) => queryKeys.arrivalOrderHistory(order.id, page)}
            fetchHistory={(targetId, params, signal) => arrivalOrdersService.history(targetId, params, signal)}
          />
        </>
      )}
    </div>
  )
}

function AddArrivalLineDialog({
  open,
  onOpenChange,
  orderId,
  orderVersion,
  canReadDeviceModels,
  componentRevMap,
  onConflict,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string
  orderVersion: number
  canReadDeviceModels: boolean
  componentRevMap: Map<string, string>
  onConflict: (err: unknown) => boolean
  onAdded: () => void
}) {
  const [deviceModelId, setDeviceModelId] = useState("")
  const [deviceRevId, setDeviceRevId] = useState("")
  const [plannedQty, setPlannedQty] = useState(1)
  const [note, setNote] = useState("")
  const [idemKey, setIdemKey] = useState(() => createIdempotencyKey("arr-line"))

  const deviceModelsQuery = useQuery({
    queryKey: queryKeys.selectableDeviceModels,
    queryFn: ({ signal }) => deviceModelsService.list({ status: 1, page: 1, page_size: 100 }, signal),
    enabled: open && canReadDeviceModels,
    staleTime: 30 * 1000,
  })

  const selectableRevisionsQuery = useQuery({
    queryKey: queryKeys.selectableDeviceRevisions(deviceModelId),
    queryFn: ({ signal }) => listSelectableDeviceRevisions(deviceModelId, signal),
    enabled: open && canReadDeviceModels && Boolean(deviceModelId),
  })

  const deviceModels = deviceModelsQuery.data?.data.items ?? []
  const selectableRevisions = useMemo<CatalogRevisionDTO[]>(
    () => selectableRevisionsQuery.data ?? [],
    [selectableRevisionsQuery.data],
  )
  const selectedRevision = useMemo(
    () => selectableRevisions.find((r) => r.id === deviceRevId),
    [selectableRevisions, deviceRevId],
  )

  useEffect(() => {
    if (!open) return
    setDeviceModelId("")
    setDeviceRevId("")
    setPlannedQty(1)
    setNote("")
    setIdemKey(createIdempotencyKey("arr-line"))
  }, [open])

  const mutation = useMutation({
    mutationFn: () =>
      arrivalOrdersService.createLine(
        orderId,
        {
          expected_version: orderVersion,
          device_model_revision_id: deviceRevId,
          planned_quantity: plannedQty,
          configuration_source: "model",
          note: note.trim(),
        },
        idemKey,
      ),
    onSuccess: () => {
      notify.success("设备明细已添加，并带入该配置版本的标配组件")
      onOpenChange(false)
      onAdded()
    },
    onError: (err) => {
      if (onConflict(err)) {
        onOpenChange(false)
        return
      }
      notify.error(getErrorMessage(err, "添加明细失败"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>添加设备明细</DialogTitle>
          <DialogDescription className="text-xs">
            先选择设备型号，再选择该型号已发布且启用的配置版本。同一设备型号可添加多行以选用不同配置版本。
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex-1 overflow-y-auto space-y-4 pr-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (!deviceModelId || !deviceRevId || plannedQty < 1) {
              notify.warning("请选择设备型号、配置版本并输入有效计划数量")
              return
            }
            mutation.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs">设备型号 *</Label>
            <NativeSelect
              value={deviceModelId}
              onChange={(e) => {
                setDeviceModelId(e.target.value)
                setDeviceRevId("")
              }}
            >
              <NativeSelectOption value="">
                {deviceModelsQuery.isLoading ? "加载设备型号..." : "请选择设备型号"}
              </NativeSelectOption>
              {deviceModels.map((m) => (
                <NativeSelectOption key={m.id} value={m.id}>
                  {m.name} ({m.model_name || labelDeviceCategory(m.category)})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">配置版本 *</Label>
            <NativeSelect
              disabled={!deviceModelId || selectableRevisionsQuery.isLoading}
              value={deviceRevId}
              onChange={(e) => setDeviceRevId(e.target.value)}
            >
              <NativeSelectOption value="">
                {!deviceModelId
                  ? "请先选择设备型号"
                  : selectableRevisionsQuery.isLoading
                    ? "加载可选配置版本..."
                    : selectableRevisions.length === 0
                      ? "暂无可用（已发布且启用）配置版本"
                      : "请选择配置版本"}
              </NativeSelectOption>
              {selectableRevisions.map((rev) => (
                <NativeSelectOption key={rev.id} value={rev.id}>
                  {formatRevisionTitle(rev)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {deviceModelId && !selectableRevisionsQuery.isLoading && selectableRevisions.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                该设备型号当前没有处于「已发布 · 启用」状态的版本，请先在设备型号详情页发布或启用版本。
              </p>
            )}
          </div>

          {selectedRevision && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{formatRevisionTitle(selectedRevision)}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-[11px]">
                    v{selectedRevision.revision_no}
                  </Badge>
                  {selectedRevision.mounting_type && (
                    <Badge variant="secondary" className="text-[11px]">
                      {MOUNTING_TYPE_LABELS[selectedRevision.mounting_type] ?? selectedRevision.mounting_type}
                      {selectedRevision.height_u ? ` ${selectedRevision.height_u}U` : ""}
                    </Badge>
                  )}
                </div>
              </div>
              {selectedRevision.description && (
                <p className="text-muted-foreground">{selectedRevision.description}</p>
              )}
              <div className="space-y-1.5 pt-1 border-t">
                <div className="font-medium text-muted-foreground">
                  每台标配预览（{selectedRevision.standard_components?.length ?? 0} 项）
                </div>
                {(selectedRevision.standard_components?.length ?? 0) === 0 ? (
                  <div className="text-muted-foreground">无标配组件（空机框）</div>
                ) : (
                  <div className="space-y-1">
                    {selectedRevision.standard_components?.map((comp) => (
                      <div
                        key={comp.id}
                        className="flex items-center justify-between gap-2 rounded border bg-background px-2.5 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">
                            {componentRevMap.get(comp.part_model_revision_id) ?? comp.part_model_revision_id}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {comp.slot_key ? `槽位 ${comp.slot_key}` : "整机汇总"} ·{" "}
                            {comp.required ? "必配" : "选配"}
                          </div>
                        </div>
                        <Badge variant="secondary" className="shrink-0 font-mono text-[11px]">
                          x {comp.quantity}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-5 space-y-1.5">
              <Label className="text-xs">计划数量（台）*</Label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={plannedQty}
                onChange={(e) => setPlannedQty(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
              />
            </div>
            <div className="col-span-7 space-y-1.5">
              <Label className="text-xs">明细备注</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" />
            </div>
          </div>

          <DialogFooter className="pt-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending || !deviceRevId}>
              {mutation.isPending ? "添加中..." : "确认添加"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type EditableArrivalComponent = ArrivalComponentEditInput & { _uid: string }

let nextRowUid = 0
function createRowUid(): string {
  nextRowUid += 1
  return `arr-comp-${nextRowUid}`
}

function EditArrivalLineDialog({
  orderId,
  orderVersion,
  line,
  deviceModelId,
  deviceLabel,
  onOpenChange,
  componentRevMap,
  onConflict,
  onSaved,
}: {
  orderId: string
  orderVersion: number
  line: ArrivalLineDTO | null
  deviceModelId?: string
  deviceLabel?: string
  onOpenChange: (open: boolean) => void
  componentRevMap: Map<string, string>
  onConflict: (err: unknown, summary?: string) => boolean
  onSaved: () => void
}) {
  const open = Boolean(line)
  const metadataQuery = useReceivingMetadata(open)
  const componentKinds = metadataQuery.data?.data.component_kinds ?? []

  const [plannedQty, setPlannedQty] = useState(1)
  const [note, setNote] = useState("")
  const [components, setComponents] = useState<EditableArrivalComponent[]>([])
  const [kindFilter, setKindFilter] = useState("")
  const [searchFilter, setSearchFilter] = useState("")
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const debouncedSearch = useDebouncedValue(searchFilter.trim(), 250)

  const deviceRevisionDetailQuery = useQuery({
    queryKey: queryKeys.deviceModelRevision(deviceModelId ?? "", line?.device_model_revision_id ?? ""),
    queryFn: ({ signal }) => deviceModelsService.getRevision(deviceModelId!, line!.device_model_revision_id, signal),
    enabled: open && Boolean(deviceModelId) && Boolean(line?.device_model_revision_id),
    staleTime: 60 * 1000,
  })

  const deviceSlots = deviceRevisionDetailQuery.data?.data.slots ?? []

  useEffect(() => {
    if (!line) return
    setPlannedQty(line.planned_quantity)
    setNote(line.note ?? "")
    setKindFilter("")
    setSearchFilter("")
    setRowErrors({})
    setComponents(
      line.expected_components.map((c) => ({
        _uid: createRowUid(),
        id: c.id,
        part_model_revision_id: c.part_model_revision_id,
        slot_key: c.slot_key ?? null,
        quantity: c.quantity,
        required: c.required,
      })),
    )
  }, [line])

  const mutation = useMutation({
    mutationFn: () =>
      arrivalOrdersService.updateLine(orderId, line!.id, orderVersion, {
        planned_quantity: plannedQty,
        note: note.trim(),
        expected_components: components.map((c) => ({
          ...(c.id ? { id: c.id } : {}),
          part_model_revision_id: c.part_model_revision_id,
          slot_key: c.slot_key?.trim() || null,
          quantity: c.slot_key?.trim() ? 1 : c.quantity,
          required: c.required,
        })),
      }),
    onSuccess: () => {
      notify.success("设备明细与每台计划配置已保存")
      onOpenChange(false)
      onSaved()
    },
    onError: (err) => {
      if (onConflict(err, `保留明细 #${line?.line_no} 的编辑草稿（计划 ${plannedQty} 台）`)) {
        return
      }
      notify.error(getErrorMessage(err, "保存明细失败"))
    },
  })

  const handleRowValidationChange = useCallback((uid: string, error: string | null) => {
    setRowErrors((prev) => {
      const current = prev[uid] ?? null
      if (current === error) return prev
      const next = { ...prev }
      if (error) {
        next[uid] = error
      } else {
        delete next[uid]
      }
      return next
    })
  }, [])

  const handleSubmit = () => {
    for (let i = 0; i < components.length; i += 1) {
      const comp = components[i]
      if (!comp.part_model_revision_id) {
        notify.warning(`第 ${i + 1} 项尚未选择兼容组件版本`)
        return
      }
      const errMsg = rowErrors[comp._uid]
      if (errMsg) {
        notify.warning(`第 ${i + 1} 项：${errMsg}`)
        return
      }
    }
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>编辑明细 #{line?.line_no} 计划配置</DialogTitle>
          <DialogDescription className="text-xs">
            {deviceLabel ? `设备配置：${deviceLabel} · ` : ""}
            仅展示该设备配置版本已确认兼容的组件；若指定槽位，仅显示可安装到该槽位的组件。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-4 space-y-1.5">
              <Label className="text-xs">计划设备数量（台）*</Label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={plannedQty}
                onChange={(e) => setPlannedQty(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
              />
            </div>
            <div className="col-span-8 space-y-1.5">
              <Label className="text-xs">备注</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-xs font-medium">每台计划组件明细</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!deviceModelId}
                onClick={() =>
                  setComponents((prev) => [
                    ...prev,
                    {
                      _uid: createRowUid(),
                      part_model_revision_id: "",
                      slot_key: null,
                      quantity: 1,
                      required: true,
                    },
                  ])
                }
              >
                <Plus className="mr-1.5 size-3.5" />
                新增组件项
              </Button>
            </div>

            <div className="grid grid-cols-12 gap-2 rounded-lg border bg-muted/20 p-2.5">
              <div className="col-span-12 sm:col-span-4">
                <NativeSelect value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                  <NativeSelectOption value="">筛选类型：全部组件</NativeSelectOption>
                  {componentKinds.map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {labelComponentKind(k)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <div className="col-span-12 sm:col-span-8">
                <Input
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  placeholder="按组件名称或料号筛选候选..."
                />
              </div>
            </div>

            {components.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                当前未配置计划组件，点击右上角「新增组件项」添加。
              </div>
            ) : (
              components.map((comp) => (
                <ArrivalLineComponentRow
                  key={comp._uid}
                  comp={comp}
                  deviceModelId={deviceModelId}
                  deviceRevisionId={line?.device_model_revision_id ?? ""}
                  deviceSlots={deviceSlots}
                  kindFilter={kindFilter}
                  searchFilter={debouncedSearch}
                  componentRevMap={componentRevMap}
                  onValidationChange={handleRowValidationChange}
                  onChange={(next) =>
                    setComponents((prev) => prev.map((x) => (x._uid === comp._uid ? next : x)))
                  }
                  onRemove={() => {
                    handleRowValidationChange(comp._uid, null)
                    setComponents((prev) => prev.filter((x) => x._uid !== comp._uid))
                  }}
                />
              ))
            )}
          </div>
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={mutation.isPending} onClick={handleSubmit}>
            {mutation.isPending ? "保存中..." : "保存明细配置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ArrivalLineComponentRow({
  comp,
  deviceModelId,
  deviceRevisionId,
  deviceSlots,
  kindFilter,
  searchFilter,
  componentRevMap,
  onValidationChange,
  onChange,
  onRemove,
}: {
  comp: EditableArrivalComponent
  deviceModelId?: string
  deviceRevisionId: string
  deviceSlots: ModelSlotDTO[]
  kindFilter: string
  searchFilter: string
  componentRevMap: Map<string, string>
  onValidationChange: (uid: string, error: string | null) => void
  onChange: (next: EditableArrivalComponent) => void
  onRemove: () => void
}) {
  const slotParam = comp.slot_key?.trim() || ""
  const hasExtraFilter = Boolean(kindFilter || searchFilter)

  const candidatesQuery = useQuery({
    queryKey: queryKeys.deviceModelCompatibleComponents(deviceModelId ?? "", deviceRevisionId, {
      slot_key: slotParam,
      kind: kindFilter,
      search: searchFilter,
    }),
    queryFn: ({ signal }) =>
      deviceModelsService.listCompatibleComponents(
        deviceModelId!,
        deviceRevisionId,
        {
          slot_key: slotParam || undefined,
          kind: kindFilter || undefined,
          search: searchFilter || undefined,
          page: 1,
          page_size: 100,
        },
        signal,
      ),
    enabled: Boolean(deviceModelId && deviceRevisionId),
    staleTime: 30 * 1000,
  })

  // Query full slot_keys & true allows_unassigned without slot_key/filter narrowing.
  const fullCompatQuery = useQuery({
    queryKey: queryKeys.deviceModelCompatibleComponents(deviceModelId ?? "", deviceRevisionId, {
      slot_key: "",
      kind: "",
      search: "",
    }),
    queryFn: ({ signal }) =>
      deviceModelsService.listCompatibleComponents(
        deviceModelId!,
        deviceRevisionId,
        {
          page: 1,
          page_size: 100,
        },
        signal,
      ),
    enabled: Boolean(deviceModelId && deviceRevisionId && (hasExtraFilter || Boolean(slotParam)) && comp.part_model_revision_id),
    staleTime: 30 * 1000,
  })

  const candidates = candidatesQuery.data?.data.items ?? []
  const fullCandidates =
    hasExtraFilter || Boolean(slotParam) ? fullCompatQuery.data?.data.items ?? candidates : candidates

  const selectedCandidate = useMemo<CompatibleComponentOptionDTO | undefined>(
    () => fullCandidates.find((c) => c.part_model_revision_id === comp.part_model_revision_id),
    [fullCandidates, comp.part_model_revision_id],
  )

  const slotMetaMap = useMemo(() => {
    const map = new Map<string, ModelSlotDTO>()
    for (const s of deviceSlots) map.set(s.stable_key, s)
    return map
  }, [deviceSlots])

  const slotOptions = useMemo(() => {
    if (selectedCandidate) {
      return selectedCandidate.slot_keys
    }
    return deviceSlots.map((s) => s.stable_key)
  }, [selectedCandidate, deviceSlots])

  const requiresSlotSelection = Boolean(selectedCandidate && !selectedCandidate.allows_unassigned)
  const slotInvalidForCandidate = Boolean(
    selectedCandidate &&
      ((!comp.slot_key && !selectedCandidate.allows_unassigned) ||
        (comp.slot_key && !selectedCandidate.slot_keys.includes(comp.slot_key))),
  )

  useEffect(() => {
    if (!comp.part_model_revision_id) {
      onValidationChange(comp._uid, null)
      return
    }
    if (slotInvalidForCandidate) {
      onValidationChange(
        comp._uid,
        selectedCandidate?.slot_keys.length
          ? `该组件必须从可用槽位中选择：${selectedCandidate.slot_keys.join("、")}`
          : "该组件在当前设备版本无可用兼容槽位",
      )
      return
    }
    onValidationChange(comp._uid, null)
  }, [comp._uid, comp.part_model_revision_id, slotInvalidForCandidate, selectedCandidate, onValidationChange])

  const selectedMissingFromFiltered = Boolean(
    comp.part_model_revision_id && !candidates.some((c) => c.part_model_revision_id === comp.part_model_revision_id),
  )

  return (
    <div className="rounded-lg border p-2.5 space-y-1.5">
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-12 sm:col-span-3 space-y-1">
          <Label className="text-[11px]">
            指定槽位 {requiresSlotSelection ? "*" : "（可选）"}
          </Label>
          <NativeSelect
            value={comp.slot_key ?? ""}
            onChange={(e) => {
              const sk = e.target.value || null
              let nextPartId = comp.part_model_revision_id
              if (nextPartId) {
                if (sk === null && selectedCandidate && !selectedCandidate.allows_unassigned) {
                  nextPartId = ""
                } else if (sk !== null && (!selectedCandidate || !selectedCandidate.slot_keys.includes(sk))) {
                  nextPartId = ""
                }
              }
              onChange({
                ...comp,
                slot_key: sk,
                part_model_revision_id: nextPartId,
                quantity: sk ? 1 : comp.quantity,
              })
            }}
          >
            <NativeSelectOption value="" disabled={requiresSlotSelection}>
              {requiresSlotSelection ? "请选择可用槽位 *（不可整机汇总）" : "整机汇总（不限槽位）"}
            </NativeSelectOption>
            {comp.slot_key && !slotOptions.includes(comp.slot_key) && (
              <NativeSelectOption value={comp.slot_key}>{comp.slot_key}（非当前候选槽位）</NativeSelectOption>
            )}
            {slotOptions.map((sk) => {
              const meta = slotMetaMap.get(sk)
              return (
                <NativeSelectOption key={sk} value={sk}>
                  {meta ? `${sk} · ${meta.name} (${labelComponentKind(meta.kind)})` : sk}
                </NativeSelectOption>
              )
            })}
          </NativeSelect>
        </div>

        <div className="col-span-12 sm:col-span-5 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px]">兼容组件版本 *</Label>
            {comp.part_model_revision_id && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => onChange({ ...comp, part_model_revision_id: "" })}
              >
                <RotateCcw className="size-3" />
                重置重选
              </button>
            )}
          </div>
          <NativeSelect
            disabled={!deviceModelId || candidatesQuery.isLoading}
            value={comp.part_model_revision_id}
            onChange={(e) => {
              const nextPartId = e.target.value
              if (!nextPartId) {
                onChange({ ...comp, part_model_revision_id: "" })
                return
              }
              const nextCand = candidates.find((c) => c.part_model_revision_id === nextPartId)
              let nextSlot = comp.slot_key
              if (nextCand && !nextCand.allows_unassigned && (!nextSlot || !nextCand.slot_keys.includes(nextSlot))) {
                nextSlot = null
              }
              onChange({
                ...comp,
                part_model_revision_id: nextPartId,
                slot_key: nextSlot,
                quantity: nextSlot ? 1 : comp.quantity,
              })
            }}
          >
            <NativeSelectOption value="">
              {candidatesQuery.isLoading
                ? "加载兼容组件..."
                : comp.slot_key
                  ? `请选择兼容「${comp.slot_key}」的组件（${candidates.length}）`
                  : `请选择兼容组件（${candidates.length}）`}
            </NativeSelectOption>
            {selectedMissingFromFiltered && (
              <NativeSelectOption value={comp.part_model_revision_id}>
                {componentRevMap.get(comp.part_model_revision_id) ?? comp.part_model_revision_id}
                {hasExtraFilter ? "（筛选范围外）" : ""}
              </NativeSelectOption>
            )}
            {candidates.map((opt) => (
              <NativeSelectOption key={opt.part_model_revision_id} value={opt.part_model_revision_id}>
                {formatCompatibleComponentLabel(opt)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <div className="col-span-6 sm:col-span-2 space-y-1">
          <Label className="text-[11px]">每台数量 *</Label>
          <Input
            type="number"
            min={1}
            max={512}
            disabled={Boolean(comp.slot_key)}
            value={comp.slot_key ? 1 : comp.quantity}
            onChange={(e) =>
              onChange({
                ...comp,
                quantity: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
              })
            }
          />
        </div>

        <div className="col-span-6 sm:col-span-2 flex items-center justify-between gap-2 pb-1">
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox
              checked={comp.required}
              onCheckedChange={(checked) => onChange({ ...comp, required: Boolean(checked) })}
            />
            必配
          </label>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {!comp.part_model_revision_id && (
        <p className="text-[11px] text-muted-foreground">
          {comp.slot_key
            ? `已筛选可装入槽位 ${comp.slot_key} 的兼容组件，请选择组件版本。`
            : "请先选择兼容组件版本（或先选择目标槽位后再选组件）。"}
        </p>
      )}
      {comp.part_model_revision_id && slotInvalidForCandidate && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {selectedCandidate?.slot_keys.length
            ? `该组件必须从可用槽位中选择：${selectedCandidate.slot_keys.join("、")}`
            : "该组件在当前设备版本没有可用的兼容槽位，请重新选择组件。"}
        </p>
      )}
      {comp.part_model_revision_id &&
        !candidatesQuery.isLoading &&
        !fullCompatQuery.isLoading &&
        !selectedCandidate && (
          <p className="text-[11px] text-destructive">
            当前组件未出现在兼容候选中，请重置后重新选择兼容组件。
          </p>
        )}
    </div>
  )
}
