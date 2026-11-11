import { useCallback, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Building2,
  ChevronRight,
  Clock,
  Cpu,
  FolderTree,
  Link2,
  MapPin,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PageHeader } from "@/components/common/page-header"
import { useConfirm } from "@/components/common/confirm-dialog"
import { ManagedHistorySheet } from "@/components/managed/managed-history-sheet"
import { ManagedReferencesDialog } from "@/components/managed/managed-references-dialog"
import { getErrorMessage } from "@/lib/api-error"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { cn } from "@/lib/utils"
import {
  locationsService,
  type DatacenterContact,
  type DatacenterExt,
  type LocationNode,
  type LocationType,
  type RackExt,
  type RoomExt,
} from "@/services/locations"
import { useAuth } from "@/stores/auth-context"
import { LocationFormDialog } from "./components/location-form-dialog"
import { LocationSecurityZoneDialog } from "./components/location-security-zone-dialog"
import { LocationSubNodesTable } from "./components/location-sub-nodes-table"
import {
  LocationTree,
  formatFloor,
  formatRackPosition,
  locationTypeIcons,
  locationTypeLabels,
} from "./components/location-tree"
import { RackElevationView } from "./components/rack-elevation-view"

const nextChildType: Partial<Record<LocationType, LocationType>> = {
  datacenter: "building",
  building: "room",
  room: "rack",
}

export default function LocationsPage() {
  const { can } = useAuth()
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  // Layout & Navigation State
  const [treeOpen, setTreeOpen] = useState(true)
  const [selectedNode, setSelectedNode] = useState<LocationNode | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [search, setSearch] = useState("")

  // Dialogs State
  const [formDialog, setFormDialog] = useState<{
    open: boolean
    type: LocationType
    node?: LocationNode | null
    parent?: LocationNode | null
  }>({ open: false, type: "datacenter" })

  const [securityZoneRack, setSecurityZoneRack] = useState<LocationNode | null>(null)
  const [historyNode, setHistoryNode] = useState<LocationNode | null>(null)
  const [referencesNode, setReferencesNode] = useState<LocationNode | null>(null)
  const [busy, setBusy] = useState(false)

  // Expand / Collapse tree toggling
  const handleToggleExpand = useCallback((uid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) {
        next.delete(uid)
      } else {
        next.add(uid)
      }
      return next
    })
  }, [])

  // Selecting a node from tree, search, or table
  const handleSelectNode = useCallback((node: LocationNode | null) => {
    setSelectedNode(node)
    if (node) {
      // Auto-expand all ancestors in tree
      if (node.path && node.path.length > 0) {
        setExpanded((prev) => {
          const next = new Set(prev)
          for (const p of node.path!) {
            next.add(p.uid)
          }
          return next
        })
      }
    }
  }, [])

  // Status toggle
  const handleToggleStatus = useCallback(
    async (node: LocationNode) => {
      const nextStatus = node.status === 1 ? 2 : 1
      const actionText = nextStatus === 1 ? "启用" : "停用"
      setBusy(true)
      try {
        const res = await locationsService.status(node.uid, node.version, nextStatus)
        notify.success(`${actionText}成功`, `已${actionText}${locationTypeLabels[node.type]}「${node.name}」`)
        void queryClient.invalidateQueries({ queryKey: ["location-nodes"] })
        if (selectedNode?.uid === node.uid) {
          setSelectedNode(res.data)
        }
      } catch (err) {
        notify.error(`${actionText}失败`, getErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [queryClient, selectedNode],
  )

  // Delete node
  const handleDeleteNode = useCallback(
    async (node: LocationNode) => {
      const confirmed = await confirm({
        title: `删除${locationTypeLabels[node.type]}「${node.name}」？`,
        description: "若该位置下存在未删除的子节点、业务设备引用或 U 位预留，将无法删除。",
        tone: "destructive",
        confirmText: "确认删除",
      })
      if (!confirmed) return

      setBusy(true)
      try {
        await locationsService.remove(node.uid, node.version)
        notify.success(`已删除${locationTypeLabels[node.type]}「${node.name}」`)
        void queryClient.invalidateQueries({ queryKey: ["location-nodes"] })
        if (selectedNode?.uid === node.uid) {
          setSelectedNode(null)
        }
      } catch (err) {
        notify.error("删除失败", getErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [confirm, queryClient, selectedNode],
  )

  // Calculate breadcrumbs
  const breadcrumbs = selectedNode
    ? [
        { uid: "root", name: "全部数据中心", type: null },
        ...(selectedNode.path ?? []).map((p) => ({ uid: p.uid, name: p.name, type: p.type as LocationType })),
        { uid: selectedNode.uid, name: selectedNode.name, type: selectedNode.type },
      ]
    : [{ uid: "root", name: "全部数据中心", type: null }]

  // Allowed child type for current selection
  const childType = selectedNode ? nextChildType[selectedNode.type] : "datacenter"
  const canCreateChild =
    childType &&
    can("locations:nodes:create") &&
    can(`locations:nodes:type:${childType}`) &&
    (!selectedNode || selectedNode.status === 1)

  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <PageHeader
        title="位置管理"
        description="数据中心 → 楼栋 → 机房 → 机柜 4 层拓扑管理与机柜立面图"
        icon={MapPin}
      />

      <div className="table-workspace-body grid grid-cols-12 gap-2 flex-1 min-h-0">
        {/* Left: Location Tree Card */}
        {treeOpen && (
          <Card
            size="sm"
            className="col-span-12 flex flex-col gap-0 rounded-xl border border-border/80 bg-card py-0 ring-0 shadow-xs lg:col-span-4 xl:col-span-3 min-h-[480px]"
          >
            <CardHeader className="flex flex-row items-center justify-between gap-1 border-b border-border/60 px-3 py-2.5">
              <div className="flex items-center gap-1.5 font-semibold text-sm">
                <FolderTree className="size-4 text-primary" />
                <span>空间位置拓扑</span>
              </div>

              <div className="flex items-center gap-1">
                {can("locations:nodes:create") && can("locations:nodes:type:datacenter") && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title="新建数据中心"
                    aria-label="新建数据中心"
                    onClick={() =>
                      setFormDialog({ open: true, type: "datacenter", parent: null })
                    }
                  >
                    <Plus className="size-3.5" />
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setTreeOpen(false)}
                  title="收起位置树"
                  aria-label="收起位置树"
                >
                  <PanelLeftClose className="size-3.5" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="table-workspace-tree flex-1 overflow-y-auto p-2.5">
              <LocationTree
                selectedUid={selectedNode?.uid}
                expanded={expanded}
                onToggle={handleToggleExpand}
                onSelect={handleSelectNode}
                search={search}
                onSearchChange={setSearch}
                trail={
                  selectedNode
                    ? [...(selectedNode.path ?? []).map((p) => p.uid), selectedNode.uid]
                    : []
                }
                canSearch={can("api:GET:/api/v1/locations/nodes/search")}
                onAddChild={(node) => {
                  const type = node ? nextChildType[node.type] : "datacenter"
                  if (type) {
                    setFormDialog({ open: true, type, parent: node, node: null })
                  }
                }}
                onEditNode={(node) =>
                  setFormDialog({ open: true, type: node.type, node, parent: null })
                }
                onDeleteNode={handleDeleteNode}
              />
            </CardContent>
          </Card>
        )}

        {/* Right: Workstation Workspace Card */}
        <div
          className={cn(
            "col-span-12 flex flex-col gap-2 min-h-0",
            treeOpen ? "lg:col-span-8 xl:col-span-9" : "col-span-12",
          )}
        >
          {/* Workstation Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-card p-2.5 sm:p-3 shadow-xs min-w-0">
            {/* Breadcrumb Navigation & Node Badges */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
              {!treeOpen && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setTreeOpen(true)}
                  title="展开位置树"
                  aria-label="展开位置树"
                  className="mr-1 shrink-0"
                >
                  <PanelLeftOpen className="size-3.5" />
                </Button>
              )}

              <nav
                aria-label="位置层级面包屑"
                className="flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar py-0.5"
              >
                {breadcrumbs.map((crumb, idx) => {
                  const isLast = idx === breadcrumbs.length - 1
                  return (
                    <div key={crumb.uid} className="flex items-center gap-1 shrink-0">
                      {idx > 0 && <ChevronRight className="size-3 text-muted-foreground/60 shrink-0" />}
                      <button
                        type="button"
                        title={crumb.name}
                        onClick={() => {
                          if (crumb.uid === "root") {
                            handleSelectNode(null)
                          } else {
                            // Find and select parent
                            void locationsService.get(crumb.uid).then((res) => {
                              handleSelectNode(res.data)
                            })
                          }
                        }}
                        className={cn(
                          "rounded px-1.5 py-0.5 transition-colors font-medium text-xs truncate",
                          isLast
                            ? "bg-muted text-foreground font-semibold max-w-[140px] sm:max-w-[190px]"
                            : "text-muted-foreground hover:text-foreground hover:underline max-w-[100px] sm:max-w-[140px]",
                        )}
                      >
                        {crumb.name}
                      </button>
                    </div>
                  )
                })}
              </nav>

              {selectedNode && (
                <div className="ml-1 flex items-center gap-1.5 shrink-0">
                  <Badge variant="outline" className="text-[10px] shrink-0 font-normal">
                    {locationTypeLabels[selectedNode.type]}
                  </Badge>
                  <Badge
                    variant={selectedNode.status === 1 ? "outline" : "secondary"}
                    className={cn(
                      "text-[10px] shrink-0 font-normal",
                      selectedNode.status === 1
                        ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                        : "text-muted-foreground",
                    )}
                  >
                    {selectedNode.status === 1 ? "启用中" : "已停用"}
                  </Badge>
                </div>
              )}
            </div>

            {/* Node Operations Buttons */}
            {selectedNode ? (
              <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                {/* 1. Primary Action: Always visible */}
                {canCreateChild && childType && (
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 shadow-2xs"
                    onClick={() =>
                      setFormDialog({
                        open: true,
                        type: childType,
                        parent: selectedNode,
                      })
                    }
                  >
                    <Plus className="size-3" />
                    <span>新建{locationTypeLabels[childType]}</span>
                  </Button>
                )}

                {/* 2. Secondary Action: Edit - Always visible */}
                {can("locations:nodes:update") && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() =>
                      setFormDialog({
                        open: true,
                        type: selectedNode.type,
                        node: selectedNode,
                        parent: null,
                      })
                    }
                  >
                    <Pencil className="size-3" />
                    <span>编辑</span>
                  </Button>
                )}

                {/* 3. Wide screen (>= 1520px): Show remaining buttons directly */}
                <div className="hidden wide:flex items-center gap-1.5">
                  {selectedNode.type === "rack" &&
                    can("api:PUT:/api/v1/locations/nodes/:id/security-zone") && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setSecurityZoneRack(selectedNode)}
                      >
                        <ShieldCheck className="size-3" />
                        <span>设置安全域</span>
                      </Button>
                    )}

                  {can("locations:nodes:status") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={busy}
                      onClick={() => void handleToggleStatus(selectedNode)}
                    >
                      {selectedNode.status === 1 ? (
                        <>
                          <ToggleLeft className="size-3 text-muted-foreground" />
                          <span>停用</span>
                        </>
                      ) : (
                        <>
                          <ToggleRight className="size-3 text-emerald-600" />
                          <span>启用</span>
                        </>
                      )}
                    </Button>
                  )}

                  {can("locations:nodes:history") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setHistoryNode(selectedNode)}
                    >
                      <Clock className="size-3" />
                      <span>变更历史</span>
                    </Button>
                  )}

                  {can("api:GET:/api/v1/locations/nodes/:id/references") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => setReferencesNode(selectedNode)}
                    >
                      <Link2 className="size-3" />
                      <span>查看引用</span>
                    </Button>
                  )}

                  {can("locations:nodes:delete") && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={busy}
                      onClick={() => void handleDeleteNode(selectedNode)}
                    >
                      <Trash2 className="size-3" />
                      <span>删除</span>
                    </Button>
                  )}
                </div>

                {/* 4. Compressed screen (< 1520px): Collapse remaining actions into DropdownMenu */}
                <div className="wide:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          aria-label="更多操作"
                          title="更多操作"
                        />
                      }
                    >
                      <MoreHorizontal className="size-3.5" />
                      <span className="hidden sm:inline">更多</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuGroup>
                        {selectedNode.type === "rack" &&
                          can("api:PUT:/api/v1/locations/nodes/:id/security-zone") && (
                            <DropdownMenuItem onClick={() => setSecurityZoneRack(selectedNode)}>
                              <ShieldCheck className="size-3.5 mr-2" />
                              <span>设置安全域</span>
                            </DropdownMenuItem>
                          )}

                        {can("locations:nodes:status") && (
                          <DropdownMenuItem
                            disabled={busy}
                            onClick={() => void handleToggleStatus(selectedNode)}
                          >
                            {selectedNode.status === 1 ? (
                              <>
                                <ToggleLeft className="size-3.5 mr-2 text-muted-foreground" />
                                <span>停用该位置</span>
                              </>
                            ) : (
                              <>
                                <ToggleRight className="size-3.5 mr-2 text-emerald-600" />
                                <span>启用该位置</span>
                              </>
                            )}
                          </DropdownMenuItem>
                        )}

                        {can("locations:nodes:history") && (
                          <DropdownMenuItem onClick={() => setHistoryNode(selectedNode)}>
                            <Clock className="size-3.5 mr-2" />
                            <span>变更历史</span>
                          </DropdownMenuItem>
                        )}

                        {can("api:GET:/api/v1/locations/nodes/:id/references") && (
                          <DropdownMenuItem onClick={() => setReferencesNode(selectedNode)}>
                            <Link2 className="size-3.5 mr-2" />
                            <span>查看引用</span>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuGroup>

                      {can("locations:nodes:delete") && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void handleDeleteNode(selectedNode)}
                          >
                            <Trash2 className="size-3.5 mr-2" />
                            <span>删除该位置</span>
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ) : (
              canCreateChild && childType === "datacenter" && (
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1 shadow-2xs"
                    onClick={() =>
                      setFormDialog({
                        open: true,
                        type: "datacenter",
                        parent: null,
                      })
                    }
                  >
                    <Plus className="size-3" />
                    <span>新建数据中心</span>
                  </Button>
                </div>
              )
            )}
          </div>

          {/* Node Summary Meta Panel if Datacenter or Room or Rack */}
          {selectedNode && (
            <div className="rounded-xl border border-border/80 bg-card p-3 shadow-xs text-xs">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">位置名称</div>
                  <div className="font-semibold text-foreground text-sm mt-0.5">
                    {selectedNode.name}
                  </div>
                </div>

                {selectedNode.type === "datacenter" && (
                  <>
                    <div className="sm:col-span-2">
                      <div className="text-muted-foreground">物理地址</div>
                      <div className="text-foreground mt-0.5 font-medium">
                        {((selectedNode.ext as any)?.address) || "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">现场联系人</div>
                      <div className="text-foreground mt-0.5">
                        {((selectedNode.ext as any)?.contact?.name) ? (
                          <span>
                            {(selectedNode.ext as any).contact.name}
                            {(selectedNode.ext as any).contact.phone && (
                              <span className="text-muted-foreground ml-1">
                                ({(selectedNode.ext as any).contact.phone})
                              </span>
                            )}
                          </span>
                        ) : (
                          "—"
                        )}
                      </div>
                    </div>
                  </>
                )}

                {selectedNode.type === "room" && (
                  <div>
                    <div className="text-muted-foreground">所在楼层</div>
                    <div className="text-foreground mt-0.5 font-mono font-medium">
                      {formatFloor((selectedNode.ext as any)?.floor)}
                    </div>
                  </div>
                )}

                {selectedNode.type === "rack" && (
                  <>
                    <div>
                      <div className="text-muted-foreground">行列坐标</div>
                      <div className="text-foreground mt-0.5 font-mono font-medium">
                        {(selectedNode.ext as any)?.row} 排 {(selectedNode.ext as any)?.column} 列
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">高度规范</div>
                      <div className="text-foreground mt-0.5 font-mono font-medium">
                        {(selectedNode.ext as any)?.height_u ?? 42} U
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">承载功率</div>
                      <div className="text-foreground mt-0.5 font-mono">
                        {(selectedNode.ext as any)?.power_capacity_w
                          ? `${(selectedNode.ext as any).power_capacity_w} W (${(
                              Number((selectedNode.ext as any).power_capacity_w) / 1000
                            ).toFixed(1)} kW)`
                          : "未设置"}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Main Area: If Rack selected -> Elevation View; Otherwise -> SubNodes DataTable */}
          <div className="flex-1 min-h-0">
            {selectedNode?.type === "rack" ? (
              <RackElevationView
                rack={selectedNode}
                onEditSecurityZone={() => setSecurityZoneRack(selectedNode)}
              />
            ) : (
              <LocationSubNodesTable
                parentNode={selectedNode}
                onSelectNode={handleSelectNode}
                onCreateChild={(type, parent) =>
                  setFormDialog({ open: true, type, parent, node: null })
                }
                onEditNode={(node) =>
                  setFormDialog({ open: true, type: node.type, node, parent: null })
                }
                onSecurityZoneNode={setSecurityZoneRack}
                onToggleStatus={handleToggleStatus}
                onViewHistory={setHistoryNode}
                onViewReferences={setReferencesNode}
                onDeleteNode={handleDeleteNode}
              />
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <LocationFormDialog
        open={formDialog.open}
        onOpenChange={(open) => setFormDialog((prev) => ({ ...prev, open }))}
        type={formDialog.type}
        node={formDialog.node}
        parent={formDialog.parent}
        onSuccess={(saved) => {
          if (formDialog.node && selectedNode?.uid === saved.uid) {
            setSelectedNode(saved)
          }
        }}
      />

      <LocationSecurityZoneDialog
        open={securityZoneRack !== null}
        onOpenChange={(open) => !open && setSecurityZoneRack(null)}
        rack={securityZoneRack}
        onSuccess={(updated) => {
          if (selectedNode?.uid === updated.uid) {
            setSelectedNode(updated)
          }
        }}
      />

      {historyNode && (
        <ManagedHistorySheet
          open={Boolean(historyNode)}
          onOpenChange={(open) => !open && setHistoryNode(null)}
          resourceTitle={locationTypeLabels[historyNode.type]}
          recordId={historyNode.uid}
          recordName={historyNode.name}
          fetchHistory={locationsService.history}
        />
      )}

      {referencesNode && (
        <ManagedReferencesDialog
          open={Boolean(referencesNode)}
          onOpenChange={(open) => !open && setReferencesNode(null)}
          resourceTitle={locationTypeLabels[referencesNode.type]}
          recordId={referencesNode.uid}
          recordName={referencesNode.name}
          fetchReferences={locationsService.references}
        />
      )}
    </div>
  )
}
