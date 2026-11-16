import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Save, Trash2 } from "lucide-react"
import { AssetLocationPicker } from "@/components/receiving/asset-location-picker"
import {
  AssetStatusBadge,
  labelComponentKind,
  useReceivingMetadata,
} from "@/components/receiving/receiving-meta"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Textarea } from "@/components/ui/textarea"
import { getErrorMessage, isVersionConflict } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import {
  createIdempotencyKey,
  type AssetLocationInput,
} from "@/services/receiving-metadata"
import {
  receiptsService,
  type PlacementKind,
  type ReceiptComponentDTO,
} from "@/services/receipts"

export function ReceiptComponentsPanel({
  receiptId,
  itemId,
  receiptVersion,
  totalReceiptComponents,
  canEdit,
  componentRevOptions,
  componentRevLabelMap,
  highlightedComponentId,
  highlightedField,
  onVersionUpdate,
  onVersionConflict,
}: {
  receiptId: string
  itemId: string
  receiptVersion: number
  totalReceiptComponents: number
  canEdit: boolean
  componentRevOptions: Array<{ revision: { id: string }; label: string }>
  componentRevLabelMap: Map<string, string>
  highlightedComponentId?: string | null
  highlightedField?: string | null
  onVersionUpdate: (nextVersion: number) => void
  onVersionConflict: (err: unknown, summary?: string) => void
}) {
  const queryClient = useQueryClient()
  const metadataQuery = useReceivingMetadata()

  const [kindFilter, setKindFilter] = useState("")
  const [serialStatusFilter, setSerialStatusFilter] = useState<"" | "present" | "missing">("")
  const [placementFilter, setPlacementFilter] = useState<"" | PlacementKind>("")
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)

  const listQuery = useQuery({
    queryKey: queryKeys.receiptItemComponents(receiptId, itemId, {
      page,
      page_size: 50,
      kind: kindFilter || undefined,
      serial_status: serialStatusFilter || undefined,
      placement_kind: placementFilter || undefined,
    }),
    queryFn: ({ signal }) =>
      receiptsService.listComponents(
        receiptId,
        itemId,
        {
          page,
          page_size: 50,
          kind: kindFilter || undefined,
          serial_status: serialStatusFilter || undefined,
          placement_kind: placementFilter || undefined,
        },
        signal,
      ),
    enabled: Boolean(receiptId && itemId),
  })

  const components = listQuery.data?.data.items ?? []
  const total = listQuery.data?.data.total ?? 0
  const maxExpand = metadataQuery.data?.data.limits.max_component_expand ?? 512
  const maxTotal = metadataQuery.data?.data.limits.max_receipt_components ?? 4096
  const remainingBudget = Math.max(0, maxTotal - totalReceiptComponents)
  const batchLimit = Math.min(maxExpand, remainingBudget || maxExpand)

  const invalidate = async (nextVersion: number) => {
    onVersionUpdate(nextVersion)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.receiptItemComponents(receiptId, itemId, undefined) }),
      queryClient.invalidateQueries({ queryKey: ["receiving", "receipts", "components", receiptId, itemId] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.receipt(receiptId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.receiptItems(receiptId, undefined) }),
      queryClient.invalidateQueries({ queryKey: ["receiving", "receipts", "items", receiptId] }),
    ])
  }

  return (
    <Card id="field-components" className={highlightedField === "components" ? "ring-2 ring-destructive" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold">
              实收组件明细 ({total} 件)
            </CardTitle>
            <CardDescription className="text-xs">
              按计划预填后可增删或修改实收件数与槽位；组件序列号可暂时留空，整单入库后再从组件资产页补录。
            </CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" disabled={componentRevOptions.length === 0} onClick={() => setAddOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              批量添加实收组件
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <NativeSelect
            aria-label="按组件类别筛选"
            value={kindFilter}
            onChange={(e) => {
              setKindFilter(e.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value="">全部组件类别</NativeSelectOption>
            {(metadataQuery.data?.data.component_kinds ?? []).map((k) => (
              <NativeSelectOption key={k} value={k}>
                {labelComponentKind(k)}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <NativeSelect
            aria-label="按序列号状态筛选"
            value={serialStatusFilter}
            onChange={(e) => {
              setSerialStatusFilter(e.target.value as "" | "present" | "missing")
              setPage(1)
            }}
          >
            <NativeSelectOption value="">全部序列号状态</NativeSelectOption>
            <NativeSelectOption value="missing">待补序列号</NativeSelectOption>
            <NativeSelectOption value="present">已录入序列号</NativeSelectOption>
          </NativeSelect>

          <NativeSelect
            aria-label="按初始放置方式筛选"
            value={placementFilter}
            onChange={(e) => {
              setPlacementFilter(e.target.value as "" | PlacementKind)
              setPage(1)
            }}
          >
            <NativeSelectOption value="">全部放置方式</NativeSelectOption>
            <NativeSelectOption value="installed">已安装到设备</NativeSelectOption>
            <NativeSelectOption value="stored">暂存库房/库位</NativeSelectOption>
          </NativeSelect>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {components.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
            当前筛选条件下暂无组件记录。
          </div>
        ) : (
          <div className="space-y-2.5">
            {components.map((comp, idx) => (
              <ReceiptComponentRow
                key={comp.id}
                index={(page - 1) * 50 + idx + 1}
                receiptId={receiptId}
                itemId={itemId}
                receiptVersion={receiptVersion}
                component={comp}
                label={componentRevLabelMap.get(comp.part_model_revision_id) ?? comp.part_model_revision_id}
                canEdit={canEdit}
                isHighlighted={highlightedComponentId === comp.id}
                highlightedField={highlightedComponentId === comp.id ? highlightedField : null}
                onMutated={invalidate}
                onVersionConflict={onVersionConflict}
              />
            ))}
          </div>
        )}

        {total > 50 && (
          <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
            <span>共 {total} 件组件，当前第 {page} 页</span>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <Button size="xs" variant="outline" disabled={page * 50 >= total} onClick={() => setPage((p) => p + 1)}>
                下一页
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <BatchAddComponentsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        receiptId={receiptId}
        itemId={itemId}
        receiptVersion={receiptVersion}
        batchLimit={batchLimit}
        componentRevOptions={componentRevOptions}
        onAdded={invalidate}
        onVersionConflict={onVersionConflict}
      />
    </Card>
  )
}

function ReceiptComponentRow({
  index,
  receiptId,
  itemId,
  receiptVersion,
  component,
  label,
  canEdit,
  isHighlighted,
  highlightedField,
  onMutated,
  onVersionConflict,
}: {
  index: number
  receiptId: string
  itemId: string
  receiptVersion: number
  component: ReceiptComponentDTO
  label: string
  canEdit: boolean
  isHighlighted: boolean
  highlightedField?: string | null
  onMutated: (nextVersion: number) => Promise<void>
  onVersionConflict: (err: unknown, summary?: string) => void
}) {
  const [serialNumber, setSerialNumber] = useState(component.serial_number ?? "")
  const [slotKey, setSlotKey] = useState(component.slot_key ?? "")
  const [placement, setPlacement] = useState<PlacementKind>(component.initial_placement)
  const [location, setLocation] = useState<AssetLocationInput | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) {
      setSerialNumber(component.serial_number ?? "")
      setSlotKey(component.slot_key ?? "")
      setPlacement(component.initial_placement)
      setLocation(null)
    }
  }, [component, dirty])

  const updateMutation = useMutation({
    mutationFn: () =>
      receiptsService.updateComponent(receiptId, itemId, component.id, receiptVersion, {
        serial_number: serialNumber.trim() || null,
        slot_key: placement === "installed" ? slotKey.trim() || null : null,
        initial_placement: placement,
        location: placement === "stored" ? location : null,
      }),
    onSuccess: async (res) => {
      setDirty(false)
      await onMutated(res.data.receipt_version)
      notify.success(`组件 #${index} 已更新`)
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        onVersionConflict(err, `保留组件 #${index} (${label}) 的未保存修改`)
        return
      }
      notify.error(getErrorMessage(err, "更新组件失败"))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => receiptsService.deleteComponent(receiptId, itemId, component.id, receiptVersion),
    onSuccess: async (res) => {
      await onMutated(res.data.receipt_version)
      notify.success(`组件 #${index} 已移除`)
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        onVersionConflict(err)
        return
      }
      notify.error(getErrorMessage(err, "移除组件失败"))
    },
  })

  return (
    <div
      id={`component-row-${component.id}`}
      className={`rounded-lg border p-3 space-y-2.5 ${
        isHighlighted ? "border-amber-500 bg-amber-500/5 ring-1 ring-amber-500/40" : ""
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Badge variant="outline" className="font-mono text-[11px]">
            #{index}
          </Badge>
          <span className="font-medium truncate">{label}</span>
          <AssetStatusBadge state={component.initial_placement} />
          {!component.serial_number && (
            <Badge variant="outline" className="text-[11px] text-amber-600 border-amber-500/40">
              待补 SN
            </Badge>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant={dirty ? "default" : "outline"}
              disabled={updateMutation.isPending}
              onClick={() => {
                if (placement === "stored" && !location?.warehouse_id) {
                  notify.warning("暂存库房的组件必须选择保管库房")
                  return
                }
                updateMutation.mutate()
              }}
            >
              <Save className="mr-1 size-3" />
              保存
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-2.5">
        <div className="col-span-12 sm:col-span-4 space-y-1">
          <Label className="text-[11px]">组件序列号（可留空待补）</Label>
          <Input
            disabled={!canEdit}
            value={serialNumber}
            className={isHighlighted && highlightedField === "serial_number" ? "border-amber-500" : undefined}
            placeholder="留空则入库后补录"
            onChange={(e) => {
              setSerialNumber(e.target.value)
              setDirty(true)
            }}
          />
        </div>

        <div className="col-span-6 sm:col-span-4 space-y-1">
          <Label className="text-[11px]">放置方式</Label>
          <NativeSelect
            disabled={!canEdit}
            value={placement}
            onChange={(e) => {
              const next = e.target.value as PlacementKind
              setPlacement(next)
              if (next === "installed") setLocation(null)
              setDirty(true)
            }}
          >
            <NativeSelectOption value="installed">安装在本机内 (installed)</NativeSelectOption>
            <NativeSelectOption value="stored">暂存库房备件区 (stored)</NativeSelectOption>
          </NativeSelect>
        </div>

        {placement === "installed" ? (
          <div className="col-span-6 sm:col-span-4 space-y-1">
            <Label className="text-[11px]">安装槽位 Key（可选）</Label>
            <Input
              disabled={!canEdit}
              value={slotKey}
              placeholder="如 DIMM_A1"
              onChange={(e) => {
                setSlotKey(e.target.value)
                setDirty(true)
              }}
            />
          </div>
        ) : (
          <div className="col-span-12 space-y-1">
            <Label className="text-[11px]">暂存库房 / 库位 *</Label>
            <AssetLocationPicker
              value={location}
              disabled={!canEdit}
              showLabels={false}
              idPrefix={`comp-loc-${component.id}`}
              onChange={(loc) => {
                setLocation(loc)
                setDirty(true)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function BatchAddComponentsDialog({
  open,
  onOpenChange,
  receiptId,
  itemId,
  receiptVersion,
  batchLimit,
  componentRevOptions,
  onAdded,
  onVersionConflict,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  receiptId: string
  itemId: string
  receiptVersion: number
  batchLimit: number
  componentRevOptions: Array<{ revision: { id: string }; label: string }>
  onAdded: (nextVersion: number) => Promise<void>
  onVersionConflict: (err: unknown) => void
}) {
  const [partRevId, setPartRevId] = useState("")
  const [quantity, setQuantity] = useState(1)
  const [placement, setPlacement] = useState<PlacementKind>("installed")
  const [location, setLocation] = useState<AssetLocationInput | null>(null)
  const [serialLines, setSerialLines] = useState("")
  const [idemKey, setIdemKey] = useState(() => createIdempotencyKey("rcpt-parts"))

  useEffect(() => {
    if (!open) return
    setPartRevId(componentRevOptions[0]?.revision.id ?? "")
    setQuantity(1)
    setPlacement("installed")
    setLocation(null)
    setSerialLines("")
    setIdemKey(createIdempotencyKey("rcpt-parts"))
  }, [open, componentRevOptions])

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmedLines = serialLines
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s, idx, arr) => idx < arr.length - 1 || s !== "")
      const units =
        serialLines.trim().length > 0
          ? Array.from({ length: quantity }, (_, i) => ({
              serial_number: trimmedLines[i] ? trimmedLines[i] : null,
              slot_key: null,
            }))
          : undefined

      return receiptsService.createComponents(
        receiptId,
        itemId,
        {
          expected_version: receiptVersion,
          part_model_revision_id: partRevId,
          quantity,
          initial_placement: placement,
          location: placement === "stored" ? location : null,
          ...(units ? { units } : {}),
        },
        idemKey,
      )
    },
    onSuccess: async (res) => {
      notify.success(`已添加 ${quantity} 件组件记录`)
      onOpenChange(false)
      await onAdded(res.data.receipt_version)
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        onOpenChange(false)
        onVersionConflict(err)
        return
      }
      notify.error(getErrorMessage(err, "批量添加组件失败"))
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>批量添加实收组件</DialogTitle>
          <DialogDescription className="text-xs">
            单次最多展开 {batchLimit} 件；组件序列号可不填写（留空生成待补记录）。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!partRevId || quantity < 1 || quantity > batchLimit) {
              notify.warning(`请选择组件型号且数量在 1～${batchLimit} 之间`)
              return
            }
            if (placement === "stored" && !location?.warehouse_id) {
              notify.warning("暂存库房模式必须选择库房")
              return
            }
            mutation.mutate()
          }}
        >
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 space-y-1.5">
              <Label className="text-xs">已发布组件型号版本 *</Label>
              <NativeSelect value={partRevId} onChange={(e) => setPartRevId(e.target.value)}>
                <NativeSelectOption value="">请选择组件版本</NativeSelectOption>
                {componentRevOptions.map((opt) => (
                  <NativeSelectOption key={opt.revision.id} value={opt.revision.id}>
                    {opt.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="col-span-6 space-y-1.5">
              <Label className="text-xs">添加数量（件）*</Label>
              <Input
                type="number"
                min={1}
                max={batchLimit}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Math.min(batchLimit, Math.trunc(Number(e.target.value) || 1))))}
              />
            </div>

            <div className="col-span-6 space-y-1.5">
              <Label className="text-xs">初始放置方式 *</Label>
              <NativeSelect
                value={placement}
                onChange={(e) => {
                  const next = e.target.value as PlacementKind
                  setPlacement(next)
                  if (next === "installed") setLocation(null)
                }}
              >
                <NativeSelectOption value="installed">安装在本机 (installed)</NativeSelectOption>
                <NativeSelectOption value="stored">暂存库房 (stored)</NativeSelectOption>
              </NativeSelect>
            </div>

            {placement === "stored" && (
              <div className="col-span-12 space-y-1.5">
                <Label className="text-xs">暂存库房 / 库位 *</Label>
                <AssetLocationPicker value={location} onChange={setLocation} showLabels={false} idPrefix="add-part-loc" />
              </div>
            )}

            <div className="col-span-12 space-y-1.5">
              <Label className="text-xs">序列号列表（可选，每行一个，留空则待补）</Label>
              <Textarea
                rows={3}
                value={serialLines}
                placeholder="可留空；如需录入，每行填写一个序列号"
                onChange={(e) => setSerialLines(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "添加中..." : `确认添加 ${quantity} 件`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
