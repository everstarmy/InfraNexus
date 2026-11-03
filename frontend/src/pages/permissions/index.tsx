import { PermissionLazyTable } from "./components/permission-lazy-table"
import { useCallback, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  Lock,
  MousePointerClick,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCcwDot,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react"
import { DataTable, DataTableCard, DataTableTitle, createActionsColumn, type ColumnDef, type FacetedFilterConfig } from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { BuiltinBadge, MethodBadge } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { isForbiddenQueryError } from "@/components/common/query-error-state"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { formatPercent } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { flattenTree } from "@/lib/tree"
import { cn } from "@/lib/utils"
import { permissionsService, type PermissionDTO, type RouteSyncReport } from "@/services/permissions"
import { useAuth } from "@/stores/auth-context"
import { PermissionFormDialog, type PermissionFormState } from "./components/permission-form-dialog"
import { SyncReportDialog } from "./components/sync-report-dialog"

const typeMeta = {
  menu: { label: "菜单", icon: PanelsTopLeft, className: "border-primary/30 bg-primary/10 text-primary" },
  button: { label: "按钮", icon: MousePointerClick, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  api: { label: "接口", icon: Webhook, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
} as const

export default function PermissionsPage() {
  const { can, user: me } = useAuth()
  const [lazyTree, setLazyTree] = useState(false)
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<PermissionFormState>(null)
  const [report, setReport] = useState<RouteSyncReport | null>(null)
  const [syncing, setSyncing] = useState(false)

  const query = useQuery({ queryKey: queryKeys.permissions, queryFn: async ({ signal }) => (await permissionsService.tree(signal)).data })
  const forbidden = isForbiddenQueryError(query.error)
  const queryUnavailable = query.isError && (!query.data || forbidden)
  const tree = useMemo(() => query.data ?? [], [query.data])
  const flat = useMemo(() => flattenTree(tree), [tree])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["permissions"] })
    void queryClient.invalidateQueries({ queryKey: ["roles"] })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  }, [queryClient])

  const syncRoutes = () =>
    void confirm({
      tone: "default",
      title: "同步系统接口权限？",
      description: "将扫描服务端已注册的受控路由，为缺失的接口自动登记权限点，并依据当前角色授权重建底层鉴权策略。",
      confirmText: "开始同步",
      onConfirm: async () => {
        setSyncing(true)
        try {
          const res = await permissionsService.sync()
          setReport(res.data)
          invalidate()
        } catch (error) {
          notify.apiError(error, "同步失败")
          throw error
        } finally {
          setSyncing(false)
        }
      },
    })

  const remove = useCallback(
    (perm: PermissionDTO) =>
      void confirm({
        title: `删除权限点「${perm.name}」？`,
        description: "删除后，已授予该权限点的角色将同步移除对应授权与访问策略。",
        confirmText: "确认删除",
        onConfirm: async () => {
          try {
            await permissionsService.remove(perm.id)
            notify.success("权限点已删除", perm.name)
            invalidate()
          } catch (error) {
            notify.apiError(error, "删除失败")
            throw error
          }
        },
      }),
    [confirm, invalidate],
  )

  const columns = useMemo<ColumnDef<PermissionDTO>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="权限点" />,
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original
          const meta = typeMeta[p.type]
          const Icon = meta.icon
          return (
            <div className="flex min-w-64 items-center gap-1.5" style={{ paddingLeft: row.depth * 20 }}>
              <Button
                variant="ghost"
                size="icon-xs"
                className={cn("text-muted-foreground", !row.getCanExpand() && "invisible")}
                onClick={(e) => {
                  e.stopPropagation()
                  row.toggleExpanded()
                }}
                aria-label={row.getIsExpanded() ? "收起" : "展开"}
              >
                <ChevronRight className={cn("size-3.5 transition-transform duration-200", row.getIsExpanded() && "rotate-90")} />
              </Button>
              <Icon className={cn("size-4 shrink-0", p.type === "menu" ? "text-primary" : "text-muted-foreground")} />
              <span className={cn("truncate text-sm", p.type === "menu" && "font-medium")}>{p.name}</span>
              {p.built_in && <BuiltinBadge />}
            </div>
          )
        },
      },
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="权限编码" />,
        enableSorting: false,
        cell: ({ row }) => <code className="font-mono text-xs text-muted-foreground">{row.original.code}</code>,
      },
      {
        id: "type",
        accessorKey: "type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="类型" />,
        enableSorting: false,
        cell: ({ row }) => {
          const meta = typeMeta[row.original.type]
          return (
            <Badge variant="outline" className={cn("rounded-md", meta.className)}>
              {meta.label}
            </Badge>
          )
        },
      },
      {
        id: "path",
        accessorFn: (p) => `${p.method ?? ""} ${p.path ?? ""}`,
        header: ({ column }) => <DataTableColumnHeader column={column} title="路由 / 接口" />,
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original
          if (!p.path) return <span className="text-xs text-muted-foreground">—</span>
          return (
            <span className="flex items-center gap-2">
              {p.type === "api" && <MethodBadge method={p.method} />}
              <code className="font-mono text-xs">{p.path}</code>
            </span>
          )
        },
      },
      {
        id: "sort_order",
        accessorKey: "sort_order",
        header: ({ column }) => <DataTableColumnHeader column={column} title="排序" />,
        enableSorting: false,
        cell: ({ row }) => <span className="text-xs text-muted-foreground tabular-nums">{row.original.sort_order ?? 0}</span>,
      },
      createActionsColumn<PermissionDTO>({
        srOnlyHeader: true,
        triggerAriaLabel: (p) => `${p.name} 的操作`,
        actions: (p) => [
          {
            key: "create-child",
            label: "新增子节点",
            icon: <Plus />,
            hidden: !can("permissions:create") || p.type === "api",
            onSelect: (row) => setForm({ mode: "create", parentId: row.id }),
          },
          {
            key: "edit",
            label: "编辑",
            icon: <Pencil />,
            hidden: !can("permissions:update"),
            onSelect: (row) => setForm({ mode: "edit", permission: row }),
          },
          {
            key: "delete",
            label: p.built_in ? "内置节点不可删除" : "删除",
            icon: p.built_in ? <Lock /> : <Trash2 />,
            destructive: true,
            disabled: p.built_in,
            hidden: !can("permissions:delete"),
            onSelect: (row) => remove(row),
          },
        ],
      }),
    ],
    [can, remove],
  )

  const facetedFilters: FacetedFilterConfig[] = [
    {
      columnId: "type",
      title: "类型",
      options: [
        { label: "菜单", value: "menu", icon: PanelsTopLeft },
        { label: "按钮", value: "button", icon: MousePointerClick },
        { label: "接口", value: "api", icon: Webhook },
      ],
    },
  ]

  const counts = {
    menu: flat.filter((p) => p.type === "menu").length,
    button: flat.filter((p) => p.type === "button").length,
    api: flat.filter((p) => p.type === "api").length,
    builtIn: flat.filter((p) => p.built_in).length,
  }
  const hasStatsData = !queryUnavailable && Boolean(query.data)

  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      <StatGrid>
        <StatCard label="菜单" value={queryUnavailable ? "—" : counts.menu} icon={PanelsTopLeft} tone="primary" loading={query.isLoading} hint={hasStatsData ? `一级菜单 ${tree.filter((node) => node.type === "menu").length} · 占比 ${formatPercent(counts.menu, flat.length)}` : undefined} />
        <StatCard label="按钮" value={queryUnavailable ? "—" : counts.button} icon={MousePointerClick} tone="warning" loading={query.isLoading} hint={hasStatsData ? `占比 ${formatPercent(counts.button, flat.length)}` : undefined} />
        <StatCard label="接口" value={queryUnavailable ? "—" : counts.api} icon={Webhook} tone="info" loading={query.isLoading} hint={hasStatsData ? `占比 ${formatPercent(counts.api, flat.length)}` : undefined} />
        <StatCard label="内置节点" value={queryUnavailable ? "—" : counts.builtIn} icon={ShieldCheck} tone="default" loading={query.isLoading} hint={hasStatsData ? `自定义 ${flat.length - counts.builtIn} · 占比 ${formatPercent(counts.builtIn, flat.length)}` : undefined} />
      </StatGrid>

      <DataTableCard
        className="table-workspace-body"
        label="权限树"
        title={<DataTableTitle title="权限树" count={flat.length} />}
        toolbarControls={
          can("api:GET:/api/v1/permissions/nodes") ? (
            <Button variant="outline" size="sm" aria-pressed={lazyTree} onClick={() => setLazyTree((value) => !value)}>
              {lazyTree ? "返回完整权限树" : "按需浏览权限节点"}
            </Button>
          ) : undefined
        }
        actions={
          <>
            {can("permissions:sync") && (
              <Button variant="outline" size="sm" onClick={syncRoutes} disabled={syncing}>
                {syncing ? <Spinner /> : <RefreshCcwDot />}
                同步系统路由
              </Button>
            )}
            {can("permissions:create") && (
              <Button
                size="icon"
                onClick={() => setForm({ mode: "create", parentId: null })}
                title="新建权限点"
                aria-label="新建权限点"
              >
                <Plus />
              </Button>
            )}
          </>
        }
        error={lazyTree ? undefined : query.error}
        hasData={Boolean(query.data)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      >
        {lazyTree ? (
          <PermissionLazyTable actorID={me?.id ?? ""} />
        ) : (
          <DataTable
            viewport={{ mode: "fill", mobileContent: true }}
            layoutControls={{ fullscreen: true }}
            columns={columns}
            data={tree}
            loading={query.isLoading}
            getRowId={(p) => p.id}
            getSubRows={(p) => p.children}
            defaultExpanded={true}
            searchPlaceholder="搜索名称、编码或接口路径"
            facetedFilters={facetedFilters}
            columnLabels={{ name: "权限点", code: "权限编码", type: "类型", path: "路由 / 接口", sort_order: "排序" }}
            initialColumnVisibility={{ sort_order: false }}
            defaultPageSize={50}
            pageSizeOptions={[20, 50, 100]}
            onRefresh={() => void query.refetch()}
            isRefreshing={query.isFetching}
            stickyActionColumn
            emptyTitle="暂无权限点"
            emptyDescription="点击「同步系统路由」自动登记服务端接口"
          />
        )}
      </DataTableCard>

      <PermissionFormDialog state={form} tree={tree} onOpenChange={(open) => !open && setForm(null)} />
      <SyncReportDialog report={report} onOpenChange={(open) => !open && setReport(null)} />
    </div>
  )
}
