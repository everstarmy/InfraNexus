import { IpamCatalogSheet } from "./components/ipam-catalog-sheet"
import { ManagedTransferActions } from "@/components/managed/managed-transfer-actions"
import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Network,
  Shield,
  Layers,
  Plus,
  Pencil,
  Trash2,
  History,
  Link2,
  Eye,
  Server,
  Cpu,
} from "lucide-react"
import { DataTable, DataTableCard, DataTableTitle, createActionsColumn, type ColumnDef } from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/common/page-header"
import { useConfirm } from "@/components/common/confirm-dialog"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { getErrorMessage } from "@/lib/api-error"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useAuth } from "@/stores/auth-context"
import {
  subnetsService,
  type SubnetDTO,
  type SubnetUsageType,
} from "@/services/ipam"
import { SubnetFormDialog } from "./components/subnet-form-dialog"
import { IPAddressPoolSheet } from "./components/ip-address-pool-sheet"
import { ManagedHistorySheet } from "@/components/managed/managed-history-sheet"
import { ManagedReferencesDialog } from "@/components/managed/managed-references-dialog"

const usageMeta: Record<SubnetUsageType, { label: string; className: string }> = {
  production: { label: "生产业务", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  business_management: { label: "业务管理", className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  bmc: { label: "带外 BMC", className: "border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300" },
  storage_management: { label: "存储网络", className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" },
  heartbeat: { label: "双机心跳", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  vip: { label: "负载虚IP", className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
  other: { label: "其他规划", className: "border-border bg-muted text-muted-foreground" },
}

export default function SubnetsPage() {
  const { can } = useAuth()
  const [catalog, setCatalog] = useState<"network-scopes" | "security-zones" | null>(null)
  const canReadSubnets = can("ipam:subnets:read")
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })

  // Dialogs
  const [subnetForm, setSubnetForm] = useState<SubnetDTO | "new" | null>(null)
  const [activePoolSubnet, setActivePoolSubnet] = useState<SubnetDTO | null>(null)

  const [historyTarget, setHistoryTarget] = useState<{
    id: string
    name: string
    title: string
    fetch: typeof subnetsService.history
  } | null>(null)

  const [refTarget, setRefTarget] = useState<{
    id: string
    name: string
    title: string
    fetch: typeof subnetsService.references
  } | null>(null)

  // Fetch Subnets
  const { data, isLoading, error, refetch } = useQuery({
    enabled: canReadSubnets,
    queryKey: ["subnets", pagination.pageIndex, pagination.pageSize, debouncedSearch],
    queryFn: ({ signal }) =>
      subnetsService.list(
        {
          page: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
          search: debouncedSearch || undefined,
        },
        signal
      ),
  })

  const subnets = data?.data.items ?? []
  const total = data?.data.total ?? 0

  // Delete Subnet
  const deleteSubnet = async (s: SubnetDTO) => {
    const ok = await confirm({
      tone: "destructive",
      title: `删除子网「${s.cidr}」？`,
      description: "已产生在用/预留 IP 或被机柜绑定的子网无法删除。",
      confirmText: "确认删除",
    })
    if (!ok) return
    try {
      await subnetsService.remove(s.id, s.version)
      notify.success("子网已删除", s.cidr)
      void queryClient.invalidateQueries({ queryKey: ["subnets"] })
    } catch (err) {
      notify.error("删除失败", getErrorMessage(err))
    }
  }

  // Toggle Subnet Status
  const toggleSubnetStatus = async (s: SubnetDTO, enabled: boolean) => {
    try {
      await subnetsService.setStatus(s.id, s.version, enabled ? 1 : 2)
      notify.success(enabled ? "已启用子网" : "已停用子网", s.cidr)
      void queryClient.invalidateQueries({ queryKey: ["subnets"] })
    } catch (err) {
      notify.error("变更状态失败", getErrorMessage(err))
    }
  }

  // Columns for Subnets
  const columns = useMemo<ColumnDef<SubnetDTO>[]>(() => [
    {
      id: "cidr",
      accessorKey: "cidr",
      header: ({ column }) => <DataTableColumnHeader column={column} title="IPv4 CIDR 网段" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <button
            type="button"
            className="font-mono font-semibold text-primary text-left hover:underline cursor-pointer"
            onClick={() => setActivePoolSubnet(row.original)}
            title="点击展开地址池矩阵"
          >
            {row.original.cidr}
          </button>
          <span className="text-[11px] text-muted-foreground">{row.original.name}</span>
        </div>
      ),
    },
    {
      id: "usage_type",
      accessorKey: "usage_type",
      header: ({ column }) => <DataTableColumnHeader column={column} title="业务用途" />,
      cell: ({ row }) => {
        const meta = usageMeta[row.original.usage_type] ?? usageMeta.other
        return (
          <Badge variant="outline" className={`text-xs ${meta.className}`}>
            {meta.label}
          </Badge>
        )
      },
    },
    {
      id: "gateway",
      accessorKey: "gateway",
      header: ({ column }) => <DataTableColumnHeader column={column} title="网关 IP" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.gateway || "—"}
        </span>
      ),
    },
    {
      id: "vlan_id",
      accessorKey: "vlan_id",
      header: ({ column }) => <DataTableColumnHeader column={column} title="VLAN ID" />,
      cell: ({ row }) =>
        row.original.vlan_id ? (
          <Badge variant="secondary" className="font-mono text-xs">
            VLAN {row.original.vlan_id}
          </Badge>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
    },
    {
      id: "is_allocatable",
      accessorKey: "is_allocatable",
      header: ({ column }) => <DataTableColumnHeader column={column} title="自动分配" />,
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={
            row.original.is_allocatable
              ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/10 text-[11px]"
              : "border-border text-muted-foreground text-[11px]"
          }
        >
          {row.original.is_allocatable ? "允许" : "仅规划"}
        </Badge>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="启用" />,
      cell: ({ row }) => (
        <Switch
          checked={row.original.status === 1}
          disabled={!can("ipam:subnets:status")}
          onCheckedChange={(checked) => void toggleSubnetStatus(row.original, checked)}
          aria-label="切换状态"
        />
      ),
    },
    {
      id: "updated_at",
      accessorKey: "updated_at",
      header: ({ column }) => <DataTableColumnHeader column={column} title="更新时间" />,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{formatDateTime(row.original.updated_at)}</span>
      ),
    },
    createActionsColumn<SubnetDTO>({
      actions: (row) => [
        {
          key: "matrix",
          label: "查看地址池矩阵",
          hidden: !row.is_allocatable,
          icon: <Eye className="size-4" />,
          onSelect: () => setActivePoolSubnet(row),
        },
        {
          key: "edit",
          label: "编辑子网",
          icon: <Pencil className="size-4" />,
          hidden: !can("ipam:subnets:update"),
          onSelect: () => setSubnetForm(row),
        },
        {
          key: "references",
          label: "查看引用",
          icon: <Link2 className="size-4" />,
          onSelect: () =>
            setRefTarget({
              id: row.id,
              name: row.cidr,
              title: "子网",
              fetch: subnetsService.references,
            }),
        },
        {
          key: "history",
          label: "变更历史",
          icon: <History className="size-4" />,
          hidden: !can("ipam:subnets:history"),
          onSelect: () =>
            setHistoryTarget({
              id: row.id,
              name: row.cidr,
              title: "子网",
              fetch: subnetsService.history,
            }),
        },
        {
          key: "delete",
          label: "删除子网",
          icon: <Trash2 className="size-4" />,
          destructive: true,
          hidden: !can("ipam:subnets:delete"),
          onSelect: () => void deleteSubnet(row),
        },
      ],
    }),
  ], [can])

  const stats = {
    total,
    prod: subnets.filter((s) => s.usage_type === "production").length,
    bmc: subnets.filter((s) => s.usage_type === "bmc").length,
    allocatable: subnets.filter((s) => s.is_allocatable).length,
  }

  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <PageHeader
        title="IP 管理与子网规划"
        description="VRF 隔离地址空间、CIDR 子网规划、VLAN 关联与 IP 地址池 5 态生命周期管理"
        icon={Network}
        actions={<>
          {can(["ipam:network-scopes:read", "ipam:network-scopes:create", "ipam:network-scopes:import", "ipam:network-scopes:export"]) && (
            <Button size="sm" variant="outline" onClick={() => setCatalog("network-scopes")}>地址空间</Button>
          )}
          {can(["ipam:security-zones:read", "ipam:security-zones:create", "ipam:security-zones:import", "ipam:security-zones:export"]) && (
            <Button size="sm" variant="outline" onClick={() => setCatalog("security-zones")}>安全域</Button>
          )}
        </>}
      />

      <StatGrid>
        <StatCard
          label="规划子网总数"
          value={stats.total}
          icon={Network}
          tone="primary"
          hint="全部隔离域子网"
        />
        <StatCard
          label="生产业务子网 (本页)"
          value={stats.prod}
          icon={Server}
          tone="success"
          hint="承载核心业务通信"
        />
        <StatCard
          label="带外管理网段 (本页)"
          value={stats.bmc}
          icon={Cpu}
          tone="info"
          hint="IPMI / Redfish 采集专网"
        />
        <StatCard
          label="自动分配网段 (本页)"
          value={stats.allocatable}
          icon={Shield}
          tone="warning"
          hint="供工单与资产自动占用"
        />
      </StatGrid>

      <DataTableCard
        className="table-workspace-body"
        label="子网列表"
        title={<DataTableTitle title="CIDR 子网列表" count={total} />}
        actions={<>
          <ManagedTransferActions permission="ipam:subnets" label="子网" service={subnetsService} filters={{ search: debouncedSearch }} onImported={() => void queryClient.invalidateQueries({ queryKey: ["subnets"] })} />
          {can("ipam:subnets:create") && (
            <Button
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={() => setSubnetForm("new")}
            >
              <Plus className="size-3.5" />
              新建子网
            </Button>
          )}
        </>}
        error={error}
        onRetry={() => void refetch()}
        hasData={Boolean(data)}
      >
        <DataTable emptyTitle={canReadSubnets ? undefined : "没有查看子网的权限"}
          viewport={{
            mode: "fill",
            mobileContent: true,
            pending: isLoading,
            queryKey: JSON.stringify([pagination, debouncedSearch]),
          }}
          layoutControls={{ density: true, fullscreen: true }}
          columns={columns}
          data={canReadSubnets ? subnets : []}
          loading={isLoading}
          getRowId={(r) => r.id}
          externalSearch={{ value: search, onChange: (value) => { setSearch(value); setPagination((current) => ({ ...current, pageIndex: 0 })) } }}
          serverFiltering
          serverPagination={{
            pageIndex: pagination.pageIndex,
            pageSize: pagination.pageSize,
            total,
            onChange: setPagination,
          }}
          defaultPageSize={20}
        />
      </DataTableCard>

      {catalog && <IpamCatalogSheet resource={catalog} onClose={() => setCatalog(null)} />}

      {/* Subnet Form Dialog */}
      {subnetForm && (
        <SubnetFormDialog
          open={Boolean(subnetForm)}
          subnet={subnetForm === "new" ? null : subnetForm}
          onOpenChange={(op) => !op && setSubnetForm(null)}
        />
      )}

      {/* IP Address Pool Matrix Sheet */}
      {activePoolSubnet && (
        <IPAddressPoolSheet
          open={Boolean(activePoolSubnet)}
          subnet={activePoolSubnet}
          onOpenChange={(op) => !op && setActivePoolSubnet(null)}
        />
      )}

      {/* Reusable History & References */}
      {historyTarget && (
        <ManagedHistorySheet
          open={Boolean(historyTarget)}
          resourceTitle={historyTarget.title}
          recordName={historyTarget.name}
          recordId={historyTarget.id}
          fetchHistory={historyTarget.fetch}
          onOpenChange={(op) => !op && setHistoryTarget(null)}
        />
      )}

      {refTarget && (
        <ManagedReferencesDialog
          open={Boolean(refTarget)}
          resourceTitle={refTarget.title}
          recordName={refTarget.name}
          recordId={refTarget.id}
          fetchReferences={refTarget.fetch}
          onOpenChange={(op) => !op && setRefTarget(null)}
        />
      )}
    </div>
  )
}
