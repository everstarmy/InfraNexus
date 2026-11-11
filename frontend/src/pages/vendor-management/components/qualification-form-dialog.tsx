import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileBadge } from "lucide-react"
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import {
  qualificationsService,
  manufacturersService,
  type VendorQualificationDTO,
  type QualificationKind,
} from "@/services/vendor-management"

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
  const editing = Boolean(qualification)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [kind, setKind] = useState<QualificationKind>("oem_authorization")
  const [manufacturerId, setManufacturerId] = useState("")
  const [certType, setCertType] = useState("")
  const [certNo, setCertNo] = useState("")
  const [level, setLevel] = useState("")
  const [validFrom, setValidFrom] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [evidenceRef, setEvidenceRef] = useState("")
  const [error, setError] = useState("")

  const { data: mfrData } = useQuery({
    queryKey: ["manufacturers", "all"],
    queryFn: ({ signal }) => manufacturersService.list({ page_size: 100 }, signal),
    enabled: open && kind === "oem_authorization",
  })

  useEffect(() => {
    if (!open) return
    setCode(qualification?.code ?? "")
    setName(qualification?.name ?? "")
    setKind(qualification?.kind ?? "oem_authorization")
    setManufacturerId(qualification?.manufacturer_id ?? "")
    setCertType(qualification?.certificate_type ?? "")
    setCertNo(qualification?.certificate_no ?? "")
    setLevel(qualification?.level ?? "")
    setValidFrom(qualification?.valid_from ?? "")
    setValidUntil(qualification?.valid_until ?? "")
    setEvidenceRef(qualification?.evidence_ref ?? "")
    setError("")
  }, [open, qualification])

  const canSubmit =
    name.trim().length >= 2 &&
    certType.trim().length >= 1 &&
    certNo.trim().length >= 1 &&
    validFrom.length === 10 &&
    validUntil.length === 10 &&
    evidenceRef.trim().length >= 1 &&
    (kind === "media_destruction" || Boolean(manufacturerId)) &&
    (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<VendorQualificationDTO> = {
        vendor_id: vendorId,
        name: name.trim(),
        kind,
        manufacturer_id: kind === "oem_authorization" ? manufacturerId : undefined,
        certificate_type: certType.trim(),
        certificate_no: certNo.trim(),
        level: level.trim() || undefined,
        valid_from: validFrom,
        valid_until: validUntil,
        evidence_ref: evidenceRef.trim(),
      }
      if (editing && qualification) {
        return qualificationsService.update(qualification, payload)
      }
      return qualificationsService.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "供应商资质已更新" : "供应商资质已登记",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["qualifications"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(
        getErrorMessage(err, editing ? "更新资质失败" : "添加资质失败")
      ),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileBadge className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑供应商资质" : "登记供应商资质"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            原厂授权函或数据介质销毁保密资质，含有效期与证明材料归档
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
              <FieldLabel className="text-xs">资质标识 (Code) *</FieldLabel>
              <Input
                placeholder="如: qual-hwh-csp"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">资质名称 *</FieldLabel>
              <Input
                placeholder="如: 华为金牌CSP认证"
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
              <FieldLabel className="text-xs">资质大类 *</FieldLabel>
              <NativeSelect
                value={kind}
                onChange={(e) => setKind(e.target.value as QualificationKind)}
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
            </Field>

            {kind === "oem_authorization" && (
              <Field>
                <FieldLabel className="text-xs">授权制造商 *</FieldLabel>
                <NativeSelect
                  value={manufacturerId}
                  onChange={(e) => setManufacturerId(e.target.value)}
                  disabled={mutation.isPending}
                  className="h-8 text-xs"
                  required
                >
                  <NativeSelectOption value="">请选择制造商</NativeSelectOption>
                  {mfrData?.data.items.map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">证书类型描述 *</FieldLabel>
              <Input
                placeholder="如: 授权服务商证书"
                value={certType}
                onChange={(e) => setCertType(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">证书/授权编号 *</FieldLabel>
              <Input
                placeholder="如: HW-2026-CSP-092"
                value={certNo}
                onChange={(e) => setCertNo(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel className="text-xs">资质等级</FieldLabel>
              <Input
                placeholder="如: 钻石级 / 五星"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">生效起始日 *</FieldLabel>
              <Input
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">到期截止日 *</FieldLabel>
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel className="text-xs">佐证材料与附件引用 *</FieldLabel>
            <Input
              placeholder="如: archive://licenses/hw-csp-2026.pdf"
              value={evidenceRef}
              onChange={(e) => setEvidenceRef(e.target.value)}
              disabled={mutation.isPending}
              className="h-8 text-xs font-mono"
              required
            />
          </Field>

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
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存" : "确定登记"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
