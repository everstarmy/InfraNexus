import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Ban, History, Info, Plus, Save, Trash2 } from "lucide-react"
import { useConfirm } from "@/components/common/confirm-dialog"
import { PageHeader } from "@/components/common/page-header"
import { AssetLocationPicker } from "@/components/receiving/asset-location-picker"
import { ReasonPromptDialog } from "@/components/receiving/reason-dialog"
import {
  AssetStatusBadge,
  hasAllowedAction,
  useReceivingMetadata,
} from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import { VersionConflictAlert, type VersionConflictState } from "@/components/receiving/version-conflict-alert"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { getErrorMessage, getReceivingError, isVersionConflict, type ReceiptIssueDTO } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { arrivalOrdersService } from "@/services/arrival-orders"
import { receiptsService, type InspectionResult, type ReceiptItemDTO } from "@/services/receipts"
import { createIdempotencyKey, toLocationInput, type AssetLocationInput } from "@/services/receiving-metadata"
import { listPublishedComponentRevisions, listPublishedDeviceRevisions } from "@/services/receiving-models"
import { useAuth } from "@/stores/auth-context"
import { ReceiptComponentsPanel } from "./components/receipt-components-panel"
import { ReceiptPhotosPanel } from "./components/receipt-photos-panel"
import { ReceiptPreviewPanel } from "./components/receipt-preview-panel"
import { ReceiptResultView } from "./components/receipt-result-view"

function toLocalDateTimeInput(iso?: string | null): string {
  const date = iso ? new Date(iso) : new Date()
  if (!Number.isFinite(date.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function ReceiptDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { can } = useAuth()

  const canRead = can("receipts:read")
  const canUpdate = can("receipts:update")
  const canEvidence = can("receipts:evidence")
  const canComplete = can("receipts:complete")
  const canCancel = can("receipts:cancel")
  const canHistory = can("receipts:history")

  const metadataQuery = useReceivingMetadata(canRead)

  const receiptQuery = useQuery({
    queryKey: queryKeys.receipt(id),
    queryFn: ({ signal }) => receiptsService.get(id, signal),
    enabled: canRead && Boolean(id),
  })

  const itemsQuery = useQuery({
    queryKey: queryKeys.receiptItems(id, { page: 1, page_size: 100 }),
    queryFn: ({ signal }) => receiptsService.listItems(id, { page: 1, page_size: 100 }, signal),
    enabled: canRead && Boolean(id),
  })

  const receipt = receiptQuery.data?.data
  const items = itemsQuery.data?.data.items ?? []

  const orderQuery = useQuery({
    queryKey: queryKeys.arrivalOrder(receipt?.purchase_batch_id ?? ""),
    queryFn: ({ signal }) => arrivalOrdersService.get(receipt!.purchase_batch_id, signal),
    enabled: canRead && can("arrival-orders:read") && Boolean(receipt?.purchase_batch_id),
  })

  const linesQuery = useQuery({
    queryKey: queryKeys.arrivalOrderLines(receipt?.purchase_batch_id ?? ""),
    queryFn: ({ signal }) => arrivalOrdersService.listLines(receipt!.purchase_batch_id, { page: 1, page_size: 100 }, signal),
    enabled: canRead && can("arrival-orders:read") && Boolean(receipt?.purchase_batch_id),
  })

  const deviceRevQuery = useQuery({
    queryKey: queryKeys.publishedDeviceRevisions,
    queryFn: ({ signal }) => listPublishedDeviceRevisions(signal),
    enabled: canRead && can("model-management:device-models:read"),
    staleTime: 60 * 1000,
  })
  const componentRevQuery = useQuery({
    queryKey: queryKeys.publishedComponentRevisions,
    queryFn: ({ signal }) => listPublishedComponentRevisions(signal),
    enabled: canRead && can("model-management:component-models:read"),
    staleTime: 60 * 1000,
  })

  const deviceRevMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const opt of deviceRevQuery.data ?? []) m.set(opt.revision.id, opt.label)
    return m
  }, [deviceRevQuery.data])

  const componentRevMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const opt of componentRevQuery.data ?? []) m.set(opt.revision.id, opt.label)
    return m
  }, [componentRevQuery.data])

  const lines = linesQuery.data?.data.items ?? []
  const lineMap = useMemo(() => {
    const m = new Map(lines.map((l) => [l.id, l]))
    return m
  }, [lines])

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [addItemOpen, setAddItemOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conflict, setConflict] = useState<VersionConflictState | null>(null)
  const [focusedIssue, setFocusedIssue] = useState<{
    itemId?: string | null
    componentId?: string | null
    field?: string | null
  } | null>(null)

  const [itemForm, setItemForm] = useState({
    serial_number: "",
    inspection_result: "pending" as InspectionResult,
    inspected_at_local: toLocalDateTimeInput(),
    location: null as AssetLocationInput | null,
    difference_reason: "",
    reject_reason: "",
    configuration_confirmed: false,
  })
  const [itemDirty, setItemDirty] = useState(false)

  useEffect(() => {
    if (items.length === 0) {
      setSelectedItemId(null)
      return
    }
    if (!selectedItemId || !items.some((x) => x.id === selectedItemId)) {
      setSelectedItemId(items[0].id)
      setItemDirty(false)
    }
  }, [items, selectedItemId])

  const selectedItem = useMemo(
    () => items.find((x) => x.id === selectedItemId) ?? null,
    [items, selectedItemId],
  )

  useEffect(() => {
    if (selectedItem && !itemDirty) {
      setItemForm({
        serial_number: selectedItem.serial_number ?? "",
        inspection_result: selectedItem.inspection_result,
        inspected_at_local: toLocalDateTimeInput(selectedItem.inspected_at),
        location: toLocationInput(selectedItem.location),
        difference_reason: selectedItem.difference_reason ?? "",
        reject_reason: selectedItem.reject_reason ?? "",
        configuration_confirmed: selectedItem.configuration_confirmed,
      })
    }
  }, [selectedItem, itemDirty])

  // Query selected item's full component counts to show planned vs actual configuration delta clearly
  const selectedItemAllComponentsQuery = useQuery({
    queryKey: ["receiving", "receipts", "item-diff-check", id, selectedItemId],
    queryFn: ({ signal }) => receiptsService.listComponents(id, selectedItemId!, { page: 1, page_size: 100 }, signal),
    enabled: canRead && Boolean(id && selectedItemId),
  })

  const configComparison = useMemo(() => {
    if (!selectedItem) return { hasDiff: false, plannedTotal: 0, actualTotal: 0, rows: [] as Array<{ label: string; planned: number; actual: number }> }
    const line = lineMap.get(selectedItem.purchase_line_id)
    const plannedMap = new Map<string, number>()
    for (const exp of line?.expected_components ?? []) {
      plannedMap.set(exp.part_model_revision_id, (plannedMap.get(exp.part_model_revision_id) ?? 0) + exp.quantity)
    }
    const actualMap = new Map<string, number>()
    for (const act of selectedItemAllComponentsQuery.data?.data.items ?? []) {
      if (act.initial_placement === "installed") {
        actualMap.set(act.part_model_revision_id, (actualMap.get(act.part_model_revision_id) ?? 0) + 1)
      }
    }
    const keys = new Set([...plannedMap.keys(), ...actualMap.keys()])
    let plannedTotal = 0
    let actualTotal = 0
    let hasDiff = false
    const rows: Array<{ label: string; planned: number; actual: number }> = []
    for (const key of keys) {
      const p = plannedMap.get(key) ?? 0
      const a = actualMap.get(key) ?? 0
      plannedTotal += p
      actualTotal += a
      if (p !== a) hasDiff = true
      rows.push({
        label: componentRevMap.get(key) ?? key,
        planned: p,
        actual: a,
      })
    }
    return { hasDiff, plannedTotal, actualTotal, rows }
  }, [selectedItem, lineMap, selectedItemAllComponentsQuery.data, componentRevMap])

  const refreshReceipt = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.receipt(id) }),
      queryClient.invalidateQueries({ queryKey: ["receiving", "receipts", "items", id] }),
      queryClient.invalidateQueries({ queryKey: ["receiving", "receipts", "item-diff-check", id] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.arrivalOrdersAll }),
    ])
  }

  const handleVersionConflict = (err: unknown, summary?: string) => {
    const info = getReceivingError(err)
    setConflict({
      message: getErrorMessage(err, "验收单已被其他操作更新"),
      currentVersion: info?.current_version,
      localSummary: summary ?? (itemDirty ? `已保留当前台次编辑内容（SN: ${itemForm.serial_number || "未填"}）` : undefined),
    })
  }

  const saveItemMutation = useMutation({
    mutationFn: () => {
      if (!receipt || !selectedItem) throw new Error("missing item")
      const inspectedIso = itemForm.inspected_at_local
        ? new Date(itemForm.inspected_at_local).toISOString()
        : new Date().toISOString()
      return receiptsService.updateItem(receipt.id, selectedItem.id, receipt.version, {
        serial_number: itemForm.serial_number.trim() || null,
        location: itemForm.location,
        inspection_result: itemForm.inspection_result,
        inspected_at: inspectedIso,
        difference_reason: itemForm.difference_reason.trim() || null,
        reject_reason: itemForm.reject_reason.trim() || null,
        configuration_confirmed: itemForm.configuration_confirmed,
      })
    },
    onSuccess: async () => {
      notify.success("当前设备验收明细已保存")
      setItemDirty(false)
      setConflict(null)
      await refreshReceipt()
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        handleVersionConflict(err)
        return
      }
      notify.error(getErrorMessage(err, "保存设备验收信息失败"))
    },
  })

  const deleteItemMutation = useMutation({
    mutationFn: (item: ReceiptItemDTO) => receiptsService.deleteItem(receipt!.id, item.id, receipt!.version),
    onSuccess: async () => {
      notify.success("设备台次已从本批草稿移除")
      setItemDirty(false)
      setConflict(null)
      await refreshReceipt()
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        handleVersionConflict(err)
        return
      }
      notify.error(getErrorMessage(err, "移除设备台次失败"))
    },
  })

  const cancelReceiptMutation = useMutation({
    mutationFn: (reason: string) =>
      receiptsService.cancel(receipt!.id, receipt!.version, reason, createIdempotencyKey("rcpt-cancel")),
    onSuccess: async () => {
      notify.success("验收单已取消")
      setCancelOpen(false)
      setConflict(null)
      await refreshReceipt()
    },
    onError: (err) => {
      setCancelOpen(false)
      if (isVersionConflict(err)) {
        handleVersionConflict(err)
        return
      }
      notify.error(getErrorMessage(err, "取消验收单失败"))
    },
  })

  const allowEdit = hasAllowedAction(receipt?.allowed_actions, "update", canUpdate)
  const allowEvidence = hasAllowedAction(receipt?.allowed_actions, "evidence", canEvidence)
  const allowComplete = hasAllowedAction(receipt?.allowed_actions, "complete", canComplete)
  const allowCancel = hasAllowedAction(receipt?.allowed_actions, "cancel", canCancel)
  const maxDevices = metadataQuery.data?.data.limits.max_receipt_devices ?? 50

  const handleLocateIssue = (issue: ReceiptIssueDTO) => {
    setFocusedIssue({
      itemId: issue.item_id,
      componentId: issue.component_id,
      field: issue.field,
    })
    if (issue.item_id) {
      setSelectedItemId(issue.item_id)
      setItemDirty(false)
    }
    setTimeout(() => {
      const targetId = issue.component_id
        ? `component-row-${issue.component_id}`
        : `field-${issue.field}`
      const el = document.getElementById(targetId)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus()
      }
    }, 80)
  }

  if (receiptQuery.isLoading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={receipt ? `验收单 ${receipt.number}` : "验收工作台"}
        description={
          receipt
            ? `关联到货单：${orderQuery.data?.data.number ?? receipt.purchase_batch_id} · 单据版本 v${receipt.version} · 共 ${receipt.device_count} 台设备 / ${receipt.component_count} 件组件`
            : ""
        }
        badge={receipt ? <AssetStatusBadge state={receipt.state} /> : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/receipts")}>
              <ArrowLeft className="mr-1.5 size-4" />
              返回列表
            </Button>
            {orderQuery.data?.data && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate(`/arrival-orders/${orderQuery.data!.data.id}`)}
              >
                查看关联到货单
              </Button>
            )}
            {canHistory && receipt && (
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
                <History className="mr-1.5 size-4" />
                操作历史
              </Button>
            )}
            {allowCancel && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>
                <Ban className="mr-1.5 size-4" />
                取消验收单
              </Button>
            )}
          </div>
        }
      />

      <VersionConflictAlert
        conflict={conflict}
        onDismiss={() => setConflict(null)}
        onReload={async () => {
          setItemDirty(false)
          await refreshReceipt()
          setConflict(null)
        }}
      />

      {receipt?.state === "completed" && <ReceiptResultView receiptId={receipt.id} />}

      {receipt?.state === "draft" && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle className="text-xs font-medium">序列号与配置核对规则提示</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            1) 通过验收的设备<strong>必须录入设备序列号</strong>并上传至少 1 张现场照片；2) 组件序列号<strong>可暂时留空</strong>，预检仅提示待补，资产生成后可逐件补录；3) 实际组件与到货计划不一致时，请填写差异原因后再确认配置。
          </AlertDescription>
        </Alert>
      )}

      {receipt && (
        <div className="grid grid-cols-12 gap-4 md:gap-6">
          <div className="col-span-12 lg:col-span-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      待验设备列表 ({items.length} / {maxDevices})
                    </CardTitle>
                    <CardDescription className="text-xs">
                      从到货单明细按计划配置预填逐台验收台次
                    </CardDescription>
                  </div>
                  {allowEdit && (
                    <Button
                      size="sm"
                      disabled={items.length >= maxDevices || lines.length === 0}
                      onClick={() => setAddItemOpen(true)}
                    >
                      <Plus className="mr-1 size-4" />
                      添加设备
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    暂无验收台次，点击「添加设备」从到货单明细预填配置。
                  </div>
                ) : (
                  items.map((item, idx) => {
                    const active = item.id === selectedItemId
                    const line = lineMap.get(item.purchase_line_id)
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "rounded-lg border p-3 transition-colors cursor-pointer space-y-1.5",
                          active ? "border-primary bg-primary/5" : "hover:bg-muted/40",
                        )}
                        onClick={() => {
                          setSelectedItemId(item.id)
                          setItemDirty(false)
                          setFocusedIssue(null)
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold">
                            #{idx + 1} · {item.serial_number || "未录设备 SN"}
                          </span>
                          <AssetStatusBadge state={item.inspection_result} />
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {deviceRevMap.get(item.device_model_revision_id) ?? item.device_model_revision_id}
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            {line ? `明细 #${line.line_no} (余 ${line.remaining_quantity})` : "到货明细"}
                          </span>
                          {allowEdit && (
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              className="h-5 px-1.5 text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                confirm({
                                  title: `移除验收台次 #${idx + 1}`,
                                  description: "将同步删除该台次下的草稿组件与照片。",
                                  confirmText: "确认移除",
                                  tone: "destructive",
                                  onConfirm: () => deleteItemMutation.mutateAsync(item),
                                })
                              }}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            {receipt.state === "draft" && (
              <ReceiptPreviewPanel
                receiptId={receipt.id}
                receiptVersion={receipt.version}
                canComplete={allowComplete}
                onLocateIssue={handleLocateIssue}
                onCompleted={refreshReceipt}
                onVersionConflict={(err) => handleVersionConflict(err)}
                onQueryLatestState={refreshReceipt}
              />
            )}
          </div>

          <div className="col-span-12 lg:col-span-8 space-y-4">
            {selectedItem ? (
              <>
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          单台核验信息
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {deviceRevMap.get(selectedItem.device_model_revision_id) ?? selectedItem.device_model_revision_id}
                        </CardDescription>
                      </div>
                      {allowEdit && (
                        <Button
                          size="sm"
                          disabled={saveItemMutation.isPending}
                          onClick={() => saveItemMutation.mutate()}
                        >
                          <Save className="mr-1.5 size-3.5" />
                          {saveItemMutation.isPending ? "保存中..." : "保存本台信息"}
                        </Button>
                      )}
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-12 sm:col-span-4 space-y-1.5">
                        <Label htmlFor="field-serial_number" className="text-xs">
                          设备序列号 (SN) {itemForm.inspection_result === "pass" ? "*" : ""}
                        </Label>
                        <Input
                          id="field-serial_number"
                          disabled={!allowEdit}
                          className={
                            focusedIssue?.field === "serial_number" && !focusedIssue.componentId
                              ? "border-destructive ring-2 ring-destructive/20"
                              : undefined
                          }
                          value={itemForm.serial_number}
                          placeholder="通过验收时必须填写"
                          onChange={(e) => {
                            setItemForm((p) => ({ ...p, serial_number: e.target.value }))
                            setItemDirty(true)
                          }}
                        />
                      </div>

                      <div className="col-span-6 sm:col-span-4 space-y-1.5">
                        <Label htmlFor="field-inspection_result" className="text-xs">
                          验收判定 *
                        </Label>
                        <NativeSelect
                          id="field-inspection_result"
                          disabled={!allowEdit}
                          value={itemForm.inspection_result}
                          onChange={(e) => {
                            setItemForm((p) => ({
                              ...p,
                              inspection_result: e.target.value as InspectionResult,
                            }))
                            setItemDirty(true)
                          }}
                        >
                          <NativeSelectOption value="pending">待检 (pending)</NativeSelectOption>
                          <NativeSelectOption value="pass">验收通过 (pass)</NativeSelectOption>
                          <NativeSelectOption value="reject">拒收 (reject)</NativeSelectOption>
                        </NativeSelect>
                      </div>

                      <div className="col-span-6 sm:col-span-4 space-y-1.5">
                        <Label htmlFor="field-inspected_at" className="text-xs">
                          现场核验时间 *
                        </Label>
                        <Input
                          id="field-inspected_at"
                          type="datetime-local"
                          disabled={!allowEdit}
                          value={itemForm.inspected_at_local}
                          onChange={(e) => {
                            setItemForm((p) => ({ ...p, inspected_at_local: e.target.value }))
                            setItemDirty(true)
                          }}
                        />
                      </div>
                    </div>

                    <div
                      id="field-custody_location_id"
                      className={cn(
                        "space-y-1.5 rounded-lg border p-3",
                        focusedIssue?.field === "custody_location_id" || focusedIssue?.field === "location"
                          ? "border-destructive"
                          : "",
                      )}
                    >
                      <Label className="text-xs font-medium">入库保管位置（库房 / 库位）*</Label>
                      <AssetLocationPicker
                        value={itemForm.location}
                        disabled={!allowEdit}
                        showLabels={false}
                        idPrefix="item-loc"
                        onChange={(loc) => {
                          setItemForm((p) => ({ ...p, location: loc }))
                          setItemDirty(true)
                        }}
                      />
                    </div>

                    {configComparison.rows.length > 0 && (
                      <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            计划配置 vs 本台实收安装组件对照（计划共 {configComparison.plannedTotal} 件 / 实收安装 {configComparison.actualTotal} 件）
                          </span>
                          {configComparison.hasDiff ? (
                            <Badge variant="destructive" className="font-normal">
                              存在配置数量差异 · 须填写差异原因
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="font-normal text-emerald-600 border-emerald-500/40">
                              与计划配置一致
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-12 gap-2">
                          {configComparison.rows.map((r, i) => (
                            <div
                              key={i}
                              className="col-span-12 sm:col-span-6 flex items-center justify-between rounded border bg-background px-2.5 py-1.5"
                            >
                              <span className="truncate pr-2">{r.label}</span>
                              <span className={cn("font-mono shrink-0", r.planned !== r.actual && "text-amber-600 font-semibold")}>
                                计划 {r.planned} / 实收 {r.actual}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-12 sm:col-span-6 space-y-1.5">
                        <Label htmlFor="field-difference_reason" className="text-xs">
                          配置差异原因 {configComparison.hasDiff && itemForm.inspection_result === "pass" ? "*" : "（有差异时必填）"}
                        </Label>
                        <Textarea
                          id="field-difference_reason"
                          rows={2}
                          disabled={!allowEdit}
                          className={focusedIssue?.field === "difference_reason" ? "border-destructive" : undefined}
                          value={itemForm.difference_reason}
                          placeholder="如 供应商分批补发，本批实装 8 根内存"
                          onChange={(e) => {
                            setItemForm((p) => ({ ...p, difference_reason: e.target.value }))
                            setItemDirty(true)
                          }}
                        />
                      </div>

                      <div className="col-span-12 sm:col-span-6 space-y-1.5">
                        <Label htmlFor="field-reject_reason" className="text-xs">
                          拒收原因 {itemForm.inspection_result === "reject" ? "*" : "（拒收时必填）"}
                        </Label>
                        <Textarea
                          id="field-reject_reason"
                          rows={2}
                          disabled={!allowEdit || itemForm.inspection_result !== "reject"}
                          className={focusedIssue?.field === "reject_reason" ? "border-destructive" : undefined}
                          value={itemForm.reject_reason}
                          placeholder="仅拒收时填写原因"
                          onChange={(e) => {
                            setItemForm((p) => ({ ...p, reject_reason: e.target.value }))
                            setItemDirty(true)
                          }}
                        />
                      </div>
                    </div>

                    <label
                      id="field-configuration_confirmed"
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs cursor-pointer",
                        focusedIssue?.field === "configuration_confirmed" ? "border-destructive bg-destructive/5" : "",
                      )}
                    >
                      <Checkbox
                        checked={itemForm.configuration_confirmed}
                        disabled={!allowEdit}
                        onCheckedChange={(checked) => {
                          setItemForm((p) => ({ ...p, configuration_confirmed: Boolean(checked) }))
                          setItemDirty(true)
                        }}
                      />
                      <span>
                        已逐件核对并确认当前设备实收组件配置（注意：增删改下方组件后需重新勾选并保存本台信息）
                      </span>
                    </label>
                  </CardContent>
                </Card>

                <ReceiptComponentsPanel
                  receiptId={receipt.id}
                  itemId={selectedItem.id}
                  receiptVersion={receipt.version}
                  totalReceiptComponents={receipt.component_count}
                  canEdit={allowEdit}
                  componentRevOptions={componentRevQuery.data ?? []}
                  componentRevLabelMap={componentRevMap}
                  highlightedComponentId={focusedIssue?.componentId}
                  highlightedField={focusedIssue?.field}
                  onVersionUpdate={() => {
                    setItemDirty(false)
                    refreshReceipt()
                  }}
                  onVersionConflict={(err, summary) => handleVersionConflict(err, summary)}
                />

                <ReceiptPhotosPanel
                  receiptId={receipt.id}
                  itemId={selectedItem.id}
                  receiptVersion={receipt.version}
                  canUpload={allowEvidence}
                  canDelete={allowEvidence}
                  highlighted={focusedIssue?.field === "photos"}
                  onVersionUpdate={() => refreshReceipt()}
                  onVersionConflict={(err) => handleVersionConflict(err)}
                />
              </>
            ) : (
              <Card>
                <CardContent className="py-16 text-center text-xs text-muted-foreground">
                  请在左侧添加并选择一台设备开始核验。
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {receipt && (
        <>
          <AddReceiptItemDialog
            open={addItemOpen}
            onOpenChange={setAddItemOpen}
            receiptId={receipt.id}
            receiptVersion={receipt.version}
            lines={lines}
            deviceRevMap={deviceRevMap}
            onConflict={(err) => handleVersionConflict(err)}
            onAdded={async (newItemId) => {
              setSelectedItemId(newItemId)
              setItemDirty(false)
              await refreshReceipt()
            }}
          />

          <ReasonPromptDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            title={`取消验收单 ${receipt.number}`}
            description="取消后草稿数据不再参与收货累计，此操作不可撤销。"
            destructive
            pending={cancelReceiptMutation.isPending}
            onConfirm={(reason) => cancelReceiptMutation.mutateAsync(reason)}
          />

          <ReceivingHistorySheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            title="验收单"
            recordLabel={receipt.number}
            recordId={receipt.id}
            queryKey={(page) => queryKeys.receiptHistory(receipt.id, page)}
            fetchHistory={(targetId, params, signal) => receiptsService.history(targetId, params, signal)}
          />
        </>
      )}
    </div>
  )
}

function AddReceiptItemDialog({
  open,
  onOpenChange,
  receiptId,
  receiptVersion,
  lines,
  deviceRevMap,
  onConflict,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  receiptId: string
  receiptVersion: number
  lines: Array<{
    id: string
    line_no: number
    device_model_revision_id: string
    planned_quantity: number
    accepted_quantity: number
    remaining_quantity: number
  }>
  deviceRevMap: Map<string, string>
  onConflict: (err: unknown) => void
  onAdded: (newItemId: string) => Promise<void>
}) {
  const [lineId, setLineId] = useState("")
  const [serialNumber, setSerialNumber] = useState("")
  const [idemKey, setIdemKey] = useState(() => createIdempotencyKey("rcpt-item"))

  useEffect(() => {
    if (!open) return
    const available = lines.find((l) => l.remaining_quantity > 0) ?? lines[0]
    setLineId(available?.id ?? "")
    setSerialNumber("")
    setIdemKey(createIdempotencyKey("rcpt-item"))
  }, [open, lines])

  const mutation = useMutation({
    mutationFn: () =>
      receiptsService.createItem(
        receiptId,
        {
          expected_version: receiptVersion,
          purchase_line_id: lineId,
          serial_number: serialNumber.trim() || null,
          configuration_source: "order",
        },
        idemKey,
      ),
    onSuccess: async (res) => {
      notify.success("已按到货单计划配置预填设备及组件明细")
      onOpenChange(false)
      await onAdded(res.data.item.id)
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        onOpenChange(false)
        onConflict(err)
        return
      }
      notify.error(getErrorMessage(err, "添加验收设备失败"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加待验设备</DialogTitle>
          <DialogDescription className="text-xs">
            选择到货单明细行后，系统将按该行「每台计划配置」自动生成待核对的组件明细。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!lineId) {
              notify.warning("请选择到货单明细行")
              return
            }
            mutation.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs">到货单明细行 *</Label>
            <NativeSelect value={lineId} onChange={(e) => setLineId(e.target.value)}>
              <NativeSelectOption value="">请选择明细行</NativeSelectOption>
              {lines.map((l) => (
                <NativeSelectOption key={l.id} value={l.id}>
                  行 #{l.line_no} · {deviceRevMap.get(l.device_model_revision_id) ?? l.device_model_revision_id} (剩余 {l.remaining_quantity} 台)
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">设备序列号（可先留空，稍后录入）</Label>
            <Input
              value={serialNumber}
              placeholder="扫描或输入设备机身序列号"
              onChange={(e) => setSerialNumber(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "预填中..." : "确定添加"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
