import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FolderPlus, FolderPen, Info } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { DepartmentSelect, departmentPathLabel } from "@/components/common/department-select"
import { UserPicker } from "@/components/common/user-picker"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { departmentsService, type DepartmentNode } from "@/services/departments"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

type DepartmentFormValues = {
  parent: string | null
  name: string
  code: string
  sortOrder: string
  leaderId: string | null
  leaderLabel: string
  phone: string
  email: string
  enabled: boolean
}

const createDepartmentSchema = (editing: boolean) =>
  z.object({
    parent: z.string().nullable(),
    name: z
      .string()
      .trim()
      .min(1, "请输入有效的部门名称")
      .max(64, "部门名称不能超过 64 个字符"),
    code: editing
      ? z.string()
      : z
          .string()
          .trim()
          .min(2, "部门编码至少 2 个字符")
          .max(64, "部门编码不能超过 64 个字符")
          .regex(CODE_PATTERN, "以字母开头，仅含字母、数字及 _ . : -"),
    leaderId: z.string().nullable(),
    leaderLabel: z.string(),
    phone: z.string().trim().max(32, "联系电话不能超过 32 个字符"),
    email: z
      .string()
      .trim()
      .max(128, "邮箱不能超过 128 个字符")
      .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), "邮箱格式不正确"),
    sortOrder: z
      .string()
      .trim()
      .refine((val) => {
        if (!val) return false
        const num = Number(val)
        return Number.isInteger(num) && num >= 0 && num <= 100000
      }, "排序值必须为 0-100000 的整数"),
    enabled: z.boolean(),
  })

export function DepartmentFormDialog({
  open,
  onOpenChange,
  department,
  parentId,
  departments,
  treeRevision,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  department?: DepartmentNode | null
  parentId?: string | null
  departments: DepartmentNode[]
  treeRevision: number
  onSaved?: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = !!department

  const departmentSchema = useMemo(() => createDepartmentSchema(editing), [editing])
  const defaultValues = useMemo<DepartmentFormValues>(
    () => ({
      parent: department ? department.parent_id : (parentId ?? null),
      name: department?.name ?? "",
      code: department?.code ?? "",
      sortOrder: String(department?.sort_order ?? 0),
      leaderId: department?.leader_id ?? null,
      leaderLabel: department?.leader_name ?? "",
      phone: department?.phone ?? "",
      email: department?.email ?? "",
      enabled: (department?.status ?? 1) === 1,
    }),
    [department, parentId],
  )

  const mutation = useMutation({
    mutationFn: async (values: DepartmentFormValues) => {
      const payload = {
        expected_revision: treeRevision,
        name: values.name.trim(),
        code: values.code.trim(),
        sort_order: Number(values.sortOrder) || 0,
        leader_id: values.leaderId,
        phone: values.phone.trim(),
        email: values.email.trim(),
        status: values.enabled ? 1 : 2,
      }
      if (editing && department) return departmentsService.update(department.id, payload)
      return departmentsService.create({ ...payload, parent_id: values.parent })
    },
    onSuccess: (res) => {
      notify.success(editing ? "部门已更新" : "部门已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["departments"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      if (editing) void queryClient.invalidateQueries({ queryKey: ["users"] })
      onSaved?.(res.data.id)
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<DepartmentFormValues>({
    defaultValues,
    resetKey: department?.id ?? `create:${parentId ?? ""}`,
    schema: departmentSchema,
    serverFieldNames: {
      parent_id: "parent",
      leader_id: "leaderId",
      sort_order: "sortOrder",
    },
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新部门失败" : "创建部门失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "部门表单尚未保存。离开后这些更改将丢失。")

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃部门更改？",
        description: "当前表单尚未保存，离开后这些更改将丢失。",
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? <FolderPen className="size-4.5 text-primary" /> : <FolderPlus className="size-4.5 text-primary" />}
            {editing ? "编辑部门" : parentId ? "新增子部门" : "新建部门"}
          </DialogTitle>
          <DialogDescription>
            {editing ? `部门路径：${departmentPathLabel(departments, department?.id)}` : "部门编码全局唯一，用于系统集成与目录同步映射"}
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
        >
          {formError && (
            <Alert variant="destructive">
              <Info />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          {editing && department?.source === "ldap" && (
            <Alert>
              <Info />
              <AlertDescription>该部门由目录同步自动创建，重命名不会影响同步映射（按 OU 标识匹配）。</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-4">
            {!editing && (
              <form.Field name="parent">
                {(field) => (
                  <FormField field={field} label="上级部门" idPrefix="dept">
                    {(props) => (
                      <DepartmentSelect
                        {...props}
                        id="dept-parent"
                        nodes={departments}
                        value={field.state.value}
                        onChange={(val) => field.handleChange(val)}
                        placeholder="无（作为顶级部门）"
                        allowClear
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="name">
                {(field) => (
                  <FormField field={field} label="部门名称" required idPrefix="dept">
                    {(props) => (
                      <Input
                        {...props}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="如 研发中心"
                      />
                    )}
                  </FormField>
                )}
              </form.Field>

              <form.Field name="code">
                {(field) => (
                  <FormField
                    field={field}
                    label="部门编码"
                    required
                    description="以字母开头，仅含字母、数字及 _ . : -"
                    idPrefix="dept"
                  >
                    {(props) => (
                      <Input
                        {...props}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="如 rd-center"
                        className="font-mono"
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            </div>

            <form.Field name="leaderId">
              {(field) => (
                <FormField field={field} label="部门负责人" idPrefix="dept">
                  {(props) => (
                    <UserPicker
                      {...props}
                      id="dept-leader"
                      value={field.state.value}
                      valueLabel={form.getFieldValue("leaderLabel")}
                      onChange={(id, label) => {
                        field.handleChange(id)
                        form.setFieldValue("leaderLabel", label ?? "")
                      }}
                      placeholder="未指定负责人"
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="phone">
                {(field) => (
                  <FormField field={field} label="联系电话" idPrefix="dept">
                    {(props) => (
                      <Input
                        {...props}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="选填"
                      />
                    )}
                  </FormField>
                )}
              </form.Field>

              <form.Field name="email">
                {(field) => (
                  <FormField field={field} label="部门邮箱" idPrefix="dept">
                    {(props) => (
                      <Input
                        {...props}
                        type="email"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder="选填"
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="sortOrder">
                {(field) => (
                  <FormField field={field} label="排序值" description="数值越小越靠前" idPrefix="dept">
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        min={0}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    )}
                  </FormField>
                )}
              </form.Field>

              <form.Field name="enabled">
                {(field) => (
                  <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-2 sm:mt-6 sm:h-fit">
                    <FieldLabel htmlFor="dept-enabled">启用部门</FieldLabel>
                    <Switch
                      id="dept-enabled"
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                    />
                  </Field>
                )}
              </form.Field>
            </div>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting]}>
              {([isSubmitting]) => (
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  {(isSubmitting || mutation.isPending) && <Spinner />}
                  {editing ? "保存修改" : "创建部门"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
