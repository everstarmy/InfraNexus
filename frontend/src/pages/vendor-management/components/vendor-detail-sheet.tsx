import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Building2,
  Users,
  FileBadge,
  Phone,
  Mail,
  Clock,
  Plus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/stores/auth-context"
import { QueryErrorState } from "@/components/common/query-error-state"
import { Spinner } from "@/components/ui/spinner"
import {
  contactsService,
  qualificationsService,
  type VendorDTO,
  type OrganizationContactDTO,
  type VendorQualificationDTO,
} from "@/services/vendor-management"
import { ContactFormDialog } from "./contact-form-dialog"
import { QualificationFormDialog } from "./qualification-form-dialog"

const roleMap: Record<string, string> = {
  account_manager: "客户经理",
  resident_engineer: "常驻工程师",
  onsite_engineer: "现场实施",
  escalation_lead: "故障升级负责人",
  commercial_contact: "商务联系人",
}

export function VendorDetailSheet({
  open,
  vendor,
  onOpenChange,
}: {
  open: boolean
  vendor?: VendorDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const { can } = useAuth()
  const canReadContacts = can("vendor-management:contacts:read")
  const canReadQualifications = can("vendor-management:qualifications:read")
  const canCreateContact = can("vendor-management:contacts:create")
  const canCreateQualification = can("vendor-management:qualifications:create")
  const [contactPage, setContactPage] = useState(1)
  const [qualificationPage, setQualificationPage] = useState(1)
  const [activeTab, setActiveTab] = useState("contacts")
  const [contactModal, setContactModal] = useState<OrganizationContactDTO | "new" | null>(null)
  const [qualModal, setQualModal] = useState<VendorQualificationDTO | "new" | null>(null)

  const contactsQuery = useQuery({
    queryKey: ["contacts", vendor?.id, contactPage],
    queryFn: ({ signal }) =>
      contactsService.list({ parent_id: vendor!.id, page: contactPage, page_size: 20 }, signal),
    enabled: open && Boolean(vendor?.id) && canReadContacts,
  })

  const qualificationsQuery = useQuery({
    queryKey: ["qualifications", vendor?.id, qualificationPage],
    queryFn: ({ signal }) =>
      qualificationsService.list({ parent_id: vendor!.id, page: qualificationPage, page_size: 20 }, signal),
    enabled: open && Boolean(vendor?.id) && canReadQualifications,
  })

  if (!vendor) return null

  const contacts = contactsQuery.data?.data.items ?? []
  const contactTotal = contactsQuery.data?.data.total ?? 0
  const qualifications = qualificationsQuery.data?.data.items ?? []
  const qualificationTotal = qualificationsQuery.data?.data.total ?? 0
  const today = new Date().toISOString().slice(0, 10)

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex flex-col gap-0 sm:max-w-xl p-0">
          <SheetHeader className="border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="size-5 text-primary" />
                <SheetTitle className="text-base font-semibold">{vendor.name}</SheetTitle>
              </div>
              <Badge
                variant="outline"
                className={
                  vendor.cooperation_status === "active"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : vendor.cooperation_status === "suspended"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                }
              >
                {vendor.cooperation_status === "active"
                  ? "合作中"
                  : vendor.cooperation_status === "suspended"
                  ? "已暂停"
                  : "已终止"}
              </Badge>
            </div>
            <SheetDescription className="text-xs font-mono">
              编码: {vendor.code} | 信用代码: {vendor.credit_code}
            </SheetDescription>
          </SheetHeader>

          {/* SLA & Service summary bar */}
          <div className="grid grid-cols-3 divide-x border-b bg-muted/20 text-center py-2.5 text-xs">
            <div>
              <span className="text-muted-foreground block text-[10px]">紧急响应</span>
              <span className="font-semibold">{vendor.emergency_response_minutes ?? "—"} 分钟</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px]">备件到达</span>
              <span className="font-semibold">{vendor.parts_response_minutes ?? "—"} 分钟</span>
            </div>
            <div>
              <span className="text-muted-foreground block text-[10px]">工程师到场</span>
              <span className="font-semibold">{vendor.engineer_response_minutes ?? "—"} 分钟</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="contacts" className="gap-1.5 text-xs">
                  <Users className="size-3.5" />
                  接口联系人 ({contactTotal})
                </TabsTrigger>
                <TabsTrigger value="qualifications" className="gap-1.5 text-xs">
                  <FileBadge className="size-3.5" />
                  资质与证书 ({qualificationTotal})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="contacts">
                <div className="flex items-center justify-between pb-3">
                  <h4 className="text-xs font-medium text-muted-foreground">
                    驻场工程师与业务接口团队
                  </h4>
                  {canCreateContact && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setContactModal("new")}
                  >
                    <Plus className="size-3" />
                    添加联系人
                  </Button>
                  )}
                </div>

                {!canReadContacts ? <p className="text-xs text-muted-foreground">没有查看联系人的权限</p> :
                  contactsQuery.error ? <QueryErrorState label="联系人" error={contactsQuery.error} onRetry={() => void contactsQuery.refetch()} /> :
                  contactsQuery.isLoading ? (
                  <div className="flex h-32 items-center justify-center">
                    <Spinner className="size-5 text-muted-foreground" />
                  </div>
                ) : contacts.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    暂无登记联系人
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {contacts.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border bg-card p-3 shadow-2xs space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{c.name}</span>
                            {c.title && (
                              <span className="text-muted-foreground text-[11px]">
                                ({c.title})
                              </span>
                            )}
                          </div>
                          {can("vendor-management:contacts:update") && (
                            <Button size="xs" variant="outline" onClick={() => setContactModal(c)}>编辑联系人</Button>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {c.roles.map((r) => (
                              <Badge key={r} variant="secondary" className="text-[10px] px-1.5 py-0">
                                {roleMap[r] ?? r}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-muted-foreground text-[11px] pt-1">
                          {c.phone && (
                            <span className="flex items-center gap-1 font-mono">
                              <Phone className="size-3 text-primary" />
                              {c.phone}
                            </span>
                          )}
                          {c.email && (
                            <span className="flex items-center gap-1">
                              <Mail className="size-3 text-primary" />
                              {c.email}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <DetailPagination page={contactPage} total={contactTotal} onChange={setContactPage} />
              </TabsContent>

              <TabsContent value="qualifications">
                <div className="flex items-center justify-between pb-3">
                  <h4 className="text-xs font-medium text-muted-foreground">
                    原厂授权函与数据介质保密销毁资质
                  </h4>
                  {canCreateQualification && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() => setQualModal("new")}
                  >
                    <Plus className="size-3" />
                    登记资质
                  </Button>
                  )}
                </div>

                {!canReadQualifications ? <p className="text-xs text-muted-foreground">没有查看资质的权限</p> :
                  qualificationsQuery.error ? <QueryErrorState label="资质" error={qualificationsQuery.error} onRetry={() => void qualificationsQuery.refetch()} /> :
                  qualificationsQuery.isLoading ? (
                  <div className="flex h-32 items-center justify-center">
                    <Spinner className="size-5 text-muted-foreground" />
                  </div>
                ) : qualifications.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                    暂无登记资质
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {qualifications.map((q) => {
                      const isExpired = q.valid_until < today
                      const daysLeft = Math.ceil(
                        (new Date(q.valid_until).getTime() - new Date().getTime()) /
                          (1000 * 60 * 60 * 24)
                      )
                      const isNearExpire = !isExpired && daysLeft <= 30

                      return (
                        <div
                          key={q.id}
                          className="rounded-lg border bg-card p-3 shadow-2xs space-y-2 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-foreground">{q.name}</span>
                            <Badge
                              variant="outline"
                              className={
                                isExpired
                                  ? "border-destructive/30 bg-destructive/10 text-destructive"
                                  : isNearExpire
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              }
                            >
                              {isExpired ? (
                                <span className="flex items-center gap-1">
                                  <XCircle className="size-3" />
                                  已过期
                                </span>
                              ) : isNearExpire ? (
                                <span className="flex items-center gap-1">
                                  <AlertTriangle className="size-3" />
                                  {daysLeft}天后到期
                                </span>
                              ) : (
                                <span className="flex items-center gap-1">
                                  <CheckCircle2 className="size-3" />
                                  有效
                                </span>
                              )}
                            </Badge>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-muted-foreground text-[11px] font-mono">
                            <div>证书编号: {q.certificate_no}</div>
                            <div>资质大类: {q.kind === "oem_authorization" ? "原厂授权" : "介质销毁"}</div>
                            <div>有效期始: {q.valid_from}</div>
                            <div>有效期止: {q.valid_until}</div>
                          </div>

                          {can("vendor-management:qualifications:update") && (
                            <Button size="xs" variant="outline" onClick={() => setQualModal(q)}>编辑资质</Button>
                          )}
                          {q.evidence_ref && (
                            <div className="rounded bg-muted/40 p-1.5 text-[10px] text-muted-foreground font-mono truncate">
                              证明附件: {q.evidence_ref}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                <DetailPagination page={qualificationPage} total={qualificationTotal} onChange={setQualificationPage} />
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>

      {contactModal && (
        <ContactFormDialog
          open={Boolean(contactModal)}
          ownerType="vendor"
          ownerId={vendor.id}
          contact={contactModal === "new" ? null : contactModal}
          onOpenChange={(op) => !op && setContactModal(null)}
        />
      )}

      {qualModal && (
        <QualificationFormDialog
          open={Boolean(qualModal)}
          vendorId={vendor.id}
          qualification={qualModal === "new" ? null : qualModal}
          onOpenChange={(op) => !op && setQualModal(null)}
        />
      )}
    </>
  )
}

function DetailPagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  if (page === 1 && total <= 20) return null
  return (
    <div className="mt-3 flex justify-between gap-2">
      <Button size="xs" variant="outline" disabled={page === 1} onClick={() => onChange(page - 1)}>上一页</Button>
      <Button size="xs" variant="outline" disabled={page * 20 >= total} onClick={() => onChange(page + 1)}>下一页</Button>
    </div>
  )
}
