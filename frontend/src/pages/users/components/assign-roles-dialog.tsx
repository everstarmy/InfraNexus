import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Lock, Search, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { BuiltinBadge } from "@/components/common/badges"
import { notify } from "@/lib/notify"
import { cn } from "@/lib/utils"
import type { RoleRef, UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

export function AssignRolesDialog({
  user,
  roles,
  isSelf,
  onOpenChange,
  onSelfChanged,
}: {
  user: UserDTO | null
  roles: RoleRef[]
  isSelf: boolean
  onOpenChange: (open: boolean) => void
  onSelfChanged: () => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")

  useEffect(() => {
    setSelected(new Set(user?.roles?.map((r) => r.id) ?? []))
    setQuery("")
  }, [user])

  const lockedAdmin = user?.built_in ? roles.find((r) => r.code === "admin")?.id : undefined
  const visible = useMemo(() => {
    const kw = query.trim().toLowerCase()
    return kw ? roles.filter((r) => r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw)) : roles
  }, [roles, query])

  const mutation = useMutation({
    mutationFn: () => usersService.assignRoles(user!.id, [...selected]),
    onSuccess: () => {
      notify.success("角色已更新", `${user?.nickname || user?.username} 的权限将在下一次请求时生效`)
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      if (isSelf) onSelfChanged()
      onOpenChange(false)
    },
    onError: (error) => notify.apiError(error, "角色分配失败"),
  })

  const toggle = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })

  return (
    <Dialog open={!!user} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4.5 text-primary" />
            分配角色
          </DialogTitle>
          <DialogDescription>
            为 <span className="font-medium text-foreground">{user?.nickname || user?.username}</span> 选择一个或多个角色，权限按并集生效
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <InputGroup className="h-8 shadow-none border-input/50 bg-muted/30 focus-within:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索角色名称或编码" className="text-xs" />
          </InputGroup>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {visible.map((role) => {
              const checked = selected.has(role.id)
              const locked = role.id === lockedAdmin
              return (
                <label
                  key={role.id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    locked ? "cursor-not-allowed opacity-80" : "cursor-pointer",
                    checked ? "border-primary/40 bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <Checkbox checked={checked} disabled={locked} onCheckedChange={(v) => toggle(role.id, !!v)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {role.name}
                      {role.built_in && <BuiltinBadge />}
                      {role.status !== 1 && <span className="text-[10px] text-muted-foreground">（已停用）</span>}
                    </div>
                    <code className="font-mono text-[11px] text-muted-foreground">{role.code}</code>
                  </div>
                  {locked && <Lock className="size-3.5 text-muted-foreground" aria-label="内置管理员必须保留该角色" />}
                </label>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">已选 {selected.size} 个角色</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            取消
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Spinner />}
            保存角色
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
