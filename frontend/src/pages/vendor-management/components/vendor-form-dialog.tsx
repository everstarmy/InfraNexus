import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Building2 } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import {
  vendorsService,
  type VendorDTO,
  type VendorServiceType,
  type CooperationStatus,
} from "@/services/vendor-management"

const SERVICE_TYPE_OPTIONS: { id: VendorServiceType; label: string }[] = [
  { id: "hardware_supplier", label: "硬件供货商" },
  { id: "oem_service", label: "原厂维保服务" },
  { id: "third_party_maintenance", label: "第三方综合维保" },
  { id: "spare_parts", label: "备件备件库" },
  { id: "data_destruction", label: "介质数据销毁" },
]

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

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [shortName, setShortName] = useState("")
  const [creditCode, setCreditCode] = useState("")
  const [serviceTypes, setServiceTypes] = useState<VendorServiceType[]>([
    "hardware_supplier",
  ])
  const [cooperationStatus, setCooperationStatus] =
    useState<CooperationStatus>("active")
  const [emergencyPhone, setEmergencyPhone] = useState("")
  const [dispatchEmail, setDispatchEmail] = useState("")
  const [dispatchUrl, setDispatchUrl] = useState("")
  const [emergencyMinutes, setEmergencyMinutes] = useState("120")
  const [partsMinutes, setPartsMinutes] = useState("240")
  const [engineerMinutes, setEngineerMinutes] = useState("240")
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(vendor?.code ?? "")
    setName(vendor?.name ?? "")
    setShortName(vendor?.short_name ?? "")
    setCreditCode(vendor?.credit_code ?? "")
    setServiceTypes(vendor?.service_types ?? ["hardware_supplier"])
    setCooperationStatus(vendor?.cooperation_status ?? "active")
    setEmergencyPhone(vendor?.emergency_phone ?? "")
    setDispatchEmail(vendor?.dispatch_email ?? "")
    setDispatchUrl(vendor?.dispatch_url ?? "")
    setEmergencyMinutes(
      vendor?.emergency_response_minutes !== undefined
        ? String(vendor.emergency_response_minutes)
        : "120"
    )
    setPartsMinutes(
      vendor?.parts_response_minutes !== undefined
        ? String(vendor.parts_response_minutes)
        : "240"
    )
    setEngineerMinutes(
      vendor?.engineer_response_minutes !== undefined
        ? String(vendor.engineer_response_minutes)
        : "240"
    )
    setDescription(vendor?.description ?? "")
    setError("")
  }, [open, vendor])

  const isDirty =
    open &&
    (code !== (vendor?.code ?? "") ||
      name !== (vendor?.name ?? "") ||
      shortName !== (vendor?.short_name ?? "") ||
      creditCode !== (vendor?.credit_code ?? "") ||
      cooperationStatus !== (vendor?.cooperation_status ?? "active") ||
      emergencyPhone !== (vendor?.emergency_phone ?? "") ||
      dispatchEmail !== (vendor?.dispatch_email ?? "") ||
      dispatchUrl !== (vendor?.dispatch_url ?? "") ||
      description !== (vendor?.description ?? ""))

  useUnsavedChanges(isDirty, "供应商信息尚未保存，关闭后这些更改将丢失。")

  const toggleServiceType = (st: VendorServiceType) => {
    setServiceTypes((current) =>
      current.includes(st)
        ? current.filter((s) => s !== st)
        : [...current, st]
    )
  }

  const creditCodeValid = creditCode.trim().length === 18
  const canSubmit =
    name.trim().length >= 2 &&
    creditCodeValid &&
    serviceTypes.length > 0 &&
    (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<VendorDTO> = {
        name: name.trim(),
        short_name: shortName.trim() || undefined,
        credit_code: creditCode.trim(),
        service_types: serviceTypes,
        cooperation_status: cooperationStatus,
        emergency_phone: emergencyPhone.trim() || undefined,
        dispatch_email: dispatchEmail.trim() || undefined,
        dispatch_url: dispatchUrl.trim() || undefined,
        emergency_response_minutes: Number(emergencyMinutes) || 0,
        parts_response_minutes: Number(partsMinutes) || 0,
        engineer_response_minutes: Number(engineerMinutes) || 0,
        description: description.trim() || undefined,
      }
      if (editing && vendor) {
        return vendorsService.update(vendor, payload)
      }
      return vendorsService.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "供应商已更新" : "供应商已创建",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["vendors"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(
        getErrorMessage(err, editing ? "更新供应商失败" : "创建供应商失败")
      ),
  })

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
              {editing ? "编辑供应商/服务商" : "新建供应商/服务商"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            维护采购供应商、原厂/第三方维保合同服务商及响应时效
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
          className="space-y-4 py-2"
        >
          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">供应商编码 *</FieldLabel>
              <Input
                placeholder="如: vendor-digital-china"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">统一社会信用代码 (18位) *</FieldLabel>
              <Input
                placeholder="91110000..."
                value={creditCode}
                onChange={(e) => setCreditCode(e.target.value.toUpperCase())}
                disabled={mutation.isPending}
                maxLength={18}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">公司全称 *</FieldLabel>
              <Input
                placeholder="如: 神州数码系统服务有限公司"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">企业简称</FieldLabel>
              <Input
                placeholder="如: 神州数码"
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">合作状态</FieldLabel>
              <NativeSelect
                value={cooperationStatus}
                onChange={(e) =>
                  setCooperationStatus(e.target.value as CooperationStatus)
                }
                disabled={mutation.isPending}
                className="h-8 text-xs"
              >
                <NativeSelectOption value="active">正常合作 (Active)</NativeSelectOption>
                <NativeSelectOption value="suspended">暂停合作 (Suspended)</NativeSelectOption>
                <NativeSelectOption value="terminated">已终止 (Terminated)</NativeSelectOption>
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel className="text-xs">24小时紧急报修电话</FieldLabel>
              <Input
                placeholder="400-xxx-xxxx"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel className="text-xs">服务能力类型 (可多选) *</FieldLabel>
            <div className="flex flex-wrap gap-4 pt-1">
              {SERVICE_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer"
                >
                  <Checkbox
                    checked={serviceTypes.includes(opt.id)}
                    onCheckedChange={() => toggleServiceType(opt.id)}
                    disabled={mutation.isPending}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </Field>

          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <h4 className="text-xs font-semibold text-foreground/80">SLA 响应承诺 (分钟)</h4>
            <div className="grid grid-cols-3 gap-3">
              <Field>
                <FieldLabel className="text-[11px] text-muted-foreground">紧急响应 (分钟)</FieldLabel>
                <Input
                  type="number"
                  value={emergencyMinutes}
                  onChange={(e) => setEmergencyMinutes(e.target.value)}
                  disabled={mutation.isPending}
                  className="h-7 text-xs font-mono"
                />
              </Field>
              <Field>
                <FieldLabel className="text-[11px] text-muted-foreground">备件到达 (分钟)</FieldLabel>
                <Input
                  type="number"
                  value={partsMinutes}
                  onChange={(e) => setPartsMinutes(e.target.value)}
                  disabled={mutation.isPending}
                  className="h-7 text-xs font-mono"
                />
              </Field>
              <Field>
                <FieldLabel className="text-[11px] text-muted-foreground">工程师到场 (分钟)</FieldLabel>
                <Input
                  type="number"
                  value={engineerMinutes}
                  onChange={(e) => setEngineerMinutes(e.target.value)}
                  disabled={mutation.isPending}
                  className="h-7 text-xs font-mono"
                />
              </Field>
            </div>
          </div>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">派单接收邮箱</FieldLabel>
              <Input
                type="email"
                placeholder="dispatch@vendor.com"
                value={dispatchEmail}
                onChange={(e) => setDispatchEmail(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">派单系统对接 URL</FieldLabel>
              <Input
                type="url"
                placeholder="https://..."
                value={dispatchUrl}
                onChange={(e) => setDispatchUrl(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel className="text-xs">备注与合作说明</FieldLabel>
            <Textarea
              placeholder="合同编号、服务范围补充..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={mutation.isPending}
              rows={2}
              className="text-xs"
            />
          </Field>

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
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit || mutation.isPending}
            >
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存更改" : "创建供应商"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
