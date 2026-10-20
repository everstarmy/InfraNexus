import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, Search, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { AuthSourceBadge, StatusDot } from "@/components/common/badges"
import { UserAvatar } from "@/components/common/user-avatar"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { getErrorStatus } from "@/lib/api-error"
import type { RoleDTO } from "@/services/roles"
import { usersService } from "@/services/users"
import { useAuth } from "@/stores/auth-context"

export function RoleMembersSheet({ role, onOpenChange }: { role: RoleDTO | null; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [search, setSearch] = useState("")
  const keyword = useDebouncedValue(search.trim(), 250)
  const query = useQuery({
    queryKey: ["users", "role-members", role?.id, keyword],
    queryFn: async () => (await usersService.list({ role_id: role!.id, keyword: keyword || undefined, page_size: 50 })).data,
    enabled: !!role && can("users"),
    retry: false,
  })
  const forbidden = !can("users") || getErrorStatus(query.error) === 403

  return (
    <Sheet open={!!role} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5">
          <SheetTitle className="flex items-center gap-2">
            <UsersRound className="size-4.5 text-primary" />
            「{role?.name}」的成员
          </SheetTitle>
          <SheetDescription>共 {role?.user_count ?? 0} 名在用成员拥有该角色</SheetDescription>
        </SheetHeader>
        <div className="border-b p-4">
          <InputGroup className="h-8">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="在成员中搜索" className="text-xs" disabled={forbidden} />
          </InputGroup>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {forbidden ? (
            <p className="py-10 text-center text-xs text-muted-foreground">当前角色无权查看人员列表</p>
          ) : query.isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">{keyword ? "没有匹配的成员" : "该角色暂未分配给任何成员"}</p>
          ) : (
            <ul className="space-y-1">
              {query.data!.items.map((u) => (
                <li key={u.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted/60">
                  <UserAvatar name={u.nickname || u.username} seed={u.username} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.nickname || u.username}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{u.department?.name ?? "未分配部门"}</p>
                  </div>
                  <AuthSourceBadge authType={u.auth_type} domain={u.domain} />
                  <StatusDot active={u.status === 1} />
                </li>
              ))}
            </ul>
          )}
        </div>
        {can("users") && (
          <SheetFooter className="border-t">
            <Button variant="outline" onClick={() => navigate(`/users?role_id=${role?.id}`)}>
              在用户管理中查看
              <ArrowUpRight />
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}
