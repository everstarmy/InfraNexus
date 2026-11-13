import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import {
  companiesService,
  type CompanyDTO,
  type CompanyType,
} from "@/services/vendor-management"
import {
  COMPANY_BOTH,
  COMPANY_MANUFACTURER,
  COMPANY_ROLE_OPTIONS,
  isValidHttpUrl,
  normalizeCreditCode,
  toggleCompanyTypeBit,
  validateCreditCode,
} from "./company-meta"

interface CompanyFormValues {
  type: number
  name: string
  short_name: string
  english_name: string
  credit_code: string
  website: string
  description: string
}

const createCompanySchema = () =>
  z.object({
    type: z
      .number()
      .int()
      .refine(
        (val) => val >= COMPANY_MANUFACTURER && val <= COMPANY_BOTH,
        "请至少选择一种厂商类型",
      ),
    name: z
      .string()
      .trim()
      .min(1, "请输入厂商名称")
      .max(128, "厂商名称不能超过 128 个字符"),
    short_name: z.string().trim().max(128, "简称不能超过 128 个字符"),
    english_name: z.string().trim().max(128, "英文名称不能超过 128 个字符"),
    credit_code: z.string().superRefine((val, ctx) => {
      const error = validateCreditCode(val)
      if (error) {
        ctx.addIssue({ code: "custom", message: error })
      }
    }),
    website: z
      .string()
      .trim()
      .max(512, "官网地址不能超过 512 个字符")
      .refine(isValidHttpUrl, "官网须以 http:// 或 https:// 开头"),
    description: z.string().max(1024, "备注说明不能超过 1024 个字符"),
  })

export function CompanyFormDialog({
  open,
  company,
  onOpenChange,
}: {
  open: boolean
  company: CompanyDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const editing = Boolean(company)
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const defaultValues = useMemo<CompanyFormValues>(
    () =>
      company
        ? {
            type: company.type,
            name: company.name,
            short_name: company.short_name ?? "",
            english_name: company.english_name ?? "",
            credit_code: company.credit_code ?? "",
            website: company.website ?? "",
            description: company.description ?? "",
          }
        : {
            type: 0,
            name: "",
            short_name: "",
            english_name: "",
            credit_code: "",
            website: "",
            description: "",
          },
    [company],
  )

  const schema = useMemo(() => createCompanySchema(), [])

  const mutation = useMutation({
    mutationFn: async (values: CompanyFormValues) => {
      const payload: Partial<CompanyDTO> = {
        type: values.type as CompanyType,
        name: values.name.trim(),
        short_name: values.short_name.trim(),
        english_name: values.english_name.trim(),
        credit_code: normalizeCreditCode(values.credit_code),
        website: values.website.trim(),
        description: values.description.trim(),
      }
      if (editing && company) {
        return companiesService.update(company, payload)
      }
      return companiesService.create({
        ...payload,
      })
    },
    onSuccess: (res) => {
      notify.success(editing ? "厂商档案已更新" : "厂商档案已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: queryKeys.companiesAll })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<CompanyFormValues>({
    defaultValues,
    resetKey: company?.id ?? "new",
    schema,
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新厂商档案失败" : "创建厂商档案失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "厂商档案尚未保存，关闭后未保存的更改将丢失。")

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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="border-b border-border/60 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Building2 className="size-4.5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold">
                {editing ? "编辑厂商档案" : "新建厂商档案"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                统一维护制造商与供应商信息，同一厂商可同时勾选两种类型
              </DialogDescription>
            </div>
          </div>
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
          className="space-y-4 pt-1"
        >
          {/* 类型选择：通栏 Checkbox 卡片组 */}
          <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5">
            <form.Field name="type">
              {(field) => (
                <FormField
                  field={field}
                  label="厂商类型"
                  description="可单选或多选；同时勾选表示兼具原厂制造与供货/维保身份"
                  required
                  idPrefix="company"
                >
                  {(props) => (
                    <div
                      role="group"
                      aria-label="厂商类型"
                      className="grid grid-cols-1 gap-2.5 pt-0.5 sm:grid-cols-2"
                    >
                      {COMPANY_ROLE_OPTIONS.map((role, index) => {
                        const checked = (field.state.value & role.bit) !== 0
                        const Icon = role.icon
                        const controlId = index === 0 ? props.id : `${props.id}-${role.key}`
                        return (
                          <div
                            key={role.key}
                            onClick={(e) => {
                              if (mutation.isPending) return
                              if (
                                (e.target as HTMLElement).closest(
                                  '[role="checkbox"], input[type="checkbox"]',
                                )
                              ) {
                                return
                              }
                              field.handleChange((prev) =>
                                toggleCompanyTypeBit(prev, role.bit, !checked),
                              )
                              field.handleBlur()
                            }}
                            className={cn(
                              "flex cursor-pointer items-start gap-3 rounded-lg border bg-background p-3 transition-colors",
                              checked
                                ? "border-primary/60 bg-primary/5 shadow-2xs"
                                : "border-border/80 hover:border-border hover:bg-muted/30",
                              mutation.isPending && "cursor-not-allowed opacity-60",
                            )}
                          >
                            <Checkbox
                              id={controlId}
                              checked={checked}
                              aria-invalid={props["aria-invalid"]}
                              aria-describedby={props["aria-describedby"]}
                              disabled={mutation.isPending}
                              className="mt-0.5"
                              onCheckedChange={(next) => {
                                field.handleChange((prev) =>
                                  toggleCompanyTypeBit(prev, role.bit, next === true),
                                )
                                field.handleBlur()
                              }}
                            />
                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                                <Icon className="size-3.5 text-primary" />
                                <span>{role.label}</span>
                              </div>
                              <p className="text-xs leading-relaxed text-muted-foreground">
                                {role.description}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </FormField>
              )}
            </form.Field>
          </div>

          {/* 基础标识：大屏两列 */}
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">

            <form.Field name="name">
              {(field) => (
                <FormField field={field} label="厂商名称" required idPrefix="company">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 华为技术有限公司"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      maxLength={128}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="short_name">
              {(field) => (
                <FormField field={field} label="简称" idPrefix="company">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 华为"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      maxLength={128}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="english_name">
              {(field) => (
                <FormField field={field} label="英文名称" idPrefix="company">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: Huawei Technologies"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      maxLength={128}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="credit_code">
              {(field) => (
                <FormField
                  field={field}
                  label="统一社会信用代码"
                  description="18 位工商信用代码，支持小写输入并校验校验位"
                  idPrefix="company"
                >
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 914403001922038216"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      maxLength={18}
                      className="font-mono uppercase"
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="website">
              {(field) => (
                <FormField
                  field={field}
                  label="官方网站"
                  description="需以 http:// 或 https:// 开头"
                  idPrefix="company"
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="url"
                      placeholder="https://www.example.com"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      maxLength={512}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <FormField
                  field={field}
                  label="备注说明"
                  idPrefix="company"
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <Textarea
                      {...props}
                      rows={3}
                      placeholder="补充主营设备线、合作范围或服务备注（选填）"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      maxLength={1024}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <DialogFooter className="border-t border-border/60 pt-3">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => void requestClose()}
            >
              取消
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Spinner />}
              {mutation.isPending
                ? editing
                  ? "保存中…"
                  : "创建中…"
                : editing
                  ? "保存修改"
                  : "创建厂商"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
