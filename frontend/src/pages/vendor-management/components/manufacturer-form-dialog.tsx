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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import {
  manufacturersService,
  type ManufacturerDTO,
  type ProtocolType,
} from "@/services/vendor-management"

const PROTOCOL_OPTIONS: { id: ProtocolType; label: string }[] = [
  { id: "redfish", label: "Redfish" },
  { id: "rest", label: "REST API" },
  { id: "snmpv2c", label: "SNMP v2c" },
  { id: "snmpv3", label: "SNMP v3" },
]

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

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [englishName, setEnglishName] = useState("")
  const [website, setWebsite] = useState("")
  const [supportUrl, setSupportUrl] = useState("")
  const [supportPhone, setSupportPhone] = useState("")
  const [enterpriseOid, setEnterpriseOid] = useState<string>("")
  const [serialNumberPattern, setSerialNumberPattern] = useState("")
  const [protocols, setProtocols] = useState<ProtocolType[]>([])
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(manufacturer?.code ?? "")
    setName(manufacturer?.name ?? "")
    setEnglishName(manufacturer?.english_name ?? "")
    setWebsite(manufacturer?.website ?? "")
    setSupportUrl(manufacturer?.support_url ?? "")
    setSupportPhone(manufacturer?.support_phone ?? "")
    setEnterpriseOid(
      manufacturer?.enterprise_oid ? String(manufacturer.enterprise_oid) : ""
    )
    setSerialNumberPattern(manufacturer?.serial_number_pattern ?? "")
    setProtocols(manufacturer?.protocols ?? [])
    setDescription(manufacturer?.description ?? "")
    setError("")
  }, [open, manufacturer])

  const isDirty =
    open &&
    (code !== (manufacturer?.code ?? "") ||
      name !== (manufacturer?.name ?? "") ||
      englishName !== (manufacturer?.english_name ?? "") ||
      website !== (manufacturer?.website ?? "") ||
      supportUrl !== (manufacturer?.support_url ?? "") ||
      supportPhone !== (manufacturer?.support_phone ?? "") ||
      enterpriseOid !== (manufacturer?.enterprise_oid ? String(manufacturer.enterprise_oid) : "") ||
      serialNumberPattern !== (manufacturer?.serial_number_pattern ?? "") ||
      JSON.stringify(protocols) !== JSON.stringify(manufacturer?.protocols ?? []) ||
      description !== (manufacturer?.description ?? ""))

  useUnsavedChanges(isDirty, "制造商信息尚未保存，关闭后这些更改将丢失。")

  const toggleProtocol = (proto: ProtocolType) => {
    setProtocols((current) =>
      current.includes(proto)
        ? current.filter((p) => p !== proto)
        : [...current, proto]
    )
  }

  const canSubmit =
    name.trim().length >= 2 &&
    (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<ManufacturerDTO> = {
        name: name.trim(),
        english_name: englishName.trim() || undefined,
        website: website.trim() || undefined,
        support_url: supportUrl.trim() || undefined,
        support_phone: supportPhone.trim() || undefined,
        enterprise_oid: enterpriseOid ? Number(enterpriseOid) : undefined,
        serial_number_pattern: serialNumberPattern.trim() || undefined,
        protocols: protocols.length > 0 ? protocols : undefined,
        description: description.trim() || undefined,
      }
      if (editing && manufacturer) {
        return manufacturersService.update(manufacturer, payload)
      }
      return manufacturersService.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "制造商已更新" : "制造商已创建",
        res.data.name
      )
      void queryClient.invalidateQueries({ queryKey: ["manufacturers"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(
        getErrorMessage(err, editing ? "更新制造商失败" : "创建制造商失败")
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Building2 className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑制造商" : "新建制造商"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            维护硬件与设备制造商的原厂信息、采集协议及技术支持渠道
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
              <FieldLabel className="text-xs">厂商编码 (Code) *</FieldLabel>
              <Input
                placeholder="如: cisco, dell, huawei"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">中文/通用名称 *</FieldLabel>
              <Input
                placeholder="如: 华为技术 / Cisco"
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
              <FieldLabel className="text-xs">英文官方名称</FieldLabel>
              <Input
                placeholder="如: Huawei Technologies"
                value={englishName}
                onChange={(e) => setEnglishName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">Enterprise OID (SNMP)</FieldLabel>
              <Input
                type="number"
                placeholder="如: 2011, 9, 674"
                value={enterpriseOid}
                onChange={(e) => setEnterpriseOid(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">官方网站</FieldLabel>
              <Input
                type="url"
                placeholder="https://..."
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">支持与报修电话</FieldLabel>
              <Input
                placeholder="400-xxx-xxxx"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">支持门户 URL</FieldLabel>
              <Input
                type="url"
                placeholder="https://support...."
                value={supportUrl}
                onChange={(e) => setSupportUrl(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">序列号正则规则</FieldLabel>
              <Input
                placeholder="如: ^[A-Z0-9]{10,14}$"
                value={serialNumberPattern}
                onChange={(e) => setSerialNumberPattern(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
              />
            </Field>
          </FieldGroup>

          <Field>
            <FieldLabel className="text-xs">支持的采集协议</FieldLabel>
            <div className="flex flex-wrap gap-4 pt-1">
              {PROTOCOL_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer"
                >
                  <Checkbox
                    checked={protocols.includes(opt.id)}
                    onCheckedChange={() => toggleProtocol(opt.id)}
                    disabled={mutation.isPending}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel className="text-xs">备注与描述</FieldLabel>
            <Textarea
              placeholder="厂商档案补充说明..."
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
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存更改" : "创建制造商"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
