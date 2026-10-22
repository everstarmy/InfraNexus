import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, Info } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { DepartmentSelect, departmentPathLabel } from "@/components/common/department-select"
import { useConfirm } from "@/components/common/confirm-dialog"
import { UserAvatar } from "@/components/common/user-avatar"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import type { DepartmentNode } from "@/services/departments"
import type { UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

export function MoveDepartmentDialog({
  users,
  departments,
  treeRevision,
  onOpenChange,
  onMoved,
}: {
  users: UserDTO[]
  departments: DepartmentNode[]
  treeRevision: number
  onOpenChange: (open: boolean) => void
  onMoved?: () => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [target, setTarget] = useState<string | null>(null)
  const open = users.length > 0

  useEffect(() => {
    if (open) setTarget(null)
  }, [open])

  const isDirty = open && target !== null
  useUnsavedChanges(isDirty, "人员调岗方案尚未执行。离开后目标部门选择将丢失。")

  const mutation = useMutation({
    mutationFn: () => usersService.batchMove(users.map((u) => u.id), target!, treeRevision),
    onSuccess: (res) => {
      notify.success("调岗完成", `已将 ${res.data.moved} 名人员调整至「${departmentPathLabel(departments, target)}」`)
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      void queryClient.invalidateQueries({ queryKey: ["departments"] })
      onMoved?.()
      onOpenChange(false)
    },
    onError: (error) => notify.apiError(error, "调岗失败"),
  })

  const directoryCount = users.filter((u) => u.auth_type !== "local").length

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃调岗方案？",
        description: `已为 ${users.length} 名人员选择目标部门，尚未执行。`,
        confirmText: "放弃方案",
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
            <ArrowRightLeft className="size-4.5 text-primary" />
            {users.length > 1 ? `批量调岗（${users.length} 人）` : "调整部门"}
          </DialogTitle>
          <DialogDescription>将所选人员整体移动到目标部门，操作在同一事务中完成</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
            <div className="flex -space-x-2">
              {users.slice(0, 5).map((u) => (
                <UserAvatar key={u.id} name={u.nickname || u.username} seed={u.username} size="sm" className="ring-2 ring-background" />
              ))}
            </div>
            <p className="min-w-0 flex-1 truncate text-sm">
              {users.slice(0, 3).map((u) => u.nickname || u.username).join("、")}
              {users.length > 3 && ` 等 ${users.length} 人`}
            </p>
          </div>
          <Field>
            <FieldLabel htmlFor="move-target">目标部门</FieldLabel>
            <DepartmentSelect id="move-target" nodes={departments} value={target} onChange={setTarget} placeholder="选择要调入的部门" />
          </Field>
          {directoryCount > 0 && (
            <Alert>
              <Info />
              <AlertDescription>其中 {directoryCount} 人为目录域账号，若目录配置开启了部门同步，下次同步可能恢复为目录中的部门。</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
            取消
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!target || treeRevision < 1 || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            确认调岗
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
