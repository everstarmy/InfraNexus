import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Building2,
  ExternalLink,
  History,
  Link2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  UserRound,
} from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/common/confirm-dialog"
import { QueryErrorState } from "@/components/common/query-error-state"
import { FormField, useAppForm } from "@/components/form"
import { ManagedHistorySheet } from "@/components/managed/managed-history-sheet"
import { ManagedReferencesDialog } from "@/components/managed/managed-references-dialog"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query-keys"
import {
  companyContactsService,
  type CompanyContactDTO,
  type CompanyDTO,
} from "@/services/vendor-management"
import { useAuth } from "@/stores/auth-context"
import {
  CompanyTypeBadges,
  toSafeExternalUrl,
} from "./company-meta"

interface ContactFormValues {
  name: string
  title: string
  phone: string
  email: string
  description: string
}

const createContactSchema = () =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, "请输入联系人姓名")
      .max(128, "姓名不能超过 128 个字符"),
    title: z.string().trim().max(128, "职务不能超过 128 个字符"),
    phone: z.string().trim().max(64, "电话不能超过 64 个字符"),
    email: z
      .string()
      .trim()
      .max(128, "邮箱不能超过 128 个字符")
      .refine((val) => !val || z.email().safeParse(val).success, "请输入合法的邮箱地址"),
    description: z.string().max(1024, "备注不能超过 1024 个字符"),
  })

function CompanyContactFormDialog({
  open,
  companyId,
  contact,
  onOpenChange,
}: {
  open: boolean
  companyId: string
  contact: CompanyContactDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const editing = Boolean(contact)
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const defaultValues = useMemo<ContactFormValues>(
    () =>
      contact
        ? {
            name: contact.name,
            title: contact.title ?? "",
            phone: contact.phone ?? "",
            email: contact.email ?? "",
            description: contact.description ?? "",
          }
        : {
            name: "",
            title: "",
            phone: "",
            email: "",
            description: "",
          },
    [contact],
  )

  const schema = useMemo(() => createContactSchema(), [])

  const mutation = useMutation({
    mutationFn: async (values: ContactFormValues) => {
      const payload: Partial<CompanyContactDTO> = {
        company_id: companyId,
        name: values.name.trim(),
        title: values.title.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        description: values.description.trim(),
      }
      if (editing && contact) {
        return companyContactsService.update(contact, payload)
      }
      return companyContactsService.create({
        ...payload,
      })
    },
    onSuccess: (res) => {
      notify.success(editing ? "联系人已更新" : "联系人已创建", res.data.name)
      void queryClient.invalidateQueries({ queryKey: queryKeys.companyContactsAll })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<ContactFormValues>({
    defaultValues,
    resetKey: contact?.id ?? "new",
    schema,
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新联系人失败" : "创建联系人失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "联系人信息尚未保存，关闭后未保存的更改将丢失。")

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
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <UserRound className="size-4 text-primary" />
            {editing ? "编辑联系人" : "新建联系人"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            维护该厂商对接人职务与联系方式
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
          className="space-y-4 pt-1"
        >
          <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">

            <form.Field name="name">
              {(field) => (
                <FormField field={field} label="姓名" required idPrefix="company-contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 张三"
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

            <form.Field name="title">
              {(field) => (
                <FormField field={field} label="职务" idPrefix="company-contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 客户经理 / 售后工程师"
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

            <form.Field name="phone">
              {(field) => (
                <FormField field={field} label="联系电话" idPrefix="company-contact">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 13800138000"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      maxLength={64}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="email">
              {(field) => (
                <FormField
                  field={field}
                  label="电子邮箱"
                  idPrefix="company-contact"
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="email"
                      placeholder="name@company.com"
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

            <form.Field name="description">
              {(field) => (
                <FormField
                  field={field}
                  label="备注"
                  idPrefix="company-contact"
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <Textarea
                      {...props}
                      rows={2}
                      placeholder="如：工作日 9:00-18:00 联系（选填）"
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

          <DialogFooter>
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
              {mutation.isPending ? "保存中…" : editing ? "保存修改" : "确认创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CompanyContactsSheet({
  company,
  onOpenChange,
}: {
  company: CompanyDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const confirm = useConfirm()

  const canReadContacts = can("vendor-management:company-contacts:read")
  const canCreateContacts = can("vendor-management:company-contacts:create")
  const canEditContacts = can("vendor-management:company-contacts:update")
  const canToggleContacts = can("vendor-management:company-contacts:status")
  const canDeleteContacts = can("vendor-management:company-contacts:delete")
  const canHistoryContacts = can("vendor-management:company-contacts:history")

  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [formTarget, setFormTarget] = useState<CompanyContactDTO | "new" | null>(null)
  const [historyTarget, setHistoryTarget] = useState<CompanyContactDTO | null>(null)
  const [referenceTarget, setReferenceTarget] = useState<CompanyContactDTO | null>(null)

  const term = useDebouncedValue(search.trim(), 250)
  const params = useMemo(
    () => ({ parent_id: company?.id, search: term || undefined, page, page_size: 20 }),
    [company?.id, term, page],
  )

  const query = useQuery({
    queryKey: company
      ? queryKeys.companyContacts(company.id, params)
      : ["company-contacts", "idle"],
    queryFn: ({ signal }) => companyContactsService.list(params, signal),
    enabled: Boolean(company) && canReadContacts,
  })

  const mutation = useMutation({
    mutationFn: async ({
      record,
      status,
    }: {
      record: CompanyContactDTO
      status?: number
    }) => {
      if (status === undefined) {
        await companyContactsService.remove(record.id, record.version)
      } else {
        await companyContactsService.setStatus(record.id, record.version, status)
      }
    },
    onSuccess: () => {
      notify.success("操作成功")
      void queryClient.invalidateQueries({ queryKey: queryKeys.companyContactsAll })
    },
    onError: (err) => notify.error("操作失败", getErrorMessage(err)),
  })

  const handleDelete = async (record: CompanyContactDTO) => {
    const ok = await confirm({
      title: `删除联系人「${record.name}」？`,
      description: "存在引用的记录将无法删除。",
      tone: "destructive",
      confirmText: "删除",
    })
    if (ok) {
      mutation.mutate({ record })
    }
  }

  const items = query.data?.data.items ?? []
  const total = query.data?.data.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / 20))
  const safeWebsite = toSafeExternalUrl(company?.website)

  return (
    <>
      <Sheet open={Boolean(company)} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <SheetHeader className="border-b border-border/60 px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pr-6">
              <div className="min-w-0 space-y-1">
                <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Building2 className="size-4 text-primary" />
                  <span className="truncate">{company?.name}</span>
                  {company && <CompanyTypeBadges type={company.type} />}
                </SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {company?.short_name && <span>简称：{company.short_name}</span>}
                  {company?.english_name && <span>{company.english_name}</span>}
                </SheetDescription>
              </div>
            </div>

            {company && (company.credit_code || safeWebsite || company.description) && (
              <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs sm:grid-cols-2">
                {company.credit_code && (
                  <div className="min-w-0">
                    <span className="text-muted-foreground">统一社会信用代码：</span>
                    <span className="font-mono text-foreground">{company.credit_code}</span>
                  </div>
                )}
                {safeWebsite && (
                  <div className="min-w-0 truncate">
                    <span className="text-muted-foreground">官网：</span>
                    <a
                      href={safeWebsite}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <span className="truncate">{safeWebsite}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </a>
                  </div>
                )}
                {company.description && (
                  <p className="text-muted-foreground sm:col-span-2">{company.description}</p>
                )}
              </div>
            )}
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground">厂商联系人</h3>
                {canReadContacts && (
                  <Badge variant="secondary" className="font-mono">
                    {total}
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canReadContacts && (
                  <div className="relative w-48 sm:w-56">
                    <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value)
                        setPage(1)
                      }}
                      placeholder="搜索姓名…"
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                )}
                {canCreateContacts && (
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 text-xs"
                    onClick={() => setFormTarget("new")}
                  >
                    <Plus className="size-3.5" />
                    新建联系人
                  </Button>
                )}
              </div>
            </div>

            {!canReadContacts ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                当前账号没有查看厂商联系人的权限
              </div>
            ) : query.error ? (
              <QueryErrorState
                error={query.error}
                label="厂商联系人"
                onRetry={() => void query.refetch()}
                retrying={query.isFetching}
              />
            ) : query.isLoading ? (
              <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
                <Spinner className="mr-2" />
                正在加载联系人…
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <UserRound className="mx-auto mb-2 size-7 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">
                  {term ? "没有匹配的联系人" : "暂无联系人"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {term
                    ? "请尝试更换关键词重新搜索"
                    : "点击右上角「新建联系人」添加商务或售后对接人"}
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2.5 rounded-lg border border-border/80 bg-card p-3.5 transition-colors hover:border-border sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm text-foreground">{item.name}</span>
                        {item.title && (
                          <Badge variant="outline" className="text-[11px] font-normal">
                            {item.title}
                          </Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {item.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="size-3" />
                            {item.phone}
                          </span>
                        )}
                        {item.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="size-3" />
                            {item.email}
                          </span>
                        )}
                      </div>

                      {item.description && (
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                      <Switch
                        checked={item.status === 1}
                        disabled={!canToggleContacts || mutation.isPending}
                        aria-label={`启停联系人 ${item.name}`}
                        onCheckedChange={(checked) =>
                          mutation.mutate({ record: item, status: checked ? 1 : 2 })
                        }
                      />
                      {canEditContacts && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="编辑联系人"
                          aria-label={`编辑联系人 ${item.name}`}
                          onClick={() => setFormTarget(item)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="查看引用"
                        aria-label={`查看联系人 ${item.name} 引用`}
                        onClick={() => setReferenceTarget(item)}
                      >
                        <Link2 className="size-3.5" />
                      </Button>
                      {canHistoryContacts && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="变更历史"
                          aria-label={`查看联系人 ${item.name} 历史`}
                          onClick={() => setHistoryTarget(item)}
                        >
                          <History className="size-3.5" />
                        </Button>
                      )}
                      {canDeleteContacts && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-destructive hover:text-destructive"
                          title="删除联系人"
                          aria-label={`删除联系人 ${item.name}`}
                          disabled={mutation.isPending}
                          onClick={() => void handleDelete(item)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {pageCount > 1 && (
                  <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs text-muted-foreground">
                    <span>
                      第 {page} / {pageCount} 页（共 {total} 人）
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        上一页
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={page >= pageCount}
                        onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                      >
                        下一页
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {company && formTarget !== null && (
        <CompanyContactFormDialog
          open
          companyId={company.id}
          contact={formTarget === "new" ? null : formTarget}
          onOpenChange={(open) => !open && setFormTarget(null)}
        />
      )}

      {historyTarget && (
        <ManagedHistorySheet
          open
          resourceTitle="厂商联系人"
          recordName={historyTarget.name}
          recordId={historyTarget.id}
          fetchHistory={companyContactsService.history}
          onOpenChange={(open) => !open && setHistoryTarget(null)}
        />
      )}

      {referenceTarget && (
        <ManagedReferencesDialog
          open
          resourceTitle="厂商联系人"
          recordName={referenceTarget.name}
          recordId={referenceTarget.id}
          fetchReferences={companyContactsService.references}
          onOpenChange={(open) => !open && setReferenceTarget(null)}
        />
      )}
    </>
  )
}
