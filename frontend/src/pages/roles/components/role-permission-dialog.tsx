import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Crown, KeyRound } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { PermissionTreePicker } from "@/components/common/permission-tree-picker"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { flattenTree } from "@/lib/tree"
import { rolesService, type PermissionDTO, type RoleDTO } from "@/services/roles"
import { useAuth } from "@/stores/auth-context"
import { getErrorStatus } from "@/lib/api-error"

export function RolePermissionDialog({ role, onOpenChange }: { role: RoleDTO | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { user, checkAuth } = useAuth()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [initializedRoleId, setInitializedRoleId] = useState<string | null>(null)
  const [revisionConflict, setRevisionConflict] = useState(false)
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false)
  const isAdminRole = role?.code === "admin"

  const treeQuery = useQuery({
    queryKey: ["roles", "permission-tree"],
    queryFn: async ({ signal }) => (await rolesService.permissionTree(signal)).data,
    enabled: !!role,
  })
  const roleQuery = useQuery({
    queryKey: ["roles", "detail", role?.id],
    queryFn: async ({ signal }) => (await rolesService.get(role!.id, signal)).data,
    enabled: !!role,
  })

  useEffect(() => {
    if (!role) {
      setSelected(new Set())
      setInitializedRoleId(null)
      setRevisionConflict(false)
      setConflictAcknowledged(false)
      return
    }
    if (roleQuery.data?.id !== role.id || roleQuery.isError || initializedRoleId === role.id) return
    setSelected(new Set(roleQuery.data.permissions?.map((p) => p.id) ?? []))
    setInitializedRoleId(role.id)
  }, [initializedRoleId, role, roleQuery.data, roleQuery.isError])

  const tree: PermissionDTO[] = useMemo(() => treeQuery.data ?? [], [treeQuery.data])
  const total = useMemo(() => flattenTree(tree).length, [tree])

  const mutation = useMutation({
    mutationFn: () => rolesService.assignPermissions(role!.id, [...selected], roleQuery.data!.edit_revision),
    onSuccess: () => {
      notify.success("权限已保存", `「${role?.name}」的授权已更新，策略立即生效`)
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      if (user?.roles?.some((r) => r.id === role?.id)) void checkAuth()
      onOpenChange(false)
    },
    onError: (error) => {
      if (getErrorStatus(error) === 409) {
        setRevisionConflict(true)
        setConflictAcknowledged(false)
        void roleQuery.refetch()
        notify.warning("授权已发生变化", "已保留你的草稿，请比较最新授权后再决定如何保存")
        return
      }
      notify.apiError(error, "保存权限失败")
    },
  })

  const loading = treeQuery.isLoading || roleQuery.isLoading
  const loadedForCurrentRole = !!role && initializedRoleId === role.id && roleQuery.data?.id === role.id
  const currentPermissionIds = roleQuery.data?.permissions?.map((permission) => permission.id) ?? []
  const currentPermissionSet = useMemo(() => new Set(currentPermissionIds), [currentPermissionIds.join("\u0000")])
  const addedCount = [...selected].filter((id) => !currentPermissionSet.has(id)).length
  const removedCount = [...currentPermissionSet].filter((id) => !selected.has(id)).length
  const permissionNames = useMemo(() => new Map(flattenTree(tree).map((permission) => [permission.id, permission.name])), [tree])
  const addedPermissions = [...selected].filter((id) => !currentPermissionSet.has(id)).map((id) => permissionNames.get(id) ?? id)
  const removedPermissions = [...currentPermissionSet].filter((id) => !selected.has(id)).map((id) => permissionNames.get(id) ?? id)
  const loadFailed = treeQuery.isError || roleQuery.isError
  const isForbidden = getErrorStatus(treeQuery.error ?? roleQuery.error) === 403
  const conflictReady = revisionConflict && roleQuery.data?.id === role?.id && !roleQuery.isFetching && !roleQuery.isError
  const isDirty = !!role && loadedForCurrentRole && (addedCount > 0 || removedCount > 0)
  useUnsavedChanges(isDirty, `「${role?.name ?? "角色"}」的权限草稿尚未保存。离开后这些授权更改将丢失。`)

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃授权草稿？",
        description: `「${role?.name}」有 ${addedCount + removedCount} 项未保存的权限更改。`,
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  const clearAll = async () => {
    if (!selected.size) return
    const accepted = await confirm({
      tone: "default",
      title: "清空角色的全部权限？",
      description: `将从「${role?.name}」的草稿中移除 ${selected.size} 项权限。保存后这些授权将立即失效。`,
      confirmText: "清空全部权限",
    })
    if (accepted) setSelected(new Set())
  }

  return (
    <Dialog open={!!role} onOpenChange={(next) => next ? onOpenChange(true) : void requestClose()}>
      <DialogContent className="flex max-h-[88svh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4.5 text-primary" />
            为「{role?.name}」分配权限
          </DialogTitle>
          <DialogDescription>勾选父节点会联动勾选其全部下级；菜单在任一下级被授权时自动显示</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-5">
          {revisionConflict && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {conflictReady
                    ? `服务器授权已更新到版本 ${roleQuery.data?.edit_revision}。你的草稿仍保留；当前差异：新增 ${addedCount}、移除 ${removedCount}。`
                    : roleQuery.isError
                      ? "最新授权读取失败，你的草稿仍保留；重试前不会允许提交。"
                      : "正在读取最新授权版本，你的草稿会保留。"}
                </span>
                {revisionConflict && roleQuery.isError && (
                  <Button variant="outline" size="sm" onClick={() => void roleQuery.refetch()}>
                    重试读取
                  </Button>
                )}
                {conflictReady && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      setSelected(new Set(currentPermissionIds))
                      setConflictAcknowledged(true)
                    }}>
                      使用最新授权
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConflictAcknowledged(true)}>
                      保留草稿并继续
                    </Button>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
          {isAdminRole ? (
            <Alert>
              <Crown />
              <AlertDescription>超级管理员内置拥有系统最高权限，无需逐项分配。</AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="space-y-3" role="status" aria-label="正在加载授权信息" aria-busy="true">
              <span className="sr-only">正在加载授权信息…</span>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          ) : loadFailed ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{isForbidden ? "当前账号无权读取完整授权信息，已禁用保存。" : "授权信息读取失败，未加载的权限不会被提交。"}</span>
                <Button variant="outline" size="sm" onClick={() => { void treeQuery.refetch(); void roleQuery.refetch() }}>
                  重试读取
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              {(addedCount > 0 || removedCount > 0) && (
                <Alert role="status" aria-live="polite" className="border-primary/20 bg-primary/[0.03]">
                  <KeyRound className="text-primary" />
                  <AlertDescription>
                    <p className="font-medium text-foreground">权限变更：新增 {addedCount}，移除 {removedCount}</p>
                    <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                      {addedPermissions.map((name) => <li key={`added-${name}`}><span className="mr-1 font-semibold text-emerald-700 dark:text-emerald-300">+</span>{name}</li>)}
                      {removedPermissions.map((name) => <li key={`removed-${name}`}><span className="mr-1 font-semibold text-destructive">−</span>{name}</li>)}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <PermissionTreePicker tree={tree} value={selected} onChange={setSelected} />
            </div>
          )}
        </div>
        <DialogFooter className="m-0 items-center rounded-b-xl border-t bg-muted/40 p-4 sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            {!isAdminRole && (
              <>
                <span className="text-muted-foreground">已选</span>
                <span className="font-semibold text-foreground tabular-nums">{selected.size}</span>
                <span className="text-muted-foreground">/ 共 {total} 项</span>
                {(addedCount > 0 || removedCount > 0) && (
                  <span className="text-xs text-muted-foreground" aria-live="polite">
                    新增 {addedCount} · 移除 {removedCount}
                  </span>
                )}
                <Button variant="ghost" size="xs" onClick={() => setSelected(new Set(flattenTree(tree).map((p) => p.id)))}>
                  全部选中
                </Button>
                <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => void clearAll()} disabled={!selected.size}>
                  全部清空
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
              取消
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={isAdminRole || loading || loadFailed || !loadedForCurrentRole || mutation.isPending || (revisionConflict && (!conflictReady || !conflictAcknowledged)) || (addedCount === 0 && removedCount === 0)}>
              {mutation.isPending && <Spinner />}
              保存授权
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
