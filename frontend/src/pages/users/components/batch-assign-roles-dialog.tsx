import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Info, Search, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { BuiltinBadge } from "@/components/common/badges"
import { useConfirm } from "@/components/common/confirm-dialog"
import { QueryErrorState } from "@/components/common/query-error-state"
import { UserAvatar } from "@/components/common/user-avatar"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { cn } from "@/lib/utils"
import type { RoleRef, UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

export function BatchAssignRolesDialog({
  users,
  roles,
  rolesLoading = false,
  rolesError,
  onRetryRoles,
  isSelfIncluded = false,
  onOpenChange,
  onAssigned,
  onSelfChanged,
}: {
  users: UserDTO[]
  roles: RoleRef[]
  rolesLoading?: boolean
  rolesError?: unknown
  onRetryRoles?: () => void
  isSelfIncluded?: boolean
  onOpenChange: (open: boolean) => void
  onAssigned?: () => void
  onSelfChanged?: () => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const open = users.length > 0
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")

  const eligibleUsers = useMemo(() => users.filter((u) => !u.built_in), [users])
  const hasBuiltinAdmin = eligibleUsers.length !== users.length

  useEffect(() => {
    if (open) {
      setSelected(new Set())
      setQuery("")
    }
  }, [open])

  const isDirty = open && selected.size > 0
  useUnsavedChanges(isDirty, "批量角色分配方案尚未保存。离开后角色选择将丢失。")

  const visible = useMemo(() => {
    const kw = query.trim().toLowerCase()
    return kw
      ? roles.filter((r) => r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw))
      : roles
  }, [roles, query])

  const mutation = useMutation({
    mutationFn: () => usersService.batchAssignRoles(eligibleUsers.map((u) => u.id), [...selected]),
    onSuccess: (res) => {
      notify.success("角色已更新", `已为 ${res.data.updated} 名人员批量分配角色，权限即时生效`)
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      if (isSelfIncluded) onSelfChanged?.()
      onAssigned?.()
      onOpenChange(false)
    },
    onError: (error) => notify.apiError(error, "批量分配角色失败"),
  })

  const toggle = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      visible.forEach((r) => next.add(r.id))
      return next
    })
  }

  const clearAllSelected = () => {
    setSelected(new Set())
  }

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃批量分配角色方案？",
        description: `已为 ${users.length} 名人员配置了角色，尚未保存。`,
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : void requestClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4.5 text-primary" />
            批量分配角色（{users.length} 人）
          </DialogTitle>
          <DialogDescription>
            为所选人员统一分配角色，原角色将被替换为所选角色；留空则清空其角色
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* 人员头像组摘要 */}
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
            <div className="flex -space-x-2">
              {users.slice(0, 5).map((u) => (
                <UserAvatar
                  key={u.id}
                  name={u.nickname || u.username}
                  seed={u.username}
                  size="sm"
                  className="ring-2 ring-background"
                />
              ))}
            </div>
            <p className="min-w-0 flex-1 truncate text-sm">
              {users.slice(0, 3).map((u) => u.nickname || u.username).join("、")}
              {users.length > 3 && ` 等 ${users.length} 人`}
            </p>
          </div>

          {hasBuiltinAdmin && (
            <Alert>
              <Info />
              <AlertDescription>
                内置管理员的角色不会被修改。其余 {eligibleUsers.length} 名人员将按所选角色更新。
              </AlertDescription>
            </Alert>
          )}

          {rolesError ? (
            <QueryErrorState error={rolesError} label="可用角色列表" onRetry={onRetryRoles} />
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <InputGroup className="h-8 shadow-none border-input/60 bg-muted/30 focus-within:ring-0">
                  <InputGroupAddon>
                    <Search className="size-3.5 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder="按名称或编码过滤角色"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="text-xs"
                  />
                </InputGroup>
                <div className="flex items-center gap-1 shrink-0">
                  <Button type="button" variant="ghost" size="xs" onClick={selectAllVisible}>
                    全选
                  </Button>
                  <Button type="button" variant="ghost" size="xs" className="text-muted-foreground" onClick={clearAllSelected}>
                    清空
                  </Button>
                </div>
              </div>

              <div className="max-h-56 divide-y overflow-y-auto rounded-xl border">
                {rolesLoading ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">正在加载角色列表…</p>
                ) : visible.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">没有匹配的角色</p>
                ) : (
                  visible.map((r) => {
                    const checked = selected.has(r.id)
                    return (
                      <label
                        key={r.id}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 p-3 text-sm transition-colors hover:bg-muted/50",
                          checked && "bg-primary/[0.04]",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => toggle(r.id, c === true)}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{r.name}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{r.code}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {r.built_in && <BuiltinBadge />}
                        </div>
                      </label>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="m-0 items-center justify-between border-t bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">
            已勾选 <span className="font-semibold text-foreground tabular-nums">{selected.size}</span> 个角色
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
              取消
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || rolesLoading || Boolean(rolesError) || eligibleUsers.length === 0}
            >
              {mutation.isPending && <Spinner />}
              确认分配
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
