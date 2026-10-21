import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import type { PaginationState, SortingState } from "@tanstack/react-table"
import {
  ArrowRightLeft,
  Building2,
  CircleCheck,
  CircleSlash,
  Eye,
  KeyRound,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UserRoundPen,
  Users,
  UserX,
} from "lucide-react"
import { DataTable, createSelectColumn, type ColumnDef, type FacetedFilterConfig } from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AuthSourceBadge, BuiltinBadge, StatusDot } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { departmentPathLabel } from "@/components/common/department-select"
import { ALL_KEY, DepartmentTree, UNASSIGNED_KEY } from "@/components/common/department-tree"
import { PageHeader } from "@/components/common/page-header"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { UserAvatar } from "@/components/common/user-avatar"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatCompact, formatDateTime, formatPercent, formatRelative } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { optionsService } from "@/services/options"
import type { PageData, UserDTO } from "@/services/types"
import { usersService, type UserListParams } from "@/services/users"
import { useAuth } from "@/stores/auth-context"
import { AssignRolesDialog } from "./components/assign-roles-dialog"
import { MoveDepartmentDialog } from "./components/move-department-dialog"
import { ResetPasswordDialog } from "./components/reset-password-dialog"
import { UserDetailSheet } from "./components/user-detail-sheet"
import { UserFormDialog } from "./components/user-form-dialog"

const columnLabels = {
  username: "用户",
  auth_type: "来源",
  department: "部门",
  roles: "角色",
  status: "状态",
  last_login_at: "最近登录",
  created_at: "创建时间",
}

export default function UsersPage() {
  const { user: me, can, checkAuth } = useAuth()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [deptKey, setDeptKey] = useState<string>(ALL_KEY)
  const [includeChildren, setIncludeChildren] = useState(true)
  const [treeOpen, setTreeOpen] = useState(true)
  const [keyword, setKeyword] = useState("")
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300)
  const [statuses, setStatuses] = useState<string[]>([])
  const [authTypes, setAuthTypes] = useState<string[]>([])
  const [roleIds, setRoleIds] = useState<string[]>(() => {
    const fromUrl = searchParams.get("role_id")
    return fromUrl ? [fromUrl] : []
  })
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 })
  const [sorting, setSorting] = useState<SortingState>([])

  const [formUser, setFormUser] = useState<UserDTO | "new" | null>(null)
  const [resetUser, setResetUser] = useState<UserDTO | null>(null)
  const [rolesUser, setRolesUser] = useState<UserDTO | null>(null)
  const [moveUsers, setMoveUsers] = useState<UserDTO[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const clearSelection = useRef<(() => void) | null>(null)

  useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }))
  }, [debouncedKeyword, statuses, authTypes, roleIds, deptKey, includeChildren, sorting])

  useEffect(() => {
    if (searchParams.get("create") !== "1") return
    if (can("users:create")) setFormUser("new")
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete("create")
        return next
      },
      { replace: true },
    )
  }, [searchParams, setSearchParams, can])

  const params = useMemo<UserListParams>(
    () => ({
      page: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
      keyword: debouncedKeyword || undefined,
      status: statuses.join(",") || undefined,
      auth_type: authTypes.join(",") || undefined,
      role_id: roleIds.join(",") || undefined,
      department_id: deptKey === ALL_KEY ? undefined : deptKey,
      include_children: deptKey !== ALL_KEY && deptKey !== UNASSIGNED_KEY ? includeChildren : undefined,
      sort: sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}` : undefined,
    }),
    [pagination, debouncedKeyword, statuses, authTypes, roleIds, deptKey, includeChildren, sorting],
  )
  const paramsRef = useRef(params)
  paramsRef.current = params

  const usersQuery = useQuery({
    queryKey: queryKeys.users(params),
    queryFn: async () => (await usersService.list(params)).data,
    placeholderData: keepPreviousData,
  })
  const statsQuery = useQuery({ queryKey: queryKeys.userStats, queryFn: async () => (await usersService.stats()).data })
  const deptQuery = useQuery({ queryKey: queryKeys.departmentOptions, queryFn: async () => (await optionsService.departments()).data })
  const rolesQuery = useQuery({ queryKey: queryKeys.roleOptions, queryFn: async () => (await optionsService.roles()).data })

  const departments = useMemo(() => deptQuery.data ?? [], [deptQuery.data])
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data])
  const stats = statsQuery.data
  const page = usersQuery.data

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["users"] })
    void queryClient.invalidateQueries({ queryKey: ["options"] })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  }, [queryClient])

  const setStatus = useCallback(
    async (user: UserDTO, enabled: boolean, silent = false) => {
      const key = queryKeys.users(paramsRef.current)
      const previous = queryClient.getQueryData<PageData<UserDTO>>(key)
      queryClient.setQueryData<PageData<UserDTO>>(key, (old) =>
        old ? { ...old, items: old.items.map((i) => (i.id === user.id ? { ...i, status: enabled ? 1 : 2 } : i)) } : old,
      )
      try {
        await usersService.setStatus(user.id, enabled ? 1 : 2)
        if (!silent) {
          toast.add({
            title: enabled ? "账号已启用" : "账号已停用",
            description: enabled ? `${user.nickname || user.username} 可以重新登录` : `${user.nickname || user.username} 的会话已立即失效`,
            type: "success",
            actionProps: { children: "撤销", onClick: () => void setStatus(user, !enabled, true) },
          })
        }
      } catch (error) {
        queryClient.setQueryData(key, previous)
        notify.apiError(error, "状态更新失败")
      } finally {
        void queryClient.invalidateQueries({ queryKey: ["users"] })
        void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      }
    },
    [queryClient],
  )

  const handleDelete = useCallback(
    (user: UserDTO) =>
      void confirm({
        title: `删除用户「${user.nickname || user.username}」？`,
        description: "删除后该账号将无法登录，已登录的会话会立即失效，此操作不可撤销。",
        confirmText: "确认删除",
        onConfirm: async () => {
          try {
            await usersService.remove(user.id)
            notify.success("用户已删除", user.nickname || user.username)
            setDetailId(null)
            refreshAll()
          } catch (error) {
            notify.apiError(error, "删除失败")
            throw error
          }
        },
      }),
    [confirm, refreshAll],
  )

  const resetFilters = () => {
    setKeyword("")
    setStatuses([])
    setAuthTypes([])
    setRoleIds([])
    setDeptKey(ALL_KEY)
  }

  const columns = useMemo<ColumnDef<UserDTO>[]>(
    () => [
      createSelectColumn<UserDTO>(),
      {
        id: "username",
        accessorKey: "username",
        header: ({ column }) => <DataTableColumnHeader column={column} title="用户" />,
        cell: ({ row }) => {
          const u = row.original
          return (
            <div className="flex min-w-48 items-center gap-3">
              <UserAvatar name={u.nickname || u.username} seed={u.username} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-foreground">{u.nickname || u.username}</span>
                  {u.id === me?.id && <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px]">我</Badge>}
                  {u.built_in && <BuiltinBadge />}
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground" title={u.email || undefined}>
                  {u.username}
                </p>
              </div>
            </div>
          )
        },
      },
      {
        id: "auth_type",
        accessorKey: "auth_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="来源" />,
        enableSorting: false,
        cell: ({ row }) => <AuthSourceBadge authType={row.original.auth_type} domain={row.original.domain} />,
      },
      {
        id: "department",
        accessorFn: (u) => u.department?.name ?? "",
        header: ({ column }) => <DataTableColumnHeader column={column} title="部门" />,
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original
          if (!u.department_id) return <span className="text-xs text-muted-foreground">未分配</span>
          const path = departmentPathLabel(departments, u.department_id)
          return (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex max-w-40 items-center gap-1.5 truncate text-sm" />}>
                <Network className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{u.department?.name}</span>
              </TooltipTrigger>
              <TooltipContent>{path || u.department?.name}</TooltipContent>
            </Tooltip>
          )
        },
      },
      {
        id: "roles",
        accessorFn: (u) => u.roles?.map((r) => r.name).join(","),
        header: ({ column }) => <DataTableColumnHeader column={column} title="角色" />,
        enableSorting: false,
        cell: ({ row }) => {
          const list = row.original.roles ?? []
          if (list.length === 0) return <span className="text-xs text-muted-foreground">未分配</span>
          return (
            <div className="flex max-w-56 flex-wrap gap-1">
              {list.slice(0, 2).map((r) => (
                <Badge key={r.id} variant="outline" className="gap-1 font-normal">
                  <ShieldCheck className="text-primary" />
                  {r.name}
                </Badge>
              ))}
              {list.length > 2 && (
                <Tooltip>
                  <TooltipTrigger render={<span />}>
                    <Badge variant="secondary">+{list.length - 2}</Badge>
                  </TooltipTrigger>
                  <TooltipContent>{list.slice(2).map((r) => r.name).join("、")}</TooltipContent>
                </Tooltip>
              )}
            </div>
          )
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => <StatusCell user={row.original} meId={me?.id} canToggle={can("users:status")} onToggle={setStatus} />,
      },
      {
        id: "last_login_at",
        accessorKey: "last_login_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="最近登录" />,
        cell: ({ row }) => (
          <span className="text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(row.original.last_login_at)}>
            {formatRelative(row.original.last_login_at)}
          </span>
        ),
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => <span className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.created_at)}</span>,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">操作</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const u = row.original
          const isSelf = u.id === me?.id
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${u.username} 的更多操作`} />}>
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => setDetailId(u.id)}>
                    <Eye />
                    查看详情
                  </DropdownMenuItem>
                  {can("users:update") && (
                    <DropdownMenuItem onClick={() => setFormUser(u)}>
                      <UserRoundPen />
                      编辑资料
                    </DropdownMenuItem>
                  )}
                  {can("users:assign-roles") && (
                    <DropdownMenuItem onClick={() => setRolesUser(u)}>
                      <ShieldCheck />
                      分配角色
                    </DropdownMenuItem>
                  )}
                  {can("users:move") && (
                    <DropdownMenuItem onClick={() => setMoveUsers([u])}>
                      <ArrowRightLeft />
                      调整部门
                    </DropdownMenuItem>
                  )}
                  {can("users:reset-password") && u.auth_type === "local" && (
                    <DropdownMenuItem onClick={() => setResetUser(u)}>
                      <KeyRound />
                      重置密码
                    </DropdownMenuItem>
                  )}
                  {can("users:delete") && !isSelf && !u.built_in && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => handleDelete(u)}>
                        <Trash2 />
                        删除用户
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
    [me?.id, can, departments, setStatus, handleDelete],
  )

  const facetedFilters: FacetedFilterConfig[] = [
    {
      columnId: "status",
      title: "状态",
      options: [
        { label: "启用", value: "1", icon: CircleCheck },
        { label: "停用", value: "2", icon: CircleSlash },
      ],
      selectedValues: statuses,
      onSelectedChange: setStatuses,
    },
    {
      columnId: "auth_type",
      title: "来源",
      options: [
        { label: "本地账号", value: "local", icon: KeyRound },
        { label: "AD 域", value: "ad", icon: Building2 },
        { label: "LDAP", value: "ldap", icon: Network },
      ],
      selectedValues: authTypes,
      onSelectedChange: setAuthTypes,
    },
    {
      columnId: "roles",
      title: "角色",
      options: roles.map((r) => ({ label: r.name, value: r.id, icon: ShieldCheck })),
      selectedValues: roleIds,
      onSelectedChange: setRoleIds,
    },
  ]

  const filtersActive = !!debouncedKeyword || statuses.length > 0 || authTypes.length > 0 || roleIds.length > 0 || deptKey !== ALL_KEY
  const scopeLabel =
    deptKey === ALL_KEY ? "全部人员" : deptKey === UNASSIGNED_KEY ? "未分配部门" : departmentPathLabel(departments, deptKey) || "所选部门"
  const topDomains = stats?.by_domain.slice(0, 2).map((d) => `${d.domain} ${d.count}`).join(" · ")
  const total = stats?.total ?? 0

  return (
    <>
      <PageHeader
        icon={Users}
        title="用户管理"
        description="管理平台人员档案、所属部门、角色授权与账号状态"
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
            共 {total} 名成员 · {stats?.active ?? 0} 人正常
          </span>
        }
        actions={
          can("users:create") && (
            <Button onClick={() => setFormUser("new")} className="shadow-xs">
              <UserPlus />
              新建用户
            </Button>
          )
        }
      />

      <StatGrid>
        <StatCard label="用户总数" value={formatCompact(total)} icon={Users} tone="primary" loading={statsQuery.isLoading} hint={stats ? `本地 ${stats.local} · 目录同步 ${stats.directory} · 未分配部门 ${stats.unassigned}` : undefined} />
        <StatCard label="启用中" value={formatCompact(stats?.active ?? 0)} icon={UserCheck} tone="success" loading={statsQuery.isLoading} ratio={total ? (stats?.active ?? 0) / total : 0} hint={`占全部账号 ${formatPercent(stats?.active ?? 0, total)}`} />
        <StatCard label="已停用" value={formatCompact(stats?.disabled ?? 0)} icon={UserX} tone="default" loading={statsQuery.isLoading} ratio={total ? (stats?.disabled ?? 0) / total : 0} hint="停用账号无法登录，会话立即失效" />
        <StatCard label="企业域账号" value={formatCompact(stats?.directory ?? 0)} icon={Building2} tone="info" loading={statsQuery.isLoading} hint={topDomains || "尚未接入企业目录"} />
      </StatGrid>

      <div className="grid grid-cols-12 gap-4">
        {treeOpen && (
          <Card className="col-span-12 h-fit gap-3 self-start border border-border/80 bg-card shadow-xs rounded-xl lg:sticky lg:top-0 lg:col-span-4 xl:col-span-3">
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">组织架构</CardTitle>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="include-children" className="text-xs font-normal text-muted-foreground">
                  含下级
                </Label>
                <Switch id="include-children" size="sm" checked={includeChildren} onCheckedChange={setIncludeChildren} />
                <Button variant="ghost" size="icon-xs" onClick={() => setTreeOpen(false)} aria-label="收起组织架构">
                  <PanelLeftClose />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="max-h-80 overflow-y-auto lg:max-h-[calc(100svh-15rem)]">
              <DepartmentTree
                nodes={departments}
                selectedKey={deptKey}
                onSelect={(key) => setDeptKey(key)}
                allItem={{ label: "全部人员", count: stats?.total }}
                unassignedItem={{ label: "未分配部门", count: stats?.unassigned }}
              />
            </CardContent>
          </Card>
        )}

        <Card className={cn("col-span-12 min-w-0 gap-3 border border-border/80 bg-card shadow-xs rounded-xl", treeOpen && "lg:col-span-8 xl:col-span-9")}>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {!treeOpen && (
                <Button variant="ghost" size="icon-xs" onClick={() => setTreeOpen(true)} aria-label="展开组织架构">
                  <PanelLeftOpen />
                </Button>
              )}
              <CardTitle className="truncate text-sm">{scopeLabel}</CardTitle>
              <Badge variant="secondary" className="font-mono">
                {page?.total ?? 0}
              </Badge>
              {deptKey !== ALL_KEY && deptKey !== UNASSIGNED_KEY && (
                <span className="hidden text-xs text-muted-foreground sm:inline">{includeChildren ? "含下级部门" : "仅直属成员"}</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={columns}
              data={page?.items ?? []}
              loading={usersQuery.isLoading}
              getRowId={(u) => u.id}
              serverFiltering
              serverPagination={{ pageIndex: pagination.pageIndex, pageSize: pagination.pageSize, total: page?.total ?? 0, onChange: setPagination }}
              serverSorting={{ sorting, onChange: setSorting }}
              externalSearch={{ value: keyword, onChange: setKeyword }}
              searchPlaceholder="搜索用户名、姓名或邮箱"
              facetedFilters={facetedFilters}
              columnLabels={columnLabels}
              initialColumnVisibility={{ created_at: false }}
              onRefresh={refreshAll}
              isRefreshing={usersQuery.isFetching}
              onRowClick={(u) => setDetailId(u.id)}
              stickyActionColumn
              batchActions={(rows, reset) =>
                can("users:move") ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 bg-background"
                    onClick={() => {
                      clearSelection.current = reset
                      setMoveUsers(rows)
                    }}
                  >
                    <ArrowRightLeft />
                    批量调岗
                  </Button>
                ) : null
              }
              emptyTitle={filtersActive ? "没有符合条件的人员" : "还没有用户"}
              emptyDescription={filtersActive ? "调整筛选条件或切换左侧部门后再试" : "新建第一位成员，或在「目录同步」中从 AD / LDAP 自动导入"}
              emptyAction={
                filtersActive ? (
                  <Button variant="outline" size="sm" onClick={resetFilters}>
                    清除全部筛选
                  </Button>
                ) : can("users:create") ? (
                  <Button size="sm" onClick={() => setFormUser("new")}>
                    <UserPlus />
                    新建用户
                  </Button>
                ) : undefined
              }
            />
          </CardContent>
        </Card>
      </div>

      <UserFormDialog
        open={formUser !== null}
        onOpenChange={(open) => !open && setFormUser(null)}
        user={formUser === "new" ? null : formUser}
        departments={departments}
        roles={roles}
        defaultDepartmentId={deptKey !== ALL_KEY && deptKey !== UNASSIGNED_KEY ? deptKey : null}
      />
      <ResetPasswordDialog
        user={resetUser}
        isSelf={resetUser?.id === me?.id}
        onOpenChange={(open) => !open && setResetUser(null)}
        onSelfReset={() => {
          queryClient.clear()
          window.dispatchEvent(new Event("infranexus:unauthorized"))
          navigate("/login", { replace: true })
        }}
      />
      <AssignRolesDialog
        user={rolesUser}
        roles={roles}
        isSelf={rolesUser?.id === me?.id}
        onOpenChange={(open) => !open && setRolesUser(null)}
        onSelfChanged={() => void checkAuth()}
      />
      <MoveDepartmentDialog
        users={moveUsers}
        departments={departments}
        onOpenChange={(open) => !open && setMoveUsers([])}
        onMoved={() => {
          clearSelection.current?.()
          clearSelection.current = null
        }}
      />
      <UserDetailSheet
        userId={detailId}
        meId={me?.id}
        departments={departments}
        onOpenChange={(open) => !open && setDetailId(null)}
        onEdit={(u) => setFormUser(u)}
        onAssignRoles={(u) => setRolesUser(u)}
        onResetPassword={(u) => setResetUser(u)}
        onMove={(u) => setMoveUsers([u])}
        onDelete={handleDelete}
      />
    </>
  )
}

function StatusCell({
  user,
  meId,
  canToggle,
  onToggle,
}: {
  user: UserDTO
  meId?: string
  canToggle: boolean
  onToggle: (user: UserDTO, enabled: boolean) => Promise<void>
}) {
  const [pending, setPending] = useState(false)
  const reason = user.id === meId ? "不能停用当前登录账号" : user.built_in ? "内置管理员账号不可停用" : !canToggle ? "没有启停账号的权限" : ""
  const active = user.status === 1
  const control = (
    <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
      <Switch
        checked={active}
        disabled={pending || !!reason}
        aria-label={active ? "停用账号" : "启用账号"}
        onCheckedChange={async (checked) => {
          setPending(true)
          try {
            await onToggle(user, checked)
          } finally {
            setPending(false)
          }
        }}
      />
      <StatusDot active={active} />
    </div>
  )
  if (!reason || user.status !== 1) return control
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="inline-flex" />}>{control}</TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}
