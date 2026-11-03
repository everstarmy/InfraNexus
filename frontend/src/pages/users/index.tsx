import { UserRowDetail } from "./components/user-row-detail"
import { UserInlineEditProvider } from "./components/inline-edit-context"
import { useDeferredTableData } from "@/components/data-table/use-deferred-table-data"
import { UserTableActions, UserTableExport } from "./table-actions"
import { useUserTableSelection } from "./use-user-table-selection"
import { selectedOnPage, updatePageSelection } from "@/components/data-table/data-table-selection"
import type { UserSelectionQuery } from "@/services/user-table-actions"
import { emptyQuery, parseTableQuery, queryUrl, queryUrlPagination, type TableQuery } from "@/components/data-table/data-table-query"
import { readDefaultView, type TableViewSnapshot } from "@/components/data-table/data-table-views"
import { preferenceStorageKey } from "@/components/data-table/data-table-preferences"
import { userQueryFields } from "./table-query"
import { AuthSourceBadge, BuiltinBadge } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { departmentPathLabel } from "@/components/common/department-select"
import { ALL_KEY, DepartmentTree, UNASSIGNED_KEY } from "@/components/common/department-tree"
import { QueryErrorState } from "@/components/common/query-error-state"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { UserAvatar } from "@/components/common/user-avatar"
import {
  DataTable,
  DataTableCard,
  DataTableTitle,
  createActionsColumn,
  createSelectColumn,
  type ColumnDef,
  type FacetedFilterConfig,
} from "@/components/data-table"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatCompact, formatDateTime, formatPercent, formatRelative } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { optionsService } from "@/services/options"
import type { PageData, UserDTO } from "@/services/types"
import { usersService, type UserListParams } from "@/services/users"
import { useAuth } from "@/stores/auth-context"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import type { PaginationState, SortingState } from "@tanstack/react-table"
import {
  Link2,
  ArrowRightLeft,
  Building2,
  CircleCheck,
  CircleSlash,
  Eye,
  KeyRound,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UserRoundPen,
  UserX,
  Users,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { AssignRolesDialog } from "./components/assign-roles-dialog"
import { BatchAssignRolesDialog } from "./components/batch-assign-roles-dialog"
import { InlineUserNickname } from "./components/inline-user-nickname"
import { MoveDepartmentDialog } from "./components/move-department-dialog"
import { ResetPasswordDialog } from "./components/reset-password-dialog"
import { UserDetailSheet } from "./components/user-detail-sheet"
import { UserFormDialog } from "./components/user-form-dialog"
import { StatusCell } from "./components/user-status-cell"

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

  const [initialView] = useState(() => readDefaultView(preferenceStorageKey(me?.id ? { userId: me.id, tableId: "users", schemaVersion: 1 } : undefined), userQueryFields))
  const [activeView, setActiveView] = useState(() => initialView && !["users_query", "keyword", "role_id", "users_pageSize"].some(key => searchParams.has(key)) ? { id: initialView.id, snapshot: { query: initialView.query, layout: initialView.layout, pageSize: initialView.pageSize } } : undefined)
  const [initialQuery] = useState(() => {
    try { const raw = searchParams.get("users_query"); return raw ? parseTableQuery(JSON.parse(raw), userQueryFields, true) : initialView?.query ?? emptyQuery() }
    catch { return emptyQuery() }
  })
  const [advanced, setAdvanced] = useState<TableQuery>(initialQuery)
  const [deptKey, setDeptKey] = useState<string>(ALL_KEY)
  const [includeChildren, setIncludeChildren] = useState(true)
  // Below the lg breakpoint the tree stacks above the list; start collapsed so
  // the members are visible first. The toggle in the table header reopens it.
  const [treeOpen, setTreeOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches)
  const [keyword, setKeyword] = useState(() => searchParams.get("keyword") ?? initialQuery.search)
  const delayedKeyword = useDebouncedValue(keyword.trim(), 300)
  const [immediateKeyword, setImmediateKeyword] = useState<string | null>(null)
  const debouncedKeyword = immediateKeyword !== null && keyword === immediateKeyword ? immediateKeyword.trim() : delayedKeyword
  const [statuses, setStatuses] = useState<string[]>([])
  const [authTypes, setAuthTypes] = useState<string[]>([])
  const [roleIds, setRoleIds] = useState<string[]>(() => {
    const fromUrl = searchParams.get("role_id")
    return fromUrl ? [fromUrl] : []
  })
  const urlPagination = queryUrlPagination(searchParams, "users")
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: urlPagination.pageIndex, pageSize: urlPagination.pageSize ?? initialView?.pageSize ?? 10 })
  const restoringUrlPage = useRef(false)
  const [sorting, setSorting] = useState<SortingState>(() => initialQuery.sorts.map(sort => ({ id: sort.field, desc: sort.desc })))

  const [formUser, setFormUser] = useState<UserDTO | "new" | null>(null)
  const [resetUser, setResetUser] = useState<UserDTO | null>(null)
  const [rolesUser, setRolesUser] = useState<UserDTO | null>(null)
  const [batchRolesUsers, setBatchRolesUsers] = useState<UserDTO[]>([])
  const [moveUsers, setMoveUsers] = useState<UserDTO[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const clearSelection = useRef<(() => void) | null>(null)

  // Adjust the owned page before committing a new query, avoiding a stale-page request.
  const queryResetKey = JSON.stringify([debouncedKeyword, statuses, authTypes, roleIds, deptKey, includeChildren, sorting, advanced.filter])
  const [previousQueryResetKey, setPreviousQueryResetKey] = useState(queryResetKey)
  if (previousQueryResetKey !== queryResetKey) {
    setPreviousQueryResetKey(queryResetKey)
    if (!restoringUrlPage.current && pagination.pageIndex !== 0) setPagination({ ...pagination, pageIndex: 0 })
    restoringUrlPage.current = false
  }

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    let changed = false
    if (next.get("create") === "1") {
      if (can("users:create")) setFormUser("new")
      next.delete("create")
      changed = true
    }
    const requestedDetail = next.get("detail")
    if (requestedDetail) {
      if (can("api:GET:/api/v1/users/:id")) setDetailId(requestedDetail)
      else notify.error("当前账号没有查看用户详情的权限")
      next.delete("detail")
      changed = true
    }
    if (changed) setSearchParams(next, { replace: true })
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
      query: advanced.filter.children.length || sorting.length > 0 ? JSON.stringify({ ...advanced, search: "", sorts: sorting.map(sort => ({ field: sort.id, desc: sort.desc })) }) : undefined,
      sort: sorting[0] ? `${sorting[0].id}:${sorting[0].desc ? "desc" : "asc"}` : undefined,
    }),
    [pagination, debouncedKeyword, statuses, authTypes, roleIds, deptKey, includeChildren, sorting, advanced],
  )
  const applyQuery = (query: TableQuery) => {
    setAdvanced(query)
    setKeyword(query.search)
    setImmediateKeyword(query.search)
    setSorting(query.sorts.map(sort => ({ id: sort.field, desc: sort.desc })))
    setPagination(current => ({ ...current, pageIndex: 0 }))
  }
  const applyView = (view: TableViewSnapshot) => {
    applyQuery(view.query)
    setStatuses([]); setAuthTypes([])
    setPagination({ pageIndex: 0, pageSize: view.pageSize })
  }
  const sharedQueryRaw = searchParams.get("users_query")
  const sharedLocation = JSON.stringify([sharedQueryRaw, urlPagination.pageIndex, urlPagination.pageSize])
  const previousSharedQuery = useRef(sharedLocation)
  useEffect(() => {
    if (previousSharedQuery.current === sharedLocation) return
    previousSharedQuery.current = sharedLocation
    setActiveView(undefined)
    if (!sharedQueryRaw) { setAdvanced(emptyQuery()); setSorting([]); setPagination(current => ({ ...current, pageIndex: 0 })); return }
    try {
      const query = parseTableQuery(JSON.parse(sharedQueryRaw), userQueryFields, true)
      restoringUrlPage.current = JSON.stringify([query.search.trim(), [], [], roleIds, deptKey, includeChildren, query.sorts.map(sort => ({ id: sort.field, desc: sort.desc })), query.filter]) !== queryResetKey
      setStatuses([]); setAuthTypes([])
      applyQuery(query)
      setPagination(current => ({ pageIndex: urlPagination.pageIndex, pageSize: urlPagination.pageSize ?? current.pageSize }))
    }
    catch { notify.error("查询链接无效或包含不可分享的字段，已保留当前查询") }
  }, [sharedLocation])
  const viewQuery: TableQuery = {
    ...advanced, search: keyword,
    filter: statuses.length || authTypes.length ? { logic: "and", children: [advanced.filter, ...(statuses.length ? [{ field: "status", op: "in" as const, value: statuses.map(Number) }] : []), ...(authTypes.length ? [{ field: "auth_type", op: "in" as const, value: authTypes }] : [])] } : advanced.filter,
    sorts: sorting.map(sort => ({ field: sort.id, desc: sort.desc })),
  }
  const tableScopeKey = JSON.stringify(params)
  const selectionQuery: UserSelectionQuery = { query: { ...advanced, search: "", sorts: [] }, keyword: debouncedKeyword || undefined, statuses: statuses.map(Number), auth_types: authTypes, role_ids: roleIds, department_id: deptKey !== ALL_KEY && deptKey !== UNASSIGNED_KEY ? deptKey : undefined, no_department: deptKey === UNASSIGNED_KEY, include_children: includeChildren }
  const [groupUsers, setGroupUsers] = useState(false)
  const [inlineEditing, setInlineEditing] = useState(false)
  const [tableActionBusy, setTableActionBusy] = useState(false)
  const selectionKey = JSON.stringify([me?.id, me?.permissions, selectionQuery])
  // Explicit IDs survive search changes; filters and identity still bound their scope.
  const selectionScopeKey = JSON.stringify([me?.id, me?.permissions, { ...selectionQuery, keyword: undefined }])
  const { selection, changeSelection } = useUserTableSelection(
    selectionScopeKey, selectionKey, `${pagination.pageIndex}:${pagination.pageSize}`,
  )


  const usersQuery = useQuery({
    queryKey: queryKeys.users(params),
    queryFn: async ({ signal }) => (await usersService.list(params, signal)).data,
    placeholderData: keepPreviousData,
  })
  const statsQuery = useQuery({ queryKey: queryKeys.userStats, queryFn: async ({ signal }) => (await usersService.stats(signal)).data })
  const deptQuery = useQuery({ queryKey: queryKeys.departmentOptions, queryFn: async ({ signal }) => (await optionsService.departments(signal)).data })
  const rolesQuery = useQuery({ queryKey: queryKeys.roleOptions, queryFn: async ({ signal }) => (await optionsService.roles(signal)).data })

  const departments = useMemo(() => deptQuery.data?.items ?? [], [deptQuery.data])
  const departmentRevision = deptQuery.data?.revision ?? 0
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data])
  const stats = statsQuery.data
  const deferredPage = useDeferredTableData(usersQuery.data, tableScopeKey, inlineEditing || selection.mode === "allMatching" || selection.ids.length > 0, usersQuery.isPlaceholderData)
  const page = deferredPage.data

  const refreshAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["users"] })
    void queryClient.invalidateQueries({ queryKey: ["options"] })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    // Membership counts, leaders and the organization revision live in the
    // department tree; role member counts live in the role list.
    void queryClient.invalidateQueries({ queryKey: ["departments"] })
    void queryClient.invalidateQueries({ queryKey: ["roles"] })
  }, [queryClient])

  const setStatus = useCallback(
    async (user: UserDTO, enabled: boolean, silent = false) => {
      const targetStatus = enabled ? 1 : 2
      const optimisticRevision = user.edit_revision + 1
      const detailKey = ["users", "detail", user.id] as const
      const detailSnapshot = queryClient.getQueryData<UserDTO>(detailKey)
      await queryClient.cancelQueries({ queryKey: queryKeys.usersAll })
      const cachedPages = queryClient.getQueriesData<PageData<UserDTO>>({ queryKey: ["users", "list"] })
      const snapshots = new Map<string, UserDTO>()
      for (const [key, page] of cachedPages) {
        const previous = page?.items.find((item) => item.id === user.id)
        if (!page || !previous) continue
        snapshots.set(JSON.stringify(key), previous)
        queryClient.setQueryData<PageData<UserDTO>>(key, {
          ...page,
          items: page.items.map((item) => item.id === user.id ? { ...item, status: targetStatus, edit_revision: optimisticRevision } : item),
        })
      }
      if (detailSnapshot) {
        queryClient.setQueryData<UserDTO>(detailKey, { ...detailSnapshot, status: targetStatus, edit_revision: optimisticRevision })
      }
      try {
        const updated = (await usersService.setStatus(user.id, targetStatus, user.edit_revision)).data
        for (const [key, page] of queryClient.getQueriesData<PageData<UserDTO>>({ queryKey: ["users", "list"] })) {
          if (!page) continue
          queryClient.setQueryData<PageData<UserDTO>>(key, {
            ...page,
            items: page.items.map((item) => item.id === user.id && item.edit_revision === optimisticRevision ? { ...item, ...updated } : item),
          })
        }
        const currentDetail = queryClient.getQueryData<UserDTO>(detailKey)
        if (currentDetail?.edit_revision === optimisticRevision) queryClient.setQueryData<UserDTO>(detailKey, { ...currentDetail, ...updated })
        if (!silent) {
          toast.add({
            title: enabled ? "账号已启用" : "账号已停用",
            description: enabled ? `${user.nickname || user.username} 可以重新登录` : `${user.nickname || user.username} 的会话已立即失效`,
            type: "success",
            actionProps: { children: "撤销", onClick: () => void setStatus(updated, !enabled, true) },
          })
        }
      } catch (error) {
        for (const [key, page] of queryClient.getQueriesData<PageData<UserDTO>>({ queryKey: ["users", "list"] })) {
          const previous = snapshots.get(JSON.stringify(key))
          if (!page || !previous) continue
          queryClient.setQueryData<PageData<UserDTO>>(key, {
            ...page,
            items: page.items.map((item) => item.id === user.id && item.status === targetStatus && item.edit_revision === optimisticRevision ? { ...item, status: previous.status, edit_revision: previous.edit_revision } : item),
          })
        }
        const currentDetail = queryClient.getQueryData<UserDTO>(detailKey)
        if (detailSnapshot && currentDetail?.status === targetStatus && currentDetail.edit_revision === optimisticRevision) {
          queryClient.setQueryData<UserDTO>(detailKey, { ...currentDetail, status: detailSnapshot.status, edit_revision: detailSnapshot.edit_revision })
        }
        notify.apiError(error, "状态更新失败")
      } finally {
        void queryClient.invalidateQueries({ queryKey: ["users"] })
        void queryClient.invalidateQueries({ queryKey: queryKeys.userStats })
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
    setAdvanced(emptyQuery())
    setSorting([])
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
        size: 200,
        minSize: 120,
        maxSize: 240,
        header: ({ column }) => <DataTableColumnHeader column={column} title="用户" />,
        cell: ({ row }) => {
          const u = row.original
          return (
            <div className="flex min-w-48 items-center gap-3">
              <UserAvatar name={u.nickname || u.username} seed={u.username} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <InlineUserNickname user={u} editable={can("users:update")} stale={usersQuery.isPlaceholderData} />
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
        size: 110, minSize: 90, maxSize: 180,
        accessorKey: "auth_type",
        header: ({ column }) => <DataTableColumnHeader column={column} title="来源" />,
        enableSorting: false,
        cell: ({ row }) => <AuthSourceBadge authType={row.original.auth_type} domain={row.original.domain} />,
      },
      {
        id: "department",
        size: 150, minSize: 120, maxSize: 260,
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
        size: 180, minSize: 140, maxSize: 320,
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
        size: 120, minSize: 110, maxSize: 160,
        accessorKey: "status",
        header: ({ column }) => <DataTableColumnHeader column={column} title="状态" />,
        cell: ({ row }) => <StatusCell user={row.original} meId={me?.id} canToggle={can("users:status")} stale={usersQuery.isPlaceholderData} onToggle={setStatus} />,
      },
      {
        id: "last_login_at",
        size: 150, minSize: 120, maxSize: 220,
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
        size: 170, minSize: 140, maxSize: 240,
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="创建时间" />,
        cell: ({ row }) => <span className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.created_at)}</span>,
      },
      createActionsColumn<UserDTO>({
        srOnlyHeader: true,
        disabled: usersQuery.isPlaceholderData,
        triggerAriaLabel: (u) => `${u.username} 的更多操作`,
        actions: (u) => [
          {
            key: "detail",
            label: "查看详情",
            icon: <Eye />,
            onSelect: (row) => setDetailId(row.id),
          },
          {
            key: "edit",
            label: "编辑资料",
            icon: <UserRoundPen />,
            hidden: !can("users:update"),
            onSelect: (row) => setFormUser(row),
          },
          {
            key: "roles",
            label: "分配角色",
            icon: <ShieldCheck />,
            hidden: !can("users:assign-roles") || u.built_in,
            onSelect: (row) => setRolesUser(row),
          },
          {
            key: "move",
            label: "调整部门",
            icon: <ArrowRightLeft />,
            hidden: !can("users:move"),
            onSelect: (row) => setMoveUsers([row]),
          },
          {
            key: "reset-password",
            label: "重置密码",
            icon: <KeyRound />,
            hidden: !can("users:reset-password") || u.auth_type !== "local",
            onSelect: (row) => setResetUser(row),
          },
          {
            key: "delete",
            label: "删除用户",
            icon: <Trash2 />,
            destructive: true,
            hidden: !can("users:delete") || u.id === me?.id || u.built_in,
            onSelect: (row) => handleDelete(row),
          },
        ],
      }),
    ],
    [me?.id, can, departments, setStatus, handleDelete, usersQuery.isPlaceholderData],
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

  const filtersActive = advanced.filter.children.length > 0 || !!debouncedKeyword || statuses.length > 0 || authTypes.length > 0 || roleIds.length > 0 || deptKey !== ALL_KEY
  const scopeLabel =
    deptKey === ALL_KEY ? "全部人员" : deptKey === UNASSIGNED_KEY ? "未分配部门" : departmentPathLabel(departments, deptKey) || "所选部门"
  const topDomains = stats?.by_domain.slice(0, 2).map((d) => `${d.domain} ${d.count}`).join(" · ")
  const total = stats?.total ?? 0
  const statsUnavailable = statsQuery.isError && !stats

  return (
    <div className="table-workspace flex min-w-0 flex-col gap-2">
      {statsQuery.isError && (
        <QueryErrorState error={statsQuery.error} label="用户统计" onRetry={() => void statsQuery.refetch()} retrying={statsQuery.isFetching} />
      )}
      {deptQuery.isError && <QueryErrorState error={deptQuery.error} label="部门筛选项" onRetry={() => void deptQuery.refetch()} retrying={deptQuery.isFetching} />}
      {rolesQuery.isError && <QueryErrorState error={rolesQuery.error} label="角色筛选项" onRetry={() => void rolesQuery.refetch()} retrying={rolesQuery.isFetching} />}

      <StatGrid>
        <StatCard label="用户总数" value={statsUnavailable ? "—" : formatCompact(total)} icon={Users} tone="primary" loading={statsQuery.isLoading} hint={stats ? `本地 ${stats.local} · 目录同步 ${stats.directory} · 未分配部门 ${stats.unassigned}` : undefined} />
        <StatCard label="启用中" value={statsUnavailable ? "—" : formatCompact(stats?.active ?? 0)} icon={UserCheck} tone="success" loading={statsQuery.isLoading} hint={stats ? `占全部账号 ${formatPercent(stats.active, total)}` : undefined} />
        <StatCard label="已停用" value={statsUnavailable ? "—" : formatCompact(stats?.disabled ?? 0)} icon={UserX} tone="default" loading={statsQuery.isLoading} hint={stats ? `占全部账号 ${formatPercent(stats.disabled, total)}` : undefined} />
        <StatCard label="企业域账号" value={statsUnavailable ? "—" : formatCompact(stats?.directory ?? 0)} icon={Building2} tone="info" loading={statsQuery.isLoading} hint={stats ? topDomains || `占全部账号 ${formatPercent(stats.directory, total)}` : undefined} />
      </StatGrid>

      <UserInlineEditProvider key={me?.id ?? "anonymous"} onDirtyChange={setInlineEditing}>
        <div className="table-workspace-body grid grid-cols-12 gap-2">
          {treeOpen && (
            <Card size="sm" className="col-span-12 flex flex-col gap-0 rounded-xl border border-border/80 bg-card py-0 ring-0 shadow-xs lg:col-span-4 xl:col-span-3 2xl:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
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
              <CardContent className="table-workspace-tree max-h-80 flex-1 overflow-y-auto p-2.5">
                <DepartmentTree
                  nodes={departments}
                  selectedKey={deptKey}
                  onSelect={(key) => setDeptKey(key)}
                  allItem={{ label: "全部人员", count: statsUnavailable ? undefined : stats?.total }}
                  unassignedItem={{ label: "未分配部门", count: statsUnavailable ? undefined : stats?.unassigned }}
                />
              </CardContent>
            </Card>
          )}

          <DataTableCard
            className={cn("col-span-12", treeOpen && "lg:col-span-8 xl:col-span-9 2xl:col-span-10")}
            label="用户列表"
            title={
              <DataTableTitle
                leading={
                  !treeOpen && (
                    <Button variant="ghost" size="icon-xs" onClick={() => setTreeOpen(true)} aria-label="展开组织架构">
                      <PanelLeftOpen />
                    </Button>
                  )
                }
                title={scopeLabel}
                count={page?.total ?? 0}
                trailing={
                  deptKey !== ALL_KEY && deptKey !== UNASSIGNED_KEY
                    ? includeChildren
                      ? "含下级部门"
                      : "仅直属成员"
                    : undefined
                }
              />
            }
            actions={
              can("users:create") && (
                <Button
                  size="icon"
                  onClick={() => setFormUser("new")}
                  title="新建用户"
                  aria-label="新建用户"
                >
                  <Plus />
                </Button>
              )
            }
            isPlaceholderData={usersQuery.isPlaceholderData}
            error={usersQuery.error}
            hasData={Boolean(usersQuery.data)}
            onRetry={() => void usersQuery.refetch()}
            retrying={usersQuery.isFetching}
            notice={
              deferredPage.hasUpdate ? (
                <div>
                  <Button variant="outline" size="sm" onClick={deferredPage.accept}>
                    有新数据，点击更新表格（草稿保留）
                  </Button>
                </div>
              ) : undefined
            }
          >
              <DataTable
                viewport={{ mode: "fill", mobileContent: true, pending: usersQuery.isPlaceholderData, queryKey: tableScopeKey, restoreKey: me?.id ? `users:${me.id}` : undefined }}
                layoutControls={{ density: true, fullscreen: true, columns: true }}
                exportControl={table => (
                  <UserTableExport
                    key="export"
                    table={table}
                    selection={selection}
                    query={selectionQuery}
                    rows={page?.items ?? []}
                    total={page?.total ?? 0}
                    pending={usersQuery.isPlaceholderData || tableActionBusy}
                    canExport={can("users:export")}
                    onBusyChange={setTableActionBusy}
                  />
                )}
                advancedQuery={{ value: viewQuery, fields: userQueryFields, onChange: query => { setStatuses([]); setAuthTypes([]); applyQuery(query) }, onApplyView: applyView, onResetFilters: query => { setStatuses([]); setAuthTypes([]); setRoleIds([]); applyQuery(query) }, activeView, initialLayout: initialView?.layout }}
                moreActions={<><Button variant="outline" size="sm" aria-pressed={groupUsers} onClick={() => setGroupUsers(value => !value)}>按来源分组（当前页）</Button><Button variant="outline" size="icon-sm" aria-label="生成查询链接" title="生成查询链接" onClick={() => { try { setSearchParams(queryUrl(searchParams, "users", viewQuery, userQueryFields, pagination)) } catch (error) { notify.error(error instanceof Error ? error.message : "生成链接失败") } }}><Link2 /></Button></>}
                selectionArea={{
                  count: selection.mode === "allMatching" ? Math.max(0, (page?.total ?? 0) - selection.excludedIds.length) : selection.ids.length,
                  currentPageCount: Object.keys(selectedOnPage(selection, (page?.items ?? []).map(row => row.id))).length,
                  estimated: selection.mode === "allMatching",
                  disabled: usersQuery.isPlaceholderData || tableActionBusy,
                  onClear: () => changeSelection({ mode: "ids", ids: [] }),
                  selectAll: selection.mode !== "allMatching" && (page?.items.length ?? 0) > 0 && (page?.items ?? []).every(row => selection.ids.includes(row.id)) && (page?.total ?? 0) > (page?.items.length ?? 0) ? { count: page?.total ?? 0, onSelect: () => changeSelection({ mode: "allMatching", excludedIds: [] }) } : undefined,
                  actions: (
                    <UserTableActions
                      managedSelection
                      key={selectionKey}
                      selection={selection}
                      onChange={changeSelection}
                      query={selectionQuery}
                      rows={page?.items ?? []}
                      total={page?.total ?? 0}
                      pending={usersQuery.isPlaceholderData || tableActionBusy}
                      canStatus={can("users:status")}
                      onRefresh={refreshAll}
                      onBusyChange={setTableActionBusy}
                      extraActions={
                        selection.mode !== "allMatching" &&
                        selection.ids.length > 0 &&
                        selection.ids.every((id) => (page?.items ?? []).some((row) => row.id === id)) ? (
                          <div className="flex items-center gap-2">
                            {can("users:assign-roles") && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={usersQuery.isPlaceholderData || tableActionBusy}
                                onClick={() => {
                                  clearSelection.current = () => changeSelection({ mode: "ids", ids: [] })
                                  setBatchRolesUsers((page?.items ?? []).filter((row) => selection.ids.includes(row.id)))
                                }}
                              >
                                <ShieldCheck />
                                批量分配角色
                              </Button>
                            )}
                            {can("users:move") && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={usersQuery.isPlaceholderData || tableActionBusy}
                                onClick={() => {
                                  clearSelection.current = () => changeSelection({ mode: "ids", ids: [] })
                                  setMoveUsers((page?.items ?? []).filter((row) => selection.ids.includes(row.id)))
                                }}
                              >
                                <ArrowRightLeft />
                                批量调岗
                              </Button>
                            )}
                          </div>
                        ) : undefined
                      }
                    />
                  ),
                }}
                columns={columns}
                data={page?.items ?? []}
                loading={usersQuery.isLoading}
                getRowId={(u) => u.id}
                detail={can("api:GET:/api/v1/users/:id") ? { render: user => <UserRowDetail id={user.id} actorID={me?.id ?? ""} /> } : undefined}
                groupBy={groupUsers ? { label: "身份来源", key: user => user.auth_type } : undefined}
                selectionScopeKey={selectionKey}
                controlledSelection={{ value: selectedOnPage(selection, (page?.items ?? []).map(row => row.id)), onChange: next => { try { changeSelection(updatePageSelection(selection, (page?.items ?? []).map(row => row.id), next)) } catch (error) { notify.error((error as Error).message) } } }}
                selectionDisabled={usersQuery.isPlaceholderData || tableActionBusy}
                serverFiltering
                serverPagination={{ pageIndex: pagination.pageIndex, pageSize: pagination.pageSize, total: page?.total ?? 0, onChange: setPagination }}
                serverSorting={{ sorting, onChange: next => { setSorting(next); setPagination(current => ({ ...current, pageIndex: 0 })) } }}
                externalSearch={{ value: keyword, onChange: setKeyword }}
                searchPlaceholder="搜索用户名、姓名或邮箱"
                facetedFilters={facetedFilters}
                columnLabels={columnLabels}
                initialColumnVisibility={{ created_at: false }}
                initialColumnPinning={{ start: ["select", "username"], end: ["actions"] }}
                tablePreference={me?.id ? { userId: me.id, tableId: "users", schemaVersion: 1 } : undefined}
                onRefresh={refreshAll}
                isRefreshing={usersQuery.isFetching}
                onRowClick={(u) => !usersQuery.isPlaceholderData && setDetailId(u.id)}
                stickyActionColumn
                enableColumnResizing
                enableColumnPinning
                emptyTitle={filtersActive ? "没有符合条件的人员" : "还没有用户"}
                emptyDescription={filtersActive ? "调整筛选条件或切换左侧部门后再试" : "新建第一位成员，或在「身份源集成」中从 AD / LDAP 自动导入"}
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
          </DataTableCard>
        </div>
      </UserInlineEditProvider>

      <UserFormDialog
        open={formUser !== null}
        onOpenChange={(open) => !open && setFormUser(null)}
        user={formUser === "new" ? null : formUser}
        departments={departments}
        treeRevision={departmentRevision}
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
        rolesLoading={rolesQuery.isLoading}
        rolesError={rolesQuery.error}
        onRetryRoles={() => void rolesQuery.refetch()}
        isSelf={rolesUser?.id === me?.id}
        onOpenChange={(open) => !open && setRolesUser(null)}
        onSelfChanged={() => void checkAuth()}
      />
      <BatchAssignRolesDialog
        users={batchRolesUsers}
        roles={roles}
        rolesLoading={rolesQuery.isLoading}
        rolesError={rolesQuery.error}
        onRetryRoles={() => void rolesQuery.refetch()}
        isSelfIncluded={batchRolesUsers.some((u) => u.id === me?.id && !u.built_in)}
        onOpenChange={(open) => !open && setBatchRolesUsers([])}
        onAssigned={() => {
          clearSelection.current?.()
          clearSelection.current = null
        }}
        onSelfChanged={() => void checkAuth()}
      />
      <MoveDepartmentDialog
        users={moveUsers}
        departments={departments}
        treeRevision={departmentRevision}
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
    </div>
  )
}
