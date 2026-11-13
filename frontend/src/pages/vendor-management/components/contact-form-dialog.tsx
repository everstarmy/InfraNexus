import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UserCheck } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Checkbox } from "@/components/ui/checkbox"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import {
  contactsService,
  type OrganizationContactDTO,
  type ContactRole,
} from "@/services/vendor-management"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

const ROLE_OPTIONS: { id: ContactRole; label: string }[] = [
  { id: "account_manager", label: "客户经理 (主联系人)" },
  { id: "resident_engineer", label: "常驻驻场工程师" },
  { id: "onsite_engineer", label: "现场实施/巡检工程师" },
  { id: "escalation_lead", label: "重大故障升级负责人" },
  { id: "commercial_contact", label: "商务与采购联系人" },
]

const createContactSchema = (editing: boolean) =>
  z.object({
    code: editing
      ? z.string()
      : z
          .string()
          .trim()
          .min(2, "人员编码至少 2 个字符")
          .max(64, "人员编码不能超过 64 个字符")
          .regex(CODE_PATTERN, "以字母开头，仅含字母、数字及 _ . : -"),
    name: z
      .string()
      .trim()
      .min(2, "姓名至少 2 个字符")
      .max(128, "姓名不能超过 128 个字符"),
    title: z.string().trim().max(128, "职务不能超过 128 个字符"),
    phone: z.string().trim().max(64, "手机号不能超过 64 个字符"),
    email: z
      .string()
      .trim()
      .max(128, "工作邮箱不能超过 128 个字符")
      .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), "工作邮箱格式不正确"),
    roles: z
      .array(
        z.enum([
          "account_manager",
          "resident_engineer",
          "onsite_engineer",
          "escalation_lead",
          "commercial_contact",
        ]),
      )
      .min(1, "至少分配一个服务角色"),
    idDocType: z.string().trim().max(32, "证件类型不能超过 32 个字符"),
    maskedId: z.string().trim().max(32, "脱敏证件号不能超过 32 个字符"),
  })

type ContactFormValues = {
  code: string
  name: string
  title: string
  phone: string
  email: string
  roles: ContactRole[]
  idDocType: string
  maskedId: string
}

export function ContactFormDialog({
  open,
  ownerType,
  ownerId,
  contact,
  onOpenChange,
}: {
  open: boolean
  ownerType: "vendor" | "manufacturer"
  ownerId: string
  contact?: OrganizationContactDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = Boolean(contact)

  const contactSchema = useMemo(() => createContactSchema(editing), [editing])
  const defaultValues = useMemo<ContactFormValues>(
    () => ({
      code: contact?.code ?? "",
      name: contact?.name ?? "",
      title: contact?.title ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      roles: contact?.roles ?? ["account_manager"],
      idDocType: contact?.id_document_type ?? "",
      maskedId: contact?.masked_id ?? "",
    }),
    [contact],
  )

  const mutation = useMutation({
    mutationFn: (values: ContactFormValues) => {
      const payload: Partial<OrganizationContactDTO> = {
        name: values.name.trim(),
        title: values.title.trim() || undefined,
        phone: values.phone.trim() || undefined,
        email: values.email.trim() || undefined,
        roles: values.roles,
        id_document_type: values.idDocType.trim() || undefined,
        masked_id: values.maskedId.trim() || undefined,
        vendor_id: ownerType === "vendor" ? ownerId : undefined,
        manufacturer_id: ownerType === "manufacturer" ? ownerId : undefined,
      }
      if (editing && contact) {
        return contactsService.update(contact, payload)
      }
      return contactsService.create({
        ...payload,
        code: values.code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "联系人已更新" : "联系人已添加",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["contacts"] })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<ContactFormValues>({
    defaultValues,
    resetKey: contact?.id ?? `create:${ownerType}:${ownerId}`,
    schema: contactSchema,
    serverFieldNames: {
      id_document_type: "idDocType",
      masked_id: "maskedId",
    },
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新联系人失败" : "添加联系人失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "联系人信息尚未保存，关闭后这些更改将丢失。")

  const requestClose = async () => {
    if (mutation.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃更改？",
        description: "当前表单尚未保存，离开后未保存的更改将丢失。",
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void requestClose()
        else onOpenChange(true)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <UserCheck className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑联系人" : "添加对接联系人"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            用于故障报修、驻场服务及商务采购对接的核心干系人档案
          </DialogDescription>
        </DialogHeader>

        {formError && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
          className="space-y-3 py-2"
        >
          <FieldGroup className="grid grid-cols-2 gap-3">
            <form.Field name="code">
              {(field) => (
                <FormField field={field} label="人员编码" required={!editing} idPrefix="contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: c-zhangsan"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={editing || mutation.isPending}
                      className="h-8 text-xs font-mono"
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="name">
              {(field) => (
                <FormField field={field} label="姓名" required idPrefix="contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 张三"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs"
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <form.Field name="title">
              {(field) => (
                <FormField field={field} label="职务 / 岗位" idPrefix="contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 高级售后工程师"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs"
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="phone">
              {(field) => (
                <FormField field={field} label="手机号" idPrefix="contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="138-xxxx-xxxx"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs"
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <form.Field name="email">
            {(field) => (
              <FormField field={field} label="工作邮箱" idPrefix="contact">
                {(props) => (
                  <Input
                    {...props}
                    type="email"
                    placeholder="zhangsan@vendor.com"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    disabled={mutation.isPending}
                    className="h-8 text-xs"
                  />
                )}
              </FormField>
            )}
          </form.Field>

          <form.Field name="roles">
            {(field) => (
              <FormField field={field} label="分配角色 (多选)" required idPrefix="contact">
                {() => (
                  <div className="space-y-1.5 rounded-md border p-2">
                    {ROLE_OPTIONS.map((opt) => {
                      const checked = field.state.value.includes(opt.id)
                      return (
                        <label
                          key={opt.id}
                          className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer select-none"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => {
                              const next = checked
                                ? field.state.value.filter((x) => x !== opt.id)
                                : [...field.state.value, opt.id]
                              field.handleChange(next)
                            }}
                            disabled={mutation.isPending}
                          />
                          <span>{opt.label}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </FormField>
            )}
          </form.Field>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <form.Field name="idDocType">
              {(field) => (
                <FormField field={field} label="证件类型" idPrefix="contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 居民身份证"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs"
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="maskedId">
              {(field) => (
                <FormField field={field} label="脱敏证件号" idPrefix="contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 110101********001X"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs font-mono"
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void requestClose()}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting]}>
              {([isSubmitting]) => (
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting || mutation.isPending}
                >
                  {isSubmitting || mutation.isPending ? (
                    <Spinner className="size-4" />
                  ) : editing ? (
                    "保存更改"
                  ) : (
                    "添加联系人"
                  )}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}