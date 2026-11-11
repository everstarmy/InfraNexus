import { ManagedLookup } from "@/components/managed/managed-editor"
import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Network } from "lucide-react"
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
  subnetsService,
  networkScopesService,
  securityZonesService,
  type SubnetDTO,
  type SubnetUsageType,
} from "@/services/ipam"

const USAGE_TYPE_OPTIONS: { id: SubnetUsageType; label: string }[] = [
  { id: "production", label: "生产业务网 (Production)" },
  { id: "business_management", label: "业务管理网 (Management)" },
  { id: "bmc", label: "带外管理 / IPMI (BMC)" },
  { id: "storage_management", label: "存储网络 (Storage)" },
  { id: "heartbeat", label: "双机心跳网 (Heartbeat)" },
  { id: "vip", label: "负载均衡虚 IP (VIP)" },
  { id: "other", label: "其他规划网段 (Other)" },
]

export function SubnetFormDialog({
  open,
  subnet,
  onOpenChange,
}: {
  open: boolean
  subnet?: SubnetDTO | null
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const editing = Boolean(subnet)

  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [scopeId, setScopeId] = useState("")
  const [zoneId, setZoneId] = useState("")
  const [cidr, setCidr] = useState("")
  const [gateway, setGateway] = useState("")
  const [vlanId, setVlanId] = useState("")
  const [usageType, setUsageType] = useState<SubnetUsageType>("production")
  const [dnsServers, setDnsServers] = useState("")
  const [isAllocatable, setIsAllocatable] = useState(true)
  const [description, setDescription] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setCode(subnet?.code ?? "")
    setName(subnet?.name ?? "")
    setScopeId(subnet?.network_scope_id ?? "")
    setZoneId(subnet?.security_zone_id ?? "")
    setCidr(subnet?.cidr ?? "")
    setGateway(subnet?.gateway ?? "")
    setVlanId(subnet?.vlan_id !== undefined && subnet?.vlan_id !== null ? String(subnet.vlan_id) : "")
    setUsageType(subnet?.usage_type ?? "production")
    setDnsServers(subnet?.dns_servers?.join(", ") ?? "")
    setIsAllocatable(subnet?.is_allocatable ?? true)
    setDescription(subnet?.description ?? "")
    setError("")
  }, [open, subnet])

  const isDirty =
    open &&
    (code !== (subnet?.code ?? "") ||
      name !== (subnet?.name ?? "") ||
      cidr !== (subnet?.cidr ?? "") ||
      gateway !== (subnet?.gateway ?? "") ||
      vlanId !== (subnet?.vlan_id ? String(subnet.vlan_id) : "") ||
      usageType !== (subnet?.usage_type ?? "production") ||
      scopeId !== (subnet?.network_scope_id ?? "") ||
      zoneId !== (subnet?.security_zone_id ?? "") ||
      dnsServers !== (subnet?.dns_servers?.join(", ") ?? "") ||
      isAllocatable !== (subnet?.is_allocatable ?? true) ||
      description !== (subnet?.description ?? ""))

  useUnsavedChanges(isDirty, "子网网段信息尚未保存，关闭后这些更改将丢失。")

  const canSubmit =
    name.trim().length >= 2 &&
    cidr.includes("/") &&
    Boolean(scopeId) &&
    Boolean(zoneId) &&
    (editing || code.trim().length >= 2)

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Partial<SubnetDTO> = {
        name: name.trim(),
        network_scope_id: scopeId,
        security_zone_id: zoneId,
        cidr: cidr.trim(),
        gateway: gateway.trim() || undefined,
        vlan_id: vlanId ? Number(vlanId) : undefined,
        usage_type: usageType,
        dns_servers: dnsServers
          ? dnsServers.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
        is_allocatable: isAllocatable,
        description: description.trim() || undefined,
      }
      if (editing && subnet) {
        return subnetsService.update(subnet, payload)
      }
      return subnetsService.create({
        ...payload,
        code: code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "子网网段已更新" : "子网网段已规划创建",
        res.data.cidr
      )
      void queryClient.invalidateQueries({ queryKey: ["subnets"] })
      onOpenChange(false)
    },
    onError: (err) =>
      setError(
        getErrorMessage(err, editing ? "更新子网失败" : "创建子网失败")
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
            <Network className="size-5 text-primary" />
            <DialogTitle className="text-base font-semibold">
              {editing ? "编辑子网规划" : "新建子网规划 (Subnet)"}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            在指定地址空间 (VRF) 与物理安全域内划分 CIDR 网段及网关
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
              <FieldLabel className="text-xs">子网编码 *</FieldLabel>
              <Input
                placeholder="如: subnet-prod-bj01"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">子网标识名称 *</FieldLabel>
              <Input
                placeholder="如: 北京主中心-业务内网-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
                required
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="subnet-scope">所属地址空间</FieldLabel>
              <ManagedLookup id="subnet-scope" label="地址空间" value={scopeId} onChange={setScopeId}
                disabled={editing || mutation.isPending} required
                source={{ key: "networkScopes", permission: "ipam:network-scopes:read", list: networkScopesService.list }} />
            </Field>
            <Field>
              <FieldLabel htmlFor="subnet-zone">所属安全域</FieldLabel>
              <ManagedLookup id="subnet-zone" label="安全域" value={zoneId} onChange={setZoneId}
                disabled={editing || mutation.isPending} required
                source={{ key: "securityZones", permission: "ipam:security-zones:read", list: securityZonesService.list }} />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel className="text-xs">IPv4 CIDR *</FieldLabel>
              <Input
                placeholder="如: 10.20.1.0/24"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                disabled={editing || mutation.isPending}
                className="h-8 text-xs font-mono"
                required
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">网关 IP</FieldLabel>
              <Input
                placeholder="如: 10.20.1.1"
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs">VLAN ID (1~4094)</FieldLabel>
              <Input
                type="number"
                min={1}
                max={4094}
                placeholder="101"
                value={vlanId}
                onChange={(e) => setVlanId(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
              />
            </Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel className="text-xs">业务网络用途 *</FieldLabel>
              <NativeSelect
                value={usageType}
                onChange={(e) => setUsageType(e.target.value as SubnetUsageType)}
                disabled={mutation.isPending}
                className="h-8 text-xs"
              >
                {USAGE_TYPE_OPTIONS.map((opt) => (
                  <NativeSelectOption key={opt.id} value={opt.id}>
                    {opt.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>

            <Field>
              <FieldLabel className="text-xs">DNS 服务器 (逗号分隔)</FieldLabel>
              <Input
                placeholder="114.114.114.114, 8.8.8.8"
                value={dnsServers}
                onChange={(e) => setDnsServers(e.target.value)}
                disabled={mutation.isPending}
                className="h-8 text-xs font-mono"
              />
            </Field>
          </FieldGroup>

          <Field>
            <label className="flex items-center gap-2 pt-1 text-xs text-foreground cursor-pointer">
              <Checkbox
                checked={isAllocatable}
                onCheckedChange={(checked) => setIsAllocatable(Boolean(checked))}
                disabled={mutation.isPending}
              />
              <span>允许自动分配为设备 IP (Is Allocatable)</span>
            </label>
          </Field>

          <Field>
            <FieldLabel className="text-xs">备注与规划说明</FieldLabel>
            <Textarea
              placeholder="子网规划边界、路由发布策略说明..."
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
              {mutation.isPending ? <Spinner className="size-4" /> : editing ? "保存更改" : "创建子网"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
