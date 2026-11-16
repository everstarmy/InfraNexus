import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ClipboardCheck, Eye, History, PackageCheck, Plus } from "lucide-react"
import {
  DataTable,
  DataTableCard,
  DataTableTitle,
  createActionsColumn,
  type ColumnDef,
} from "@/components/data-table"
import { PageHeader } from "@/components/common/page-header"
import {
  AssetStatusBadge,
  filterSuppliers,
  hasAllowedAction,
  useCompanyOptions,
} from "@/components/receiving/receiving-meta"
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
import {
  arrivalOrdersService,
  type ArrivalOrderDTO,
  type ArrivalOrderState,
} from "@/services/arrival-orders"
import { receiptsService } from "@/services/receipts"
import { createIdempotencyKey } from "@/services/receiving-metadata"
import { useAuth } from "@/stores/auth-context"

export default function ArrivalOrdersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useAuth()

  const canRead = can("arrival-orders:read")
  const canCreate = can("arrival-orders:create")
  const canHistory = can("arrival-orders:history")
  const canCreateReceipt = can("receipts:create")

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [stateFilter, setStateFilter] = useState<"all" | ArrivalOrderState>("all")
  const [supplierFilter, setSupplierFilter] = useState("all")
  const [createdFromDate, setCreatedFromDate] = useState("")
  const [createdToDate, setCreatedToDate] = useState("")

  const [createOpen, setCreateOpen] = useState(false)
  const [historyTarget, setHistoryTarget] = useState<ArrivalOrderDTO | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)

  const companiesQuery = useCompanyOptions(canRead)
  const suppliers = useMemo(
    () => filterSuppliers(companiesQuery.data?.data.items ?? []),
    [companiesQuery.data],
  )
  const supplierMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of companiesQuery.data?.data.items ?? []) {
      map.set(c.id, c.name)
    }
    return map
  }, [companiesQuery.data])

  const queryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      state: stateFilter === "all" ? undefined : stateFilter,
      supplier_id: supplierFilter === "all" ? undefined : supplierFilter,
      created_from: createdFromDate ? `${createdFromDate}T00:00:00Z` : undefined,
      created_to: createdToDate ? `${createdToDate}T23:59:59Z` : undefined,
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    [debouncedSearch, stateFilter, supplierFilter, createdFromDate, createdToDate, pagination],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.arrivalOrders(queryParams),
    queryFn: ({ signal }) => arrivalOrdersService.list(queryParams, signal),
    enabled: canRead,
  })

  const launchReceiptMutation = useMutation({
    mutationFn: (order: ArrivalOrderDTO) =>
      receiptsService.create(order.id, `来自到货单 ${order.number}`, createIdempotencyKey("rcpt")),
    onSuccess: (res) => {
      notify.success(`验收单 ${res.data.number} 已创建`)
      queryClient.invalidateQueries({ queryKey: queryKeys.receiptsAll })
      navigate(`/receipts/${res.data.id}`)
    },
    onError: (err) => notify.error(getErrorMessage(err, "发起验收失败")),
  })

  const columns = useMemo<ColumnDef<ArrivalOrderDTO>[]>(
    () => [
      {
        accessorKey: "number",
        header: "到货单号 / 名称",
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className="min-w-0">
              <button
                type="button"
                className="font-mono text-xs font-semibold text-primary hover:underline text-left block"
                onClick={() => navigate(`/arrival-orders/${item.id}`)}
              >
                {item.number}
              </button>
              <div className="text-xs text-foreground truncate max-w-60">{item.name}</div>
            </div>
          )
        },
      },
      {
        id: "supplier",
        header: "供应商",
        cell: ({ row }) => (
          <span className="text-xs">{supplierMap.get(row.original.supplier_id) ?? row.original.supplier_id}</span>
        ),
      },
      {
        accessorKey: "external_order_no",
        header: "采购单号",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">{row.original.external_order_no || "—"}</span>
        ),
      },
      {
        accessorKey: "expected_arrival_date",
        header: "预计到货日",
        cell: ({ row }) => (
          <span className="text-xs">{row.original.expected_arrival_date?.slice(0, 10) || "—"}</span>
        ),
      },
      {
        id: "progress",
        header: "累计验收 / 计划",
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className="text-xs space-y-0.5">
              <div>
                <span className="font-medium text-foreground">{item.accepted_quantity}</span>
                <span className="text-muted-foreground"> / {item.planned_quantity} 台</span>
              </div>
              <div className="text-[11px] text-muted-foreground">剩余待收：{item.remaining_quantity}</div>
            </div>
          )
        },
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
      createActionsColumn<ArrivalOrderDTO>({
        actions: (item) => [
          {
            key: "detail",
            label: "查看与维护明细",
            icon: <Eye />,
            onSelect: () => navigate(`/arrival-orders/${item.id}`),
          },
          {
            key: "receive",
            label: "发起分批验收",
            icon: <ClipboardCheck />,
            hidden: !hasAllowedAction(item.allowed_actions, "receive", canCreateReceipt),
            onSelect: () => launchReceiptMutation.mutate(item),
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
    [canCreateReceipt, canHistory, launchReceiptMutation, navigate, supplierMap],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="到货单管理"
        description="录入采购到货计划、每台计划配置，开放收货后跟踪累计验收与剩余数量。"
        icon={PackageCheck}
        actions={
          canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              新建到货单
            </Button>
          )
        }
      />

      <DataTableCard
        title={<DataTableTitle title="到货计划列表" count={listQuery.data?.data.total} />}
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
          searchPlaceholder="搜索到货单号、名称或外部采购单号..."
          onRefresh={() => void listQuery.refetch()}
          isRefreshing={listQuery.isFetching}
          searchTrailing={
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="按单据状态筛选"
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value as "all" | ArrivalOrderState)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部状态</NativeSelectOption>
                <NativeSelectOption value="draft">草稿 (draft)</NativeSelectOption>
                <NativeSelectOption value="open">收货中 (open)</NativeSelectOption>
                <NativeSelectOption value="completed">已完成 (completed)</NativeSelectOption>
                <NativeSelectOption value="closed">已关闭 (closed)</NativeSelectOption>
                <NativeSelectOption value="canceled">已取消 (canceled)</NativeSelectOption>
              </NativeSelect>

              <NativeSelect
                aria-label="按供应商筛选"
                value={supplierFilter}
                onChange={(e) => {
                  setSupplierFilter(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部供应商</NativeSelectOption>
                {suppliers.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>

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

      <ArrivalOrderCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        suppliers={suppliers}
        onCreated={(order) => {
          queryClient.invalidateQueries({ queryKey: queryKeys.arrivalOrdersAll })
          navigate(`/arrival-orders/${order.id}`)
        }}
      />

      <ReceivingHistorySheet
        open={Boolean(historyTarget)}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        title="到货单"
        recordLabel={historyTarget?.number}
        recordId={historyTarget?.id}
        queryKey={(page) => queryKeys.arrivalOrderHistory(historyTarget?.id ?? "", page)}
        fetchHistory={(id, params, signal) => arrivalOrdersService.history(id, params, signal)}
      />
    </div>
  )
}

function ArrivalOrderCreateDialog({
  open,
  onOpenChange,
  suppliers,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  suppliers: Array<{ id: string; name: string }>
  onCreated: (order: ArrivalOrderDTO) => void
}) {
  const [name, setName] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [externalOrderNo, setExternalOrderNo] = useState("")
  const [expectedDate, setExpectedDate] = useState("")
  const [description, setDescription] = useState("")
  const [idemKey, setIdemKey] = useState(() => createIdempotencyKey("arr"))

  useEffect(() => {
    if (!open) return
    setName("")
    setSupplierId(suppliers[0]?.id ?? "")
    setExternalOrderNo("")
    setExpectedDate("")
    setDescription("")
    setIdemKey(createIdempotencyKey("arr"))
  }, [open, suppliers])

  const mutation = useMutation({
    mutationFn: () =>
      arrivalOrdersService.create(
        {
          name: name.trim(),
          supplier_id: supplierId,
          external_order_no: externalOrderNo.trim() || null,
          expected_arrival_date: expectedDate || null,
          description: description.trim(),
        },
        idemKey,
      ),
    onSuccess: (res) => {
      notify.success(`到货单 ${res.data.number} 已创建，请继续添加设备明细`)
      onOpenChange(false)
      onCreated(res.data)
    },
    onError: (err) => notify.error(getErrorMessage(err, "创建到货单失败")),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建到货单草稿</DialogTitle>
          <DialogDescription className="text-xs">
            填写供应商与采购信息，创建后可添加设备型号、计划数量及每台标配配置。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim() || !supplierId) {
              notify.warning("请填写到货单名称并选择供应商")
              return
            }
            mutation.mutate()
          }}
        >
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 space-y-1.5">
              <Label htmlFor="arr-name" className="text-xs">
                到货单名称 *
              </Label>
              <Input
                id="arr-name"
                value={name}
                disabled={mutation.isPending}
                placeholder="如 Q4 GPU 计算节点首批到货"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="col-span-12 sm:col-span-6 space-y-1.5">
              <Label htmlFor="arr-supplier" className="text-xs">
                供应商 *
              </Label>
              <NativeSelect
                id="arr-supplier"
                disabled={mutation.isPending}
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <NativeSelectOption value="">请选择供应商</NativeSelectOption>
                {suppliers.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>

            <div className="col-span-12 sm:col-span-6 space-y-1.5">
              <Label htmlFor="arr-po" className="text-xs">
                外部采购单号
              </Label>
              <Input
                id="arr-po"
                value={externalOrderNo}
                disabled={mutation.isPending}
                placeholder="如 PO-2026-0081"
                onChange={(e) => setExternalOrderNo(e.target.value)}
              />
            </div>

            <div className="col-span-12 sm:col-span-6 space-y-1.5">
              <Label htmlFor="arr-date" className="text-xs">
                预计到货日期
              </Label>
              <Input
                id="arr-date"
                type="date"
                value={expectedDate}
                disabled={mutation.isPending}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>

            <div className="col-span-12 space-y-1.5">
              <Label htmlFor="arr-desc" className="text-xs">
                备注说明
              </Label>
              <Textarea
                id="arr-desc"
                rows={2}
                value={description}
                disabled={mutation.isPending}
                placeholder="可选填写物流或收货要求"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "创建中..." : "创建并维护明细"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
