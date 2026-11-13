import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileBadge } from "lucide-react"
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import {
  qualificationsService,
  manufacturersService,
  type VendorQualificationDTO,
  type QualificationKind,
} from "@/services/vendor-management"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const createQualificationSchema = (editing: boolean) =>
  z
    .object({
      code: editing
        ? z.string()
        : z
            .string()
            .trim()
            .min(2, "资质编码至少 2 个字符")
            .max(64, "资质编码不能超过 64 个字符")
            .regex(CODE_PATTERN, "以字母开头，仅含字母、数字及 _ . : -"),
      name: z
        .string()
        .trim()
        .min(2, "资质名称至少 2 个字符")
        .max(128, "资质名称不能超过 128 个字符"),
      kind: z.enum(["oem_authorization", "media_destruction"]),
      manufacturerId: z.string(),
      certType: z.string().trim().min(1, "资质/认证类型不能为空").max(64, "认证类型不能超过 64 个字符"),
      certNo: z.string().trim().min(1, "证书/授权编号不能为空").max(128, "证书编号不能超过 128 个字符"),
      level: z.string().trim().max(64, "授权等级不能超过 64 个字符"),
      validFrom: z
        .string()
        .trim()
        .regex(DATE_PATTERN, "生效起始日期必须为 YYYY-MM-DD 格式"),
      validUntil: z
        .string()
        .trim()
        .regex(DATE_PATTERN, "截止日期必须为 YYYY-MM-DD 格式"),
      evidenceRef: z.string().trim().min(1, "证明材料文件编号/归档编号不能为空").max(256, "证明材料引用不能超过 256 个字符"),
    })
    .refine(
      (data) => {
        if (data.kind === "oem_authorization") {
          return Boolean(data.manufacturerId)
        }
        return true
      },
      {
        message: "原厂授权资质必须指定授权厂商",
        path: ["manufacturerId"],
      },
    )
    .refine(
      (data) => {
        if (DATE_PATTERN.test(data.validFrom) && DATE_PATTERN.test(data.validUntil)) {
          return data.validUntil >= data.validFrom
        }
        return true
      },
      {
        message: "截止日期不能早于生效起始日期",
        path: ["validUntil"],
      },
    )

type QualificationFormValues = {
  code: string
  name: string
  kind: QualificationKind
  manufacturerId: string
  certType: string
  certNo: string
  level: string
  validFrom: string
  validUntil: string
  evidenceRef: string
}

export function QualificationFormDialog({
  open,
  vendorId,
  qualification,
  onOpenChange,
}: {
  open: boolean
  vendorId: string
  qualification?: VendorQualificationDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = Boolean(qualification)

  const qualificationSchema = useMemo(() => createQualificationSchema(editing), [editing])
  const defaultValues = useMemo<QualificationFormValues>(
    () => ({
      code: qualification?.code ?? "",
      name: qualification?.name ?? "",
      kind: qualification?.kind ?? "oem_authorization",
      manufacturerId: qualification?.manufacturer_id ?? "",
      certType: qualification?.certificate_type ?? "",
      certNo: qualification?.certificate_no ?? "",
      level: qualification?.level ?? "",
      validFrom: qualification?.valid_from ?? "",
      validUntil: qualification?.valid_until ?? "",
      evidenceRef: qualification?.evidence_ref ?? "",
    }),
    [qualification],
  )

  const { data: mfrData } = useQuery({
    queryKey: ["manufacturers", "all"],
    queryFn: ({ signal }) => manufacturersService.list({ page_size: 100 }, signal),
    enabled: open,
  })

  const mutation = useMutation({
    mutationFn: (values: QualificationFormValues) => {
      const payload: Partial<VendorQualificationDTO> = {
        vendor_id: vendorId,
        name: values.name.trim(),
        kind: values.kind,
        manufacturer_id: values.kind === "oem_authorization" ? values.manufacturerId : undefined,
        certificate_type: values.certType.trim(),
        certificate_no: values.certNo.trim(),
        level: values.level.trim() || undefined,
        valid_from: values.validFrom,
        valid_until: values.validUntil,
        evidence_ref: values.evidenceRef.trim(),
      }
      if (editing && qualification) {
        return qualificationsService.update(qualification, payload)
      }
      return qualificationsService.create({
        ...payload,
        code: values.code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "资质证书已更新" : "资质证书已录入",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["qualifications"] })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<QualificationFormValues>({
    defaultValues,
    resetKey: qualification?.id ?? `create:${vendorId}`,
    schema: qualificationSchema,
    serverFieldNames: {
      manufacturer_id: "manufacturerId",
      certificate_type: "certType",
      certificate_no: "certNo",
      valid_from: "validFrom",
      valid_until: "validUntil",
      evidence_ref: "evidenceRef",
    },
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新资质失败" : "录入资质失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "资质信息尚未保存，关闭后这些更改将丢失。")

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

  const manufacturers = mfrData?.data.items ?? []

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
            <FileBadge className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑资质与认证" : "录入供应商资质认证"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            原厂维保/代理授权函及国家涉密介质销毁专项资质档案
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
                <FormField field={field} label="资质编码" required={!editing} idPrefix="qual">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: qual-h3c-gold"
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
                <FormField field={field} label="资质证书名称" required idPrefix="qual">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 新华三金牌维保服务商授权"
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
            <form.Field name="kind">
              {(field) => (
                <FormField field={field} label="资质类别" required idPrefix="qual">
                  {(props) => (
                    <NativeSelect
                      {...props}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value as QualificationKind)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs"
                    >
                      <NativeSelectOption value="oem_authorization">
                        原厂维保/代理授权 (OEM)
                      </NativeSelectOption>
                      <NativeSelectOption value="media_destruction">
                        介质/数据销毁专项资质
                      </NativeSelectOption>
                    </NativeSelect>
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Subscribe selector={(state) => [state.values.kind]}>
              {([currentKind]) =>
                currentKind === "oem_authorization" ? (
                  <form.Field name="manufacturerId">
                    {(field) => (
                      <FormField field={field} label="授权厂商" required idPrefix="qual">
                        {(props) => (
                          <NativeSelect
                            {...props}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                            disabled={mutation.isPending}
                            className="h-8 text-xs"
                          >
                            <NativeSelectOption value="">
                              -- 请选择授权厂商 --
                            </NativeSelectOption>
                            {manufacturers.map((m) => (
                              <NativeSelectOption key={m.id} value={m.id}>
                                {m.name} ({m.code})
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                      </FormField>
                    )}
                  </form.Field>
                ) : (
                  <div className="flex items-center text-xs text-muted-foreground pt-4">
                    通用认证无需绑定具体厂商
                  </div>
                )
              }
            </form.Subscribe>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <form.Field name="certType">
              {(field) => (
                <FormField field={field} label="资质/认证类型" required idPrefix="qual">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: ISO9001 / 五星级服务商"
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

            <form.Field name="certNo">
              {(field) => (
                <FormField field={field} label="证书 / 授权编号" required idPrefix="qual">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: CN-2026-H3C-09821"
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

          <FieldGroup className="grid grid-cols-3 gap-3">
            <form.Field name="level">
              {(field) => (
                <FormField field={field} label="授权等级" idPrefix="qual">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 金牌 / 一级"
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

            <form.Field name="validFrom">
              {(field) => (
                <FormField field={field} label="生效起始日" required idPrefix="qual">
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
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

            <form.Field name="validUntil">
              {(field) => (
                <FormField field={field} label="有效期截止" required idPrefix="qual">
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
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

          <form.Field name="evidenceRef">
            {(field) => (
              <FormField field={field} label="证明材料凭证 / 归档编号" required idPrefix="qual">
                {(props) => (
                  <Input
                    {...props}
                    placeholder="如: DOC-ARCHIVE-2026-0819"
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
                    "录入资质"
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