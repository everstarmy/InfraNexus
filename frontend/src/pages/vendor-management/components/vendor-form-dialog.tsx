import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import {
  vendorsService,
  type VendorDTO,
  type VendorServiceType,
  type CooperationStatus,
} from "@/services/vendor-management"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

const SERVICE_TYPE_OPTIONS: { id: VendorServiceType; label: string }[] = [
  { id: "hardware_supplier", label: "硬件供货商" },
  { id: "oem_service", label: "原厂维保服务" },
  { id: "third_party_maintenance", label: "第三方综合维保" },
  { id: "spare_parts", label: "备件备件库" },
  { id: "data_destruction", label: "介质数据销毁" },
]

const createVendorSchema = (editing: boolean) =>
  z.object({
    code: editing
      ? z.string()
      : z
          .string()
          .trim()
          .min(2, "供应商编码至少 2 个字符")
          .max(64, "供应商编码不能超过 64 个字符")
          .regex(CODE_PATTERN, "以字母开头，仅含字母、数字及 _ . : -"),
    name: z
      .string()
      .trim()
      .min(2, "供应商全称至少 2 个字符")
      .max(128, "供应商全称不能超过 128 个字符"),
    shortName: z.string().trim().max(128, "简称不能超过 128 个字符"),
    creditCode: z
      .string()
      .trim()
      .regex(/^[0-9A-HJ-NPQRTUWXY]{18}$/, "统一社会信用代码必须为 18 位大写字母或数字"),
    serviceTypes: z
      .array(
        z.enum([
          "hardware_supplier",
          "oem_service",
          "third_party_maintenance",
          "spare_parts",
          "data_destruction",
        ]),
      )
      .min(1, "至少勾选一种服务类别"),
    cooperationStatus: z.enum(["active", "suspended", "terminated"]),
    emergencyPhone: z.string().trim().max(64, "紧急热线不能超过 64 个字符"),
    dispatchEmail: z
      .string()
      .trim()
      .max(128, "派单邮箱不能超过 128 个字符")
      .refine((val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val), "派单邮箱格式不正确"),
    dispatchUrl: z
      .string()
      .trim()
      .max(512, "派单平台链接不能超过 512 个字符")
      .refine((val) => !val || /^https?:\/\/.+/.test(val), "派单平台链接必须为合法的 http(s) URL"),
    emergencyMinutes: z
      .string()
      .trim()
      .refine((val) => {
        if (!val) return false
        const num = Number(val)
        return Number.isInteger(num) && num >= 0 && num <= 525600
      }, "应急时限必须为 0-525600 的整数"),
    partsMinutes: z
      .string()
      .trim()
      .refine((val) => {
        if (!val) return false
        const num = Number(val)
        return Number.isInteger(num) && num >= 0 && num <= 525600
      }, "备件时限必须为 0-525600 的整数"),
    engineerMinutes: z
      .string()
      .trim()
      .refine((val) => {
        if (!val) return false
        const num = Number(val)
        return Number.isInteger(num) && num >= 0 && num <= 525600
      }, "工程师到场时限必须为 0-525600 的整数"),
    description: z.string().max(1024, "说明不能超过 1024 个字符"),
  })

type VendorFormValues = {
  code: string
  name: string
  shortName: string
  creditCode: string
  serviceTypes: VendorServiceType[]
  cooperationStatus: CooperationStatus
  emergencyPhone: string
  dispatchEmail: string
  dispatchUrl: string
  emergencyMinutes: string
  partsMinutes: string
  engineerMinutes: string
  description: string
}

export function VendorFormDialog({
  open,
  vendor,
  onOpenChange,
}: {
  open: boolean
  vendor?: VendorDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = Boolean(vendor)

  const vendorSchema = useMemo(() => createVendorSchema(editing), [editing])
  const defaultValues = useMemo<VendorFormValues>(
    () => ({
      code: vendor?.code ?? "",
      name: vendor?.name ?? "",
      shortName: vendor?.short_name ?? "",
      creditCode: vendor?.credit_code ?? "",
      serviceTypes: vendor?.service_types ?? ["hardware_supplier"],
      cooperationStatus: vendor?.cooperation_status ?? "active",
      emergencyPhone: vendor?.emergency_phone ?? "",
      dispatchEmail: vendor?.dispatch_email ?? "",
      dispatchUrl: vendor?.dispatch_url ?? "",
      emergencyMinutes:
        vendor?.emergency_response_minutes !== undefined
          ? String(vendor.emergency_response_minutes)
          : "120",
      partsMinutes:
        vendor?.parts_response_minutes !== undefined
          ? String(vendor.parts_response_minutes)
          : "240",
      engineerMinutes:
        vendor?.engineer_response_minutes !== undefined
          ? String(vendor.engineer_response_minutes)
          : "240",
      description: vendor?.description ?? "",
    }),
    [vendor],
  )

  const mutation = useMutation({
    mutationFn: (values: VendorFormValues) => {
      const payload: Partial<VendorDTO> = {
        name: values.name.trim(),
        short_name: values.shortName.trim() || undefined,
        credit_code: values.creditCode.trim() || undefined,
        service_types: values.serviceTypes,
        cooperation_status: values.cooperationStatus,
        emergency_phone: values.emergencyPhone.trim() || undefined,
        dispatch_email: values.dispatchEmail.trim() || undefined,
        dispatch_url: values.dispatchUrl.trim() || undefined,
        emergency_response_minutes: values.emergencyMinutes
          ? Number(values.emergencyMinutes)
          : undefined,
        parts_response_minutes: values.partsMinutes
          ? Number(values.partsMinutes)
          : undefined,
        engineer_response_minutes: values.engineerMinutes
          ? Number(values.engineerMinutes)
          : undefined,
        description: values.description.trim() || undefined,
      }
      if (editing && vendor) {
        return vendorsService.update(vendor, payload)
      }
      return vendorsService.create({
        ...payload,
        code: values.code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "供应商已更新" : "供应商已录入",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["vendors"] })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<VendorFormValues>({
    defaultValues,
    resetKey: vendor?.id,
    schema: vendorSchema,
    serverFieldNames: {
      short_name: "shortName",
      credit_code: "creditCode",
      service_types: "serviceTypes",
      cooperation_status: "cooperationStatus",
      emergency_phone: "emergencyPhone",
      dispatch_email: "dispatchEmail",
      dispatch_url: "dispatchUrl",
      emergency_response_minutes: "emergencyMinutes",
      parts_response_minutes: "partsMinutes",
      engineer_response_minutes: "engineerMinutes",
    },
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新供应商失败" : "创建供应商失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "供应商信息尚未保存，关闭后这些更改将丢失。")

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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑供应商档案" : "录入新供应商档案"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            维保服务商、备件供货商统一档案与应急响应服务等级 (SLA)
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
                <FormField field={field} label="供应商编码" required={!editing} idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: vendor-inspur"
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
                <FormField field={field} label="供应商全称" required idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 浪潮电子信息产业股份有限公司"
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
            <form.Field name="shortName">
              {(field) => (
                <FormField field={field} label="商务简称" idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 浪潮信息"
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

            <form.Field name="creditCode">
              {(field) => (
                <FormField field={field} label="统一社会信用代码" required idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="18 位统一代码"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs font-mono"
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <form.Field name="serviceTypes">
            {(field) => (
              <FormField field={field} label="服务类别 (多选)" required idPrefix="vendor">
                {() => (
                  <div className="grid grid-cols-3 gap-2 rounded-md border p-2">
                    {SERVICE_TYPE_OPTIONS.map((opt) => {
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
            <form.Field name="cooperationStatus">
              {(field) => (
                <FormField field={field} label="合作状态" required idPrefix="vendor">
                  {(props) => (
                    <NativeSelect
                      {...props}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value as CooperationStatus)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs"
                    >
                      <NativeSelectOption value="active">正常服务 (Active)</NativeSelectOption>
                      <NativeSelectOption value="suspended">合作暂停 (Suspended)</NativeSelectOption>
                      <NativeSelectOption value="terminated">合作终止 (Terminated)</NativeSelectOption>
                    </NativeSelect>
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="emergencyPhone">
              {(field) => (
                <FormField field={field} label="7×24 紧急响应电话" idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="400-xxx-xxxx"
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
            <form.Field name="dispatchEmail">
              {(field) => (
                <FormField field={field} label="工单派发邮箱" idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      placeholder="support@vendor.com"
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

            <form.Field name="dispatchUrl">
              {(field) => (
                <FormField field={field} label="服务工单平台链接" idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      type="url"
                      placeholder="https://service.vendor.com"
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

          <FieldGroup className="grid grid-cols-3 gap-3">
            <form.Field name="emergencyMinutes">
              {(field) => (
                <FormField field={field} label="应急电话响应 (分)" idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
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

            <form.Field name="partsMinutes">
              {(field) => (
                <FormField field={field} label="备件到场时限 (分)" idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
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

            <form.Field name="engineerMinutes">
              {(field) => (
                <FormField field={field} label="工程师到场 (分)" idPrefix="vendor">
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
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

          <form.Field name="description">
            {(field) => (
              <FormField field={field} label="说明与备忘录" idPrefix="vendor">
                {(props) => (
                  <Textarea
                    {...props}
                    placeholder="合同编号、服务窗口说明..."
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    disabled={mutation.isPending}
                    rows={2}
                    className="text-xs"
                  />
                )}
              </FormField>
            )}
          </form.Field>

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
                    "创建供应商"
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