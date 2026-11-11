import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { UserCheck } from "lucide-react"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Checkbox } from "@/components/ui/checkbox"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import {
  contactsService,
  type OrganizationContactDTO,
  type ContactRole,
} from "@/services/vendor-management"

const ROLE_OPTIONS: { id: ContactRole; label: string }[] = [
  { id: "account_manager", label: "客户经理 (主联系人)" },
  { id: "resident_engineer", label: "常驻驻场工程师" },
  { id: "onsite_engineer", label: "现场实施/巡检工程师" },
  { id: "escalation_lead", label: "重大故障升级负责人" },
  { id: "commercial_contact", label: "商务与采购联系人" },
]

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
  const editing = Boolean(contact)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [roles, setRoles] = useState<ContactRole[]>(["account_manager"])
  const [idDocType, setIdDocType] = useState("")
  const [maskedId, setMaskedId] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(contact?.code ?? "")
    setName(contact?.name ?? "")
    setTitle(contact?.title ?? "")
    setPhone(contact?.phone ?? "")
    setEmail(contact?.email ?? "")
    setRoles(contact?.roles ?? ["account_manager"])
    setIdDocType(contact?.id_document_type ?? "")
    setMaskedId(contact?.masked_id ?? "")
    setError("")
  }, [open, contact])

  const toggleRole = (r: ContactRole) => {
    setRoles((curr) =>
      curr.includes(r) ? curr.filter((x) => x !== r) : [...curr, r]
    )
  }

  const canSubmit =
    name.trim().length >= 2 &&
    roles.length > 0 &&
    (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<OrganizationContactDTO> = {
        name: name.trim(),
        title: title.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        roles,
        id_document_type: idDocType.trim() || undefined,
        masked_id: maskedId.trim() || undefined,
        vendor_id: ownerType === "vendor" ? ownerId : undefined,
        manufacturer_id: ownerType === "manufacturer" ? ownerId : undefined,
      }
      if (editing && contact) {
        return contactsService.update(contact, payload)
      }
      return contactsService.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(editing ? "联系人已更新" : "联系人已添加", res.data.name)
      void queryClient.invalidateQueries({ queryKey: ["contacts"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(
        getErrorMessage(err, editing ? "更新联系人失败" : "添加联系人失败")
      ),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <UserCheck className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑联系人" : "添加联系人"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            录入原厂或供应商的业务接口人、技术支持工程师及准入凭证
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive" className="py-2 text-xs">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
          className="space-y-3 py-2"
        >
          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">联系人标识 (Code) *</FieldLabel>
              <Input
                placeholder="如: c-zhangsan"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">姓名 *</FieldLabel>
              <Input
                placeholder="如: 张三"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
                required
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">职务/头衔</FieldLabel>
              <Input
                placeholder="如: 华北区资深售后专家"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">联系电话</FieldLabel>
              <Input
                placeholder="138xxxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel className="text-xs">电子邮箱</FieldLabel>
            <Input
              type="email"
              placeholder="engineer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={mutation.isPending}
              className="h-8 text-xs"
            />
          </Field>

          <Field>
            <FieldLabel className="text-xs">担任职责 (可多选) *</FieldLabel>
            <div className="flex flex-col gap-2 pt-1">
              {ROLE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-center gap-2 text-xs text-foreground cursor-pointer"
                >
                  <Checkbox
                    checked={roles.includes(opt.id)}
                    onCheckedChange={() => toggleRole(opt.id)}
                    disabled={mutation.isPending}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </Field>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">证件类型</FieldLabel>
              <Input
                placeholder="如: 身份证 / 护照"
                value={idDocType}
                onChange={(e) => setIdDocType(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>
            <Field>
              <FieldLabel className="text-xs">脱敏证件号</FieldLabel>
              <Input
                placeholder="如: 110101****1234"
                value={maskedId}
                onChange={(e) => setMaskedId(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
              />
            </Field>
          </FieldGroup>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存" : "确定添加"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
