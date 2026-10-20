import type React from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRightLeft, CalendarClock, Fingerprint, KeyRound, LogIn, Mail, Network, ShieldCheck, Trash2, UserRoundPen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { AuthSourceBadge, BuiltinBadge, StatusDot } from "@/components/common/badges"
import { Can } from "@/components/common/can"
import { departmentPathLabel } from "@/components/common/department-select"
import { UserAvatar } from "@/components/common/user-avatar"
import { formatDateTime, formatRelative } from "@/lib/format"
import type { DepartmentNode } from "@/services/departments"
import type { UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

function InfoRow({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground">{label}</p>
        <div className="mt-0.5 text-sm break-all text-foreground">{children}</div>
      </div>
    </div>
  )
}

export function UserDetailSheet({
  userId,
  meId,
  departments,
  onOpenChange,
  onEdit,
  onAssignRoles,
  onResetPassword,
  onMove,
  onDelete,
}: {
  userId: string | null
  meId?: string
  departments: DepartmentNode[]
  onOpenChange: (open: boolean) => void
  onEdit: (user: UserDTO) => void
  onAssignRoles: (user: UserDTO) => void
  onResetPassword: (user: UserDTO) => void
  onMove: (user: UserDTO) => void
  onDelete: (user: UserDTO) => void
}) {
  const query = useQuery({
    queryKey: ["users", "detail", userId],
    queryFn: async () => (await usersService.get(userId!)).data,
    enabled: !!userId,
  })
  const user = query.data
  const isSelf = !!user && user.id === meId

  return (
    <Sheet open={!!userId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b bg-gradient-to-b from-primary/[0.06] to-transparent p-6">
          {!user ? (
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-44" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <UserAvatar name={user.nickname || user.username} seed={user.username} size="lg" className="size-14" />
              <div className="min-w-0 space-y-1.5">
                <SheetTitle className="flex items-center gap-2 text-lg">
                  <span className="truncate">{user.nickname || user.username}</span>
                  {isSelf && <Badge variant="secondary">我</Badge>}
                  {user.built_in && <BuiltinBadge />}
                </SheetTitle>
                <SheetDescription className="truncate font-mono text-xs">
                  {user.username}
                  {user.domain ? `@${user.domain}` : ""}
                </SheetDescription>
                <div className="flex items-center gap-2">
                  <AuthSourceBadge authType={user.auth_type} domain={user.domain} />
                  <StatusDot active={user.status === 1} />
                </div>
              </div>
            </div>
          )}
        </SheetHeader>

        {user && (
          <div className="flex flex-wrap gap-2 border-b px-6 py-3">
            <Can code="users:update">
              <Button size="sm" variant="outline" onClick={() => onEdit(user)}>
                <UserRoundPen />
                编辑
              </Button>
            </Can>
            <Can code="users:assign-roles">
              <Button size="sm" variant="outline" onClick={() => onAssignRoles(user)}>
                <ShieldCheck />
                分配角色
              </Button>
            </Can>
            <Can code="users:move">
              <Button size="sm" variant="outline" onClick={() => onMove(user)}>
                <ArrowRightLeft />
                调岗
              </Button>
            </Can>
            {user.auth_type === "local" && (
              <Can code="users:reset-password">
                <Button size="sm" variant="outline" onClick={() => onResetPassword(user)}>
                  <KeyRound />
                  重置密码
                </Button>
              </Can>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {!user ? (
            <div className="space-y-4 py-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <InfoRow icon={Mail} label="电子邮箱">
                {user.email || <span className="text-muted-foreground">未填写</span>}
              </InfoRow>
              <InfoRow icon={Network} label="所属部门">
                {user.department_id ? departmentPathLabel(departments, user.department_id) || user.department?.name : <span className="text-muted-foreground">未分配部门</span>}
              </InfoRow>
              <InfoRow icon={ShieldCheck} label="角色">
                {user.roles?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {user.roles.map((r) => (
                      <Badge key={r.id} variant="outline" className="gap-1">
                        <ShieldCheck className="text-primary" />
                        {r.name}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">未分配角色</span>
                )}
              </InfoRow>
              {user.auth_type !== "local" && (
                <InfoRow icon={Fingerprint} label="目录对象标识">
                  <code className="font-mono text-xs">{user.external_id || "—"}</code>
                </InfoRow>
              )}
              <Separator className="my-2" />
              <InfoRow icon={LogIn} label="最近登录">
                {user.last_login_at ? `${formatRelative(user.last_login_at)} · ${formatDateTime(user.last_login_at)}` : "从未登录"}
              </InfoRow>
              <InfoRow icon={CalendarClock} label="创建 / 更新时间">
                {formatDateTime(user.created_at)} / {formatDateTime(user.updated_at)}
              </InfoRow>
            </>
          )}
        </div>

        {user && !isSelf && !user.built_in && (
          <SheetFooter className="border-t">
            <Can code="users:delete">
              <Button variant="destructive" onClick={() => onDelete(user)}>
                <Trash2 />
                删除该用户
              </Button>
            </Can>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
