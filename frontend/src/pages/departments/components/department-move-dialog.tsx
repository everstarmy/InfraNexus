import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FolderInput } from "lucide-react"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useConfirm } from "@/components/common/confirm-dialog"
import { DepartmentSelect, departmentPathLabel } from "@/components/common/department-select"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { collectIds } from "@/lib/tree"
import { getErrorStatus } from "@/lib/api-error"
import { departmentsService, type DepartmentNode } from "@/services/departments"

const moveDepartmentSchema = z
  .object({
    toRoot: z.boolean(),
    target: z.string().nullable(),
  })
  .refine((data) => data.toRoot || (data.target !== null && data.target.length > 0), {
    message: "请选择新的上级部门或设为顶级部门",
    path: ["target"],
  })

type MoveDepartmentValues = z.infer<typeof moveDepartmentSchema>

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
  const [conflictError, setConflictError] = useState(false)

  const defaultValues = useMemo<MoveDepartmentValues>(
    () => ({
      toRoot: false,
      target: null,
    }),
    [department?.id],
  )

  const blocked = useMemo(() => new Set(department ? collectIds(department) : []), [department])

  const mutation = useMutation({
    mutationFn: (values: MoveDepartmentValues) =>
      departmentsService.move(department!.id, values.toRoot ? null : values.target, treeRevision),
    onSuccess: () => {
      notify.success("部门已移动", `${department?.name} 及其下级部门已整体迁移`)
      void queryClient.invalidateQueries({ queryKey: ["departments"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      void queryClient.invalidateQueries({ queryKey: ["users"] })
      if (department) onMoved?.(department.id)
      onOpenChange(false)
    },
    onError: (error) => {
      if (getErrorStatus(error) === 409) {
        setConflictError(true)
        notify.error("组织架构已更新，移动方案仍保留。请核对最新树结构后再提交。")
        void queryClient.invalidateQueries({ queryKey: ["departments", "tree"] })
      } else {
        notify.apiError(error, "移动失败")
      }
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm({
    defaultValues,
    resetKey: department?.id,
    schema: moveDepartmentSchema,
    serverFieldNames: { parent_id: "target" },
    open: Boolean(department),
    onSubmit: async (values) => {
      setConflictError(false)
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: "移动部门失败",
  })

  const isDirty = Boolean(department) && hasChanges
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

  return (
    <Dialog open={!!department} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="size-4.5 text-primary" />
            移动部门
          </DialogTitle>
          <DialogDescription>
            将「{department?.name}」连同其全部下级部门迁移到新的上级，当前位置：
            {departmentPathLabel(departments, department?.parent_id) || "顶级"}
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
        >
          {conflictError && (
            <Alert variant="destructive">
              <AlertDescription>组织架构版本已变化。目标选择和草稿仍保留；树刷新后请核对目标，再明确重试。</AlertDescription>
            </Alert>
          )}

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <form.Field name="toRoot">
            {(field) => (
              <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-2">
                <FieldLabel htmlFor="move-root">设为顶级部门</FieldLabel>
                <Switch
                  id="move-root"
                  checked={field.state.value}
                  onCheckedChange={(checked) => {
                    field.handleChange(checked)
                    if (checked) {
                      form.setFieldValue("target", null)
                    }
                  }}
                />
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => [state.values.toRoot]}>
            {([toRoot]) =>
              !toRoot ? (
                <form.Field name="target">
                  {(field) => (
                    <FormField
                      field={field}
                      label="新的上级部门"
                      description="不可选择自身或其下级部门，以避免形成环路"
                      id="move-parent"
                    >
                      {(props) => (
                        <DepartmentSelect
                          {...props}
                          nodes={departments}
                          value={field.state.value}
                          onChange={(val) => field.handleChange(val)}
                          disabledKeys={blocked}
                          disableInactive={false}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting]}>
              {([isSubmitting]) => (
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  {(isSubmitting || mutation.isPending) && <Spinner />}
                  确认移动
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
