import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Crown, KeyRound } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { PermissionTreePicker } from "@/components/common/permission-tree-picker"
import { notify } from "@/lib/notify"
import { flattenTree } from "@/lib/tree"
import { rolesService, type PermissionDTO, type RoleDTO } from "@/services/roles"
import { useAuth } from "@/stores/auth-context"

export function RolePermissionDialog({ role, onOpenChange }: { role: RoleDTO | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const { user, checkAuth } = useAuth()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const isAdminRole = role?.code === "admin"

  const treeQuery = useQuery({
    queryKey: ["roles", "permission-tree"],
    queryFn: async () => (await rolesService.permissionTree()).data,
    enabled: !!role,
  })
  const roleQuery = useQuery({
    queryKey: ["roles", "detail", role?.id],
    queryFn: async () => (await rolesService.get(role!.id)).data,
    enabled: !!role,
  })

  useEffect(() => {
    if (roleQuery.data) setSelected(new Set(roleQuery.data.permissions?.map((p) => p.id) ?? []))
  }, [roleQuery.data])

  const tree: PermissionDTO[] = useMemo(() => treeQuery.data ?? [], [treeQuery.data])
  const total = useMemo(() => flattenTree(tree).length, [tree])

  const mutation = useMutation({
    mutationFn: () => rolesService.assignPermissions(role!.id, [...selected]),
    onSuccess: () => {
      notify.success("权限已保存", `「${role?.name}」的授权已同步至 Casbin，立即生效`)
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      if (user?.roles?.some((r) => r.id === role?.id)) void checkAuth()
      onOpenChange(false)
    },
    onError: (error) => notify.apiError(error, "保存权限失败"),
  })

  const loading = treeQuery.isLoading || roleQuery.isLoading

  return (
    <Dialog open={!!role} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[88svh] flex-col gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b p-5">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4.5 text-primary" />
            为「{role?.name}」分配权限
          </DialogTitle>
          <DialogDescription>勾选父节点会联动勾选其全部下级；菜单在任一下级被授权时自动显示</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-5">
          {isAdminRole ? (
            <Alert>
              <Crown />
              <AlertDescription>超级管理员内置拥有全部权限（Casbin 超级主体旁路），无需逐项分配。</AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <PermissionTreePicker tree={tree} value={selected} onChange={setSelected} />
          )}
        </div>
        <DialogFooter className="m-0 items-center rounded-b-xl border-t bg-muted/40 p-4 sm:justify-between">
          <div className="flex items-center gap-2 text-sm">
            {!isAdminRole && (
              <>
                <span className="text-muted-foreground">已选</span>
                <span className="font-semibold text-foreground tabular-nums">{selected.size}</span>
                <span className="text-muted-foreground">/ 共 {total} 项</span>
                <Button variant="ghost" size="xs" onClick={() => setSelected(new Set(flattenTree(tree).map((p) => p.id)))}>
                  全部选中
                </Button>
                <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setSelected(new Set())}>
                  全部清空
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={isAdminRole || loading || mutation.isPending}>
              {mutation.isPending && <Spinner />}
              保存授权
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
