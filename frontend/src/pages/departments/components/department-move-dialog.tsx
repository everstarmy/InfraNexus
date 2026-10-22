import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FolderInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useConfirm } from "@/components/common/confirm-dialog"
import { DepartmentSelect, departmentPathLabel } from "@/components/common/department-select"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { collectIds } from "@/lib/tree"
import { getErrorStatus } from "@/lib/api-error"
import { departmentsService, type DepartmentNode } from "@/services/departments"

export function DepartmentMoveDialog({
  department,
  departments,
  treeRevision,
  onOpenChange,
  onMoved,
}: {
  department: DepartmentNode | null
  departments: DepartmentNode[]
  treeRevision: number
  onOpenChange: (open: boolean) => void
  onMoved?: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [toRoot, setToRoot] = useState(false)
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    setToRoot(false)
    setTarget(null)
  }, [department])

  const blocked = useMemo(() => new Set(department ? collectIds(department) : []), [department])
  const isDirty = !!department && (toRoot || target !== null)
  useUnsavedChanges(isDirty, "部门移动方案尚未执行。离开后当前目标选择将丢失。")

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃部门移动方案？",
        description: "已选择的目标尚未执行，关闭后将清除该方案。",
        confirmText: "放弃方案",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  const mutation = useMutation({
    mutationFn: () => departmentsService.move(department!.id, toRoot ? null : target, treeRevision),
    onSuccess: () => {
      notify.success("部门已移动", `${department?.name} 及其下级部门已整体迁移`)
      void queryClient.invalidateQueries({ queryKey: ["departments"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      if (department) onMoved?.(department.id)
      onOpenChange(false)
    },
    onError: (error) => {
      if (getErrorStatus(error) === 409) {
        notify.error("组织架构已更新，移动方案仍保留。请核对最新树结构后再提交。")
        void queryClient.invalidateQueries({ queryKey: ["departments", "tree"] })
      } else {
        notify.apiError(error, "移动失败")
      }
    },
  })
  const hasConflict = getErrorStatus(mutation.error) === 409

  return (
    <Dialog open={!!department} onOpenChange={(next) => next ? onOpenChange(true) : void requestClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="size-4.5 text-primary" />
            移动部门
          </DialogTitle>
          <DialogDescription>
            将「{department?.name}」连同其全部下级部门迁移到新的上级，当前位置：{departmentPathLabel(departments, department?.parent_id) || "顶级"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {hasConflict && (
            <Alert variant="destructive">
              <AlertDescription>组织架构版本已变化。目标选择和草稿仍保留；树刷新后请核对目标，再明确重试。</AlertDescription>
            </Alert>
          )}
          <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-2">
            <FieldLabel htmlFor="move-root">设为顶级部门</FieldLabel>
            <Switch id="move-root" checked={toRoot} onCheckedChange={setToRoot} />
          </Field>
          {!toRoot && (
            <Field>
              <FieldLabel htmlFor="move-parent">新的上级部门</FieldLabel>
              <DepartmentSelect id="move-parent" nodes={departments} value={target} onChange={setTarget} disabledKeys={blocked} disableInactive={false} />
              <FieldDescription>不可选择自身或其下级部门，以避免形成环路</FieldDescription>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
            取消
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={(!toRoot && !target) || mutation.isPending}>
            {mutation.isPending && <Spinner />}
            确认移动
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
