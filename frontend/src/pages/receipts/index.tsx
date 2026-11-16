import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Eye, History, Plus } from "lucide-react"
import {
  DataTable,
  DataTableCard,
  DataTableTitle,
  createActionsColumn,
  type ColumnDef,
} from "@/components/data-table"
import { PageHeader } from "@/components/common/page-header"
import { AssetStatusBadge } from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import { Button } from "@/components/ui/button"
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
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getErrorMessage } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { arrivalOrdersService } from "@/services/arrival-orders"
import { receiptsService, type ReceiptDTO, type ReceiptState } from "@/services/receipts"
import { createIdempotencyKey } from "@/services/receiving-metadata"
import { useAuth } from "@/stores/auth-context"

export default function ReceiptsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()

  const canRead = can("receipts:read")
  const canCreate = can("receipts:create")
  const canHistory = can("receipts:history")
  const canReadOrders = can("arrival-orders:read")

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [stateFilter, setStateFilter] = useState<"all" | ReceiptState>("all")
  const [orderFilter, setOrderFilter] = useState("all")
  const [createdFromDate, setCreatedFromDate] = useState("")
  const [createdToDate, setCreatedToDate] = useState("")

  const [createOpen, setCreateOpen] = useState(false)
  const [historyTarget, setHistoryTarget] = useState<ReceiptDTO | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const ordersQuery = useQuery({
    queryKey: queryKeys.arrivalOrders({ page: 1, page_size: 100 }),
    queryFn: ({ signal }) => arrivalOrdersService.list({ page: 1, page_size: 100 }, signal),
    enabled: canRead && canReadOrders,
    staleTime: 30 * 1000,
  })

  const orderMap = useMemo(() => {
    const map = new Map<string, { number: string; name: string }>()
    for (const o of ordersQuery.data?.data.items ?? []) {
      map.set(o.id, { number: o.number, name: o.name })
    }
    return map
  }, [ordersQuery.data])

  const openOrders = useMemo(
    () => (ordersQuery.data?.data.items ?? []).filter((o) => o.state === "open"),
    [ordersQuery.data],
  )

  const queryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      state: stateFilter === "all" ? undefined : stateFilter,
      purchase_batch_id: orderFilter === "all" ? undefined : orderFilter,
      created_from: createdFromDate ? `${createdFromDate}T00:00:00Z` : undefined,
      created_to: createdToDate ? `${createdToDate}T23:59:59Z` : undefined,
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    [debouncedSearch, stateFilter, orderFilter, createdFromDate, createdToDate, pagination],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.receipts(queryParams),
    queryFn: ({ signal }) => receiptsService.list(queryParams, signal),
    enabled: canRead,
  })

  const columns = useMemo<ColumnDef<ReceiptDTO>[]>(
    () => [
      {
        accessorKey: "number",
        header: "验收单号",
        cell: ({ row }) => {
          const item = row.original
          return (
            <button
              type="button"
              className="font-mono text-xs font-semibold text-primary hover:underline"
              onClick={() => navigate(`/receipts/${item.id}`)}
            >
              {item.number}
            </button>
          )
        },
      },
      {
        id: "arrival_order",
        header: "关联到货单",
        cell: ({ row }) => {
          const ord = orderMap.get(row.original.purchase_batch_id)
          return ord ? (
            <button
              type="button"
              className="text-left hover:underline"
              onClick={() => navigate(`/arrival-orders/${row.original.purchase_batch_id}`)}
            >
              <div className="font-mono text-xs font-medium">{ord.number}</div>
              <div className="text-[11px] text-muted-foreground truncate max-w-48">{ord.name}</div>
            </button>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">{row.original.purchase_batch_id}</span>
          )
        },
      },
      {
        id: "counts",
        header: "设备与组件统计",
        cell: ({ row }) => {
          const r = row.original
          return (
            <div className="text-xs space-y-0.5">
              <div>
                设备 {r.device_count} 台（通过 {r.passed_count} / 拒收 {r.rejected_count}）
              </div>
              <div className="text-[11px] text-muted-foreground">实收组件 {r.component_count} 件</div>
            </div>
          )
        },
      },
      {
        accessorKey: "note",
        header: "备注",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate block max-w-48">{row.original.note || "—"}</span>
        ),
      },
      {
        accessorKey: "state",
        header: "状态",
        cell: ({ row }) => <AssetStatusBadge state={row.original.state} />,
      },
      {
        accessorKey: "updated_at",
        header: "更新时间",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updated_at)}</span>
        ),
      },
      createActionsColumn<ReceiptDTO>({
        actions: (item) => [
          {
            key: "detail",
            label: item.state === "draft" ? "进入验收工作台" : "查看验收结果",
            icon: <Eye />,
            onSelect: () => navigate(`/receipts/${item.id}`),
          },
          {
            key: "history",
            label: "操作历史",
            icon: <History />,
            hidden: !canHistory,
            onSelect: () => setHistoryTarget(item),
          },
        ],
      }),
    ],
    [canHistory, navigate, orderMap],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="验收工作台"
        description="基于开放收货的到货单逐台录入设备序列号、核对实际组件配置、上传图片凭证并执行预检提交。"
        icon={ClipboardCheck}
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              发起分批验收
            </Button>
          )
        }
      />

      <DataTableCard
        title={<DataTableTitle title="分批验收单列表" count={listQuery.data?.data.total} />}
        isPlaceholderData={listQuery.isPlaceholderData}
        error={listQuery.error}
        hasData={Boolean(listQuery.data)}
        onRetry={() => void listQuery.refetch()}
        retrying={listQuery.isFetching}
      >
        <DataTable
          columns={columns}
          data={listQuery.data?.data.items ?? []}
          loading={listQuery.isLoading}
          getRowId={(r) => r.id}
          serverFiltering
          externalSearch={{
            value: search,
            onChange: (val) => {
              setSearch(val)
              setPagination((p) => ({ ...p, pageIndex: 0 }))
            },
          }}
          serverPagination={{
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
            total: listQuery.data?.data.total ?? 0,
            onChange: setPagination,
          }}
          searchPlaceholder="搜索验收单号或备注..."
          onRefresh={() => void listQuery.refetch()}
          isRefreshing={listQuery.isFetching}
          searchTrailing={
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="按验收单状态筛选"
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value as "all" | ReceiptState)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部状态</NativeSelectOption>
                <NativeSelectOption value="draft">草稿 (draft)</NativeSelectOption>
                <NativeSelectOption value="completed">已完成 (completed)</NativeSelectOption>
                <NativeSelectOption value="canceled">已取消 (canceled)</NativeSelectOption>
              </NativeSelect>

              {canReadOrders && (
                <NativeSelect
                  aria-label="按关联到货单筛选"
                  value={orderFilter}
                  onChange={(e) => {
                    setOrderFilter(e.target.value)
                    setPagination((p) => ({ ...p, pageIndex: 0 }))
                  }}
                >
                  <NativeSelectOption value="all">全部到货单</NativeSelectOption>
                  {(ordersQuery.data?.data.items ?? []).map((o) => (
                    <NativeSelectOption key={o.id} value={o.id}>
                      {o.number} · {o.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}

              <Input
                type="date"
                aria-label="创建开始日期"
                className="w-36"
                value={createdFromDate}
                onChange={(e) => {
                  setCreatedFromDate(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              />
              <Input
                type="date"
                aria-label="创建结束日期"
                className="w-36"
                value={createdToDate}
                onChange={(e) => {
                  setCreatedToDate(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              />
            </div>
          }
        />
      </DataTableCard>

      <ReceiptCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        openOrders={openOrders}
        onCreated={(rec) => {
          queryClient.invalidateQueries({ queryKey: queryKeys.receiptsAll })
          navigate(`/receipts/${rec.id}`)
        }}
      />

      <ReceivingHistorySheet
        open={Boolean(historyTarget)}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        title="验收单"
        recordLabel={historyTarget?.number}
        recordId={historyTarget?.id}
        queryKey={(page) => queryKeys.receiptHistory(historyTarget?.id ?? "", page)}
        fetchHistory={(id, params, signal) => receiptsService.history(id, params, signal)}
      />
    </div>
  )
}

function ReceiptCreateDialog({
  open,
  onOpenChange,
  openOrders,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  openOrders: Array<{ id: string; number: string; name: string; remaining_quantity: number }>
  onCreated: (rec: ReceiptDTO) => void
}) {
  const [orderId, setOrderId] = useState("")
  const [note, setNote] = useState("")
  const [idemKey, setIdemKey] = useState(() => createIdempotencyKey("rcpt"))

  useEffect(() => {
    if (!open) return
    setOrderId(openOrders[0]?.id ?? "")
    setNote("")
    setIdemKey(createIdempotencyKey("rcpt"))
  }, [open, openOrders])

  const mutation = useMutation({
    mutationFn: () => receiptsService.create(orderId, note.trim(), idemKey),
    onSuccess: (res) => {
      notify.success(`验收单 ${res.data.number} 已创建`)
      onOpenChange(false)
      onCreated(res.data)
    },
    onError: (err) => notify.error(getErrorMessage(err, "创建验收单失败")),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发起分批验收</DialogTitle>
          <DialogDescription className="text-xs">
            仅可从状态为「收货中 (open)」的到货单发起分批验收。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!orderId) {
              notify.warning("请选择开放收货中的到货单")
              return
            }
            mutation.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label className="text-xs">开放收货中的到货单 *</Label>
            <NativeSelect value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <NativeSelectOption value="">请选择到货单</NativeSelectOption>
              {openOrders.map((o) => (
                <NativeSelectOption key={o.id} value={o.id}>
                  {o.number} · {o.name} (待收 {o.remaining_quantity} 台)
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">本批验收备注</Label>
            <Textarea
              rows={2}
              value={note}
              placeholder="如 第一批机柜到货 2 台"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "创建中..." : "创建并进入工作台"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
