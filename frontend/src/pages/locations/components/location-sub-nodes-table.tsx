import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  Building2,
  Clock,
  Cpu,
  DoorClosed,
  FolderTree,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react"
import {
  DataTable,
  DataTableCard,
  DataTableTitle,
  createActionsColumn,
  type ColumnDef,
} from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useConfirm } from "@/components/common/confirm-dialog"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import {
  locationsService,
  type LocationNode,
  type LocationType,
  type RackExt,
  type RoomExt,
} from "@/services/locations"
import { useAuth } from "@/stores/auth-context"
import { formatFloor, formatRackPosition, locationTypeLabels } from "./location-tree"

const childTypeMap: Record<LocationType | "root", LocationType | null> = {
  root: "datacenter",
  datacenter: "building",
  building: "room",
  room: "rack",
  rack: null,
}

interface LocationSubNodesTableProps {
  parentNode: LocationNode | null // null means root (datacenters)
  onSelectNode: (node: LocationNode) => void
  onCreateChild: (childType: LocationType, parent: LocationNode | null) => void
  onEditNode: (node: LocationNode) => void
  onSecurityZoneNode: (node: LocationNode) => void
  onToggleStatus: (node: LocationNode) => void
  onViewHistory: (node: LocationNode) => void
  onViewReferences: (node: LocationNode) => void
  onDeleteNode: (node: LocationNode) => void
}

export function LocationSubNodesTable({
  parentNode,
  onSelectNode,
  onCreateChild,
  onEditNode,
  onSecurityZoneNode,
  onToggleStatus,
  onViewHistory,
  onViewReferences,
  onDeleteNode,
}: LocationSubNodesTableProps) {
  const { can } = useAuth()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const [floorFilter, setFloorFilter] = useState("")
  const [rowFilter, setRowFilter] = useState("")
  const [colFilter, setColFilter] = useState("")

  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const debouncedFloor = useDebouncedValue(floorFilter.trim(), 250)
  const debouncedRow = useDebouncedValue(rowFilter.trim().toUpperCase(), 250)
  const debouncedCol = useDebouncedValue(colFilter.trim(), 250)

  const childType = parentNode ? childTypeMap[parentNode.type] : "datacenter"
  const childTypeLabel = childType ? locationTypeLabels[childType] : ""

  const queryParams = useMemo(
    () => ({
      parent: parentNode ? parentNode.uid : "root",
      type: childType ?? undefined,
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
      search: debouncedSearch || undefined,
      floor: debouncedFloor ? Number(debouncedFloor) : undefined,
      row: debouncedRow || undefined,
      column: debouncedCol ? Number(debouncedCol) : undefined,
    }),
    [
      parentNode,
      childType,
      pagination.pageIndex,
      pagination.pageSize,
      debouncedSearch,
      debouncedFloor,
      debouncedRow,
      debouncedCol,
    ],
  )

  const query = useQuery({
    queryKey: ["location-nodes", "sub-table", queryParams],
    queryFn: ({ signal }) => locationsService.list(queryParams, signal),
  })

  const items = query.data?.data?.items ?? []
  const total = query.data?.data?.total ?? 0

  const columns = useMemo<ColumnDef<LocationNode>[]>(() => {
    const cols: ColumnDef<LocationNode>[] = [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title={`${childTypeLabel}名称`} />,
        cell: ({ row }) => {
          const node = row.original
          return (
            <button
              type="button"
              onClick={() => onSelectNode(node)}
              className="group flex items-center gap-1.5 font-medium text-foreground hover:text-primary transition-colors text-left"
            >
              <span className="underline-offset-4 group-hover:underline">{node.name}</span>
              <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )
        },
      },
    ]

    if (childType === "datacenter") {
      cols.push(
        {
          id: "address",
          header: ({ column }) => <DataTableColumnHeader column={column} title="物理地址" />,
          cell: ({ row }) => {
            const ext = (row.original.ext ?? {}) as Record<string, any>
            return <span className="text-xs text-muted-foreground">{ext.address || "—"}</span>
          },
        },
        {
          id: "contact",
          header: ({ column }) => <DataTableColumnHeader column={column} title="现场联系人" />,
          cell: ({ row }) => {
            const ext = (row.original.ext ?? {}) as Record<string, any>
            const contact = ext.contact as Record<string, any> | undefined
            if (!contact?.name) return <span className="text-xs text-muted-foreground">—</span>
            return (
              <div className="text-xs">
                <span className="font-medium text-foreground">{contact.name}</span>
                {contact.phone && <span className="ml-1 text-muted-foreground">({contact.phone})</span>}
              </div>
            )
          },
        },
      )
    } else if (childType === "room") {
      cols.push({
        id: "floor",
        header: ({ column }) => <DataTableColumnHeader column={column} title="楼层" />,
        cell: ({ row }) => {
          const ext = (row.original.ext ?? {}) as unknown as RoomExt
          return (
            <Badge variant="outline" className="text-xs font-mono">
              {formatFloor(ext.floor)}
            </Badge>
          )
        },
      })
    } else if (childType === "rack") {
      cols.push(
        {
          id: "position",
          header: ({ column }) => <DataTableColumnHeader column={column} title="坐标 (行-列)" />,
          cell: ({ row }) => {
            const ext = (row.original.ext ?? {}) as unknown as RackExt
            return (
              <Badge variant="outline" className="text-xs font-mono font-medium">
                {ext.row} 排 {ext.column} 列
              </Badge>
            )
          },
        },
        {
          id: "height_u",
          header: ({ column }) => <DataTableColumnHeader column={column} title="高度" />,
          cell: ({ row }) => {
            const ext = (row.original.ext ?? {}) as unknown as RackExt
            return <span className="text-xs font-mono">{ext.height_u ?? 42} U</span>
          },
        },
        {
          id: "power",
          header: ({ column }) => <DataTableColumnHeader column={column} title="承载功率" />,
          cell: ({ row }) => {
            const ext = (row.original.ext ?? {}) as unknown as RackExt
            if (!ext.power_capacity_w) return <span className="text-xs text-muted-foreground">—</span>
            const kw = (ext.power_capacity_w / 1000).toFixed(1)
            return <span className="text-xs font-mono">{ext.power_capacity_w} W ({kw} kW)</span>
          },
        },
        {
          id: "security_zone",
          header: ({ column }) => <DataTableColumnHeader column={column} title="安全域" />,
          cell: ({ row }) => {
            const zoneId = row.original.security_zone_id
            if (!zoneId) return <span className="text-xs text-muted-foreground">未配置</span>
            return (
              <Badge variant="secondary" className="text-[11px] font-normal">
                已分配
              </Badge>
            )
          },
        },
      )
    }

    cols.push(
      {
        id: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => {
          const status = row.original.status
          return (
            <Badge
              variant={status === 1 ? "outline" : "secondary"}
              className={`text-xs ${
                status === 1 ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10" : "text-muted-foreground"
              }`}
            >
              {status === 1 ? "启用中" : "已停用"}
            </Badge>
          )
        },
      },
      {
        id: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.created_at ? formatDateTime(row.original.created_at) : "—"}
          </span>
        ),
      },
      createActionsColumn<LocationNode>({
        id: "actions",
        title: "操作",
        actions: (node) => [
          {
            key: "view-children",
            label: node.type === "rack" ? "查看立面图" : "查看下级",
            icon: node.type === "rack" ? <Cpu className="size-3.5" /> : <FolderTree className="size-3.5" />,
            onSelect: () => onSelectNode(node),
          },
          {
            key: "edit",
            label: "编辑",
            icon: <Pencil className="size-3.5" />,
            onSelect: () => onEditNode(node),
            hidden: !can("locations:nodes:update"),
          },
          {
            key: "security-zone",
            label: "设置安全域",
            icon: <ShieldCheck className="size-3.5" />,
            onSelect: () => onSecurityZoneNode(node),
            hidden: node.type !== "rack" || !can("api:PUT:/api/v1/locations/nodes/:id/security-zone"),
          },
          {
            key: "toggle-status",
            label: node.status === 1 ? "停用" : "启用",
            icon: node.status === 1 ? <ToggleLeft className="size-3.5" /> : <ToggleRight className="size-3.5" />,
            onSelect: () => onToggleStatus(node),
            hidden: !can("locations:nodes:status"),
          },
          {
            key: "history",
            label: "变更历史",
            icon: <Clock className="size-3.5" />,
            onSelect: () => onViewHistory(node),
            hidden: !can("locations:nodes:history"),
          },
          {
            key: "references",
            label: "查看引用",
            icon: <Link2 className="size-3.5" />,
            onSelect: () => onViewReferences(node),
            hidden: !can("api:GET:/api/v1/locations/nodes/:id/references"),
          },
          {
            key: "delete",
            label: "删除",
            icon: <Trash2 className="size-3.5 text-destructive" />,
            onSelect: () => onDeleteNode(node),
            hidden: !can("locations:nodes:delete"),
            destructive: true,
          },
        ],
      }),
    )

    return cols
  }, [
    childType,
    childTypeLabel,
    can,
    onSelectNode,
    onEditNode,
    onSecurityZoneNode,
    onToggleStatus,
    onViewHistory,
    onViewReferences,
    onDeleteNode,
  ])

  if (!childType) {
    return null
  }

  const tableTitle = parentNode
    ? `「${parentNode.name}」下的${childTypeLabel}`
    : `全部${childTypeLabel}`

  const canCreate =
    can("locations:nodes:create") &&
    can(`locations:nodes:type:${childType}`) &&
    (!parentNode || parentNode.status === 1)

  return (
    <DataTableCard
      className="table-workspace-body h-full flex flex-col"
      label={`${childTypeLabel}列表`}
      title={
        <DataTableTitle
          title={tableTitle}
          count={total}
          trailing={
            childType === "room" && debouncedFloor ? `楼层: ${debouncedFloor}F` : undefined
          }
        />
      }
      actions={
        canCreate ? (
          <Button
            size="sm"
            onClick={() => onCreateChild(childType, parentNode)}
            className="h-8 gap-1"
          >
            <Plus className="size-3.5" />
            <span>新建{childTypeLabel}</span>
          </Button>
        ) : undefined
      }
      isPlaceholderData={query.isPlaceholderData}
      error={query.error}
      hasData={Boolean(query.data)}
      onRetry={() => void query.refetch()}
      retrying={query.isFetching}
    >
      <DataTable
        viewport={{
          mode: "fill",
          mobileContent: true,
          pending: query.isPlaceholderData,
          queryKey: JSON.stringify(queryParams),
        }}
        layoutControls={{ density: true, fullscreen: true }}
        columns={columns}
        data={items}
        loading={query.isLoading}
        getRowId={(r) => r.uid}
        serverFiltering
        serverPagination={{
          pageIndex: pagination.pageIndex,
          pageSize: pagination.pageSize,
          total,
          onChange: setPagination,
        }}
        defaultPageSize={20}
        externalSearch={{ value: search, onChange: setSearch }}
        searchPlaceholder={`搜索${childTypeLabel}名称...`}
        searchTrailing={
          <div className="flex items-center gap-1.5">
            {childType === "room" && (
              <Input
                placeholder="楼层(-5~100)"
                type="number"
                min={-5}
                max={100}
                value={floorFilter}
                onChange={(e) => setFloorFilter(e.target.value)}
                className="h-8 w-28 text-xs"
              />
            )}
            {childType === "rack" && (
              <>
                <Input
                  placeholder="机柜行(A-Z)"
                  maxLength={2}
                  value={rowFilter}
                  onChange={(e) => setRowFilter(e.target.value.toUpperCase())}
                  className="h-8 w-24 text-xs"
                />
                <Input
                  placeholder="机柜列(1-9999)"
                  type="number"
                  min={1}
                  max={9999}
                  value={colFilter}
                  onChange={(e) => setColFilter(e.target.value)}
                  className="h-8 w-28 text-xs"
                />
              </>
            )}
          </div>
        }
        onRefresh={() => void query.refetch()}
        isRefreshing={query.isFetching}
        stickyActionColumn
        enableColumnResizing
        enableColumnPinning
        initialColumnPinning={{ start: ["name"], end: ["actions"] }}
        emptyTitle={`暂无${childTypeLabel}`}
        emptyDescription={
          canCreate
            ? `点击上方「新建${childTypeLabel}」添加第一个${childTypeLabel}`
            : `当前位置下暂未创建${childTypeLabel}`
        }
        emptyAction={
          canCreate ? (
            <Button size="sm" onClick={() => onCreateChild(childType, parentNode)}>
              <Plus className="mr-1.5 size-3.5" />
              新建{childTypeLabel}
            </Button>
          ) : undefined
        }
      />
    </DataTableCard>
  )
}
