import { useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Cpu, Eye, History } from "lucide-react"
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
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatDateTime } from "@/lib/format"
import { queryKeys } from "@/lib/query-keys"
import { assetsService, type AssetPartDetailDTO } from "@/services/assets"
import { warehousesService } from "@/services/locations"
import type { PlacementKind } from "@/services/receipts"
import { componentModelsService } from "@/services/receiving-models"
import { useAuth } from "@/stores/auth-context"

export default function ComponentAssetsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { can } = useAuth()

  const canRead = can("assets:components:read")
  const canHistory = can("assets:components:history")
  const canReadDevices = can("assets:devices:read")

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [partModelFilter, setPartModelFilter] = useState("all")
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [placementFilter, setPlacementFilter] = useState<"all" | PlacementKind>("all")
  const [serialStatusFilter, setSerialStatusFilter] = useState<"all" | "present" | "missing">(
    (searchParams.get("serial_status") as "present" | "missing") || "all",
  )
  const [sourceDeviceId, setSourceDeviceId] = useState(searchParams.get("source_device_id") ?? "")
  const [currentDeviceId, setCurrentDeviceId] = useState(searchParams.get("current_device_id") ?? "")
  const [historyTarget, setHistoryTarget] = useState<AssetPartDetailDTO | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const debouncedSourceDevice = useDebouncedValue(sourceDeviceId.trim(), 250)
  const debouncedCurrentDevice = useDebouncedValue(currentDeviceId.trim(), 250)

  const componentModelsQuery = useQuery({
    queryKey: queryKeys.componentModels({ page: 1, page_size: 100 }),
    queryFn: ({ signal }) => componentModelsService.list({ page: 1, page_size: 100 }, signal),
    enabled: canRead && can("model-management:component-models:read"),
    staleTime: 60 * 1000,
  })

  const warehousesQuery = useQuery({
    queryKey: queryKeys.warehouses({ page: 1, page_size: 100 }),
    queryFn: ({ signal }) => warehousesService.list({ page: 1, page_size: 100 }, signal),
    enabled: canRead,
    staleTime: 60 * 1000,
  })

  const queryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      part_model_id: partModelFilter === "all" ? undefined : partModelFilter,
      source_device_id: debouncedSourceDevice || undefined,
      current_device_id: debouncedCurrentDevice || undefined,
      warehouse_id: warehouseFilter === "all" ? undefined : warehouseFilter,
      placement_kind: placementFilter === "all" ? undefined : placementFilter,
      serial_status: serialStatusFilter === "all" ? undefined : serialStatusFilter,
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    [
      debouncedSearch,
      partModelFilter,
      debouncedSourceDevice,
      debouncedCurrentDevice,
      warehouseFilter,
      placementFilter,
      serialStatusFilter,
      pagination,
    ],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.assetComponents(queryParams),
    queryFn: ({ signal }) => assetsService.listComponents(queryParams, signal),
    enabled: canRead,
  })

  const columns = useMemo<ColumnDef<AssetPartDetailDTO>[]>(
    () => [
      {
        accessorKey: "internal_code",
        header: "组件编码 / 序列号",
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className="min-w-0 space-y-0.5">
              <button
                type="button"
                className="font-mono text-xs font-semibold text-primary hover:underline block"
                onClick={() => navigate(`/assets/components/${item.id}`)}
              >
                {item.internal_code}
              </button>
              {item.serial_number ? (
                <div className="font-mono text-[11px] text-foreground">SN: {item.serial_number}</div>
              ) : (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/40">
                  待补序列号
                </Badge>
              )}
            </div>
          )
        },
      },
      {
        id: "placement",
        header: "当前状态与位置",
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className="text-xs space-y-0.5">
              <div className="flex items-center gap-1.5">
                <AssetStatusBadge state={item.placement.kind} />
                {item.slot_key && <span className="font-mono text-[11px]">槽位 {item.slot_key}</span>}
              </div>
              <div className="text-[11px] text-muted-foreground truncate max-w-52">
                {item.location?.path ||
                  [item.location?.warehouse_name, item.location?.bin_name].filter(Boolean).join(" / ") ||
                  "—"}
              </div>
            </div>
          )
        },
      },
      {
        id: "devices_relation",
        header: "来源设备 vs 当前安装设备",
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className="text-[11px] space-y-0.5 font-mono">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground font-sans">来源:</span>
                {canReadDevices ? (
                  <button
                    type="button"
                    className="text-primary hover:underline truncate max-w-36"
                    onClick={() => navigate(`/assets/devices/${item.source_device_id}`)}
                  >
                    {item.source_device_id}
                  </button>
                ) : (
                  <span className="truncate max-w-36">{item.source_device_id}</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground font-sans">当前:</span>
                {item.current_device_id ? (
                  canReadDevices ? (
                    <button
                      type="button"
                      className="text-primary hover:underline truncate max-w-36"
                      onClick={() => navigate(`/assets/devices/${item.current_device_id}`)}
                    >
                      {item.current_device_id}
                    </button>
                  ) : (
                    <span className="truncate max-w-36">{item.current_device_id}</span>
                  )
                ) : (
                  <span className="text-muted-foreground font-sans">库房暂存（未装机）</span>
                )}
              </div>
            </div>
          )
        },
      },
      {
        accessorKey: "quality_state",
        header: "品质",
        cell: ({ row }) => <AssetStatusBadge state={row.original.quality_state} />,
      },
      {
        accessorKey: "created_at",
        header: "入库时间",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      createActionsColumn<AssetPartDetailDTO>({
        actions: (item) => [
          {
            key: "detail",
            label: item.serial_number ? "查看组件详情" : "详情与补录序列号",
            icon: <Eye />,
            onSelect: () => navigate(`/assets/components/${item.id}`),
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
    [canHistory, canReadDevices, navigate],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="组件资产台账"
        description="按型号、位置、来源设备/当前安装设备及序列号待补状态查询逐件组件，并支持缺失序列号补录。"
        icon={Cpu}
      />

      <DataTableCard
        title={<DataTableTitle title="逐件组件台账" count={listQuery.data?.data.total} />}
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
          searchPlaceholder="搜索内部编码或组件序列号..."
          onRefresh={() => void listQuery.refetch()}
          isRefreshing={listQuery.isFetching}
          searchTrailing={
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect
                aria-label="按序列号状态筛选"
                value={serialStatusFilter}
                onChange={(e) => {
                  setSerialStatusFilter(e.target.value as "all" | "present" | "missing")
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部序列号状态</NativeSelectOption>
                <NativeSelectOption value="missing">待补序列号 (missing)</NativeSelectOption>
                <NativeSelectOption value="present">已有序列号 (present)</NativeSelectOption>
              </NativeSelect>

              <NativeSelect
                aria-label="按当前在位方式筛选"
                value={placementFilter}
                onChange={(e) => {
                  setPlacementFilter(e.target.value as "all" | PlacementKind)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部放置状态</NativeSelectOption>
                <NativeSelectOption value="installed">已安装到设备</NativeSelectOption>
                <NativeSelectOption value="stored">库房暂存</NativeSelectOption>
              </NativeSelect>

              {componentModelsQuery.data && (
                <NativeSelect
                  aria-label="按组件型号筛选"
                  value={partModelFilter}
                  onChange={(e) => {
                    setPartModelFilter(e.target.value)
                    setPagination((p) => ({ ...p, pageIndex: 0 }))
                  }}
                >
                  <NativeSelectOption value="all">全部组件型号</NativeSelectOption>
                  {componentModelsQuery.data.data.items.map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}

              <NativeSelect
                aria-label="按所在库房筛选"
                value={warehouseFilter}
                onChange={(e) => {
                  setWarehouseFilter(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部库房</NativeSelectOption>
                {(warehousesQuery.data?.data.items ?? []).map((w) => (
                  <NativeSelectOption key={w.id} value={w.id}>
                    {w.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>

              <Input
                className="w-40"
                placeholder="来源设备 ID..."
                value={sourceDeviceId}
                onChange={(e) => {
                  setSourceDeviceId(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              />
              <Input
                className="w-40"
                placeholder="当前设备 ID..."
                value={currentDeviceId}
                onChange={(e) => {
                  setCurrentDeviceId(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              />
            </div>
          }
        />
      </DataTableCard>

      <ReceivingHistorySheet
        open={Boolean(historyTarget)}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        title="组件资产"
        recordLabel={historyTarget?.internal_code}
        recordId={historyTarget?.id}
        queryKey={(page) => queryKeys.assetComponentHistory(historyTarget?.id ?? "", page)}
        fetchHistory={(id, params, signal) => assetsService.getComponentHistory(id, params, signal)}
      />
    </div>
  )
}
