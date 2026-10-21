import { useCallback, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  KeyRound,
  Lock,
  MoreHorizontal,
  MousePointerClick,
  PanelsTopLeft,
  Pencil,
  Plus,
  RefreshCcwDot,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react"
import { DataTable, type ColumnDef, type FacetedFilterConfig } from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { BuiltinBadge, MethodBadge } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { PageHeader } from "@/components/common/page-header"
import { StatCard, StatGrid } from "@/components/common/stat-card"
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
  const { can } = useAuth()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<PermissionFormState>(null)
  const [report, setReport] = useState<RouteSyncReport | null>(null)
  const [syncing, setSyncing] = useState(false)

  const query = useQuery({ queryKey: queryKeys.permissions, queryFn: async () => (await permissionsService.tree()).data })
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
      {
        id: "actions",
        header: () => <span className="sr-only">操作</span>,
        enableHiding: false,
        enableSorting: false,
        cell: ({ row }) => {
          const p = row.original
          const canManage = (p.type !== "api" && can("permissions:create")) || can("permissions:update") || can("permissions:delete")
          if (!canManage) return null
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${p.name} 的操作`} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {can("permissions:create") && p.type !== "api" && (
                    <DropdownMenuItem onClick={() => setForm({ mode: "create", parentId: p.id })}>
                      <Plus />
                      新增子节点
                    </DropdownMenuItem>
                  )}
                  {can("permissions:update") && (
                    <DropdownMenuItem onClick={() => setForm({ mode: "edit", permission: p })}>
                      <Pencil />
                      编辑
                    </DropdownMenuItem>
                  )}
                  {can("permissions:delete") && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={p.built_in} onClick={() => remove(p)}>
                        {p.built_in ? <Lock /> : <Trash2 />}
                        {p.built_in ? "内置节点不可删除" : "删除"}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        },
      },
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

  return (
    <>
      <PageHeader
        icon={KeyRound}
        title="权限清单"
        description="维护菜单、操作按钮与接口三级权限点；接口权限由服务端在每次请求时强制鉴权"
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:text-violet-300">
            <span className="size-1.5 rounded-full bg-violet-500 animate-pulse" />
            RBAC 细粒度权限模型
          </span>
        }
        actions={
          <>
            {can("permissions:sync") && (
              <Button variant="outline" onClick={syncRoutes} disabled={syncing}>
                {syncing ? <Spinner /> : <RefreshCcwDot />}
                同步系统路由
              </Button>
            )}
            {can("permissions:create") && (
              <Button onClick={() => setForm({ mode: "create", parentId: null })} className="shadow-xs">
                <Plus />
                新建权限点
              </Button>
            )}
          </>
        }
      />

      <StatGrid>
        <StatCard label="菜单" value={counts.menu} icon={PanelsTopLeft} tone="primary" loading={query.isLoading} hint="控制侧栏与路由可见性" />
        <StatCard label="按钮" value={counts.button} icon={MousePointerClick} tone="warning" loading={query.isLoading} hint="控制页面内操作入口" />
        <StatCard label="接口" value={counts.api} icon={Webhook} tone="info" loading={query.isLoading} hint="控制后端接口访问，按 (角色, 路径, 请求方法) 鉴权" />
        <StatCard label="内置节点" value={counts.builtIn} icon={ShieldCheck} tone="default" loading={query.isLoading} hint="随系统升级维护，不可删除" />
      </StatGrid>

      <Card className="border border-border/80 bg-card shadow-xs rounded-xl">
        <CardContent>
          <DataTable
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
        </CardContent>
      </Card>

      <PermissionFormDialog state={form} tree={tree} onOpenChange={(open) => !open && setForm(null)} />
      <SyncReportDialog report={report} onOpenChange={(open) => !open && setReport(null)} />
    </>
  )
}
