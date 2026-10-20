import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ArrowRightLeft, Info } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { DepartmentSelect, departmentPathLabel } from "@/components/common/department-select"
import { UserAvatar } from "@/components/common/user-avatar"
import { notify } from "@/lib/notify"
import type { DepartmentNode } from "@/services/departments"
import type { UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

export function MoveDepartmentDialog({
  users,
  departments,
  onOpenChange,
  onMoved,
}: {
  users: UserDTO[]
  departments: DepartmentNode[]
  onOpenChange: (open: boolean) => void
  onMoved?: () => void
}) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<string | null>(null)
  const open = users.length > 0

  useEffect(() => {
    if (open) setTarget(null)
  }, [open])

  const mutation = useMutation({
    mutationFn: () => usersService.batchMove(users.map((u) => u.id), target!),
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

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            取消
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!target || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            确认调岗
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
