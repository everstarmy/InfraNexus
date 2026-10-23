import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { Crown, KeyRound, Lock, MoreHorizontal, Pencil, ShieldCheck, ShieldOff, ShieldPlus, Trash2, UsersRound } from "lucide-react"
import { DataTable, type ColumnDef } from "@/components/data-table"
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
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BuiltinBadge, StatusDot } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { PageHeader } from "@/components/common/page-header"
import { QueryErrorState, QueryPlaceholderNotice, isForbiddenQueryError } from "@/components/common/query-error-state"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "@/lib/utils"
import { rolesService, type RoleDTO } from "@/services/roles"
import type { PageData } from "@/services/types"
import { useAuth } from "@/stores/auth-context"
import { RoleFormDialog } from "./components/role-form-dialog"
import { RoleMembersSheet } from "./components/role-members-sheet"
import { RolePermissionDialog } from "./components/role-permission-dialog"

export default function RolesPage() {
  const { user, can } = useAuth()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [form, setForm] = useState<RoleDTO | "new" | null>(null)
  const [permRole, setPermRole] = useState<RoleDTO | null>(null)
  const [membersRole, setMembersRole] = useState<RoleDTO | null>(null)
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const statusRequests = useRef(new Map<string, Promise<void>>())
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const [search, setSearch] = useState("")
  const keyword = useDebouncedValue(search.trim(), 250)

  useEffect(() => {
    if (searchParams.get("create") !== "1") return
    if (can("roles:create")) setForm("new")
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      next.delete("create")
      return next
    }, { replace: true })
  }, [searchParams, setSearchParams, can])

  useEffect(() => {
    setPagination((current) => current.pageIndex === 0 ? current : { ...current, pageIndex: 0 })
  }, [keyword])

  const params = useMemo(() => ({ page: pagination.pageIndex + 1, page_size: pagination.pageSize, keyword: keyword || undefined }), [pagination, keyword])
  const query = useQuery({
    queryKey: queryKeys.roles(params),
    queryFn: async ({ signal }) => (await rolesService.list(params, signal)).data,
    placeholderData: keepPreviousData,
  })
  const roles = useMemo(() => query.data?.items ?? [], [query.data?.items])
  const total = query.data?.total ?? 0
  const forbidden = isForbiddenQueryError(query.error)
  const listUnavailable = query.isError && (!query.data || forbidden)

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["roles"] })
    void queryClient.invalidateQueries({ queryKey: ["options"] })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  }, [queryClient])

  const toggleStatus = useCallback(
    async (role: RoleDTO, enabled: boolean, silent = false) => {
      const existingRequest = statusRequests.current.get(role.id)
      if (existingRequest) {
        await existingRequest
        return
      }
      const status = enabled ? 1 : 2
      const optimisticRevision = role.edit_revision + 1
      const detailKey = ["roles", "detail", role.id] as const
      const detailSnapshot = queryClient.getQueryData<RoleDTO>(detailKey)
      setPending((current) => new Set(current).add(role.id))
      await queryClient.cancelQueries({ queryKey: ["roles", "list"] })
      const snapshots = new Map<string, RoleDTO>()
      for (const [key, page] of queryClient.getQueriesData<PageData<RoleDTO>>({ queryKey: ["roles", "list"] })) {
        const previous = page?.items.find((item) => item.id === role.id)
        if (!page || !previous) continue
        snapshots.set(JSON.stringify(key), previous)
        queryClient.setQueryData<PageData<RoleDTO>>(key, {
          ...page,
          items: page.items.map((item) => item.id === role.id ? { ...item, status, edit_revision: optimisticRevision } : item),
        })
      }
      if (detailSnapshot) {
        queryClient.setQueryData<RoleDTO>(detailKey, { ...detailSnapshot, status, edit_revision: optimisticRevision })
      }
      const request = (async () => {
      try {
        const updated = (await rolesService.setStatus(role.id, status, role.edit_revision)).data
        for (const [key, page] of queryClient.getQueriesData<PageData<RoleDTO>>({ queryKey: ["roles", "list"] })) {
          if (!page) continue
          queryClient.setQueryData<PageData<RoleDTO>>(key, {
            ...page,
            items: page.items.map((item) => item.id === role.id && item.edit_revision === optimisticRevision ? { ...item, ...updated } : item),
          })
        }
        const currentDetail = queryClient.getQueryData<RoleDTO>(detailKey)
        if (currentDetail?.edit_revision === optimisticRevision) queryClient.setQueryData<RoleDTO>(detailKey, { ...currentDetail, ...updated })
        if (!silent) {
          toast.add({
            title: enabled ? "角色已启用" : "角色已停用",
            description: enabled ? role.name : `拥有「${role.name}」的成员将即刻失去其授权`,
            type: "success",
            actionProps: { children: "撤销", onClick: () => void toggleStatus(updated, !enabled, true) },
          })
        }
        invalidate()
      } catch (error) {
        for (const [key, page] of queryClient.getQueriesData<PageData<RoleDTO>>({ queryKey: ["roles", "list"] })) {
          const previous = snapshots.get(JSON.stringify(key))
          if (!page || !previous) continue
          queryClient.setQueryData<PageData<RoleDTO>>(key, {
            ...page,
            items: page.items.map((item) => item.id === role.id && item.status === status && item.edit_revision === optimisticRevision ? { ...item, status: previous.status, edit_revision: previous.edit_revision } : item),
          })
        }
        const currentDetail = queryClient.getQueryData<RoleDTO>(detailKey)
        if (detailSnapshot && currentDetail?.status === status && currentDetail.edit_revision === optimisticRevision) {
          queryClient.setQueryData<RoleDTO>(detailKey, { ...currentDetail, status: detailSnapshot.status, edit_revision: detailSnapshot.edit_revision })
        }
        notify.apiError(error, "状态更新失败")
      } finally {
        setPending((current) => {
          const next = new Set(current)
          next.delete(role.id)
          return next
        })
      }
      })()
      statusRequests.current.set(role.id, request)
      try {
        await request
      } finally {
        if (statusRequests.current.get(role.id) === request) statusRequests.current.delete(role.id)
      }
    },
    [invalidate, queryClient],
  )

  const remove = useCallback(
    (role: RoleDTO) =>
      void confirm({
        title: `删除角色「${role.name}」？`,
        description:
          role.user_count > 0
            ? `该角色当前授予了 ${role.user_count} 名成员，删除后他们将立即失去该角色的全部权限。`
            : "删除后该角色的授权策略会同步移除，此操作不可撤销。",
        confirmText: "确认删除",
        onConfirm: async () => {
          try {
            await rolesService.remove(role.id)
            notify.success("角色已删除", role.name)
            if (roles.length === 1 && pagination.pageIndex > 0) {
              setPagination((current) => ({ ...current, pageIndex: current.pageIndex - 1 }))
            }
            invalidate()
          } catch (error) {
            notify.apiError(error, "删除失败")
            throw error
          }
        },
      }),
    [confirm, invalidate, roles.length, pagination.pageIndex],
  )

  const columns = useMemo<ColumnDef<RoleDTO>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="角色" />,
        cell: ({ row }) => {
          const role = row.original
          return (
            <div className="flex min-w-56 items-center gap-3">
              <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", role.built_in ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-primary/10 text-primary")}>
                {role.built_in ? <Crown className="size-4.5" /> : <ShieldCheck className="size-4.5" />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{role.name}</span>
                  {role.built_in && <BuiltinBadge />}
                </div>
                <p className="max-w-72 truncate text-xs text-muted-foreground">{role.description || "暂无描述"}</p>
              </div>
            </div>
          )
        },
      },
      {
        id: "code",
        accessorKey: "code",
        header: ({ column }) => <DataTableColumnHeader column={column} title="角色编码" />,
        cell: ({ row }) => (
          <Badge variant="outline" className="font-mono">
            {row.original.code}
          </Badge>
        ),
      },
      {
        id: "user_count",
        accessorKey: "user_count",
        header: ({ column }) => <DataTableColumnHeader column={column} title="成员" />,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 font-normal"
            onClick={(e) => {
              e.stopPropagation()
              setMembersRole(row.original)
            }}
          >
            <UsersRound className="text-muted-foreground" />
            <span className="font-medium">{row.original.user_count}</span> 人
          </Button>
        ),
      },
      {
        id: "permissions",
        accessorFn: (r) => r.permissions?.length ?? 0,
        header: ({ column }) => <DataTableColumnHeader column={column} title="权限点" />,
        cell: ({ row }) =>
          row.original.code === "admin" ? (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
              全部权限
            </Badge>
          ) : (
            <span className="text-sm tabular-nums">{row.original.permissions?.length ?? 0} 项</span>
          ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => {
          const role = row.original
          const disabledReason = role.built_in ? "内置角色不可停用" : !can("roles:update") ? "没有编辑角色的权限" : ""
          const control = (
            <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
              <Switch
                checked={role.status === 1}
                disabled={!!disabledReason || pending.has(role.id) || query.isPlaceholderData}
                onCheckedChange={(checked) => void toggleStatus(role, checked)}
                aria-label={role.status === 1 ? "停用角色" : "启用角色"}
              />
              <StatusDot active={role.status === 1} />
            </div>
          )
          return disabledReason ? (
            <Tooltip>
              <TooltipTrigger render={<div className="inline-flex" />}>{control}</TooltipTrigger>
              <TooltipContent>{disabledReason}</TooltipContent>
            </Tooltip>
          ) : (
            control
          )
        },
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: "actions",
        size: 54,
        minSize: 54,
        maxSize: 54,
        header: () => <span className="sr-only">操作</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const role = row.original
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${role.name} 的操作`} disabled={query.isPlaceholderData} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {can("roles:assign") && (
                    <DropdownMenuItem onClick={() => setPermRole(role)}>
                      <KeyRound />
                      分配权限
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setMembersRole(role)}>
                    <UsersRound />
                    查看成员
                  </DropdownMenuItem>
                  {can("roles:update") && (
                    <DropdownMenuItem onClick={() => setForm(role)}>
                      <Pencil />
                      编辑角色
                    </DropdownMenuItem>
                  )}
                  {can("roles:delete") && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={role.built_in} onClick={() => remove(role)}>
                        {role.built_in ? <Lock /> : <Trash2 />}
                        {role.built_in ? "内置角色不可删除" : "删除角色"}
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
    [can, pending, toggleStatus, remove, query.isPlaceholderData],
  )

  const stats = {
    total,
    builtIn: roles.filter((r) => r.built_in).length,
    disabled: roles.filter((r) => r.status !== 1).length,
    grants: roles.reduce((sum, r) => sum + r.user_count, 0),
  }

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="角色管理"
        description="定义角色与授权范围，策略实时生效至服务端鉴权引擎"
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
            <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
            访问控制策略实时生效中
          </span>
        }
        actions={
          can("roles:create") && (
            <Button onClick={() => setForm("new")} className="shadow-xs">
              <ShieldPlus />
              新建角色
            </Button>
          )
        }
      />

      <StatGrid>
        <StatCard label="角色总数" value={listUnavailable ? "—" : stats.total} icon={ShieldCheck} tone="primary" loading={query.isLoading} hint={listUnavailable ? "角色数据不可用" : "当前搜索条件下的总数"} />
        <StatCard label="内置角色（本页）" value={listUnavailable ? "—" : stats.builtIn} icon={Crown} tone="warning" loading={query.isLoading} hint={`本页 ${roles.length} 个角色`} />
        <StatCard label="成员绑定（本页）" value={listUnavailable ? "—" : stats.grants} icon={UsersRound} tone="info" loading={query.isLoading} hint="本页角色的成员绑定数" />
        <StatCard label="停用角色（本页）" value={listUnavailable ? "—" : stats.disabled} icon={ShieldOff} tone="default" loading={query.isLoading} hint="停用后其权限对所有成员失效" />
      </StatGrid>

      {query.isError && query.data && !forbidden && <QueryErrorState error={query.error} label="角色列表" onRetry={() => void query.refetch()} retrying={query.isFetching} />}

      <Card className="border border-border/80 bg-card shadow-xs rounded-xl">
        <CardContent>
          {query.isPlaceholderData && <QueryPlaceholderNotice label="角色列表" />}
          {listUnavailable ? (
            <QueryErrorState error={query.error} label="角色列表" onRetry={() => void query.refetch()} retrying={query.isFetching} />
          ) : <DataTable
            columns={columns}
            data={roles}
            loading={query.isLoading}
            getRowId={(r) => r.id}
            externalSearch={{ value: search, onChange: setSearch }}
            serverFiltering
            serverPagination={{ pageIndex: pagination.pageIndex, pageSize: pagination.pageSize, total, onChange: setPagination }}
            defaultPageSize={20}
            searchPlaceholder="搜索角色名称或编码"
            columnLabels={{ name: "角色", code: "角色编码", user_count: "成员", permissions: "权限点", status: "状态", created_at: "创建时间" }}
            initialColumnVisibility={{ created_at: false }}
            onRefresh={() => void query.refetch()}
            isRefreshing={query.isFetching}
            onRowClick={(role) => !query.isPlaceholderData && can("roles:assign") && setPermRole(role)}
            stickyActionColumn
            enableColumnResizing
            enableColumnPinning
            initialColumnPinning={{ start: ["name"], end: ["actions"] }}
            tablePreference={user?.id ? { userId: user.id, tableId: "roles", schemaVersion: 1 } : undefined}
            emptyTitle="还没有角色"
            emptyDescription="创建角色并分配权限点，再将角色授予成员"
          />}
        </CardContent>
      </Card>

      <RoleFormDialog open={form !== null} role={form === "new" ? null : form} onOpenChange={(open) => !open && setForm(null)} />
      <RolePermissionDialog role={permRole} onOpenChange={(open) => !open && setPermRole(null)} />
      <RoleMembersSheet role={membersRole} onOpenChange={(open) => !open && setMembersRole(null)} />
    </>
  )
}
