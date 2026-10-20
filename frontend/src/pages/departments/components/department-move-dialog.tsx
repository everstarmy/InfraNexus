import { useEffect, useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FolderInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { DepartmentSelect, departmentPathLabel } from "@/components/common/department-select"
import { notify } from "@/lib/notify"
import { collectIds } from "@/lib/tree"
import { departmentsService, type DepartmentNode } from "@/services/departments"

export function DepartmentMoveDialog({
  department,
  departments,
  onOpenChange,
}: {
  department: DepartmentNode | null
  departments: DepartmentNode[]
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [toRoot, setToRoot] = useState(false)
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    setToRoot(false)
    setTarget(null)
  }, [department])

  const blocked = useMemo(() => new Set(department ? collectIds(department) : []), [department])

  const mutation = useMutation({
    mutationFn: () => departmentsService.move(department!.id, toRoot ? null : target),
    onSuccess: () => {
      notify.success("部门已移动", `${department?.name} 及其下级部门已整体迁移`)
      void queryClient.invalidateQueries({ queryKey: ["departments"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      onOpenChange(false)
    },
    onError: (error) => notify.apiError(error, "移动失败"),
  })

  return (
    <Dialog open={!!department} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
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
