import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Eye, HardDrive, History } from "lucide-react"
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
  filterManufacturers,
  filterSuppliers,
  useCompanyOptions,
} from "@/components/receiving/receiving-meta"
import { ReceivingHistorySheet } from "@/components/receiving/receiving-history-sheet"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatDateTime } from "@/lib/format"
import { queryKeys } from "@/lib/query-keys"
import { assetsService, type AssetDeviceDTO } from "@/services/assets"
import { warehousesService } from "@/services/locations"
import { deviceModelsService } from "@/services/receiving-models"
import { useAuth } from "@/stores/auth-context"

export default function DeviceAssetsPage() {
  const navigate = useNavigate()
  const { can } = useAuth()

  const canRead = can("assets:devices:read")
  const canHistory = can("assets:devices:history")

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [deviceModelFilter, setDeviceModelFilter] = useState("all")
  const [manufacturerFilter, setManufacturerFilter] = useState("all")
  const [supplierFilter, setSupplierFilter] = useState("all")
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [stateFilter, setStateFilter] = useState("all")
  const [sourceReceiptId, setSourceReceiptId] = useState("")
  const [historyTarget, setHistoryTarget] = useState<AssetDeviceDTO | null>(null)

  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const debouncedReceiptId = useDebouncedValue(sourceReceiptId.trim(), 250)

  const companiesQuery = useCompanyOptions(canRead)
  const manufacturers = useMemo(
    () => filterManufacturers(companiesQuery.data?.data.items ?? []),
    [companiesQuery.data],
  )
  const suppliers = useMemo(
    () => filterSuppliers(companiesQuery.data?.data.items ?? []),
    [companiesQuery.data],
  )
  const companyMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of companiesQuery.data?.data.items ?? []) map.set(c.id, c.name)
    return map
  }, [companiesQuery.data])

  const deviceModelsQuery = useQuery({
    queryKey: queryKeys.deviceModels({ page: 1, page_size: 100 }),
    queryFn: ({ signal }) => deviceModelsService.list({ page: 1, page_size: 100 }, signal),
    enabled: canRead && can("model-management:device-models:read"),
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
      device_model_id: deviceModelFilter === "all" ? undefined : deviceModelFilter,
      manufacturer_id: manufacturerFilter === "all" ? undefined : manufacturerFilter,
      supplier_id: supplierFilter === "all" ? undefined : supplierFilter,
      warehouse_id: warehouseFilter === "all" ? undefined : warehouseFilter,
      lifecycle_state: stateFilter === "all" ? undefined : stateFilter,
      source_receipt_id: debouncedReceiptId || undefined,
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    [
      debouncedSearch,
      deviceModelFilter,
      manufacturerFilter,
      supplierFilter,
      warehouseFilter,
      stateFilter,
      debouncedReceiptId,
      pagination,
    ],
  )

  const listQuery = useQuery({
    queryKey: queryKeys.assetDevices(queryParams),
    queryFn: ({ signal }) => assetsService.listDevices(queryParams, signal),
    enabled: canRead,
  })

  const columns = useMemo<ColumnDef<AssetDeviceDTO>[]>(
    () => [
      {
        accessorKey: "asset_code",
        header: "资产编码 / 序列号",
        cell: ({ row }) => {
          const d = row.original
          return (
            <div className="min-w-0">
              <button
                type="button"
                className="font-mono text-xs font-semibold text-primary hover:underline text-left block"
                onClick={() => navigate(`/assets/devices/${d.id}`)}
              >
                {d.asset_code}
              </button>
              <div className="font-mono text-[11px] text-foreground">SN: {d.serial_number}</div>
            </div>
          )
        },
      },
      {
        id: "manufacturer_supplier",
        header: "制造商 / 供应商",
        cell: ({ row }) => (
          <div className="text-xs space-y-0.5">
            <div>{companyMap.get(row.original.manufacturer_id) ?? row.original.manufacturer_id}</div>
            <div className="text-[11px] text-muted-foreground">
              供应：{companyMap.get(row.original.supplier_id) ?? row.original.supplier_id}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "lifecycle_state",
        header: "生命周期状态",
        cell: ({ row }) => <AssetStatusBadge state={row.original.lifecycle_state} />,
      },
      {
        accessorKey: "configuration_version",
        header: "当前配置版本",
        cell: ({ row }) => <span className="font-mono text-xs">v{row.original.configuration_version}</span>,
      },
      {
        accessorKey: "created_at",
        header: "入库时间",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{formatDateTime(row.original.created_at)}</span>
        ),
      },
      createActionsColumn<AssetDeviceDTO>({
        actions: (item) => [
          {
            key: "detail",
            label: "查看设备配置与详情",
            icon: <Eye />,
            onSelect: () => navigate(`/assets/devices/${item.id}`),
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
    [canHistory, companyMap, navigate],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="设备资产台账"
        description="查询已验收建账的实物设备，追溯来源到货单与验收基线、现场照片及配置变更差异。"
        icon={HardDrive}
      />

      <DataTableCard
        title={<DataTableTitle title="设备实物资产" count={listQuery.data?.data.total} />}
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
          searchPlaceholder="搜索资产编码或设备序列号..."
          onRefresh={() => void listQuery.refetch()}
          isRefreshing={listQuery.isFetching}
          searchTrailing={
            <div className="flex flex-wrap items-center gap-2">
              {deviceModelsQuery.data && (
                <NativeSelect
                  aria-label="按设备型号筛选"
                  value={deviceModelFilter}
                  onChange={(e) => {
                    setDeviceModelFilter(e.target.value)
                    setPagination((p) => ({ ...p, pageIndex: 0 }))
                  }}
                >
                  <NativeSelectOption value="all">全部设备型号</NativeSelectOption>
                  {deviceModelsQuery.data.data.items.map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}

              <NativeSelect
                aria-label="按制造商筛选"
                value={manufacturerFilter}
                onChange={(e) => {
                  setManufacturerFilter(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部制造商</NativeSelectOption>
                {manufacturers.map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name}
                  </NativeSelectOption>
                ))}
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

              <NativeSelect
                aria-label="按生命周期状态筛选"
                value={stateFilter}
                onChange={(e) => {
                  setStateFilter(e.target.value)
                  setPagination((p) => ({ ...p, pageIndex: 0 }))
                }}
              >
                <NativeSelectOption value="all">全部状态</NativeSelectOption>
                <NativeSelectOption value="receiving">入库/待上架</NativeSelectOption>
                <NativeSelectOption value="in_stock">在库</NativeSelectOption>
                <NativeSelectOption value="in_service">服役中</NativeSelectOption>
              </NativeSelect>

              <Input
                className="w-44"
                placeholder="按来源验收单 ID 筛选..."
                value={sourceReceiptId}
                onChange={(e) => {
                  setSourceReceiptId(e.target.value)
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
        title="设备资产"
        recordLabel={historyTarget ? `${historyTarget.asset_code} (${historyTarget.serial_number})` : undefined}
        recordId={historyTarget?.id}
        queryKey={(page) => queryKeys.assetDeviceHistory(historyTarget?.id ?? "", page)}
        fetchHistory={(id, params, signal) => assetsService.getDeviceHistory(id, params, signal)}
      />
    </div>
  )
}
