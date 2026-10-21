import { useCallback, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BuiltinBadge, StatusDot } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { PageHeader } from "@/components/common/page-header"
import { StatCard, StatGrid } from "@/components/common/stat-card"
import { formatDateTime } from "@/lib/format"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { rolesService, type RoleDTO } from "@/services/roles"
import { useAuth } from "@/stores/auth-context"
import { RoleFormDialog } from "./components/role-form-dialog"
import { RoleMembersSheet } from "./components/role-members-sheet"
import { RolePermissionDialog } from "./components/role-permission-dialog"

export default function RolesPage() {
  const { can } = useAuth()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<RoleDTO | "new" | null>(null)
  const [permRole, setPermRole] = useState<RoleDTO | null>(null)
  const [membersRole, setMembersRole] = useState<RoleDTO | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const query = useQuery({ queryKey: queryKeys.roles(""), queryFn: async () => (await rolesService.list()).data.items })
  const roles = useMemo(() => query.data ?? [], [query.data])

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["roles"] })
    void queryClient.invalidateQueries({ queryKey: ["options"] })
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  }, [queryClient])

  const toggleStatus = useCallback(
    async (role: RoleDTO, enabled: boolean) => {
      setPending(role.id)
      try {
        await rolesService.update(role.id, { status: enabled ? 1 : 2 })
        notify.success(enabled ? "角色已启用" : "角色已停用", enabled ? role.name : `拥有「${role.name}」的成员将即刻失去其授权`)
        invalidate()
      } catch (error) {
        notify.apiError(error, "状态更新失败")
      } finally {
        setPending(null)
      }
    },
    [invalidate],
  )

  const remove = useCallback(
    (role: RoleDTO) =>
      void confirm({
        title: `删除角色「${role.name}」？`,
        description:
          role.user_count > 0
            ? `该角色当前授予了 ${role.user_count} 名成员，删除后他们将立即失去该角色的全部权限。`
            : "删除后该角色的 Casbin 策略会同步移除，此操作不可撤销。",
        confirmText: "确认删除",
        onConfirm: async () => {
          try {
            await rolesService.remove(role.id)
            notify.success("角色已删除", role.name)
            invalidate()
          } catch (error) {
            notify.apiError(error, "删除失败")
            throw error
          }
        },
      }),
    [confirm, invalidate],
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
                disabled={!!disabledReason || pending === role.id}
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
        header: () => <span className="sr-only">操作</span>,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const role = row.original
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${role.name} 的操作`} />}>
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
    [can, pending, toggleStatus, remove],
  )

  const stats = {
    total: roles.length,
    builtIn: roles.filter((r) => r.built_in).length,
    disabled: roles.filter((r) => r.status !== 1).length,
    grants: roles.reduce((sum, r) => sum + r.user_count, 0),
  }

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="角色管理"
        description="定义角色与授权范围，策略实时同步至 Casbin 鉴权引擎"
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">
            <span className="size-1.5 rounded-full bg-sky-500 animate-pulse" />
            Casbin 策略同步生效中
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
        <StatCard label="角色总数" value={stats.total} icon={ShieldCheck} tone="primary" loading={query.isLoading} hint={`自定义角色 ${stats.total - stats.builtIn} 个`} />
        <StatCard label="内置角色" value={stats.builtIn} icon={Crown} tone="warning" loading={query.isLoading} hint="受保护：不可删除、不可停用" />
        <StatCard label="授权关系" value={stats.grants} icon={UsersRound} tone="info" loading={query.isLoading} hint="成员-角色绑定总数（多角色按人次计）" />
        <StatCard label="已停用角色" value={stats.disabled} icon={ShieldOff} tone="default" loading={query.isLoading} hint="停用后其权限对所有成员失效" />
      </StatGrid>

      <Card className="border border-border/80 bg-card shadow-xs rounded-xl">
        <CardContent>
          <DataTable
            columns={columns}
            data={roles}
            loading={query.isLoading}
            getRowId={(r) => r.id}
            searchPlaceholder="搜索角色名称或编码"
            columnLabels={{ name: "角色", code: "角色编码", user_count: "成员", permissions: "权限点", status: "状态", created_at: "创建时间" }}
            initialColumnVisibility={{ created_at: false }}
            onRefresh={() => void query.refetch()}
            isRefreshing={query.isFetching}
            onRowClick={(role) => can("roles:assign") && setPermRole(role)}
            stickyActionColumn
            emptyTitle="还没有角色"
            emptyDescription="创建角色并分配权限点，再将角色授予成员"
          />
        </CardContent>
      </Card>

      <RoleFormDialog open={form !== null} role={form === "new" ? null : form} onOpenChange={(open) => !open && setForm(null)} />
      <RolePermissionDialog role={permRole} onOpenChange={(open) => !open && setPermRole(null)} />
      <RoleMembersSheet role={membersRole} onOpenChange={(open) => !open && setMembersRole(null)} />
    </>
  )
}
