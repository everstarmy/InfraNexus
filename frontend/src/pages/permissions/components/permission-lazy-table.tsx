import { Input } from "@/components/ui/input"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ExpandedState } from "@tanstack/react-table"
import { DataTable, DataTableTitle, type ColumnDef } from "@/components/data-table"
import { Button } from "@/components/ui/button"
import { permissionNodes, type PermissionNode } from "@/services/permissions"

type Branch = { status: "loading" | "error" | "loaded"; items: PermissionNode[] }
export function PermissionLazyTable({
  actorID,
  toolbarControls,
  actions,
}: {
  actorID: string
  toolbarControls?: React.ReactNode
  actions?: React.ReactNode
}) {
  const [keyword, setKeyword] = useState("")
  const [version, setVersion] = useState(0)
  return (
    <div className="table-workspace-lazy flex min-w-0 flex-col gap-3">
      <Input
        aria-label="搜索权限路径（保留祖先）"
        placeholder="搜索权限路径（保留祖先）"
        maxLength={200}
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <PermissionNodeTable
        key={`${actorID}:${keyword}:${version}`}
        actorID={actorID}
        keyword={keyword}
        toolbarControls={toolbarControls}
        actions={actions}
        onRefresh={() => setVersion((value) => value + 1)}
      />
    </div>
  )
}
function PermissionNodeTable({
  actorID,
  keyword,
  toolbarControls,
  actions,
  onRefresh,
}: {
  actorID: string
  keyword: string
  toolbarControls?: React.ReactNode
  actions?: React.ReactNode
  onRefresh: () => void
}) {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const [branches, setBranches] = useState<Record<string, Branch>>({})
  const requests = useRef(new Map<string, AbortController>())
  const query = useQuery({
    queryKey: ["permissions", "nodes", actorID, keyword, pagination],
    queryFn: async ({ signal }) =>
      (
        await permissionNodes(
          { keyword, page: pagination.pageIndex + 1, page_size: pagination.pageSize },
          signal,
        )
      ).data,
    refetchOnWindowFocus: false,
    retry: false,
  })
  useEffect(() => {
    const active = requests.current
    return () => {
      for (const controller of active.values()) controller.abort()
      active.clear()
    }
  }, [])
  const load = async (id: string) => {
    if (requests.current.has(id)) return
    const controller = new AbortController()
    requests.current.set(id, controller)
    setBranches((value) => ({ ...value, [id]: { status: "loading", items: [] } }))
    try {
      const items: PermissionNode[] = []
      for (let page = 1; page <= 5; page++) {
        const result = (
          await permissionNodes({ parent_id: id, keyword, page, page_size: 100 }, controller.signal)
        ).data
        if (result.total > 500) throw new Error("Too many siblings")
        items.push(...result.items)
        if (items.length >= result.total || result.items.length === 0) break
      }
      if (!controller.signal.aborted)
        setBranches((value) => ({ ...value, [id]: { status: "loaded", items } }))
    } catch {
      if (!controller.signal.aborted)
        setBranches((value) => ({ ...value, [id]: { status: "error", items: [] } }))
    } finally {
      if (requests.current.get(id) === controller) requests.current.delete(id)
    }
  }
  const changeExpanded = (next: ExpandedState) => {
    if (next === true) return
    const previous = expanded === true ? {} : expanded
    for (const [id, open] of Object.entries(next))
      if (open && !previous[id] && !branches[id]) void load(id)
    for (const [id, controller] of requests.current)
      if (!next[id]) {
        controller.abort()
        requests.current.delete(id)
        setBranches((value) => {
          const copy = { ...value }
          delete copy[id]
          return copy
        })
      }
    setExpanded(next)
  }
  const data = useMemo(() => {
    const attach = (nodes: PermissionNode[], ancestors: Set<string>): PermissionNode[] =>
      nodes
        .filter((node) => !ancestors.has(node.id))
        .map((node) => ({
          ...node,
          children: attach(branches[node.id]?.items ?? [], new Set([...ancestors, node.id])),
        }))
    return attach(query.data?.items ?? [], new Set())
  }, [query.data, branches])
  const columns: ColumnDef<PermissionNode>[] = [
    {
      id: "name",
      accessorKey: "name",
      header: "权限点",
      cell: ({ row }) => {
        const branch = branches[row.id]
        return (
          <div className="flex items-center gap-2" style={{ paddingLeft: row.depth * 16 }}>
            {row.original.has_children && (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={
                  row.getIsExpanded() ? `收起 ${row.original.name}` : `展开 ${row.original.name}`
                }
                aria-expanded={row.getIsExpanded()}
                onClick={() => row.toggleExpanded()}
              >
                {row.getIsExpanded() ? "−" : "+"}
              </Button>
            )}
            <span>{row.original.name}</span>
            {branch?.status === "loading" && <span role="status">加载中…</span>}
            {branch?.status === "error" && (
              <Button size="sm" variant="outline" onClick={() => void load(row.id)}>
                加载失败，重试（单级最多 500 项）
              </Button>
            )}
            {branch?.status === "loaded" && !branch.items.length && (
              <span className="text-muted-foreground">无匹配子节点</span>
            )}
          </div>
        )
      },
    },
    { id: "code", accessorKey: "code", header: "权限编码" },
    { id: "type", accessorKey: "type", header: "类型", cell: ({ row }) => ({ menu: "菜单", button: "按钮", api: "接口" })[row.original.type] },
  ]
  if (query.isError)
    return (
      <div role="alert">
        节点加载失败{" "}
        <Button variant="outline" onClick={() => void query.refetch()}>
          重试权限节点
        </Button>
      </div>
    )
  return (
    <DataTable
      columns={columns}
      data={data}
      loading={query.isPending}
      getRowId={(row) => row.id}
      getSubRows={(row) => row.children}
      treeState={{ expanded, onChange: changeExpanded, canExpand: (row) => row.has_children }}
      serverFiltering
      hideSearch
      serverPagination={{
        ...pagination,
        total: query.data?.root_total ?? 0,
        onChange: setPagination,
      }}
      toolbarTitle={<DataTableTitle title="权限节点" count={query.data?.root_total ?? 0} />}
      toolbarControls={toolbarControls}
      actions={actions}
      onRefresh={onRefresh}
      viewport={{ mode: "fill", mobileContent: true }}
      summary={{
        label: "筛选计数",
        render: () =>
          `根节点 ${query.data?.root_total ?? 0} · 直接匹配 ${query.data?.matched_nodes ?? 0} · 含祖先 ${query.data?.retained_nodes ?? 0}`,
      }}
      emptyTitle="无匹配权限节点"
      hideViewOptions
    />
  )
}
