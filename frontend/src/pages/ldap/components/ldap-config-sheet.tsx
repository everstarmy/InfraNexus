import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-form"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
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
import { z } from "zod"
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
import { FormField, focusFirstInvalidField, useAppForm } from "@/components/form"
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes"
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

const createLdapSchema = (editing: boolean, hasBindPassword: boolean) =>
  z.object({
    name: z.string().trim().min(1, "配置名称不能为空").max(64, "配置名称不能超过 64 个字符"),
    type: z.enum(["ad", "ldap"]),
    domain: z.string().trim().min(1, "认证域不能为空").max(128, "认证域不能超过 128 个字符"),
    server_host: z.string().trim().min(1, "服务器地址不能为空").max(255, "服务器地址不能超过 255 个字符"),
    port: z.number().int().min(1, "端口必须在 1-65535 之间").max(65535, "端口必须在 1-65535 之间"),
    use_ssl: z.boolean(),
    start_tls: z.boolean(),
    insecure_skip_verify: z.boolean(),
    bind_dn: z.string().trim().min(1, "服务账号 (Bind DN) 不能为空"),
    bind_password: z.string().refine((val) => {
      if (!editing || !hasBindPassword) {
        return val.trim().length > 0
      }
      return true
    }, "服务账号密码不能为空"),
    base_dn: z.string().trim().min(1, "搜索基准 (Base DN) 不能为空"),
    user_filter: z
      .string()
      .trim()
      .min(1, "用户过滤器不能为空")
      .refine((val) => val.includes("%s"), "用户过滤器必须包含 %s 占位符"),
    attribute_mapping: z.object({
      username: z.string().trim().min(1, "登录账号映射不能为空").max(64, "属性名称不能超过 64 个字符"),
      nickname: z.string().trim().min(1, "显示名称映射不能为空").max(64, "属性名称不能超过 64 个字符"),
      email: z.string().trim().max(64, "属性名称不能超过 64 个字符"),
      department: z.string().trim().max(64, "属性名称不能超过 64 个字符"),
      external_id: z.string().trim().max(64, "属性名称不能超过 64 个字符"),
    }),
    department_sync: z
      .object({
        strategy: z.enum(["ou", "attribute", "none"]),
        root_department_id: z.string().nullable(),
        ou_mappings: z
          .array(
            z.object({
              ou_dn: z.string().trim(),
              department_id: z.string(),
            }),
          )
          .max(100, "最多支持 100 条 OU 映射"),
      })
      .superRefine((val, ctx) => {
        if (val.strategy !== "ou") return
        val.ou_mappings.forEach((m, index) => {
          if (!m.ou_dn.trim()) {
            ctx.addIssue({
              code: "custom",
              path: ["ou_mappings", index, "ou_dn"],
              message: "OU DN 不能为空",
            })
          } else if (m.ou_dn.trim().length > 512) {
            ctx.addIssue({
              code: "custom",
              path: ["ou_mappings", index, "ou_dn"],
              message: "OU DN 不能超过 512 个字符",
            })
          }
          if (!m.department_id) {
            ctx.addIssue({
              code: "custom",
              path: ["ou_mappings", index, "department_id"],
              message: "请选择目标部门",
            })
          }
        })
      }),
    default_role_id: z.string().nullable(),
    enabled: z.boolean(),
    sync_enabled: z.boolean(),
    sync_interval_minutes: z.number().int().min(5, "同步间隔最小 5 分钟"),
    disable_missing_users: z.boolean(),
    timeout_seconds: z.number().int().min(1, "超时时间必须在 1-60 秒之间").max(60, "超时时间必须在 1-60 秒之间"),
  })

export const mappingFields: Array<{
  key: keyof AttributeMapping
  label: string
  hint: string
  required?: boolean
}> = [
  { key: "username", label: "登录账号", hint: "作为本地用户名，按域唯一", required: true },
  { key: "nickname", label: "显示名称", hint: "同步为用户姓名 / 昵称", required: true },
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

function fieldToTab(fieldName: string): StudioTab {
  if (fieldName.startsWith("attribute_mapping")) return "mapping"
  if (fieldName.startsWith("department_sync")) return "org"
  if (
    fieldName === "enabled" ||
    fieldName === "default_role_id" ||
    fieldName === "sync_enabled" ||
    fieldName === "sync_interval_minutes" ||
    fieldName === "disable_missing_users"
  ) {
    return "policy"
  }
  return "connection"
}

const STATIC_STEP_FIELDS: Record<StudioTab, string[]> = {
  connection: [
    "name",
    "type",
    "domain",
    "server_host",
    "port",
    "timeout_seconds",
    "bind_dn",
    "bind_password",
    "base_dn",
    "user_filter",
  ],
  mapping: mappingFields.map((f) => `attribute_mapping.${f.key}`),
  org: ["department_sync", "department_sync.strategy", "department_sync.root_department_id", "department_sync.ou_mappings"],
  policy: [
    "enabled",
    "default_role_id",
    "sync_enabled",
    "sync_interval_minutes",
    "disable_missing_users",
  ],
}

const ADVANCED_CONNECTION_FIELDS = new Set(["user_filter", "timeout_seconds"])

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
    desc: "服务器、凭证与连通测试",
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
    desc: "策略确认与调度设置",
  },
]

const STRATEGY_LABELS: Record<LDAPConfigPayload["department_sync"]["strategy"], string> = {
  ou: "按 OU 路径自动建树",
  attribute: "按部门属性归类",
  none: "不同步部门",
}

function formatIssuePath(issuePath: readonly PropertyKey[], formValue: unknown): string {
  let current: unknown = formValue
  let path = ""
  for (let i = 0; i < issuePath.length; i++) {
    const segment = issuePath[i]
    if (segment === undefined || typeof segment === "symbol") continue
    const segmentAsNumber = typeof segment === "number" ? segment : Number(segment)
    if (Array.isArray(current) && !Number.isNaN(segmentAsNumber)) {
      path += `[${segmentAsNumber}]`
    } else {
      path += (path.length > 0 ? "." : "") + String(segment)
    }
    if (typeof current === "object" && current !== null && segment in current) {
      current = (current as Record<PropertyKey, unknown>)[segment]
    } else {
      current = undefined
    }
  }
  return path
}

function getStepFields(step: StudioTab, values: LDAPConfigPayload): string[] {
  if (step !== "org") return STATIC_STEP_FIELDS[step]
  const rowFields = (values.department_sync?.ou_mappings ?? []).flatMap((_, idx) => [
    `department_sync.ou_mappings[${idx}].ou_dn`,
    `department_sync.ou_mappings[${idx}].department_id`,
  ])
  return [...STATIC_STEP_FIELDS.org, ...rowFields]
}

function connectionFingerprint(v: LDAPConfigPayload): string {
  return JSON.stringify({
    type: v.type,
    domain: v.domain,
    server_host: v.server_host,
    port: v.port,
    use_ssl: v.use_ssl,
    start_tls: v.start_tls,
    insecure_skip_verify: v.insecure_skip_verify,
    bind_dn: v.bind_dn,
    bind_password: v.bind_password,
    base_dn: v.base_dn,
    user_filter: v.user_filter,
    timeout_seconds: v.timeout_seconds,
  })
}

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
  const editing = Boolean(config)
  const [tab, setTab] = useState<StudioTab>(initialTab)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [attemptedSteps, setAttemptedSteps] = useState<Set<StudioTab>>(() => new Set())
  const [verifiedSteps, setVerifiedSteps] = useState<Set<StudioTab>>(() => new Set())
  const [testResult, setTestResult] = useState<LDAPTestResult | null>(null)
  const testedFingerprintRef = useRef<string | null>(null)

  const defaultValues = useMemo<LDAPConfigPayload>(() => {
    return config ? fromConfig(config) : emptyForm()
  }, [config])

  const schema = useMemo(
    () => createLdapSchema(editing, Boolean(config?.has_bind_password)),
    [editing, config?.has_bind_password],
  )

  const mutation = useMutation({
    mutationFn: (payload: LDAPConfigPayload) => {
      const normalizedPayload: LDAPConfigPayload = {
        ...payload,
        department_sync: {
          ...payload.department_sync,
          ou_mappings:
            payload.department_sync.strategy === "ou"
              ? payload.department_sync.ou_mappings
              : [],
        },
      }
      return config
        ? ldapService.update(config.id, normalizedPayload)
        : ldapService.create(normalizedPayload)
    },
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
  })

  const focusTabForFields = (fields: string[]) => {
    if (fields.length === 0) return
    if (fields.some((f) => ADVANCED_CONNECTION_FIELDS.has(f))) {
      setShowAdvanced(true)
    }
    const targetTabs = fields.map(fieldToTab)
    if (!targetTabs.includes(tab)) {
      setTab(targetTabs[0])
      requestAnimationFrame(() => focusFirstInvalidField(formRef.current))
    }
  }

  const { form, formRef, submit, hasChanges, formError } = useAppForm<LDAPConfigPayload>({
    defaultValues,
    resetKey: config?.id ?? "new",
    schema,
    open,
    serverFieldNames: {
      name: "name",
      domain: "domain",
      server_host: "server_host",
      serverHost: "server_host",
      port: "port",
      bind_dn: "bind_dn",
      bindDn: "bind_dn",
      bind_password: "bind_password",
      bindPassword: "bind_password",
      base_dn: "base_dn",
      baseDn: "base_dn",
      user_filter: "user_filter",
      userFilter: "user_filter",
      timeout_seconds: "timeout_seconds",
      timeoutSeconds: "timeout_seconds",
      sync_interval_minutes: "sync_interval_minutes",
      syncIntervalMinutes: "sync_interval_minutes",
    },
    onSubmit: async (values) => {
      await mutation.mutateAsync(values)
    },
    onSubmitInvalid: focusTabForFields,
    onServerErrors: (result) => focusTabForFields(result.fields),
    fallbackErrorMessage: config ? "保存配置失败" : "创建配置失败",
  })

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    setShowAdvanced(false)
    setAttemptedSteps(new Set())
    setVerifiedSteps(new Set())
    setTestResult(null)
    testedFingerprintRef.current = null
  }, [open, initialTab, config?.id])

  const formValues = useStore(form.store, (s) => s.values)
  const fieldMeta = useStore(form.store, (s) => s.fieldMeta)
  const submissionAttempts = useStore(form.store, (s) => s.submissionAttempts)
  const isDirty = open && hasChanges
  useUnsavedChanges(isDirty, "目录连接、映射或同步策略尚未保存。离开后这些更改将丢失。")

  const applyIssuesForStep = (step: StudioTab, values: LDAPConfigPayload) => {
    const parsed = schema.safeParse(values)
    const stepIssueMap = new Map<string, string>()

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = formatIssuePath(issue.path, values)
        if (!path || fieldToTab(path) !== step) continue
        if (!stepIssueMap.has(path)) {
          stepIssueMap.set(path, issue.message)
        }
      }
    }

    const fields = new Set([...getStepFields(step, values), ...stepIssueMap.keys()])
    for (const fieldName of fields) {
      const msg = stepIssueMap.get(fieldName)
      const currentMeta = form.getFieldMeta(fieldName as never) as
        | { isTouched?: boolean; errorMap?: Record<string, unknown> }
        | undefined
      const currentDynamic = (currentMeta?.errorMap?.onDynamic as { message?: string } | undefined)?.message

      if (msg) {
        if (!currentMeta?.isTouched || currentDynamic !== msg) {
          form.setFieldMeta(fieldName as never, (prev) => ({
            ...prev,
            isTouched: true,
            errorMap: {
              ...prev.errorMap,
              onDynamic: { message: msg },
            },
          }))
        }
      } else if (currentDynamic !== undefined) {
        form.setFieldMeta(fieldName as never, (prev) => ({
          ...prev,
          errorMap: {
            ...prev.errorMap,
            onDynamic: undefined,
          },
        }))
      }
    }

    return stepIssueMap
  }

  // Re-evaluate attempted steps on edit before initial form submission so errors heal immediately.
  useEffect(() => {
    if (!open || submissionAttempts > 0 || attemptedSteps.size === 0) return
    for (const step of attemptedSteps) {
      applyIssuesForStep(step, formValues)
    }
  }, [open, formValues, attemptedSteps, submissionAttempts, schema])

  const validateStep = (step: StudioTab): boolean => {
    setAttemptedSteps((prev) => {
      if (prev.has(step)) return prev
      const next = new Set(prev)
      next.add(step)
      return next
    })

    const issueMap = applyIssuesForStep(step, form.state.values)
    if (issueMap.size > 0) {
      setVerifiedSteps((prev) => {
        if (!prev.has(step)) return prev
        const next = new Set(prev)
        next.delete(step)
        return next
      })
      if ([...issueMap.keys()].some((k) => ADVANCED_CONNECTION_FIELDS.has(k))) {
        setShowAdvanced(true)
      }
      requestAnimationFrame(() => focusFirstInvalidField(formRef.current))
      return false
    }

    setVerifiedSteps((prev) => {
      if (prev.has(step)) return prev
      const next = new Set(prev)
      next.add(step)
      return next
    })
    return true
  }

  const errorTabs = useMemo(() => {
    const tabsWithErrors = new Set<StudioTab>()
    for (const [name, rawMeta] of Object.entries(fieldMeta)) {
      const meta = rawMeta as
        | { isTouched?: boolean; errors?: unknown[]; errorMap?: { onServer?: unknown; onDynamic?: unknown } }
        | undefined
      if (!meta) continue
      const hasServer = Boolean(meta.errorMap?.onServer)
      const hasClient =
        (meta.isTouched || submissionAttempts > 0) &&
        ((meta.errors?.length ?? 0) > 0 || Boolean(meta.errorMap?.onDynamic))
      if (hasServer || hasClient) {
        tabsWithErrors.add(fieldToTab(name))
      }
    }
    return tabsWithErrors
  }, [fieldMeta, submissionAttempts])

  const requestClose = async () => {
    if (mutation.isPending) return
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

  const security = formValues.use_ssl ? "ldaps" : formValues.start_tls ? "starttls" : "none"
  const currentFingerprint = useMemo(() => connectionFingerprint(formValues), [formValues])
  const testStale =
    Boolean(testResult) &&
    testedFingerprintRef.current !== null &&
    testedFingerprintRef.current !== currentFingerprint

  const changeType = (next: DirectoryType) => {
    const prevType = form.getFieldValue("type")
    const prevFilter = form.getFieldValue("user_filter")
    const prevMapping = form.getFieldValue("attribute_mapping")
    const prevDef = DEFAULTS[prevType]

    form.setFieldValue("type", next)
    if (prevFilter === prevDef.filter || !prevFilter) {
      form.setFieldValue("user_filter", DEFAULTS[next].filter)
    }
    if (JSON.stringify(prevMapping) === JSON.stringify(prevDef.mapping)) {
      form.setFieldValue("attribute_mapping", { ...DEFAULTS[next].mapping })
    }
  }

  const changeSecurity = (mode: string) => {
    const curPort = form.getFieldValue("port")
    form.setFieldValue("use_ssl", mode === "ldaps")
    form.setFieldValue("start_tls", mode === "starttls")
    if (mode === "ldaps" && curPort === 389) {
      form.setFieldValue("port", 636)
    } else if (mode !== "ldaps" && curPort === 636) {
      form.setFieldValue("port", 389)
    }
  }

  const mappings = formValues.department_sync?.ou_mappings ?? []
  const setMappings = (next: typeof mappings) => {
    form.setFieldValue("department_sync", {
      ...form.getFieldValue("department_sync"),
      ou_mappings: next,
    })
  }

  const test = useMutation({
    mutationFn: () => ldapService.test({ ...form.state.values, config_id: config?.id }),
    onSuccess: (res) => {
      testedFingerprintRef.current = connectionFingerprint(form.state.values)
      setTestResult(res.data)
    },
    onError: (err) => notify.apiError(err, "测试连接失败"),
  })

  const handleTestConnection = () => {
    if (test.isPending) return
    if (!validateStep("connection")) {
      if (tab !== "connection") setTab("connection")
      return
    }
    test.mutate()
  }

  const currentStepIndex = STEPS.findIndex((s) => s.key === tab)

  const handleNextStep = () => {
    if (currentStepIndex >= STEPS.length - 1) return
    if (!validateStep(tab)) return
    setTab(STEPS[currentStepIndex + 1].key)
  }

  const handleTabChange = (nextTab: StudioTab) => {
    if (nextTab === tab) return
    if (editing) {
      setTab(nextTab)
      return
    }
    const nextIdx = STEPS.findIndex((s) => s.key === nextTab)
    if (nextIdx <= currentStepIndex) {
      setTab(nextTab)
      return
    }
    // Validate intermediate unverified steps before jumping ahead in create wizard
    for (let i = currentStepIndex; i < nextIdx; i++) {
      const stepKey = STEPS[i].key
      if (!validateStep(stepKey)) {
        if (stepKey !== tab) setTab(stepKey)
        return
      }
    }
    setTab(nextTab)
  }

  const selectedRoleLabel = useMemo(() => {
    if (!formValues.default_role_id) return "不分配默认角色"
    const role = roles.find((r) => r.id === formValues.default_role_id)
    return role ? `${role.name}（${role.code}）` : formValues.default_role_id
  }, [formValues.default_role_id, roles])

  const renderTestResultAlert = () => {
    if (!testResult) return null
    return (
      <Alert
        className={cn(
          testStale
            ? "border-amber-500/30 bg-amber-500/5"
            : testResult.success
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-destructive/30 bg-destructive/5",
        )}
      >
        {testStale ? (
          <Info className="text-amber-600" />
        ) : testResult.success ? (
          <CheckCircle2 className="text-emerald-600" />
        ) : (
          <CircleX className="text-destructive" />
        )}
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {testResult.success ? "连接成功" : "连接失败"}
          {testStale && (
            <Badge variant="outline" className="border-amber-500/40 text-xs/4.5 text-amber-700 dark:text-amber-300">
              连接参数已修改，建议重新测试
            </Badge>
          )}
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
    )
  }

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
            {editing
              ? "修改 Windows AD 或 OpenLDAP 目录连接、属性映射、组织建树及同步策略"
              : "按步骤完成目录连接验证、属性与组织映射及同步策略设置"}
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

        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs
            value={tab}
            onValueChange={(v) => handleTabChange(String(v) as StudioTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
          >
            {/* Stepper / Settings Navigation Bar */}
            <TabsList
              variant="line"
              aria-label="目录配置步骤"
              className="grid h-auto w-full grid-cols-2 gap-2 rounded-none border-b bg-muted/20 px-6 py-3 group-data-horizontal/tabs:h-auto sm:grid-cols-4"
            >
              {STEPS.map((s) => {
                const isActive = tab === s.key
                const hasTabError = errorTabs.has(s.key)
                const isVerified = !hasTabError && verifiedSteps.has(s.key)
                return (
                  <TabsTrigger
                    key={s.key}
                    value={s.key}
                    className={cn(
                      "h-auto justify-start gap-2.5 whitespace-normal rounded-xl border px-3 py-2 text-left transition-colors after:hidden",
                      hasTabError
                        ? "border-destructive/60 bg-destructive/5 ring-1 ring-destructive/20"
                        : isActive
                          ? "border-primary bg-background shadow-2xs ring-1 ring-primary/20"
                          : isVerified
                            ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                            : "border-border/70 bg-background/60 hover:bg-background",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-(length:--text-description)/5 font-semibold",
                        hasTabError
                          ? "bg-destructive text-destructive-foreground"
                          : isActive
                            ? "bg-primary text-primary-foreground"
                            : isVerified
                              ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                              : "bg-muted text-muted-foreground",
                      )}
                    >
                      {hasTabError ? "!" : isVerified ? <Check className="size-3.5" /> : s.step}
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
              {formError && (
                <Alert variant="destructive">
                  <CircleX />
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <TabsContent value="connection" className="mt-0">
                <div className="space-y-4">
                  {/* Section 1: Basic & Server */}
                  <div className="space-y-4 rounded-xl border bg-background/60 p-4">
                    <div className="space-y-0.5">
                      <h3 className="text-sm font-medium">1. 身份标识与服务器地址</h3>
                      <p className="text-xs text-muted-foreground">
                        选择目录类型后会自动预填默认检索过滤器与标准属性映射
                      </p>
                    </div>

                    <Field>
                      <FieldLabel>目录类型</FieldLabel>
                      <form.Subscribe selector={(state) => [state.values.type]}>
                        {([typeVal]) => (
                          <ToggleGroup
                            variant="outline"
                            value={[typeVal]}
                            onValueChange={(v) => v[0] && changeType(v[0] as DirectoryType)}
                            className="w-full"
                          >
                            <ToggleGroupItem
                              value="ad"
                              className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5"
                            >
                              Windows Active Directory
                            </ToggleGroupItem>
                            <ToggleGroupItem
                              value="ldap"
                              className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5"
                            >
                              OpenLDAP / 通用 LDAP
                            </ToggleGroupItem>
                          </ToggleGroup>
                        )}
                      </form.Subscribe>
                    </Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <form.Field name="name">
                        {(field) => (
                          <FormField field={field} label="配置名称" required idPrefix="ldap">
                            {(props) => (
                              <Input
                                {...props}
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                onBlur={field.handleBlur}
                                placeholder="如 总部 AD"
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>

                      <form.Field name="domain">
                        {(field) => (
                          <FormField
                            field={field}
                            label="认证域"
                            required
                            idPrefix="ldap"
                            description="登录页「企业域」选项的标识"
                          >
                            {(props) => (
                              <Input
                                {...props}
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value.toLowerCase())}
                                onBlur={field.handleBlur}
                                placeholder="如 corp.local"
                                className="font-mono"
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                      <form.Field name="server_host">
                        {(field) => (
                          <FormField field={field} label="服务器地址" required idPrefix="ldap">
                            {(props) => (
                              <Input
                                {...props}
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                onBlur={field.handleBlur}
                                placeholder="dc01.corp.local"
                                className="font-mono"
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>

                      <form.Field name="port">
                        {(field) => (
                          <FormField field={field} label="端口" required idPrefix="ldap">
                            {(props) => (
                              <Input
                                {...props}
                                type="number"
                                min={1}
                                max={65535}
                                value={field.state.value}
                                onChange={(e) => field.handleChange(Number(e.target.value) || 0)}
                                onBlur={field.handleBlur}
                                className="font-mono"
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>
                    </div>

                    <Field>
                      <FieldLabel>传输安全</FieldLabel>
                      <form.Subscribe
                        selector={(state) => [state.values.use_ssl, state.values.start_tls]}
                      >
                        {([useSsl, startTls]) => {
                          const sec = useSsl ? "ldaps" : startTls ? "starttls" : "none"
                          return (
                            <>
                              <ToggleGroup
                                variant="outline"
                                value={[sec]}
                                onValueChange={(v) => v[0] && changeSecurity(v[0])}
                                className="w-full"
                              >
                                <ToggleGroupItem
                                  value="none"
                                  className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5"
                                >
                                  不加密
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="ldaps"
                                  className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5"
                                >
                                  LDAPS (636)
                                </ToggleGroupItem>
                                <ToggleGroupItem
                                  value="starttls"
                                  className="h-auto min-h-8 min-w-0 flex-1 whitespace-normal px-2 py-1.5 text-(length:--text-description)/5"
                                >
                                  StartTLS
                                </ToggleGroupItem>
                              </ToggleGroup>
                              {sec === "none" && (
                                <FieldDescription className="text-(length:--text-description)/5">
                                  生产环境建议启用 LDAPS 或 StartTLS，避免域密码明文传输
                                </FieldDescription>
                              )}
                            </>
                          )
                        }}
                      </form.Subscribe>
                    </Field>

                    <form.Subscribe
                      selector={(state) => [
                        state.values.use_ssl,
                        state.values.start_tls,
                        state.values.insecure_skip_verify,
                      ]}
                    >
                      {([useSsl, startTls, insecure]) => {
                        const sec = useSsl ? "ldaps" : startTls ? "starttls" : "none"
                        if (sec === "none") return null
                        return (
                          <>
                            <Field
                              orientation="horizontal"
                              className="items-center justify-between rounded-lg border px-3 py-2.5"
                            >
                              <div>
                                <FieldLabel htmlFor="ldap-insecure">跳过证书校验</FieldLabel>
                                <FieldDescription className="text-(length:--text-description)/5">
                                  仅用于自签名证书的测试环境
                                </FieldDescription>
                              </div>
                              <Switch
                                id="ldap-insecure"
                                checked={insecure}
                                onCheckedChange={(v) => form.setFieldValue("insecure_skip_verify", v)}
                              />
                            </Field>
                            {insecure && (
                              <Alert className="border-amber-500/30 bg-amber-500/5">
                                <ShieldAlert className="text-amber-600" />
                                <AlertDescription>
                                  已关闭 TLS 证书校验，连接可能遭受中间人攻击，请勿在生产环境使用。
                                </AlertDescription>
                              </Alert>
                            )}
                          </>
                        )
                      }}
                    </form.Subscribe>
                  </div>

                  {/* Section 2: Credentials & Search Base */}
                  <div className="space-y-4 rounded-xl border bg-background/60 p-4">
                    <div className="space-y-0.5">
                      <h3 className="text-sm font-medium">2. 服务账号与目录检索范围</h3>
                      <p className="text-xs text-muted-foreground">
                        用于执行用户认证及定时同步，建议配置只读权限服务账号
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <form.Field name="bind_dn">
                        {(field) => (
                          <FormField field={field} label="服务账号 (Bind DN)" required idPrefix="ldap">
                            {(props) => (
                              <Input
                                {...props}
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                onBlur={field.handleBlur}
                                placeholder="CN=svc-infranexus,OU=Service,DC=corp,DC=local"
                                className="font-mono text-(length:--text-description)/5"
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>

                      <form.Field name="bind_password">
                        {(field) => (
                          <FormField
                            field={field}
                            label="服务账号密码"
                            required={!config?.has_bind_password}
                            idPrefix="ldap"
                            description="使用 AES-GCM 加密后存储，任何接口都不会回显明文"
                          >
                            {(props) => (
                              <Input
                                {...props}
                                type="password"
                                autoComplete="new-password"
                                value={field.state.value}
                                onChange={(e) => field.handleChange(e.target.value)}
                                onBlur={field.handleBlur}
                                placeholder={
                                  config?.has_bind_password
                                    ? "已加密保存，留空则保持不变"
                                    : "请输入服务账号密码"
                                }
                              />
                            )}
                          </FormField>
                        )}
                      </form.Field>
                    </div>

                    <form.Field name="base_dn">
                      {(field) => (
                        <FormField field={field} label="搜索基准 (Base DN)" required idPrefix="ldap">
                          {(props) => (
                            <Input
                              {...props}
                              value={field.state.value}
                              onChange={(e) => field.handleChange(e.target.value)}
                              onBlur={field.handleBlur}
                              placeholder="DC=corp,DC=local"
                              className="font-mono text-(length:--text-description)/5"
                            />
                          )}
                        </FormField>
                      )}
                    </form.Field>

                    {/* Collapsible Advanced Query & Timeout */}
                    <div className="rounded-lg border bg-muted/20">
                      <button
                        type="button"
                        onClick={() => setShowAdvanced((v) => !v)}
                        aria-expanded={showAdvanced}
                        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-medium text-foreground hover:bg-muted/40"
                      >
                        <span>高级检索参数（用户过滤器与连接超时）</span>
                        <ChevronDown
                          className={cn(
                            "size-4 text-muted-foreground transition-transform",
                            showAdvanced && "rotate-180",
                          )}
                        />
                      </button>
                      <div className={cn("space-y-4 border-t p-3", !showAdvanced && "hidden")}>
                        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                          <form.Field name="user_filter">
                            {(field) => (
                              <FormField
                                field={field}
                                label="用户过滤器"
                                required
                                idPrefix="ldap"
                                description={
                                  <>
                                    <code>%s</code> 在登录时替换为转义后的账号，同步时替换为 <code>*</code>
                                  </>
                                }
                              >
                                {(props) => (
                                  <Textarea
                                    {...props}
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                    onBlur={field.handleBlur}
                                    rows={2}
                                    className="font-mono text-(length:--text-description)/5"
                                  />
                                )}
                              </FormField>
                            )}
                          </form.Field>

                          <form.Field name="timeout_seconds">
                            {(field) => (
                              <FormField field={field} label="超时（秒）" required idPrefix="ldap">
                                {(props) => (
                                  <Input
                                    {...props}
                                    type="number"
                                    min={1}
                                    max={60}
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(Number(e.target.value) || 0)}
                                    onBlur={field.handleBlur}
                                    className="font-mono"
                                  />
                                )}
                              </FormField>
                            )}
                          </form.Field>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: Embedded Connectivity Verification */}
                  <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-medium">3. 目录连通性测试</h3>
                          {testResult?.success && !testStale && (
                            <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300">
                              已验证连通
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          推荐在进入下一步前先验证网络、Bind 凭据与 Base DN 检索是否正常
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleTestConnection}
                        disabled={test.isPending}
                      >
                        {test.isPending ? <Spinner /> : <Plug />}
                        测试连接
                      </Button>
                    </div>
                    {renderTestResultAlert()}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="mapping" className="mt-0">
                <form.Subscribe selector={(state) => [state.values.type]}>
                  {([curType]) => (
                    <>
                      <div className="mb-4 flex items-center justify-between">
                        <p className="text-sm/5.5 text-muted-foreground">
                          将目录属性映射到本地用户档案字段
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            form.setFieldValue("attribute_mapping", {
                              ...DEFAULTS[curType].mapping,
                            })
                          }
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
                              <p className="text-sm/5.5 font-medium">
                                {f.label}
                                {f.required && <span className="ml-0.5 text-destructive">*</span>}
                              </p>
                              <p className="text-xs/4.5 text-muted-foreground">{f.hint}</p>
                            </div>
                            <form.Field name={`attribute_mapping.${f.key}` as `attribute_mapping.${keyof AttributeMapping}`}>
                              {(field) => (
                                <FormField field={field} idPrefix="ldap">
                                  {(props) => (
                                    <Input
                                      {...props}
                                      value={field.state.value}
                                      onChange={(e) => field.handleChange(e.target.value)}
                                      onBlur={field.handleBlur}
                                      placeholder={DEFAULTS[curType].mapping[f.key]}
                                      className="font-mono"
                                      aria-label={f.label}
                                    />
                                  )}
                                </FormField>
                              )}
                            </form.Field>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </form.Subscribe>
              </TabsContent>

              <TabsContent value="org" className="mt-0">
                <FieldGroup className="gap-5">
                  <FieldSet>
                    <FieldLegend variant="label">部门同步策略</FieldLegend>
                    <form.Subscribe
                      selector={(state) => [state.values.department_sync?.strategy]}
                    >
                      {([strategy]) => (
                        <RadioGroup
                          value={strategy ?? "ou"}
                          onValueChange={(v) =>
                            form.setFieldValue("department_sync", {
                              ...form.getFieldValue("department_sync"),
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
                                  <p className="text-(length:--text-description)/5 font-normal text-muted-foreground">
                                    {opt.desc}
                                  </p>
                                </div>
                              </Field>
                            </FieldLabel>
                          ))}
                        </RadioGroup>
                      )}
                    </form.Subscribe>
                  </FieldSet>

                  <form.Subscribe
                    selector={(state) => [
                      state.values.department_sync?.strategy,
                      state.values.department_sync?.root_department_id,
                    ]}
                  >
                    {([strategy, rootDeptId]) => {
                      if (strategy === "none") return null
                      return (
                        <Field>
                          <FieldLabel htmlFor="ldap-root">挂载到根部门</FieldLabel>
                          <DepartmentSelect
                            id="ldap-root"
                            nodes={departments}
                            value={rootDeptId}
                            onChange={(id) =>
                              form.setFieldValue("department_sync", {
                                ...form.getFieldValue("department_sync"),
                                root_department_id: id,
                              })
                            }
                            placeholder="作为顶级部门创建"
                            allowClear
                            disableInactive={false}
                          />
                          <FieldDescription className="text-(length:--text-description)/5">
                            自动创建的部门会挂在该部门之下
                          </FieldDescription>
                        </Field>
                      )
                    }}
                  </form.Subscribe>

                  <form.Subscribe
                    selector={(state) => [state.values.department_sync?.strategy]}
                  >
                    {([strategy]) => {
                      if (strategy !== "ou") return null
                      return (
                        <FieldSet>
                          <div className="flex items-center justify-between">
                            <FieldLegend variant="label">OU → 已有部门映射</FieldLegend>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setMappings([...mappings, { ou_dn: "", department_id: "" }])
                              }
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
                              {mappings.map((_m, i) => (
                                <div
                                  key={i}
                                  className="grid items-start gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_14rem_auto]"
                                >
                                  <form.Field name={`department_sync.ou_mappings[${i}].ou_dn` as `department_sync.ou_mappings[${number}].ou_dn`}>
                                    {(field) => (
                                      <FormField
                                        field={field}
                                        id={`ldap-ou-dn-${i}`}
                                        idPrefix="ldap"
                                      >
                                        {(props) => (
                                          <Input
                                            {...props}
                                            value={field.state.value ?? ""}
                                            onChange={(e) => field.handleChange(e.target.value)}
                                            onBlur={field.handleBlur}
                                            placeholder="OU=研发中心,DC=corp,DC=local"
                                            className="font-mono text-(length:--text-description)/5"
                                            aria-label="OU DN"
                                          />
                                        )}
                                      </FormField>
                                    )}
                                  </form.Field>
                                  <form.Field name={`department_sync.ou_mappings[${i}].department_id` as `department_sync.ou_mappings[${number}].department_id`}>
                                    {(field) => (
                                      <FormField
                                        field={field}
                                        id={`ldap-ou-dept-${i}`}
                                        idPrefix="ldap"
                                      >
                                        {(props) => (
                                          <DepartmentSelect
                                            id={props.id}
                                            nodes={departments}
                                            value={field.state.value || null}
                                            onChange={(id) => field.handleChange(id ?? "")}
                                            placeholder="映射到部门"
                                            disableInactive={false}
                                            aria-invalid={props["aria-invalid"]}
                                            aria-describedby={props["aria-describedby"]}
                                          />
                                        )}
                                      </FormField>
                                    )}
                                  </form.Field>
                                  <Button
                                    type="button"
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
                      )
                    }}
                  </form.Subscribe>
                </FieldGroup>
              </TabsContent>

              <TabsContent value="policy" className="mt-0">
                <FieldGroup className="gap-4">
                  <form.Field name="enabled">
                    {(field) => (
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
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v)}
                        />
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="default_role_id">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="ldap-role">首次登录 / 同步建档默认角色</FieldLabel>
                        <Select
                          value={field.state.value ?? NO_ROLE}
                          onValueChange={(v) =>
                            field.handleChange(v === NO_ROLE ? null : String(v))
                          }
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
                    )}
                  </form.Field>

                  <form.Field name="sync_enabled">
                    {(field) => (
                      <Field
                        orientation="horizontal"
                        className="items-center justify-between rounded-lg border px-3 py-3"
                      >
                        <div>
                          <FieldLabel htmlFor="ldap-sync">定时全量同步</FieldLabel>
                        </div>
                        <Switch
                          id="ldap-sync"
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v)}
                        />
                      </Field>
                    )}
                  </form.Field>

                  <form.Subscribe selector={(state) => [state.values.sync_enabled]}>
                    {([syncEnabled]) => {
                      if (!syncEnabled) return null
                      return (
                        <form.Field name="sync_interval_minutes">
                          {(field) => (
                            <FormField
                              field={field}
                              label="同步间隔（分钟）"
                              required
                              idPrefix="ldap"
                              description="最小 5 分钟"
                              className="sm:w-56"
                            >
                              {(props) => (
                                <Input
                                  {...props}
                                  type="number"
                                  min={5}
                                  value={field.state.value}
                                  onChange={(e) =>
                                    field.handleChange(Number(e.target.value) || 0)
                                  }
                                  onBlur={field.handleBlur}
                                />
                              )}
                            </FormField>
                          )}
                        </form.Field>
                      )
                    }}
                  </form.Subscribe>

                  <form.Field name="disable_missing_users">
                    {(field) => (
                      <Field
                        orientation="horizontal"
                        className="items-center justify-between rounded-lg border px-3 py-3"
                      >
                        <div>
                          <FieldLabel htmlFor="ldap-disable-missing">
                            停用目录中已删除的账号
                          </FieldLabel>
                          <FieldDescription className="text-(length:--text-description)/5">
                            全量同步时，本地存在但目录中已不存在的域账号将被停用
                          </FieldDescription>
                        </div>
                        <Switch
                          id="ldap-disable-missing"
                          checked={field.state.value}
                          onCheckedChange={(v) => field.handleChange(v)}
                        />
                      </Field>
                    )}
                  </form.Field>

                  <Alert>
                    <Info />
                    <AlertDescription>
                      本地账号永远不会与域账号自动合并；同名时按「域 + 用户名」区分为两个独立身份。
                    </AlertDescription>
                  </Alert>

                  {/* Pre-save Summary Card */}
                  <div className="space-y-2.5 rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-medium">配置摘要</h4>
                      {testResult?.success && !testStale ? (
                        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300">
                          连通测试已通过（{testResult.latency_ms} ms）
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {testStale ? "参数已调整，建议重测" : "尚未执行连通测试"}
                        </Badge>
                      )}
                    </div>
                    <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">目录与认证域</dt>
                        <dd className="mt-0.5 font-medium text-foreground">
                          {formValues.type === "ad" ? "Windows AD" : "OpenLDAP"} ·{" "}
                          <span className="font-mono">{formValues.domain || "未填写"}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">服务器与传输安全</dt>
                        <dd className="mt-0.5 font-mono text-foreground">
                          {formValues.server_host || "未填写"}:{formValues.port} (
                          {security === "ldaps" ? "LDAPS" : security === "starttls" ? "StartTLS" : "不加密"})
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">组织部门策略</dt>
                        <dd className="mt-0.5 font-medium text-foreground">
                          {STRATEGY_LABELS[formValues.department_sync.strategy]}
                          {formValues.department_sync.strategy === "ou" &&
                            `（显式映射 ${mappings.length} 条）`}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">默认角色与同步</dt>
                        <dd className="mt-0.5 font-medium text-foreground">
                          {selectedRoleLabel} ·{" "}
                          {formValues.sync_enabled
                            ? `每 ${formValues.sync_interval_minutes} 分钟全量同步`
                            : "仅手动同步"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </FieldGroup>
              </TabsContent>

              {tab !== "connection" && testResult && renderTestResultAlert()}
            </div>
          </Tabs>

          <DialogFooter className="m-0 flex-row flex-wrap items-center justify-between gap-2 rounded-b-xl border-t bg-muted/40 px-6 py-3.5 sm:justify-between">
            {editing ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={test.isPending}
              >
                {test.isPending ? <Spinner /> : <Plug />}
                测试连接
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                第 {currentStepIndex + 1} / {STEPS.length} 步 · {STEPS[currentStepIndex]?.title}
              </span>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {!editing && currentStepIndex > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTab(STEPS[currentStepIndex - 1].key)}
                  disabled={mutation.isPending}
                >
                  <ArrowLeft className="size-3.5" />
                  上一步
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                onClick={() => void requestClose()}
                disabled={mutation.isPending}
              >
                取消
              </Button>

              {!editing && currentStepIndex < STEPS.length - 1 ? (
                <Button
                  type="button"
                  onClick={handleNextStep}
                  disabled={mutation.isPending}
                >
                  下一步
                  <ArrowRight className="size-3.5" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={optionsLoading || !!optionsError || mutation.isPending}
                >
                  {mutation.isPending && <Spinner />}
                  {config ? "保存配置" : "创建配置"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { LdapConfigDialog as LdapConfigSheet, LdapConfigDialog as LdapConfigStudio }
