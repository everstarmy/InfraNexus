import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleX, FolderTree, Info, Network, Plug, Plus, RotateCcw, ShieldAlert, Trash2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DepartmentSelect } from "@/components/common/department-select"
import { getErrorMessage } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { cn } from "@/lib/utils"
import type { DepartmentNode } from "@/services/departments"
import { ldapService, type AttributeMapping, type DirectoryType, type LDAPConfig, type LDAPConfigPayload, type LDAPTestResult } from "@/services/ldap"
import type { RoleRef } from "@/services/types"

const DEFAULTS: Record<DirectoryType, { filter: string; mapping: AttributeMapping }> = {
  ad: {
    filter: "(&(objectClass=user)(objectCategory=person)(sAMAccountName=%s))",
    mapping: { username: "sAMAccountName", email: "mail", nickname: "displayName", department: "department", external_id: "objectGUID" },
  },
  ldap: {
    filter: "(&(objectClass=inetOrgPerson)(uid=%s))",
    mapping: { username: "uid", email: "mail", nickname: "cn", department: "ou", external_id: "entryUUID" },
  },
}

const NO_ROLE = "__none__"

function emptyForm(): LDAPConfigPayload {
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
    department_sync: { strategy: "ou", root_department_id: null, ou_mappings: [] },
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

const mappingFields: Array<{ key: keyof AttributeMapping; label: string; hint: string }> = [
  { key: "username", label: "登录账号", hint: "作为本地用户名，按域唯一" },
  { key: "nickname", label: "显示名称", hint: "同步为用户姓名 / 昵称" },
  { key: "email", label: "电子邮箱", hint: "与其他账号冲突时自动忽略" },
  { key: "department", label: "部门名称", hint: "部门策略为「按部门属性」时使用" },
  { key: "external_id", label: "唯一标识", hint: "用于改名后仍能匹配同一账号（AD 推荐 objectGUID）" },
]

export function LdapConfigSheet({
  open,
  config,
  departments,
  roles,
  onOpenChange,
}: {
  open: boolean
  config: LDAPConfig | null
  departments: DepartmentNode[]
  roles: RoleRef[]
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<LDAPConfigPayload>(emptyForm)
  const [tab, setTab] = useState("connection")
  const [error, setError] = useState("")
  const [testResult, setTestResult] = useState<LDAPTestResult | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(config ? fromConfig(config) : emptyForm())
    setTab("connection")
    setError("")
    setTestResult(null)
  }, [open, config])

  const set = <K extends keyof LDAPConfigPayload>(key: K, value: LDAPConfigPayload[K]) => setForm((f) => ({ ...f, [key]: value }))
  const security = form.use_ssl ? "ldaps" : form.start_tls ? "starttls" : "none"

  const changeType = (next: DirectoryType) =>
    setForm((f) => {
      const prev = DEFAULTS[f.type]
      return {
        ...f,
        type: next,
        user_filter: f.user_filter === prev.filter || !f.user_filter ? DEFAULTS[next].filter : f.user_filter,
        attribute_mapping: JSON.stringify(f.attribute_mapping) === JSON.stringify(prev.mapping) ? { ...DEFAULTS[next].mapping } : f.attribute_mapping,
      }
    })

  const changeSecurity = (mode: string) =>
    setForm((f) => ({
      ...f,
      use_ssl: mode === "ldaps",
      start_tls: mode === "starttls",
      port: mode === "ldaps" && f.port === 389 ? 636 : mode !== "ldaps" && f.port === 636 ? 389 : f.port,
    }))

  const mappings = form.department_sync.ou_mappings ?? []
  const setMappings = (next: typeof mappings) => set("department_sync", { ...form.department_sync, ou_mappings: next })

  const required = [form.name, form.domain, form.server_host, form.bind_dn, form.base_dn, form.user_filter].every((v) => v.trim())
  const passwordReady = !!config?.has_bind_password || !!form.bind_password
  const valid = required && passwordReady && form.user_filter.includes("%s") && (!form.sync_enabled || form.sync_interval_minutes >= 5)

  const save = useMutation({
    mutationFn: () => (config ? ldapService.update(config.id, form) : ldapService.create(form)),
    onSuccess: (res) => {
      notify.success(config ? "目录配置已更新" : "目录配置已创建", `${res.data.name}（${res.data.domain}）`)
      void queryClient.invalidateQueries({ queryKey: ["ldap"] })
      void queryClient.invalidateQueries({ queryKey: ["auth", "domains"] })
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      onOpenChange(false)
    },
    onError: (err) => setError(getErrorMessage(err, "保存失败")),
  })

  const test = useMutation({
    mutationFn: () => ldapService.test({ ...form, config_id: config?.id }),
    onSuccess: (res) => setTestResult(res.data),
    onError: (err) => notify.apiError(err, "测试连接失败"),
  })

  return (
    <Sheet open={open} onOpenChange={(next) => !save.isPending && onOpenChange(next)}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-5">
          <SheetTitle className="flex items-center gap-2">
            <Network className="size-4.5 text-primary" />
            {config ? `编辑目录配置 · ${config.name}` : "新建目录配置"}
          </SheetTitle>
          <SheetDescription>连接 Windows AD 或 OpenLDAP，开启域账号登录并同步组织架构</SheetDescription>
        </SheetHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-0 flex-1 gap-0">
          <div className="border-b px-5 py-3">
            <TabsList className="w-full">
              <TabsTrigger value="connection">连接</TabsTrigger>
              <TabsTrigger value="mapping">属性映射</TabsTrigger>
              <TabsTrigger value="org">组织映射</TabsTrigger>
              <TabsTrigger value="policy">同步与登录</TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {error && (
              <Alert variant="destructive" className="mb-4">
                <CircleX />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <TabsContent value="connection">
              <FieldGroup className="gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="ldap-name">配置名称</FieldLabel>
                    <Input id="ldap-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="如 总部 AD" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ldap-domain">认证域</FieldLabel>
                    <Input id="ldap-domain" value={form.domain} onChange={(e) => set("domain", e.target.value.toLowerCase())} placeholder="如 corp.local" className="font-mono" />
                    <FieldDescription>登录页「企业域」选项的标识</FieldDescription>
                  </Field>
                </div>
                <Field>
                  <FieldLabel>目录类型</FieldLabel>
                  <ToggleGroup variant="outline" value={[form.type]} onValueChange={(v) => v[0] && changeType(v[0] as DirectoryType)} className="w-full">
                    <ToggleGroupItem value="ad" className="flex-1">Windows Active Directory</ToggleGroupItem>
                    <ToggleGroupItem value="ldap" className="flex-1">OpenLDAP / 通用 LDAP</ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                  <Field>
                    <FieldLabel htmlFor="ldap-host">服务器地址</FieldLabel>
                    <Input id="ldap-host" value={form.server_host} onChange={(e) => set("server_host", e.target.value)} placeholder="dc01.corp.local" className="font-mono" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ldap-port">端口</FieldLabel>
                    <Input id="ldap-port" type="number" min={1} max={65535} value={form.port} onChange={(e) => set("port", Number(e.target.value) || 0)} className="font-mono" />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>传输安全</FieldLabel>
                  <ToggleGroup variant="outline" value={[security]} onValueChange={(v) => v[0] && changeSecurity(v[0])} className="w-full">
                    <ToggleGroupItem value="none" className="flex-1">不加密</ToggleGroupItem>
                    <ToggleGroupItem value="ldaps" className="flex-1">LDAPS (636)</ToggleGroupItem>
                    <ToggleGroupItem value="starttls" className="flex-1">StartTLS</ToggleGroupItem>
                  </ToggleGroup>
                  {security === "none" && <FieldDescription>生产环境建议启用 LDAPS 或 StartTLS，避免域密码明文传输</FieldDescription>}
                </Field>
                {security !== "none" && (
                  <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-2.5">
                    <div>
                      <FieldLabel htmlFor="ldap-insecure">跳过证书校验</FieldLabel>
                      <FieldDescription>仅用于自签名证书的测试环境</FieldDescription>
                    </div>
                    <Switch id="ldap-insecure" checked={form.insecure_skip_verify} onCheckedChange={(v) => set("insecure_skip_verify", v)} />
                  </Field>
                )}
                {form.insecure_skip_verify && security !== "none" && (
                  <Alert className="border-amber-500/30 bg-amber-500/5">
                    <ShieldAlert className="text-amber-600" />
                    <AlertDescription>已关闭 TLS 证书校验，连接可能遭受中间人攻击，请勿在生产环境使用。</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <FieldLabel htmlFor="ldap-binddn">服务账号 (Bind DN)</FieldLabel>
                  <Input id="ldap-binddn" value={form.bind_dn} onChange={(e) => set("bind_dn", e.target.value)} placeholder="CN=svc-infranexus,OU=Service,DC=corp,DC=local" className="font-mono text-xs" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ldap-bindpw">服务账号密码</FieldLabel>
                  <Input
                    id="ldap-bindpw"
                    type="password"
                    autoComplete="new-password"
                    value={form.bind_password}
                    onChange={(e) => set("bind_password", e.target.value)}
                    placeholder={config?.has_bind_password ? "已加密保存，留空则保持不变" : "请输入服务账号密码"}
                  />
                  <FieldDescription>使用 AES-GCM 加密后存储，任何接口都不会回显明文</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ldap-basedn">搜索基准 (Base DN)</FieldLabel>
                  <Input id="ldap-basedn" value={form.base_dn} onChange={(e) => set("base_dn", e.target.value)} placeholder="DC=corp,DC=local" className="font-mono text-xs" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ldap-filter">用户过滤器</FieldLabel>
                  <Textarea id="ldap-filter" value={form.user_filter} onChange={(e) => set("user_filter", e.target.value)} rows={2} className="font-mono text-xs" />
                  <FieldDescription>
                    <code>%s</code> 在登录时替换为转义后的账号，同步时替换为 <code>*</code>
                  </FieldDescription>
                </Field>
                <Field className="sm:w-48">
                  <FieldLabel htmlFor="ldap-timeout">超时（秒）</FieldLabel>
                  <Input id="ldap-timeout" type="number" min={1} max={60} value={form.timeout_seconds} onChange={(e) => set("timeout_seconds", Number(e.target.value) || 0)} />
                </Field>
              </FieldGroup>
            </TabsContent>

            <TabsContent value="mapping">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">将目录属性映射到本地用户档案字段</p>
                <Button variant="ghost" size="sm" onClick={() => set("attribute_mapping", { ...DEFAULTS[form.type].mapping })}>
                  <RotateCcw />
                  恢复默认
                </Button>
              </div>
              <div className="overflow-hidden rounded-xl border">
                {mappingFields.map((f, i) => (
                  <div key={f.key} className={cn("grid items-center gap-3 px-4 py-3 sm:grid-cols-[10rem_1fr]", i > 0 && "border-t")}>
                    <div>
                      <p className="text-sm font-medium">{f.label}</p>
                      <p className="text-[11px] text-muted-foreground">{f.hint}</p>
                    </div>
                    <Input
                      value={form.attribute_mapping[f.key]}
                      onChange={(e) => set("attribute_mapping", { ...form.attribute_mapping, [f.key]: e.target.value })}
                      placeholder={DEFAULTS[form.type].mapping[f.key]}
                      className="font-mono"
                      aria-label={f.label}
                    />
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="org">
              <FieldGroup className="gap-5">
                <FieldSet>
                  <FieldLegend variant="label">部门同步策略</FieldLegend>
                  <RadioGroup
                    value={form.department_sync.strategy}
                    onValueChange={(v) => set("department_sync", { ...form.department_sync, strategy: v as LDAPConfigPayload["department_sync"]["strategy"] })}
                    className="grid gap-2"
                  >
                    {[
                      { value: "ou", title: "按 OU 路径自动建树", desc: "例如 OU=平台组,OU=研发中心 → 研发中心 / 平台组，逐级创建缺失部门" },
                      { value: "attribute", title: "按部门属性归类", desc: "读取「部门名称」映射属性，在根部门下创建同名一级部门" },
                      { value: "none", title: "不同步部门", desc: "仅同步账号，部门由管理员在本系统中维护" },
                    ].map((opt) => (
                      <FieldLabel key={opt.value} htmlFor={`strategy-${opt.value}`}>
                        <Field orientation="horizontal">
                          <RadioGroupItem value={opt.value} id={`strategy-${opt.value}`} />
                          <div className="space-y-0.5">
                            <p className="text-sm font-medium">{opt.title}</p>
                            <p className="text-xs font-normal text-muted-foreground">{opt.desc}</p>
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
                      onChange={(id) => set("department_sync", { ...form.department_sync, root_department_id: id })}
                      placeholder="作为顶级部门创建"
                      allowClear
                      disableInactive={false}
                    />
                    <FieldDescription>自动创建的部门会挂在该部门之下</FieldDescription>
                  </Field>
                )}

                {form.department_sync.strategy === "ou" && (
                  <FieldSet>
                    <div className="flex items-center justify-between">
                      <FieldLegend variant="label">OU → 已有部门映射</FieldLegend>
                      <Button variant="outline" size="sm" onClick={() => setMappings([...mappings, { ou_dn: "", department_id: "" }])}>
                        <Plus />
                        添加映射
                      </Button>
                    </div>
                    <FieldDescription>命中最深的映射 OU 后，其下更深层的 OU 会继续自动建树</FieldDescription>
                    {mappings.length === 0 ? (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
                        <FolderTree className="size-4" />
                        暂无显式映射，将完全按 OU 路径自动建树
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {mappings.map((m, i) => (
                          <div key={i} className="grid items-center gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_12rem_auto]">
                            <Input
                              value={m.ou_dn}
                              onChange={(e) => setMappings(mappings.map((x, j) => (j === i ? { ...x, ou_dn: e.target.value } : x)))}
                              placeholder="OU=研发中心,DC=corp,DC=local"
                              className="font-mono text-xs"
                              aria-label="OU DN"
                            />
                            <DepartmentSelect
                              nodes={departments}
                              value={m.department_id || null}
                              onChange={(id) => setMappings(mappings.map((x, j) => (j === i ? { ...x, department_id: id ?? "" } : x)))}
                              placeholder="映射到部门"
                              disableInactive={false}
                            />
                            <Button variant="ghost" size="icon-sm" onClick={() => setMappings(mappings.filter((_, j) => j !== i))} aria-label="删除映射">
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

            <TabsContent value="policy">
              <FieldGroup className="gap-4">
                <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-3">
                  <div>
                    <FieldLabel htmlFor="ldap-enabled">允许域账号登录</FieldLabel>
                    <FieldDescription>关闭后登录页不再提供该域，已同步的账号也无法登录</FieldDescription>
                  </div>
                  <Switch id="ldap-enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ldap-role">首次登录 / 同步建档默认角色</FieldLabel>
                  <Select
                    value={form.default_role_id ?? NO_ROLE}
                    onValueChange={(v) => set("default_role_id", v === NO_ROLE ? null : String(v))}
                    items={[{ value: NO_ROLE, label: "不分配角色" }, ...roles.map((r) => ({ value: r.id, label: `${r.name}（${r.code}）` }))]}
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
                <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-3">
                  <div>
                    <FieldLabel htmlFor="ldap-sync">定时全量同步</FieldLabel>
                    <FieldDescription>由后台调度器按间隔自动执行</FieldDescription>
                  </div>
                  <Switch id="ldap-sync" checked={form.sync_enabled} onCheckedChange={(v) => set("sync_enabled", v)} />
                </Field>
                {form.sync_enabled && (
                  <Field className="sm:w-56">
                    <FieldLabel htmlFor="ldap-interval">同步间隔（分钟）</FieldLabel>
                    <Input id="ldap-interval" type="number" min={5} value={form.sync_interval_minutes} onChange={(e) => set("sync_interval_minutes", Number(e.target.value) || 0)} />
                    <FieldDescription>最小 5 分钟</FieldDescription>
                  </Field>
                )}
                <Field orientation="horizontal" className="items-center justify-between rounded-lg border px-3 py-3">
                  <div>
                    <FieldLabel htmlFor="ldap-disable-missing">停用目录中已删除的账号</FieldLabel>
                    <FieldDescription>全量同步时，本地存在但目录中已不存在的域账号将被停用</FieldDescription>
                  </div>
                  <Switch id="ldap-disable-missing" checked={form.disable_missing_users} onCheckedChange={(v) => set("disable_missing_users", v)} />
                </Field>
                <Alert>
                  <Info />
                  <AlertDescription>本地账号永远不会与域账号自动合并；同名时按「域 + 用户名」区分为两个独立身份。</AlertDescription>
                </Alert>
              </FieldGroup>
            </TabsContent>

            {testResult && (
              <Alert
                className={cn(
                  "mt-4",
                  testResult.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5",
                )}
              >
                {testResult.success ? <CheckCircle2 className="text-emerald-600" /> : <CircleX className="text-destructive" />}
                <AlertTitle className="flex flex-wrap items-center gap-2">
                  {testResult.success ? "连接成功" : "连接失败"}
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {testResult.server_url}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {testResult.latency_ms} ms
                  </Badge>
                  {!testResult.success && (
                    <Badge variant="outline" className="text-[10px]">
                      失败阶段：{{ connect: "建立连接", bind: "服务账号认证", search: "用户检索", done: "完成" }[testResult.stage]}
                    </Badge>
                  )}
                </AlertTitle>
                <AlertDescription>
                  {testResult.message}
                  {testResult.sample_users.length > 0 && (
                    <span className="mt-1 block font-mono text-xs">示例账号：{testResult.sample_users.join("、")}</span>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </Tabs>

        <SheetFooter className="flex-row justify-between border-t">
          <Button variant="outline" onClick={() => test.mutate()} disabled={!required || test.isPending}>
            {test.isPending ? <Spinner /> : <Plug />}
            测试连接
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
              取消
            </Button>
            <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
              {save.isPending && <Spinner />}
              {config ? "保存配置" : "创建配置"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
