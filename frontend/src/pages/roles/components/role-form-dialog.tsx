import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Info, ShieldPlus, ShieldCheck } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { rolesService, type RoleDTO } from "@/services/roles"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

type RoleFormValues = {
  code: string
  name: string
  description: string
}

const createRoleSchema = (editing: boolean) =>
  z.object({
    code: editing
      ? z.string()
      : z
          .string()
          .trim()
          .min(2, "角色编码至少 2 个字符")
          .max(64, "角色编码不能超过 64 个字符")
          .regex(CODE_PATTERN, "以字母开头，仅含字母、数字及 _ . : -"),
    name: z
      .string()
      .trim()
      .min(2, "角色名称至少 2 个字符")
      .max(64, "角色名称不能超过 64 个字符"),
    description: z.string().max(255, "职责描述不能超过 255 个字符"),
  })

export function RoleFormDialog({
  open,
  role,
  onOpenChange,
}: {
  open: boolean
  role?: RoleDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = !!role

  const roleSchema = useMemo(() => createRoleSchema(editing), [editing])
  const defaultValues = useMemo<RoleFormValues>(
    () => ({
      code: role?.code ?? "",
      name: role?.name ?? "",
      description: role?.description ?? "",
    }),
    [role],
  )

  const mutation = useMutation({
    mutationFn: (values: RoleFormValues) =>
      editing && role
        ? rolesService.update(role.id, { name: values.name.trim(), description: values.description.trim() })
        : rolesService.create({ code: values.code.trim(), name: values.name.trim(), description: values.description.trim() }),
    onSuccess: (res) => {
      notify.success(editing ? "角色已更新" : "角色已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["roles"] })
      void queryClient.invalidateQueries({ queryKey: ["options"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      if (editing) void queryClient.invalidateQueries({ queryKey: ["users"] })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<RoleFormValues>({
    defaultValues,
    resetKey: role?.id,
    schema: roleSchema,
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新角色失败" : "创建角色失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "角色表单尚未保存。离开后这些更改将丢失。")

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃角色更改？",
        description: "当前表单尚未保存，离开后这些更改将丢失。",
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? <ShieldCheck className="size-4.5 text-primary" /> : <ShieldPlus className="size-4.5 text-primary" />}
            {editing ? "编辑角色" : "新建角色"}
          </DialogTitle>
          <DialogDescription>角色编码是系统唯一的授权主体标识，创建后不可修改</DialogDescription>
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
          {formError && (
            <Alert variant="destructive">
              <Info />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-4">
            <form.Field name="code">
              {(field) => (
                <FormField
                  field={field}
                  label="角色编码"
                  required={!editing}
                  description={editing ? undefined : "建议使用小写英文，如 operator、auditor"}
                  idPrefix="role"
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="如 auditor"
                      className="font-mono"
                      disabled={editing || mutation.isPending}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="name">
              {(field) => (
                <FormField field={field} label="角色名称" required idPrefix="role">
                  {(props) => (
                    <Input
                      {...props}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="如 审计员"
                      disabled={mutation.isPending}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <FormField
                  field={field}
                  label="职责描述"
                  description="简述该角色的职责范围"
                  id="role-desc"
                >
                  {(props) => (
                    <Textarea
                      {...props}
                      value={field.state.value ?? ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      placeholder="简述该角色的职责范围"
                      disabled={mutation.isPending}
                      rows={3}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void requestClose()} disabled={mutation.isPending}>
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
              {([isSubmitting]) => (
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  {(isSubmitting || mutation.isPending) && <Spinner />}
                  {editing ? "保存修改" : "创建角色"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
