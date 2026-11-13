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
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import {
  manufacturersService,
  type ManufacturerDTO,
  type ProtocolType,
} from "@/services/vendor-management"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/

const PROTOCOL_OPTIONS: { id: ProtocolType; label: string }[] = [
  { id: "redfish", label: "Redfish" },
  { id: "rest", label: "REST API" },
  { id: "snmpv2c", label: "SNMP v2c" },
  { id: "snmpv3", label: "SNMP v3" },
]

const createManufacturerSchema = (editing: boolean) =>
  z.object({
    code: editing
      ? z.string()
      : z
          .string()
          .trim()
          .min(2, "制造商编码至少 2 个字符")
          .max(64, "制造商编码不能超过 64 个字符")
          .regex(CODE_PATTERN, "以字母开头，仅含字母、数字及 _ . : -"),
    name: z
      .string()
      .trim()
      .min(2, "制造商名称至少 2 个字符")
      .max(128, "制造商名称不能超过 128 个字符"),
    englishName: z.string().trim().max(128, "英文名不能超过 128 个字符"),
    website: z
      .string()
      .trim()
      .max(512, "官方网站不能超过 512 个字符")
      .refine((val) => !val || /^https?:\/\/.+/.test(val), "官方网站必须为合法的 http(s) 链接"),
    supportUrl: z
      .string()
      .trim()
      .max(512, "技术支持链接不能超过 512 个字符")
      .refine((val) => !val || /^https?:\/\/.+/.test(val), "技术支持链接必须为合法的 http(s) 链接"),
    supportPhone: z.string().trim().max(64, "支持热线不能超过 64 个字符"),
    enterpriseOid: z
      .string()
      .trim()
      .refine((val) => {
        if (!val) return true
        const num = Number(val)
        return Number.isInteger(num) && num >= 1 && num <= 4294967295
      }, "企业私有 OID 必须为 1-4294967295 的整数"),
    serialNumberPattern: z
      .string()
      .trim()
      .max(512, "匹配规则不能超过 512 个字符")
      .refine((val) => {
        if (!val) return true
        try {
          new RegExp(val)
          return true
        } catch {
          return false
        }
      }, "序列号匹配规则必须为合法正则表达式"),
    protocols: z.array(z.enum(["redfish", "rest", "snmpv2c", "snmpv3"])),
    description: z.string().max(1024, "说明不能超过 1024 个字符"),
  })

type ManufacturerFormValues = {
  code: string
  name: string
  englishName: string
  website: string
  supportUrl: string
  supportPhone: string
  enterpriseOid: string
  serialNumberPattern: string
  protocols: ProtocolType[]
  description: string
}

export function ManufacturerFormDialog({
  open,
  manufacturer,
  onOpenChange,
}: {
  open: boolean
  manufacturer?: ManufacturerDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = Boolean(manufacturer)

  const manufacturerSchema = useMemo(() => createManufacturerSchema(editing), [editing])
  const defaultValues = useMemo<ManufacturerFormValues>(
    () => ({
      code: manufacturer?.code ?? "",
      name: manufacturer?.name ?? "",
      englishName: manufacturer?.english_name ?? "",
      website: manufacturer?.website ?? "",
      supportUrl: manufacturer?.support_url ?? "",
      supportPhone: manufacturer?.support_phone ?? "",
      enterpriseOid: manufacturer?.enterprise_oid ? String(manufacturer.enterprise_oid) : "",
      serialNumberPattern: manufacturer?.serial_number_pattern ?? "",
      protocols: manufacturer?.protocols ?? [],
      description: manufacturer?.description ?? "",
    }),
    [manufacturer],
  )

  const mutation = useMutation({
    mutationFn: (values: ManufacturerFormValues) => {
      const payload: Partial<ManufacturerDTO> = {
        name: values.name.trim(),
        english_name: values.englishName.trim() || undefined,
        website: values.website.trim() || undefined,
        support_url: values.supportUrl.trim() || undefined,
        support_phone: values.supportPhone.trim() || undefined,
        enterprise_oid: values.enterpriseOid ? Number(values.enterpriseOid) : undefined,
        serial_number_pattern: values.serialNumberPattern.trim() || undefined,
        protocols: values.protocols,
        description: values.description.trim() || undefined,
      }
      if (editing && manufacturer) {
        return manufacturersService.update(manufacturer, payload)
      }
      return manufacturersService.create({
        ...payload,
        code: values.code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "制造商已更新" : "制造商已录入",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["manufacturers"] })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<ManufacturerFormValues>({
    defaultValues,
    resetKey: manufacturer?.id,
    schema: manufacturerSchema,
    serverFieldNames: {
      english_name: "englishName",
      support_url: "supportUrl",
      support_phone: "supportPhone",
      enterprise_oid: "enterpriseOid",
      serial_number_pattern: "serialNumberPattern",
    },
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新制造商失败" : "创建制造商失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "制造商信息尚未保存，关闭后这些更改将丢失。")

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
              {editing ? "编辑硬件制造商档案" : "录入新硬件制造商"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            用于机架服务器、网络交换机、存储阵列的品牌元数据与带外接口规范
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
                <FormField field={field} label="制造商编码" required={!editing} idPrefix="mfr">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: cisco"
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
                <FormField field={field} label="中文品牌 / 厂商名" required idPrefix="mfr">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 思科系统"
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
            <form.Field name="englishName">
              {(field) => (
                <FormField field={field} label="英文名称 (English Name)" idPrefix="mfr">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: Cisco Systems, Inc."
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

            <form.Field name="supportPhone">
              {(field) => (
                <FormField field={field} label="官方技术支持热线" idPrefix="mfr">
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
            <form.Field name="website">
              {(field) => (
                <FormField field={field} label="官方门户网址" idPrefix="mfr">
                  {(props) => (
                    <Input
                      {...props}
                      type="url"
                      placeholder="https://www.cisco.com"
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

            <form.Field name="supportUrl">
              {(field) => (
                <FormField field={field} label="驱动/固件下载与支持中心" idPrefix="mfr">
                  {(props) => (
                    <Input
                      {...props}
                      type="url"
                      placeholder="https://support.cisco.com"
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
            <form.Field name="enterpriseOid">
              {(field) => (
                <FormField field={field} label="SNMP Enterprise OID (IANA)" idPrefix="mfr">
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      placeholder="如: 9 (Cisco)"
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

            <form.Field name="serialNumberPattern">
              {(field) => (
                <FormField field={field} label="序列号正则 (Serial Pattern)" idPrefix="mfr">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: ^FOC[0-9A-Z]{8}$"
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

          <form.Field name="protocols">
            {(field) => (
              <FormField field={field} label="支持的设备带外/发现协议" idPrefix="mfr">
                {() => (
                  <div className="grid grid-cols-4 gap-2 rounded-md border p-2">
                    {PROTOCOL_OPTIONS.map((opt) => {
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
                                ? field.state.value.filter((p) => p !== opt.id)
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

          <form.Field name="description">
            {(field) => (
              <FormField field={field} label="说明与备忘录" idPrefix="mfr">
                {(props) => (
                  <Textarea
                    {...props}
                    placeholder="厂商产线特点、主流型号说明..."
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
                    "录入制造商"
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