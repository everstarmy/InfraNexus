import * as React from "react"
import { Building2, ChevronRight, FolderTree, Network, Search, UsersRound, UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"
import { filterTree, flattenTree } from "@/lib/tree"
import type { DepartmentNode } from "@/services/departments"

export const ALL_KEY = "all"
export const UNASSIGNED_KEY = "none"

export interface DepartmentTreeProps {
  nodes: DepartmentNode[]
  selectedKey?: string | null
  onSelect: (key: string, node?: DepartmentNode) => void
  allItem?: { label: string; count?: number }
  unassignedItem?: { label: string; count?: number }
  showCounts?: boolean
  searchable?: boolean
  disabledKeys?: ReadonlySet<string>
  defaultExpandDepth?: number
  renderActions?: (node: DepartmentNode) => React.ReactNode
  className?: string
}

function collectExpandable(nodes: DepartmentNode[], depth: number, maxDepth: number, out: Set<string>) {
  for (const node of nodes) {
    if (node.children?.length && depth < maxDepth) {
      out.add(node.id)
      collectExpandable(node.children, depth + 1, maxDepth, out)
    }
  }
  return out
}

export function DepartmentTree({
  nodes,
  selectedKey,
  onSelect,
  allItem,
  unassignedItem,
  showCounts = true,
  searchable = true,
  disabledKeys,
  defaultExpandDepth = 2,
  renderActions,
  className,
}: DepartmentTreeProps) {
  const [query, setQuery] = React.useState("")
  const [expanded, setExpanded] = React.useState<Set<string>>(() => collectExpandable(nodes, 0, defaultExpandDepth - 1, new Set()))
  const seeded = React.useRef(nodes.length > 0)

  React.useEffect(() => {
    if (!seeded.current && nodes.length > 0) {
      seeded.current = true
      setExpanded(collectExpandable(nodes, 0, defaultExpandDepth - 1, new Set()))
    }
  }, [nodes, defaultExpandDepth])

  const keyword = query.trim().toLowerCase()
  const visible = React.useMemo(
    () => (keyword ? filterTree(nodes, (n) => n.name.toLowerCase().includes(keyword) || n.code.toLowerCase().includes(keyword)) : nodes),
    [nodes, keyword],
  )
  const forcedOpen = React.useMemo(() => (keyword ? new Set(flattenTree(visible).map((n) => n.id)) : null), [keyword, visible])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const renderNode = (node: DepartmentNode, depth: number): React.ReactNode => {
    const hasChildren = node.children?.length > 0
    const isOpen = forcedOpen ? forcedOpen.has(node.id) : expanded.has(node.id)
    const selected = selectedKey === node.id
    const disabled = disabledKeys?.has(node.id) ?? false
    const Icon = node.source === "ldap" ? Network : depth === 0 ? Building2 : FolderTree
    return (
      <li key={node.id} role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={selected}>
        <div
          className={cn(
            "group/tree-row relative flex items-center gap-0.5 rounded-lg pr-1 transition-colors",
            selected ? "bg-primary/10 text-primary" : "hover:bg-muted/70",
          )}
          style={{ paddingLeft: depth * 14 }}
        >
          {selected && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />}
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn("text-muted-foreground hover:bg-transparent", !hasChildren && "invisible")}
            onClick={() => toggle(node.id)}
            aria-label={isOpen ? `收起 ${node.name}` : `展开 ${node.name}`}
            tabIndex={hasChildren ? 0 : -1}
          >
            <ChevronRight className={cn("transition-transform duration-200", isOpen && "rotate-90")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(node.id, node)}
            className={cn(
              "h-8 min-w-0 flex-1 justify-start gap-2 px-1.5 font-normal hover:bg-transparent",
              selected && "font-medium text-primary hover:text-primary",
              node.status !== 1 && "text-muted-foreground",
            )}
          >
            <Icon className={cn("size-4 shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
            <span className="truncate">{node.name}</span>
            {node.status !== 1 && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">停用</span>}
          </Button>
          {renderActions && <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/tree-row:opacity-100 group-focus-within/tree-row:opacity-100">{renderActions(node)}</div>}
          {showCounts && (
            <span className={cn("shrink-0 px-1 font-mono text-[11px] tabular-nums", selected ? "text-primary" : "text-muted-foreground")}>
              {node.total_member_count}
            </span>
          )}
        </div>
        {hasChildren && isOpen && (
          <ul role="group" className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  const virtualItem = (key: string, label: string, count: number | undefined, Icon: typeof UsersRound) => (
    <li role="treeitem" aria-selected={selectedKey === key}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onSelect(key)}
        className={cn(
          "relative h-8 w-full justify-start gap-2 pr-2 pl-2 font-normal",
          selectedKey === key ? "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary" : "hover:bg-muted/70",
        )}
      >
        {selectedKey === key && <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-primary" />}
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">{label}</span>
        {count !== undefined && <span className="font-mono text-[11px] tabular-nums opacity-80">{count}</span>}
      </Button>
    </li>
  )

  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      {searchable && (
        <InputGroup className="h-8 shadow-none border-input/50 bg-muted/30 focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索部门名称或编码" className="text-xs" />
        </InputGroup>
      )}
      <ul role="tree" aria-label="组织架构" className="min-h-0 space-y-0.5 text-sm">
        {allItem && virtualItem(ALL_KEY, allItem.label, allItem.count, UsersRound)}
        {visible.map((node) => renderNode(node, 0))}
        {keyword && visible.length === 0 && (
          <li className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配「{query}」的部门</li>
        )}
        {unassignedItem && virtualItem(UNASSIGNED_KEY, unassignedItem.label, unassignedItem.count, UserX)}
      </ul>
    </div>
  )
}
