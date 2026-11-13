import { useEffect, useRef, type KeyboardEvent } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Cpu,
  DoorClosed,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { locationsService, type LocationNode, type LocationType } from "@/services/locations"
import { useAuth } from "@/stores/auth-context"

export const locationTypeLabels: Record<LocationType, string> = {
  datacenter: "数据中心",
  building: "楼栋",
  room: "机房",
  rack: "机柜",
}

export const locationTypeIcons: Record<LocationType, typeof Server> = {
  datacenter: Server,
  building: Building2,
  room: DoorClosed,
  rack: Cpu,
}

export const nextChildType: Partial<Record<LocationType, LocationType>> = {
  datacenter: "building",
  building: "room",
  room: "rack",
}

export function formatFloor(floor: number | null | undefined): string {
  if (floor == null) return ""
  return floor < 0 ? `B${Math.abs(floor)}F` : `${floor}F`
}

export function formatRackPosition(ext?: Record<string, unknown>): string {
  if (!ext) return ""
  const row = ext.row ? String(ext.row) : ""
  const col = ext.column != null ? String(ext.column).padStart(2, "0") : ""
  if (row && col) return `${row}-${col}`
  if (row) return `${row}排`
  return ""
}

interface TreeBranchProps {
  parent?: string
  selectedUid?: string | null
  expanded: Set<string>
  onToggle: (uid: string) => void
  onSelect: (node: LocationNode | null) => void
  trail: string[]
  level?: number
  onAddChild?: (node: LocationNode | null) => void
  onEditNode?: (node: LocationNode) => void
  onDeleteNode?: (node: LocationNode) => void
}

function TreeBranch({
  parent,
  selectedUid,
  expanded,
  onToggle,
  onSelect,
  trail,
  level = 1,
  onAddChild,
  onEditNode,
  onDeleteNode,
}: TreeBranchProps) {
  const { can } = useAuth()
  const query = useInfiniteQuery({
    queryKey: ["location-nodes", "tree", parent ?? "root"],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      locationsService.list({ parent: parent ?? undefined, page: pageParam, page_size: 25 }, signal),
    getNextPageParam: ({ data }) =>
      data.page * data.page_size < data.total ? data.page + 1 : undefined,
  })

  const trailIndex = parent ? trail.indexOf(parent) : -1
  const reveal = !parent || trailIndex >= 0 ? trail[trailIndex + 1] : undefined
  const { data, fetchNextPage, hasNextPage, isFetching, isError } = query
  const found = data?.pages.some((page) => page.data.items.some((node) => node.uid === reveal))

  useEffect(() => {
    if (reveal && !found && hasNextPage && !isFetching && !isError) {
      void fetchNextPage()
    }
  }, [reveal, found, hasNextPage, isFetching, isError, fetchNextPage])

  const items = data?.pages.flatMap((page) => page.data.items) ?? []
  const isRootLevel = !parent
  const isRootSelected = selectedUid === null || selectedUid === "root" || selectedUid === undefined

  if (query.isPending && !data) {
    return (
      <div className="flex items-center gap-2 py-1.5 ps-4 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        <span>正在加载...</span>
      </div>
    )
  }

  if (query.isError) {
    return (
      <div className="flex items-center gap-2 py-1 ps-4 text-xs text-destructive">
        <span>加载失败</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs"
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="mr-1 size-3" />
          重试
        </Button>
      </div>
    )
  }

  return (
    <ul
      role={parent ? "group" : "tree"}
      aria-label={parent ? undefined : "空间位置导航树"}
      className={cn("space-y-0.5", parent && "ps-3")}
    >
      {/* Root "全部数据中心" Virtual Item */}
      {isRootLevel && (
        <li
          role="treeitem"
          aria-selected={isRootSelected}
          aria-level={1}
          className="select-none"
        >
          <div
            className={cn(
              "group/tree-row relative flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
              isRootSelected
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            )}
          >
            {isRootSelected && (
              <span
                aria-hidden
                className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-primary"
              />
            )}

            <button
              type="button"
              onClick={() => onSelect(null)}
              className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Server
                className={cn(
                  "size-3.5 shrink-0",
                  isRootSelected ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="truncate">全部数据中心</span>
            </button>

            {/* No duplicate root-row create icon; header + button owns datacenter creation */}
          </div>
        </li>
      )}

      {items.map((node) => (
        <TreeNodeItem
          key={node.uid}
          node={node}
          selectedUid={selectedUid}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          trail={trail}
          level={level}
          onAddChild={onAddChild}
          onEditNode={onEditNode}
          onDeleteNode={onDeleteNode}
        />
      ))}

      {items.length === 0 && !parent && (
        <li className="py-3 text-center text-xs text-muted-foreground">
          暂无数据中心，点击上方加号新建
        </li>
      )}

      {query.hasNextPage && (
        <li className="py-0.5 ps-4">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs text-muted-foreground hover:text-foreground"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? (
              <>
                <Loader2 className="mr-1 size-3 animate-spin" />
                加载中...
              </>
            ) : (
              "加载更多..."
            )}
          </Button>
        </li>
      )}
    </ul>
  )
}

function TreeNodeItem({
  node,
  selectedUid,
  expanded,
  onToggle,
  onSelect,
  trail,
  level,
  onAddChild,
  onEditNode,
  onDeleteNode,
}: {
  node: LocationNode
  selectedUid?: string | null
  expanded: Set<string>
  onToggle: (uid: string) => void
  onSelect: (node: LocationNode | null) => void
  trail: string[]
  level: number
  onAddChild?: (node: LocationNode | null) => void
  onEditNode?: (node: LocationNode) => void
  onDeleteNode?: (node: LocationNode) => void
}) {
  const { can } = useAuth()
  const isSelected = selectedUid === node.uid
  const isOpen = expanded.has(node.uid)
  const hasChildren = Boolean(node.has_children)
  const Icon = locationTypeIcons[node.type] || Layers
  const ext = (node.ext ?? {}) as Record<string, unknown>

  const childType = nextChildType[node.type]
  const canAdd =
    childType &&
    can("locations:nodes:create") &&
    can(`locations:nodes:type:${childType}`) &&
    node.status === 1
  const canEdit = can("locations:nodes:update")
  const canDelete = can("locations:nodes:delete")

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tree = event.currentTarget.closest('[role="tree"]')
    if (!tree) return
    const buttons = [...tree.querySelectorAll<HTMLButtonElement>("[data-tree-label]")]
    const index = buttons.indexOf(event.currentTarget)

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault()
        buttons[index + 1]?.focus()
        break
      case "ArrowUp":
        event.preventDefault()
        buttons[index - 1]?.focus()
        break
      case "Home":
        event.preventDefault()
        buttons[0]?.focus()
        break
      case "End":
        event.preventDefault()
        buttons.at(-1)?.focus()
        break
      case "ArrowRight":
        event.preventDefault()
        if (hasChildren && !isOpen) {
          onToggle(node.uid)
        } else if (isOpen) {
          buttons[index + 1]?.focus()
        }
        break
      case "ArrowLeft":
        event.preventDefault()
        if (isOpen) {
          onToggle(node.uid)
        } else {
          event.currentTarget
            .closest('[role="group"]')
            ?.parentElement?.querySelector<HTMLButtonElement>("[data-tree-label]")
            ?.focus()
        }
        break
      case "Enter":
      case " ":
        event.preventDefault()
        onSelect(node)
        break
    }
  }

  return (
    <li
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-level={level}
      className="select-none"
    >
      <div
        className={cn(
          "group/tree-row relative flex h-7 items-center gap-1 rounded-md px-1.5 text-xs transition-colors",
          isSelected
            ? "bg-primary/10 font-medium text-primary"
            : "text-foreground hover:bg-muted/70",
        )}
      >
        {isSelected && (
          <span
            aria-hidden
            className="absolute top-1 bottom-1 left-0 w-0.5 rounded-full bg-primary"
          />
        )}

        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isOpen ? `收起${node.name}` : `展开${node.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle(node.uid)
            }}
            className="flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          data-tree-label
          onKeyDown={onKeyDown}
          onClick={() => onSelect(node)}
          className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon className={cn("size-3.5 shrink-0", isSelected ? "text-primary" : "text-muted-foreground")} />
          <span className="truncate">{node.name}</span>

          {node.type === "room" && ext.floor != null && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal shrink-0">
              {formatFloor(Number(ext.floor))}
            </Badge>
          )}

          {node.type === "rack" && formatRackPosition(ext) && (
            <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal shrink-0">
              {formatRackPosition(ext)}
            </Badge>
          )}

          {node.status === 2 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal text-muted-foreground shrink-0">
              已停用
            </Badge>
          )}
        </button>

        {/* Hover action icons */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100">
          {canAdd && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              title={`新建${locationTypeLabels[childType]}`}
              aria-label={`新建${locationTypeLabels[childType]}`}
              onClick={(e) => {
                e.stopPropagation()
                onAddChild?.(node)
              }}
            >
              <Plus className="size-3" />
            </Button>
          )}

          {canEdit && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              title={`编辑${locationTypeLabels[node.type]}`}
              aria-label={`编辑${locationTypeLabels[node.type]}`}
              onClick={(e) => {
                e.stopPropagation()
                onEditNode?.(node)
              }}
            >
              <Pencil className="size-3" />
            </Button>
          )}

          {canDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title={`删除${locationTypeLabels[node.type]}`}
              aria-label={`删除${locationTypeLabels[node.type]}`}
              onClick={(e) => {
                e.stopPropagation()
                onDeleteNode?.(node)
              }}
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {isOpen && (
        <TreeBranch
          parent={node.uid}
          selectedUid={selectedUid}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          trail={trail}
          level={level + 1}
          onAddChild={onAddChild}
          onEditNode={onEditNode}
          onDeleteNode={onDeleteNode}
        />
      )}
    </li>
  )
}

export interface LocationTreeProps {
  selectedUid?: string | null
  expanded: Set<string>
  onToggle: (uid: string) => void
  onSelect: (node: LocationNode | null) => void
  search: string
  onSearchChange: (search: string) => void
  trail: string[]
  canSearch?: boolean
  onAddChild?: (node: LocationNode | null) => void
  onEditNode?: (node: LocationNode) => void
  onDeleteNode?: (node: LocationNode) => void
}

export function LocationTree({
  selectedUid,
  expanded,
  onToggle,
  onSelect,
  search,
  onSearchChange,
  trail,
  canSearch = true,
  onAddChild,
  onEditNode,
  onDeleteNode,
}: LocationTreeProps) {
  const { can } = useAuth()
  const searchInputRef = useRef<HTMLInputElement>(null)

  const searchQuery = useInfiniteQuery({
    queryKey: ["location-nodes", "search", search],
    enabled: Boolean(search) && canSearch,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      locationsService.list({ search, page: pageParam, page_size: 20 }, signal, true),
    getNextPageParam: ({ data }) =>
      data.page * data.page_size < data.total ? data.page + 1 : undefined,
  })

  const searchResults = searchQuery.data?.pages.flatMap((page) => page.data.items) ?? []

  return (
    <div className="flex h-full flex-col gap-2">
      {canSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder="跨层搜索位置名称..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pr-8 pl-8 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                onSearchChange("")
                searchInputRef.current?.focus()
              }}
              aria-label="清空搜索"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto pr-1">
        {search ? (
          <div className="space-y-1">
            <div className="px-1 text-[11px] font-medium text-muted-foreground">
              搜索结果 {searchQuery.data ? `(${searchQuery.data.pages[0]?.data.total ?? 0})` : ""}
            </div>
            {searchQuery.isPending && (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span>正在搜索...</span>
              </div>
            )}
            {searchQuery.isError && (
              <div className="py-2 text-xs text-destructive">
                搜索失败
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-2 h-6 px-1.5 text-xs"
                  onClick={() => void searchQuery.refetch()}
                >
                  重试
                </Button>
              </div>
            )}
            {searchResults.length === 0 && !searchQuery.isPending && (
              <div className="py-4 text-center text-xs text-muted-foreground">未找到匹配的位置</div>
            )}
            <ul className="space-y-1" role="list">
              {searchResults.map((item) => {
                const Icon = locationTypeIcons[item.type] || Layers
                const ext = (item.ext ?? {}) as Record<string, unknown>
                const pathNames = (item.path ?? []).map((p) => p.name)
                const isSelected = selectedUid === item.uid

                const childType = nextChildType[item.type]
                const canAdd =
                  childType &&
                  can("locations:nodes:create") &&
                  can(`locations:nodes:type:${childType}`) &&
                  item.status === 1
                const canEdit = can("locations:nodes:update")
                const canDelete = can("locations:nodes:delete")

                return (
                  <li key={item.uid}>
                    <div
                      className={cn(
                        "group/tree-row relative flex items-center justify-between rounded-md p-2 text-xs transition-colors",
                        isSelected
                          ? "bg-primary/10 font-medium text-primary"
                          : "hover:bg-muted/70",
                      )}
                    >
                      {isSelected && (
                        <span
                          aria-hidden
                          className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => onSelect(item)}
                        className="min-w-0 flex-1 text-left outline-none"
                      >
                        <div className="flex items-center gap-1.5 font-medium">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{item.name}</span>
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            {locationTypeLabels[item.type]}
                          </Badge>
                          {item.type === "room" && ext.floor != null && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              {formatFloor(Number(ext.floor))}
                            </Badge>
                          )}
                          {item.status === 2 && (
                            <Badge variant="secondary" className="h-4 px-1 text-[10px] text-muted-foreground">
                              已停用
                            </Badge>
                          )}
                        </div>
                        {pathNames.length > 0 && (
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            {pathNames.join(" / ")}
                          </div>
                        )}
                      </button>

                      {/* Hover action icons */}
                      <div className="ml-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100">
                        {canAdd && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                            title={`新建${locationTypeLabels[childType]}`}
                            aria-label={`新建${locationTypeLabels[childType]}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              onAddChild?.(item)
                            }}
                          >
                            <Plus className="size-3" />
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                            title={`编辑${locationTypeLabels[item.type]}`}
                            aria-label={`编辑${locationTypeLabels[item.type]}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              onEditNode?.(item)
                            }}
                          >
                            <Pencil className="size-3" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title={`删除${locationTypeLabels[item.type]}`}
                            aria-label={`删除${locationTypeLabels[item.type]}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              onDeleteNode?.(item)
                            }}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
            {searchQuery.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-6 w-full text-xs text-muted-foreground"
                disabled={searchQuery.isFetchingNextPage}
                onClick={() => void searchQuery.fetchNextPage()}
              >
                {searchQuery.isFetchingNextPage ? "加载中..." : "加载更多搜索结果..."}
              </Button>
            )}
          </div>
        ) : (
          <TreeBranch
            selectedUid={selectedUid}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={onSelect}
            trail={trail}
            onAddChild={onAddChild}
            onEditNode={onEditNode}
            onDeleteNode={onDeleteNode}
          />
        )}
      </div>
    </div>
  )
}
