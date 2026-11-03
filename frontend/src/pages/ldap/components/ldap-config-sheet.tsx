import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDot,
  CircleX,
  FolderTree,
  Info,
  Network,
  Plug,
  Plus,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DepartmentSelect } from "@/components/common/department-select"
import { QueryErrorState } from "@/components/common/query-error-state"
import { useConfirm } from "@/components/common/confirm-dialog"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { cn } from "@/lib/utils"
import type { DepartmentNode } from "@/services/departments"
import {
  ldapService,
  type AttributeMapping,
  type DirectoryType,
  type LDAPConfig,
  type LDAPConfigPayload,
  type LDAPTestResult,
} from "@/services/ldap"
import type { RoleRef } from "@/services/types"

export const DEFAULTS: Record<DirectoryType, { filter: string; mapping: AttributeMapping }> = {
  ad: {
    filter: "(&(objectClass=user)(objectCategory=person)(sAMAccountName=%s))",
    mapping: {
      username: "sAMAccountName",
      email: "mail",
      nickname: "displayName",
      department: "department",
      external_id: "objectGUID",
    },
  },
  ldap: {
    filter: "(&(objectClass=inetOrgPerson)(uid=%s))",
    mapping: {
      username: "uid",
      email: "mail",
      nickname: "cn",
      department: "ou",
      external_id: "entryUUID",
    },
  },
}

const NO_ROLE = "__none__"

export function emptyForm(): LDAPConfigPayload {
  return {
    name: "",
    type: "ad",
    domain: "",
    server_host: "",
    port: 389,
    use_ssl: false,
    start_tls: false,
    insecure_skip_verify: false,
    bind_dn: "",
    bind_password: "",
    base_dn: "",
    user_filter: DEFAULTS.ad.filter,
    attribute_mapping: { ...DEFAULTS.ad.mapping },
    department_sync: {
      strategy: "ou",
      root_department_id: null,
      ou_mappings: [],
    },
    default_role_id: null,
    enabled: true,
    sync_enabled: false,
    sync_interval_minutes: 60,
    disable_missing_users: false,
    timeout_seconds: 10,
  }
}

export function fromConfig(cfg: LDAPConfig): LDAPConfigPayload {
  return {
    name: cfg.name,
    type: cfg.type,
    domain: cfg.domain,
    server_host: cfg.server_host,
    port: cfg.port,
    use_ssl: cfg.use_ssl,
    start_tls: cfg.start_tls,
    insecure_skip_verify: cfg.insecure_skip_verify,
    bind_dn: cfg.bind_dn,
    bind_password: "",
    base_dn: cfg.base_dn,
    user_filter: cfg.user_filter,
    attribute_mapping: { ...cfg.attribute_mapping },
    department_sync: {
      strategy: cfg.department_sync.strategy || "none",
      root_department_id: cfg.department_sync.root_department_id,
      ou_mappings: cfg.department_sync.ou_mappings ?? [],
    },
    default_role_id: cfg.default_role_id,
    enabled: cfg.enabled,
    sync_enabled: cfg.sync_enabled,
    sync_interval_minutes: cfg.sync_interval_minutes,
    disable_missing_users: cfg.disable_missing_users,
    timeout_seconds: cfg.timeout_seconds,
  }
}

export const mappingFields: Array<{
  key: keyof AttributeMapping
  label: string
  hint: string
}> = [
  { key: "username", label: "登录账号", hint: "作为本地用户名，按域唯一" },
  { key: "nickname", label: "显示名称", hint: "同步为用户姓名 / 昵称" },
  { key: "email", label: "电子邮箱", hint: "与其他账号冲突时自动忽略" },
  {
    key: "department",
    label: "部门名称",
    hint: "部门策略为「按部门属性」时使用",
  },
  {
    key: "external_id",
    label: "唯一标识",
    hint: "用于改名后仍能匹配同一账号（AD 推荐 objectGUID）",
  },
]

export type StudioTab = "connection" | "mapping" | "org" | "policy"

const STEPS: Array<{
  key: StudioTab
  step: number
  title: string
  desc: string
}> = [
  {
    key: "connection",
    step: 1,
    title: "连接与目录",
    desc: "服务器、加密与服务账号",
  },
  {
    key: "mapping",
    step: 2,
    title: "属性映射",
    desc: "目录属性与平台字段对照",
  },
  {
    key: "org",
    step: 3,
    title: "组织映射",
    desc: "部门建树与 OU 挂载规则",
  },
  {
    key: "policy",
    step: 4,
    title: "同步与登录",
    desc: "域登录开关与定时调度",
  },
]

export function LdapConfigDialog({
  open,
  config,
  initialTab = "connection",
  departments,
  roles,
  optionsLoading = false,
  optionsError,
  onRetryOptions,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  config: LDAPConfig | null
  initialTab?: StudioTab
  departments: DepartmentNode[]
  roles: RoleRef[]
  optionsLoading?: boolean
  optionsError?: unknown
  onRetryOptions?: () => void
  onOpenChange: (open: boolean) => void
  onSaved?: (saved: LDAPConfig) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [form, setForm] = useState<LDAPConfigPayload>(emptyForm)
  const initialSnapshot = useRef("")
  const [tab, setTab] = useState<StudioTab>(initialTab)
  const [error, setError] = useState("")
  const [testResult, setTestResult] = useState<LDAPTestResult | null>(null)

  useEffect(() => {
    if (!open) return
    const initial = config ? fromConfig(config) : emptyForm()
    initialSnapshot.current = JSON.stringify(initial)
    setForm(initial)
    setTab(initialTab)
    setError("")
    setTestResult(null)
  }, [open, config, initialTab])

  const isDirty = useMemo(
    () => open && JSON.stringify(form) !== initialSnapshot.current,
    [form, open],
  )
  useUnsavedChanges(isDirty, "目录连接、映射或同步策略尚未保存。离开后这些更改将丢失。")

  const requestClose = async () => {
    if (save.isPending) return
    if (isDirty) {
      const discard = await confirm({
        tone: "default",
        title: "放弃目录配置更改？",
        description: "当前配置尚未保存，离开后这些更改将丢失。",
        confirmText: "放弃更改",
      })
      if (!discard) return
    }
    onOpenChange(false)
  }

  const set = <K extends keyof LDAPConfigPayload>(key: K, value: LDAPConfigPayload[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const security = form.use_ssl ? "ldaps" : form.start_tls ? "starttls" : "none"

  const changeType = (next: DirectoryType) =>
    setForm((f) => {
      const prev = DEFAULTS[f.type]
      return {
        ...f,
        type: next,
        user_filter:
          f.user_filter === prev.filter || !f.user_filter ? DEFAULTS[next].filter : f.user_filter,
        attribute_mapping:
          JSON.stringify(f.attribute_mapping) === JSON.stringify(prev.mapping)
            ? { ...DEFAULTS[next].mapping }
            : f.attribute_mapping,
      }
    })

  const changeSecurity = (mode: string) =>
    setForm((f) => ({
      ...f,
      use_ssl: mode === "ldaps",
      start_tls: mode === "starttls",
      port:
        mode === "ldaps" && f.port === 389
          ? 636
          : mode !== "ldaps" && f.port === 636
            ? 389
            : f.port,
    }))

  const mappings = form.department_sync.ou_mappings ?? []
  const setMappings = (next: typeof mappings) =>
    set("department_sync", { ...form.department_sync, ou_mappings: next })

  const required = [
    form.name,
    form.domain,
    form.server_host,
    form.bind_dn,
    form.base_dn,
    form.user_filter,
  ].every((v) => v.trim())
  const passwordReady = !!config?.has_bind_password || !!form.bind_password
  const valid =
    required &&
    passwordReady &&
    form.user_filter.includes("%s") &&
    (!form.sync_enabled || form.sync_interval_minutes >= 5)

  const save = useMutation({
    mutationFn: () => (config ? ldapService.update(config.id, form) : ldapService.create(form)),
    onSuccess: (res) => {
      notify.success(
        config ? "目录配置已更新" : "目录配置已创建",
        `${res.data.name}（${res.data.domain}）`,
      )
      void queryClient.invalidateQueries({ queryKey: ["ldap"] })
      void queryClient.invalidateQueries({ queryKey: ["auth", "domains"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      onSaved?.(res.data)
      onOpenChange(false)
    },
    onError: (err) => setError(getErrorMessage(err, "保存失败")),
  })

  const test = useMutation({
    mutationFn: () => ldapService.test({ ...form, config_id: config?.id }),
    onSuccess: (res) => setTestResult(res.data),
    onError: (err) => notify.apiError(err, "测试连接失败"),
  })

  const currentStepIndex = STEPS.findIndex((s) => s.key === tab)

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <DialogContent
        data-slot="ldap-config-dialog"
        className="flex max-h-[90svh] flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <DialogHeader className="border-b px-6 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-lg/6.5 font-semibold">
            <Network className="size-4.5 text-primary" />
            {config ? `编辑目录配置 · ${config.name}` : "新建目录配置"}
          </DialogTitle>
          <DialogDescription className="text-(length:--text-description)/5">
            配置 Windows AD 或 OpenLDAP 目录连接、属性与组织架构映射及同步策略
          </DialogDescription>
        </DialogHeader>

        {optionsLoading && (
          <p
            className="border-b bg-muted/20 px-6 py-2 text-(length:--text-description)/5 text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            正在加载部门与角色映射选项…
          </p>
        )}
        {!!optionsError && onRetryOptions && (
          <div className="border-b p-4">
            <QueryErrorState
              error={optionsError}
              label="部门与角色映射选项"
              onRetry={onRetryOptions}
            />
          </div>
        )}

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(String(v) as StudioTab)}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          {/* Stepper Navigation Bar */}
          <TabsList
            variant="line"
            aria-label="目录配置步骤"
            className="grid h-auto w-full grid-cols-2 gap-2 rounded-none border-b bg-muted/20 px-6 py-3 group-data-horizontal/tabs:h-auto sm:grid-cols-4"
          >
            {STEPS.map((s, idx) => {
              const isActive = tab === s.key
              const isCompleted = idx < currentStepIndex
              return (
                <TabsTrigger
                  key={s.key}
                  value={s.key}
                  className={cn(
                    "h-auto justify-start gap-2.5 whitespace-normal rounded-xl border px-3 py-2 text-left transition-colors after:hidden",
                    isActive
                      ? "border-primary bg-background shadow-2xs ring-1 ring-primary/20"
                      : isCompleted
                        ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                        : "border-border/70 bg-background/60 hover:bg-background",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-(length:--text-description)/5 font-semibold",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : isCompleted
                          ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isCompleted ? <Check className="size-3.5" /> : s.step}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm/5.5 font-medium text-foreground">{s.title}</p>
                    <p className="hidden text-xs/4.5 text-muted-foreground sm:block">
                      {s.desc}
                    </p>
                  </div>
                </TabsTrigger>
              )
            })}
          </TabsList>

          {/* Step Content Body */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {error && (
              <Alert variant="destructive">
                <CircleX />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <TabsContent value="connection" className="mt-0">
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel>目录类型</FieldLabel>
                  <ToggleGroup
                    variant="outline"
                    value={[form.type]}
                    onValueChange={(v) => v[0] && changeType(v[0] as DirectoryType)}
                    className="w-full"
                  >
                    <ToggleGroupItem value="ad" className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5">
                      Windows Active Directory
                    </ToggleGroupItem>
                    <ToggleGroupItem value="ldap" className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5">
                      OpenLDAP / 通用 LDAP
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ldap-name">配置名称</FieldLabel>
                    <Input
                      id="ldap-name"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="如 总部 AD"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ldap-domain">认证域</FieldLabel>
                    <Input
                      id="ldap-domain"
                      value={form.domain}
                      onChange={(e) => set("domain", e.target.value.toLowerCase())}
                      placeholder="如 corp.local"
                      className="font-mono"
                    />
                    <FieldDescription className="text-(length:--text-description)/5">登录页「企业域」选项的标识</FieldDescription>
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-[1fr_7rem_7rem]">
                  <Field>
                    <FieldLabel htmlFor="ldap-host">服务器地址</FieldLabel>
                    <Input
                      id="ldap-host"
                      value={form.server_host}
                      onChange={(e) => set("server_host", e.target.value)}
                      placeholder="dc01.corp.local"
                      className="font-mono"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ldap-port">端口</FieldLabel>
                    <Input
                      id="ldap-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.port}
                      onChange={(e) => set("port", Number(e.target.value) || 0)}
                      className="font-mono"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ldap-timeout">超时（秒）</FieldLabel>
                    <Input
                      id="ldap-timeout"
                      type="number"
                      min={1}
                      max={60}
                      value={form.timeout_seconds}
                      onChange={(e) => set("timeout_seconds", Number(e.target.value) || 0)}
                      className="font-mono"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel>传输安全</FieldLabel>
                  <ToggleGroup
                    variant="outline"
                    value={[security]}
                    onValueChange={(v) => v[0] && changeSecurity(v[0])}
                    className="w-full"
                  >
                    <ToggleGroupItem value="none" className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5">
                      不加密
                    </ToggleGroupItem>
                    <ToggleGroupItem value="ldaps" className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5">
                      LDAPS (636)
                    </ToggleGroupItem>
                    <ToggleGroupItem value="starttls" className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5">
                      StartTLS
                    </ToggleGroupItem>
                  </ToggleGroup>
                  {security === "none" && (
                    <FieldDescription className="text-(length:--text-description)/5">
                      生产环境建议启用 LDAPS 或 StartTLS，避免域密码明文传输
                    </FieldDescription>
                  )}
                </Field>

                {security !== "none" && (
                  <Field
                    orientation="horizontal"
                    className="items-center justify-between rounded-lg border px-3 py-2.5"
                  >
                    <div>
                      <FieldLabel htmlFor="ldap-insecure">跳过证书校验</FieldLabel>
                      <FieldDescription className="text-(length:--text-description)/5">仅用于自签名证书的测试环境</FieldDescription>
                    </div>
                    <Switch
                      id="ldap-insecure"
                      checked={form.insecure_skip_verify}
                      onCheckedChange={(v) => set("insecure_skip_verify", v)}
                    />
                  </Field>
                )}

                {form.insecure_skip_verify && security !== "none" && (
                  <Alert className="border-amber-500/30 bg-amber-500/5">
                    <ShieldAlert className="text-amber-600" />
                    <AlertDescription>
                      已关闭 TLS 证书校验，连接可能遭受中间人攻击，请勿在生产环境使用。
                    </AlertDescription>
                  </Alert>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ldap-binddn">服务账号 (Bind DN)</FieldLabel>
                    <Input
                      id="ldap-binddn"
                      value={form.bind_dn}
                      onChange={(e) => set("bind_dn", e.target.value)}
                      placeholder="CN=svc-infranexus,OU=Service,DC=corp,DC=local"
                      className="font-mono text-(length:--text-description)/5"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ldap-bindpw">服务账号密码</FieldLabel>
                    <Input
                      id="ldap-bindpw"
                      type="password"
                      autoComplete="new-password"
                      value={form.bind_password}
                      onChange={(e) => set("bind_password", e.target.value)}
                      placeholder={
                        config?.has_bind_password
                          ? "已加密保存，留空则保持不变"
                          : "请输入服务账号密码"
                      }
                    />
                    <FieldDescription className="text-(length:--text-description)/5">
                      使用 AES-GCM 加密后存储，任何接口都不会回显明文
                    </FieldDescription>
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="ldap-basedn">搜索基准 (Base DN)</FieldLabel>
                  <Input
                    id="ldap-basedn"
                    value={form.base_dn}
                    onChange={(e) => set("base_dn", e.target.value)}
                    placeholder="DC=corp,DC=local"
                    className="font-mono text-(length:--text-description)/5"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="ldap-filter">用户过滤器</FieldLabel>
                  <Textarea
                    id="ldap-filter"
                    value={form.user_filter}
                    onChange={(e) => set("user_filter", e.target.value)}
                    rows={2}
                    className="font-mono text-(length:--text-description)/5"
                  />
                  <FieldDescription className="text-(length:--text-description)/5">
                    <code>%s</code> 在登录时替换为转义后的账号，同步时替换为 <code>*</code>
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </TabsContent>

            <TabsContent value="mapping" className="mt-0">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm/5.5 text-muted-foreground">将目录属性映射到本地用户档案字段</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => set("attribute_mapping", { ...DEFAULTS[form.type].mapping })}
                >
                  <RotateCcw />
                  恢复默认
                </Button>
              </div>
              <div className="overflow-hidden rounded-xl border">
                {mappingFields.map((f, i) => (
                  <div
                    key={f.key}
                    className={cn(
                      "grid items-center gap-3 px-4 py-3 sm:grid-cols-[12rem_1fr]",
                      i > 0 && "border-t",
                    )}
                  >
                    <div>
                      <p className="text-sm/5.5 font-medium">{f.label}</p>
                      <p className="text-xs/4.5 text-muted-foreground">{f.hint}</p>
                    </div>
                    <Input
                      value={form.attribute_mapping[f.key]}
                      onChange={(e) =>
                        set("attribute_mapping", {
                          ...form.attribute_mapping,
                          [f.key]: e.target.value,
                        })
                      }
                      placeholder={DEFAULTS[form.type].mapping[f.key]}
                      className="font-mono"
                      aria-label={f.label}
                    />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="org" className="mt-0">
              <FieldGroup className="gap-5">
                <FieldSet>
                  <FieldLegend variant="label">部门同步策略</FieldLegend>
                  <RadioGroup
                    value={form.department_sync.strategy}
                    onValueChange={(v) =>
                      set("department_sync", {
                        ...form.department_sync,
                        strategy: v as LDAPConfigPayload["department_sync"]["strategy"],
                      })
                    }
                    className="grid gap-2"
                  >
                    {[
                      {
                        value: "ou",
                        title: "按 OU 路径自动建树",
                        desc: "例如 OU=平台组,OU=研发中心 → 研发中心 / 平台组，逐级创建缺失部门",
                      },
                      {
                        value: "attribute",
                        title: "按部门属性归类",
                        desc: "读取「部门名称」映射属性，在根部门下创建同名一级部门",
                      },
                      {
                        value: "none",
                        title: "不同步部门",
                        desc: "仅同步账号，部门由管理员在本系统中维护",
                      },
                    ].map((opt) => (
                      <FieldLabel key={opt.value} htmlFor={`strategy-${opt.value}`}>
                        <Field orientation="horizontal">
                          <RadioGroupItem value={opt.value} id={`strategy-${opt.value}`} />
                          <div className="space-y-0.5">
                            <p className="text-sm/5.5 font-medium">{opt.title}</p>
                            <p className="text-(length:--text-description)/5 font-normal text-muted-foreground">{opt.desc}</p>
                          </div>
                        </Field>
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                </FieldSet>

                {form.department_sync.strategy !== "none" && (
                  <Field>
                    <FieldLabel htmlFor="ldap-root">挂载到根部门</FieldLabel>
                    <DepartmentSelect
                      id="ldap-root"
                      nodes={departments}
                      value={form.department_sync.root_department_id}
                      onChange={(id) =>
                        set("department_sync", {
                          ...form.department_sync,
                          root_department_id: id,
                        })
                      }
                      placeholder="作为顶级部门创建"
                      allowClear
                      disableInactive={false}
                    />
                    <FieldDescription className="text-(length:--text-description)/5">自动创建的部门会挂在该部门之下</FieldDescription>
                  </Field>
                )}

                {form.department_sync.strategy === "ou" && (
                  <FieldSet>
                    <div className="flex items-center justify-between">
                      <FieldLegend variant="label">OU → 已有部门映射</FieldLegend>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMappings([...mappings, { ou_dn: "", department_id: "" }])}
                      >
                        <Plus />
                        添加映射
                      </Button>
                    </div>
                    <FieldDescription className="text-(length:--text-description)/5">
                      命中最深的映射 OU 后，其下更深层的 OU 会继续自动建树
                    </FieldDescription>
                    {mappings.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-(length:--text-description)/5 text-muted-foreground">
                        <FolderTree className="size-4" />
                        暂无显式映射，将完全按 OU 路径自动建树
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mappings.map((m, i) => (
                          <div
                            key={i}
                            className="grid items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_14rem_auto]"
                          >
                            <Input
                              value={m.ou_dn}
                              onChange={(e) =>
                                setMappings(
                                  mappings.map((x, j) =>
                                    j === i ? { ...x, ou_dn: e.target.value } : x,
                                  ),
                                )
                              }
                              placeholder="OU=研发中心,DC=corp,DC=local"
                              className="font-mono text-(length:--text-description)/5"
                              aria-label="OU DN"
                            />
                            <DepartmentSelect
                              nodes={departments}
                              value={m.department_id || null}
                              onChange={(id) =>
                                setMappings(
                                  mappings.map((x, j) =>
                                    j === i ? { ...x, department_id: id ?? "" } : x,
                                  ),
                                )
                              }
                              placeholder="映射到部门"
                              disableInactive={false}
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setMappings(mappings.filter((_, j) => j !== i))}
                              aria-label="删除映射"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </FieldSet>
                )}
              </FieldGroup>
            </TabsContent>

            <TabsContent value="policy" className="mt-0">
              <FieldGroup className="gap-4">
                <Field
                  orientation="horizontal"
                  className="items-center justify-between rounded-lg border px-3 py-3"
                >
                  <div>
                    <FieldLabel htmlFor="ldap-enabled">允许域账号登录</FieldLabel>
                    <FieldDescription className="text-(length:--text-description)/5">
                      仅控制当前域的新登录；关闭后从登录页移除并拒绝认证，不影响目录同步或其他域。已有会话按原有效期处理
                    </FieldDescription>
                  </div>
                  <Switch
                    id="ldap-enabled"
                    checked={form.enabled}
                    onCheckedChange={(v) => set("enabled", v)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ldap-role">首次登录 / 同步建档默认角色</FieldLabel>
                  <Select
                    value={form.default_role_id ?? NO_ROLE}
                    onValueChange={(v) => set("default_role_id", v === NO_ROLE ? null : String(v))}
                    items={[
                      { value: NO_ROLE, label: "不分配角色" },
                      ...roles.map((r) => ({
                        value: r.id,
                        label: `${r.name}（${r.code}）`,
                      })),
                    ]}
                  >
                    <SelectTrigger id="ldap-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ROLE}>不分配角色</SelectItem>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name}（{r.code}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field
                  orientation="horizontal"
                  className="items-center justify-between rounded-lg border px-3 py-3"
                >
                  <div>
                    <FieldLabel htmlFor="ldap-sync">定时全量同步</FieldLabel>
                  </div>
                  <Switch
                    id="ldap-sync"
                    checked={form.sync_enabled}
                    onCheckedChange={(v) => set("sync_enabled", v)}
                  />
                </Field>
                {form.sync_enabled && (
                  <Field className="sm:w-56">
                    <FieldLabel htmlFor="ldap-interval">同步间隔（分钟）</FieldLabel>
                    <Input
                      id="ldap-interval"
                      type="number"
                      min={5}
                      value={form.sync_interval_minutes}
                      onChange={(e) => set("sync_interval_minutes", Number(e.target.value) || 0)}
                    />
                    <FieldDescription className="text-(length:--text-description)/5">最小 5 分钟</FieldDescription>
                  </Field>
                )}
                <Field
                  orientation="horizontal"
                  className="items-center justify-between rounded-lg border px-3 py-3"
                >
                  <div>
                    <FieldLabel htmlFor="ldap-disable-missing">停用目录中已删除的账号</FieldLabel>
                    <FieldDescription className="text-(length:--text-description)/5">
                      全量同步时，本地存在但目录中已不存在的域账号将被停用
                    </FieldDescription>
                  </div>
                  <Switch
                    id="ldap-disable-missing"
                    checked={form.disable_missing_users}
                    onCheckedChange={(v) => set("disable_missing_users", v)}
                  />
                </Field>
                <Alert>
                  <Info />
                  <AlertDescription>
                    本地账号永远不会与域账号自动合并；同名时按「域 + 用户名」区分为两个独立身份。
                  </AlertDescription>
                </Alert>
              </FieldGroup>
            </TabsContent>

            {testResult && (
              <Alert
                className={cn(
                  testResult.success
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-destructive/30 bg-destructive/5",
                )}
              >
                {testResult.success ? (
                  <CheckCircle2 className="text-emerald-600" />
                ) : (
                  <CircleX className="text-destructive" />
                )}
                <AlertTitle className="flex flex-wrap items-center gap-2">
                  {testResult.success ? "连接成功" : "连接失败"}
                  <Badge variant="outline" className="font-mono text-xs/4.5">
                    {testResult.server_url}
                  </Badge>
                  <Badge variant="outline" className="text-xs/4.5">
                    {testResult.latency_ms} ms
                  </Badge>
                  {!testResult.success && (
                    <Badge variant="outline" className="text-xs/4.5">
                      失败阶段：
                      {
                        {
                          connect: "建立连接",
                          bind: "服务账号认证",
                          search: "用户检索",
                          done: "完成",
                        }[testResult.stage]
                      }
                    </Badge>
                  )}
                </AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{testResult.message}</p>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {[
                      { key: "connect", label: "1. 建立连接" },
                      { key: "bind", label: "2. 服务账号认证" },
                      { key: "search", label: "3. 用户检索" },
                    ].map((s) => {
                      const order = ["connect", "bind", "search", "done"]
                      const passed =
                        testResult.success || order.indexOf(s.key) < order.indexOf(testResult.stage)
                      const failed = !testResult.success && testResult.stage === s.key
                      return (
                        <div
                          key={s.key}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs/4.5",
                            passed &&
                              "border-emerald-500/30 bg-background text-emerald-700 dark:text-emerald-300",
                            failed &&
                              "border-destructive/40 bg-background font-medium text-destructive",
                            !passed &&
                              !failed &&
                              "border-border/60 bg-background/50 text-muted-foreground",
                          )}
                        >
                          {passed ? (
                            <CheckCircle2 className="size-3 shrink-0" />
                          ) : failed ? (
                            <CircleX className="size-3 shrink-0" />
                          ) : (
                            <CircleDot className="size-3 shrink-0" />
                          )}
                          <span className="truncate">{s.label}</span>
                        </div>
                      )
                    })}
                  </div>
                  {testResult.sample_users.length > 0 && (
                    <span className="block font-mono text-(length:--text-description)/5">
                      示例账号：{testResult.sample_users.join("、")}
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </Tabs>

        <DialogFooter className="m-0 flex-row flex-wrap items-center justify-between gap-2 rounded-b-xl border-t bg-muted/40 px-6 py-3.5 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => test.mutate()}
            disabled={!required || test.isPending}
          >
            {test.isPending ? <Spinner /> : <Plug />}
            测试连接
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {currentStepIndex > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setTab(STEPS[currentStepIndex - 1].key)}
                disabled={save.isPending}
              >
                <ArrowLeft className="size-3.5" />
                上一步
              </Button>
            )}
            {currentStepIndex < STEPS.length - 1 && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setTab(STEPS[currentStepIndex + 1].key)}
                disabled={save.isPending}
              >
                下一步
                <ArrowRight className="size-3.5" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={() => void requestClose()}
              disabled={save.isPending}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => save.mutate()}
              disabled={!valid || optionsLoading || !!optionsError || save.isPending}
            >
              {save.isPending && <Spinner />}
              {config ? "保存配置" : "创建配置"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { LdapConfigDialog as LdapConfigSheet, LdapConfigDialog as LdapConfigStudio }
