import { useMemo } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Network } from "lucide-react"
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { useConfirm } from "@/components/common/confirm-dialog"
import { FormField, useAppForm } from "@/components/form"
import { ManagedLookup } from "@/components/managed/managed-editor"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { notify } from "@/lib/notify"
import {
  subnetsService,
  networkScopesService,
  securityZonesService,
  type SubnetDTO,
  type SubnetUsageType,
} from "@/services/ipam"

const CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/
const ipv4 = z.ipv4()
const ipAddress = z.union([ipv4, z.ipv6()])

function parseDnsServers(value: string) {
  return value.split(",").map((address) => address.trim()).filter(Boolean)
}

const USAGE_TYPE_OPTIONS: { id: SubnetUsageType; label: string }[] = [
  { id: "production", label: "生产业务网 (Production)" },
  { id: "business_management", label: "业务管理网 (Management)" },
  { id: "bmc", label: "带外管理 / IPMI (BMC)" },
  { id: "storage_management", label: "存储网络 (Storage)" },
  { id: "heartbeat", label: "双机心跳网 (Heartbeat)" },
  { id: "vip", label: "负载均衡虚 IP (VIP)" },
  { id: "other", label: "其他规划网段 (Other)" },
]

const createSubnetSchema = (editing: boolean) =>
  z.object({
    code: editing
      ? z.string()
      : z
          .string()
          .trim()
          .min(2, "子网编码至少 2 个字符")
          .max(64, "子网编码不能超过 64 个字符")
          .regex(CODE_PATTERN, "以字母开头，仅含字母、数字及 _ . : -"),
    name: z
      .string()
      .trim()
      .min(2, "子网名称至少 2 个字符")
      .max(64, "子网名称不能超过 64 个字符"),
    network_scope_id: z.string().min(1, "请选择所属地址空间"),
    security_zone_id: z.string().min(1, "请选择所属安全域"),
    cidr: z
      .string()
      .trim()
      .pipe(z.cidrv4("请输入合法的 IPv4 CIDR（如 10.20.1.0/24）")),
    gateway: z
      .string()
      .trim()
      .refine((val) => !val || ipv4.safeParse(val).success, "网关必须为合法的 IPv4 地址（如 10.20.1.1）"),
    vlan_id: z
      .string()
      .trim()
      .refine(
        (val) => {
          if (!val) return true
          const num = Number(val)
          return Number.isInteger(num) && num >= 1 && num <= 4094
        },
        "VLAN ID 必须为 1~4094 之间的整数",
      ),
    usage_type: z.enum([
      "production",
      "business_management",
      "bmc",
      "storage_management",
      "heartbeat",
      "vip",
      "other",
    ]),
    dns_servers: z.string().superRefine((value, ctx) => {
      const addresses = parseDnsServers(value)
      if (addresses.length > 8) {
        ctx.addIssue({ code: "custom", message: "DNS 地址最多填写 8 个" })
      }
      if (addresses.some((address) => address.includes("%") || !ipAddress.safeParse(address).success)) {
        ctx.addIssue({ code: "custom", message: "请输入合法的 IPv4 或 IPv6 DNS 地址" })
      }
    }),
    is_allocatable: z.boolean(),
    description: z.string().max(255, "备注不能超过 255 个字符"),
  })

type SubnetFormValues = {
  code: string
  name: string
  network_scope_id: string
  security_zone_id: string
  cidr: string
  gateway: string
  vlan_id: string
  usage_type: SubnetUsageType
  dns_servers: string
  is_allocatable: boolean
  description: string
}

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

  const subnetSchema = useMemo(() => createSubnetSchema(editing), [editing])
  const defaultValues = useMemo<SubnetFormValues>(
    () => ({
      code: subnet?.code ?? "",
      name: subnet?.name ?? "",
      network_scope_id: subnet?.network_scope_id ?? "",
      security_zone_id: subnet?.security_zone_id ?? "",
      cidr: subnet?.cidr ?? "",
      gateway: subnet?.gateway ?? "",
      vlan_id: subnet?.vlan_id !== undefined && subnet?.vlan_id !== null ? String(subnet.vlan_id) : "",
      usage_type: subnet?.usage_type ?? "production",
      dns_servers: subnet?.dns_servers?.join(", ") ?? "",
      is_allocatable: subnet?.is_allocatable ?? true,
      description: subnet?.description ?? "",
    }),
    [subnet],
  )

  const mutation = useMutation({
    mutationFn: (values: SubnetFormValues) => {
      const payload: Partial<SubnetDTO> = {
        name: values.name.trim(),
        network_scope_id: values.network_scope_id,
        security_zone_id: values.security_zone_id,
        cidr: values.cidr.trim(),
        gateway: values.gateway.trim() || undefined,
        vlan_id: values.vlan_id ? Number(values.vlan_id) : undefined,
        usage_type: values.usage_type,
        dns_servers: values.dns_servers
          ? parseDnsServers(values.dns_servers)
          : undefined,
        is_allocatable: values.is_allocatable,
        description: values.description.trim() || undefined,
      }
      if (editing && subnet) {
        return subnetsService.update(subnet, payload)
      }
      return subnetsService.create({
        ...payload,
        code: values.code.trim(),
      })
    },
    onSuccess: (res) => {
      notify.success(
        editing ? "子网网段已更新" : "子网网段已规划创建",
        res.data.cidr,
      )
      void queryClient.invalidateQueries({ queryKey: ["subnets"] })
      onOpenChange(false)
    },
  })

  const { form, formError, formRef, submit, hasChanges } = useAppForm<SubnetFormValues>({
    defaultValues,
    resetKey: subnet?.id,
    schema: subnetSchema,
    open,
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    fallbackErrorMessage: editing ? "更新子网失败" : "创建子网失败",
  })

  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "子网网段信息尚未保存，关闭后这些更改将丢失。")

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
                <FormField
                  field={field}
                  label="子网编码"
                  required={!editing}
                  idPrefix="subnet"
                >
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: subnet-prod-bj01"
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
                <FormField field={field} label="子网标识名称" required idPrefix="subnet">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 北京主中心-业务内网-1"
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

          <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <form.Field name="network_scope_id">
              {(field) => (
                <FormField field={field} label="所属地址空间" required id="subnet-scope-trigger">
                  {({ id, ...props }) => (
                    <ManagedLookup
                      {...props}
                      id="subnet-scope"
                      triggerId={id}
                      label="地址空间"
                      value={field.state.value}
                      onChange={(val) => field.handleChange(val)}
                      disabled={editing || mutation.isPending}
                      required
                      source={{
                        key: "networkScopes",
                        permission: "ipam:network-scopes:read",
                        list: networkScopesService.list,
                      }}
                    />
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="security_zone_id">
              {(field) => (
                <FormField field={field} label="所属安全域" required id="subnet-zone-trigger">
                  {({ id, ...props }) => (
                    <ManagedLookup
                      {...props}
                      id="subnet-zone"
                      triggerId={id}
                      label="安全域"
                      value={field.state.value}
                      onChange={(val) => field.handleChange(val)}
                      disabled={editing || mutation.isPending}
                      required
                      source={{
                        key: "securityZones",
                        permission: "ipam:security-zones:read",
                        list: securityZonesService.list,
                      }}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <FieldGroup className="grid grid-cols-3 gap-3">
            <form.Field name="cidr">
              {(field) => (
                <FormField field={field} label="IPv4 CIDR" required idPrefix="subnet">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 10.20.1.0/24"
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

            <form.Field name="gateway">
              {(field) => (
                <FormField field={field} label="网关 IP" idPrefix="subnet">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="如: 10.20.1.1"
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

            <form.Field name="vlan_id">
              {(field) => (
                <FormField field={field} label="VLAN ID (1~4094)" idPrefix="subnet">
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={1}
                      max={4094}
                      placeholder="101"
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

          <FieldGroup className="grid grid-cols-2 gap-3">
            <form.Field name="usage_type">
              {(field) => (
                <FormField field={field} label="业务网络用途" required idPrefix="subnet">
                  {(props) => (
                    <NativeSelect
                      {...props}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value as SubnetUsageType)}
                      onBlur={field.handleBlur}
                      disabled={mutation.isPending}
                      className="h-8 text-xs"
                    >
                      {USAGE_TYPE_OPTIONS.map((opt) => (
                        <NativeSelectOption key={opt.id} value={opt.id}>
                          {opt.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="dns_servers">
              {(field) => (
                <FormField field={field} label="DNS 服务器 (逗号分隔)" idPrefix="subnet">
                  {(props) => (
                    <Input
                      {...props}
                      placeholder="114.114.114.114, 8.8.8.8"
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

          <form.Field name="is_allocatable">
            {(field) => (
              <FormField field={field} id="subnet-allocatable">
                {(props) => (
                  <label className="flex items-center gap-2 pt-1 text-xs text-foreground cursor-pointer">
                    <Checkbox
                      {...props}
                      checked={field.state.value}
                      onCheckedChange={(checked) => field.handleChange(Boolean(checked))}
                      disabled={mutation.isPending}
                    />
                    <span>允许自动分配为设备 IP (Is Allocatable)</span>
                  </label>
                )}
              </FormField>
            )}
          </form.Field>

          <form.Field name="description">
            {(field) => (
              <FormField field={field} label="备注与规划说明" idPrefix="subnet">
                {(props) => (
                  <Textarea
                    {...props}
                    placeholder="子网规划边界、路由发布策略说明..."
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
                    "创建子网"
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
