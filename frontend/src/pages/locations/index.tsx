import { ManagedTransferActions } from "@/components/managed/managed-transfer-actions"
import { useState, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  MapPin,
  Server,
  Plus,
  Pencil,
  Trash2,
  History,
  Link2,
  Eye,
  LayoutGrid,
} from "lucide-react"
import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { DataTable, DataTableCard, DataTableTitle, createActionsColumn, type ColumnDef } from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { PageHeader } from "@/components/common/page-header"
import { useConfirm } from "@/components/common/confirm-dialog"
import { LocationLevel } from "./components/location-level"
import type { ManagedBase } from "@/services/managed"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { getErrorMessage } from "@/lib/api-error"
import { useAuth } from "@/stores/auth-context"
import {
  datacentersService,
  buildingsService,
  floorsService,
  roomsService,
  rackRowsService,
  racksService,
  type DatacenterDTO,
  type RackDTO,
} from "@/services/locations"
import { DatacenterFormDialog } from "./components/datacenter-form-dialog"
import { RackFormDialog } from "./components/rack-form-dialog"
import { NodeFormDialog, type NodeType } from "./components/node-form-dialog"
import { RackElevationView } from "./components/rack-elevation-view"
import { ManagedHistorySheet } from "@/components/managed/managed-history-sheet"
import { ManagedReferencesDialog } from "@/components/managed/managed-references-dialog"

const topologyLevels = [
  { type: "building", label: "楼栋", permission: "locations:buildings", list: buildingsService.list },
  { type: "floor", label: "楼层", permission: "locations:floors", list: floorsService.list },
  { type: "room", label: "机房", permission: "locations:rooms", list: roomsService.list },
  { type: "rack-row", label: "机柜列", permission: "locations:rack-rows", list: rackRowsService.list },
] as const

export default function LocationsTopologyPage() {
  const { can } = useAuth()
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [selection, setSelection] = useState<ManagedBase[]>([])
  const selectedRow = selection[4]
  const [viewingRack, setViewingRack] = useState<RackDTO | null>(null)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [dcForm, setDcForm] = useState<DatacenterDTO | "new" | null>(null)
  const [rackForm, setRackForm] = useState<RackDTO | "new" | null>(null)
  const [nodeModal, setNodeModal] = useState<{
    type: NodeType
    parentId: string
    node?: ManagedBase
  } | null>(null)

  const selectLocation = (depth: number, node: ManagedBase) => {
    setSelection((current) => [...current.slice(0, depth), node])
    setPagination((current) => ({ ...current, pageIndex: 0 }))
    setViewingRack(null)
  }

  const [historyTarget, setHistoryTarget] = useState<{
    id: string
    name: string
    title: string
    fetch: typeof racksService.history
  } | null>(null)

  const [refTarget, setRefTarget] = useState<{
    id: string
    name: string
    title: string
    fetch: typeof racksService.references
  } | null>(null)

  const rackQuery = useQuery({
    queryKey: ["racks", selectedRow?.id, pagination],
    queryFn: ({ signal }) => racksService.list({
      parent_id: selectedRow?.id,
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }, signal),
    enabled: Boolean(selectedRow) && can("locations:racks:read"),
  })
  const rackData = rackQuery.data
  const loadingRacks = rackQuery.isLoading
  const racks = rackData?.data.items ?? []

  // Toggle Rack Status
  const toggleRackStatus = async (r: RackDTO, enabled: boolean) => {
    try {
      await racksService.setStatus(r.id, r.version, enabled ? 1 : 2)
      notify.success(enabled ? "已启用机柜" : "已停用机柜", r.name)
      void queryClient.invalidateQueries({ queryKey: ["racks"] })
    } catch (err) {
      notify.error("变更状态失败", getErrorMessage(err))
    }
  }

  // Delete Rack
  const deleteRack = async (r: RackDTO) => {
    const ok = await confirm({
      tone: "destructive",
      title: `删除机柜「${r.name}」？`,
      description: "包含在用/预留 U 位或绑定网段的机柜无法删除。",
      confirmText: "确认删除",
    })
    if (!ok) return
    try {
      await racksService.remove(r.id, r.version)
      notify.success("机柜已删除", r.name)
      void queryClient.invalidateQueries({ queryKey: ["racks"] })
      if (viewingRack?.id === r.id) setViewingRack(null)
    } catch (err) {
      notify.error("删除失败", getErrorMessage(err))
    }
  }

  // Columns for Racks
  const rackColumns = useMemo<ColumnDef<RackDTO>[]>(() => [
    {
      id: "name",
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title="机柜名称 / 编码" />,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <button
            type="button"
            className="font-medium text-foreground text-left hover:text-primary transition-colors cursor-pointer"
            onClick={() => setViewingRack(row.original)}
          >
            {row.original.name}
          </button>
          <span className="text-[11px] font-mono text-muted-foreground">{row.original.code}</span>
        </div>
      ),
    },
    {
      id: "label",
      accessorKey: "label",
      header: ({ column }) => <DataTableColumnHeader column={column} title="现场标签" />,
      cell: ({ row }) =>
        row.original.label ? (
          <Badge variant="outline" className="font-mono text-xs">
            {row.original.label}
          </Badge>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
    },
    {
      id: "units",
      accessorKey: "units",
      header: ({ column }) => <DataTableColumnHeader column={column} title="U 位总高" />,
      cell: ({ row }) => (
        <span className="font-mono font-semibold text-xs text-primary">{row.original.units} U</span>
      ),
    },
    {
      id: "max_load_kg",
      accessorKey: "max_load_kg",
      header: ({ column }) => <DataTableColumnHeader column={column} title="最大承重" />,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.max_load_kg} kg</span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title="启用" />,
      cell: ({ row }) => (
        <Switch
          checked={row.original.status === 1}
          disabled={!can("locations:racks:status")}
          onCheckedChange={(checked) => void toggleRackStatus(row.original, checked)}
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
    createActionsColumn<RackDTO>({
      actions: (row) => [
        {
          key: "elevation",
          label: "查看 U 位立面图",
          icon: <Eye className="size-4" />,
          onSelect: () => setViewingRack(row),
        },
        {
          key: "edit",
          label: "编辑机柜",
          icon: <Pencil className="size-4" />,
          hidden: !can("locations:racks:update"),
          onSelect: () => setRackForm(row),
        },
        {
          key: "references",
          label: "查看引用",
          icon: <Link2 className="size-4" />,
          onSelect: () =>
            setRefTarget({
              id: row.id,
              name: row.name,
              title: "机柜",
              fetch: racksService.references,
            }),
        },
        {
          key: "history",
          label: "变更历史",
          icon: <History className="size-4" />,
          hidden: !can("locations:racks:history"),
          onSelect: () =>
            setHistoryTarget({
              id: row.id,
              name: row.name,
              title: "机柜",
              fetch: racksService.history,
            }),
        },
        {
          key: "delete",
          label: "删除机柜",
          icon: <Trash2 className="size-4" />,
          destructive: true,
          hidden: !can("locations:racks:delete"),
          onSelect: () => void deleteRack(row),
        },
      ],
    }),
  ], [can, viewingRack])

  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <PageHeader
        title="机房空间拓扑与机柜"
        description="数据中心园区、建筑楼栋、楼层机房层级树及 42U/48U 服务器机架立面空间管理"
        icon={MapPin}
        actions={<>
          <ManagedTransferActions permission="locations:datacenters" label="数据中心" service={datacentersService} onImported={() => void queryClient.invalidateQueries({ queryKey: ["datacenters"] })} />
          {can("locations:datacenters:create") && (
            <Button
              size="sm"
              className="gap-1.5 h-8 text-xs"
              onClick={() => setDcForm("new")}
            >
              <Plus className="size-3.5" />
              新建数据中心
            </Button>
          )}
        </>}
      />

      {/* Grid: Left Topology Tree + Right Master/Detail Workstation */}
      <div className="table-workspace-body grid grid-cols-12 gap-2">
        {/* Left Topology Tree Panel */}
        <Card size="sm" className="col-span-12 flex flex-col gap-0 rounded-xl border border-border/80 bg-card py-0 ring-0 shadow-xs lg:col-span-4 xl:col-span-3">
          <CardHeader className="border-b border-border/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <MapPin className="size-3.5 text-primary" />
              空间拓扑层级
            </div>
          </CardHeader>
          <CardContent className="table-workspace-tree max-h-96 flex-1 space-y-3 overflow-y-auto p-2.5">
            <LocationLevel
              label="数据中心"
              permission="locations:datacenters"
              queryKey={["datacenters"]}
              list={datacentersService.list}
              selectedId={selection[0]?.id}
              onSelect={(node) => selectLocation(0, node)}
              onEdit={setDcForm}
            />
            {topologyLevels.map(({ type, label, permission, list }, index) => {
              const parent = selection[index]
              if (!parent) return null
              return (
                <LocationLevel<ManagedBase>
                  key={`${type}:${parent.id}`}
                  label={label}
                  permission={permission}
                  queryKey={["locations", type, parent.id]}
                  list={list}
                  parentId={parent.id}
                  selectedId={selection[index + 1]?.id}
                  onSelect={(node) => selectLocation(index + 1, node)}
                  onCreate={parent.status === 1 ? () => setNodeModal({ type, parentId: parent.id }) : undefined}
                  onEdit={(node) => setNodeModal({ type, parentId: parent.id, node })}
                />
              )
            })}
          </CardContent>
        </Card>

        {/* Right Workstation: Elevation View OR Racks DataTable */}
        <div className="col-span-12 lg:col-span-8 xl:col-span-9 flex flex-col min-h-0">
          {viewingRack ? (
            <Card size="sm" className="flex-1 flex flex-col min-h-0 rounded-xl border border-border/80 bg-card py-0 ring-0 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between border-b border-border/60 px-4 py-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setViewingRack(null)}
                >
                  <LayoutGrid className="size-3.5" />
                  返回机柜列表
                </Button>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 overflow-y-auto p-4">
                <RackElevationView rack={viewingRack} />
              </CardContent>
            </Card>
          ) : (
            <DataTableCard
              className="flex-1 min-h-0"
              label="机柜管理"
              title={
                <DataTableTitle
                  title={selectedRow ? `「${selectedRow.name}」所属机柜` : "机柜列表"}
                  count={rackData?.data.total ?? 0}
                />
              }
              actions={<>
                {selectedRow && <ManagedTransferActions permission="locations:racks" label="机柜" service={racksService} filters={{ parent_id: selectedRow.id }} onImported={() => void queryClient.invalidateQueries({ queryKey: ["racks"] })} />}
                {selectedRow?.status === 1 && can("locations:racks:create") && (
                  <Button
                    size="sm"
                    className="gap-1.5 h-8 text-xs"
                    onClick={() => setRackForm("new")}
                  >
                    <Plus className="size-3.5" />
                    新建机柜
                  </Button>
                )}
              </>}
              error={rackQuery.error}
              onRetry={() => void rackQuery.refetch()}
              hasData={Boolean(rackData)}
            >
              <DataTable
                emptyTitle={!selectedRow ? "请选择机柜列" : !can("locations:racks:read") ? "没有查看机柜的权限" : undefined}
                viewport={{
                  mode: "fill",
                  mobileContent: true,
                  pending: loadingRacks,
                  queryKey: JSON.stringify([selectedRow?.id, pagination]),
                }}
                layoutControls={{ density: true, fullscreen: true }}
                columns={rackColumns}
                data={can("locations:racks:read") ? racks : []}
                loading={loadingRacks}
                getRowId={(r) => r.id}
                defaultPageSize={20}
                serverPagination={{ ...pagination, total: rackData?.data.total ?? 0, onChange: setPagination }}
              />
            </DataTableCard>
          )}
        </div>
      </div>

      {/* Datacenter Form Dialog */}
      {dcForm && (
        <DatacenterFormDialog
          open={Boolean(dcForm)}
          datacenter={dcForm === "new" ? null : dcForm}
          onOpenChange={(op) => !op && setDcForm(null)}
        />
      )}

      {/* Rack Form Dialog */}
      {rackForm && (
        <RackFormDialog
          open={Boolean(rackForm)}
          rackRowId={rackForm === "new" ? selectedRow?.id ?? "" : rackForm.rack_row_id}
          rack={rackForm === "new" ? null : rackForm}
          onOpenChange={(op) => !op && setRackForm(null)}
        />
      )}

      {nodeModal && (
        <NodeFormDialog
          open
          type={nodeModal.type}
          parentId={nodeModal.parentId}
          node={nodeModal.node}
          onOpenChange={(open) => !open && setNodeModal(null)}
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
