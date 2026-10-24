import { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Fingerprint,
  Info,
  KeyRound,
  Layers,
  Lock,
  Network,
  ShieldCheck,
  User,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getErrorCode, getErrorMessage, BizCode } from "@/lib/api-error"
import { queryKeys } from "@/lib/query-keys"
import { authService } from "@/services/auth"
import { useAuth } from "@/stores/auth-context"

type Mode = "local" | "domain"

const MODE_KEY = "infranexus_login_mode"

const features = [
  { icon: Building2, title: "企业域统一登录", text: "AD / LDAP 凭证直连校验，首次登录自动建档" },
  { icon: Network, title: "组织架构同步", text: "OU 自动映射部门树，全量与增量定时同步" },
  { icon: ShieldCheck, title: "细粒度权限", text: "菜单、按钮、API 三级权限，服务端实时精准鉴权" },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, login } = useAuth()
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === "domain" ? "domain" : "local"))
  const [domain, setDomain] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [capsLock, setCapsLock] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (error && !submitting) {
      // Wait for React to commit the input's enabled state before focusing it.
      passwordRef.current?.focus()
      passwordRef.current?.select()
    }
  }, [error, submitting])

  const redirect = new URLSearchParams(location.search).get("redirect") || "/"
  const domainsQuery = useQuery({
    queryKey: queryKeys.loginDomains,
    queryFn: async () => (await authService.domains()).data,
    staleTime: 60 * 1000,
  })
  const domains = domainsQuery.data ?? []

  useEffect(() => {
    if (!domain && domains.length > 0) setDomain(domains[0].domain)
  }, [domain, domains])

  useEffect(() => {
    if (isAuthenticated) navigate(redirect, { replace: true })
  }, [isAuthenticated, navigate, redirect])

  const switchMode = (next: Mode) => {
    setMode(next)
    localStorage.setItem(MODE_KEY, next)
    setUsername("")
    setPassword("")
    setError("")
    setTouched(false)
    setCapsLock(false)
    requestAnimationFrame(() => usernameRef.current?.focus())
  }

  const trackCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"))

  const domainMode = mode === "domain"
  const noDomains = domainMode && !domainsQuery.isLoading && domains.length === 0
  const usernameMissing = touched && !username.trim()
  const passwordMissing = touched && !password

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!username.trim()) {
      usernameRef.current?.focus()
      return
    }
    if (!password) {
      passwordRef.current?.focus()
      return
    }
    if (noDomains) return
    setSubmitting(true)
    setError("")
    try {
      const res = await authService.login({
        username: username.trim(),
        password,
        domain: domainMode ? domain : undefined,
      })
      login(res.data.user)
      navigate(redirect, { replace: true })
    } catch (err) {
      const code = getErrorCode(err)
      if (code === BizCode.DirectoryUnavailable) setError("企业目录服务暂时不可用，请稍后重试或改用本地账号登录")
      else setError(getErrorMessage(err, "登录失败，请检查账号和密码"))
      // Keep the account but ask for the password again, like most sign-in forms.
      if (code === BizCode.InvalidCredentials) {
        setPassword("")
        setTouched(false)
      }
      setSubmitting(false)
      return
    }
    setSubmitting(false)
  }

  return (
    <div className="grid min-h-svh w-full bg-background lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-zinc-950 p-10 text-zinc-50 lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-violet-600/30 blur-3xl" />
          <div className="absolute -right-24 bottom-0 size-[28rem] rounded-full bg-sky-500/20 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255/0.04)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
        </div>
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-sky-500 shadow-lg shadow-violet-500/30">
            <Layers className="size-5" />
          </div>
          <div>
            <p className="text-base font-semibold tracking-tight">InfraNexus</p>
            <p className="font-mono text-[11px] text-zinc-400">Enterprise Identity Console</p>
          </div>
        </div>
        <div className="relative max-w-lg space-y-8">
          <div className="space-y-3">
            <h2 className="text-4xl leading-tight font-semibold tracking-tight">
              一个入口，
              <br />
              管好每一位员工的身份与权限
            </h2>
            <p className="text-sm leading-relaxed text-zinc-400">
              本地账号与企业 AD / LDAP 域账号统一认证，组织架构自动同步，权限变更即时生效。
            </p>
          </div>
          <ul className="space-y-4">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                  <Icon className="size-4.5 text-violet-300" />
                </div>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="text-xs text-zinc-400">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-zinc-500">© {new Date().getFullYear()} InfraNexus · 会话由 HttpOnly Cookie 保护</p>
      </aside>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-7">
          <div className="space-y-2">
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-violet-500 text-primary-foreground">
                <Layers className="size-4.5" />
              </div>
              <span className="text-base font-semibold">InfraNexus</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">欢迎回来</h1>
            <p className="text-sm text-muted-foreground">选择登录方式，进入企业管理控制台</p>
          </div>

          <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
            <TabsList className="grid h-9 w-full grid-cols-2">
              <TabsTrigger value="local" className="gap-1.5">
                <KeyRound />
                本地账号
              </TabsTrigger>
              <TabsTrigger value="domain" className="gap-1.5">
                <Building2 />
                企业 AD 域账号
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {error && (
              <Alert id="login-form-error" variant="destructive" role="alert" aria-live="assertive" className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {domainMode && noDomains && (
              <Alert>
                <Info />
                <AlertDescription>尚未配置可用的企业域，请联系管理员在「系统配置 · 身份源集成」中启用域登录。</AlertDescription>
              </Alert>
            )}

            {domainMode && domains.length > 1 && (
              <Field>
                <FieldLabel htmlFor="login-domain">认证域</FieldLabel>
                <Select
                  value={domain}
                  onValueChange={(v) => setDomain(String(v))}
                  items={domains.map((d) => ({ value: d.domain, label: `${d.name}（${d.domain}）` }))}
                >
                  <SelectTrigger id="login-domain" className="w-full">
                    <SelectValue placeholder="选择认证域" />
                  </SelectTrigger>
                  <SelectContent>
                    {domains.map((d) => (
                      <SelectItem key={d.domain} value={d.domain}>
                        <Building2 className="text-muted-foreground" />
                        {d.name}（{d.domain}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field data-invalid={usernameMissing || undefined}>
              <FieldLabel htmlFor="login-username">{domainMode ? "域账号" : "用户名"}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  {domainMode ? <Fingerprint /> : <User />}
                </InputGroupAddon>
                <InputGroupInput
                  id="login-username"
                  autoComplete="username"
                  autoFocus
                  ref={usernameRef}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    if (error) setError("")
                  }}
                  placeholder={domainMode ? "工号 / 统一通行证账号，如 zhangsan" : "请输入用户名"}
                  aria-invalid={usernameMissing || undefined}
                  aria-describedby={usernameMissing ? "login-username-error" : error ? "login-form-error" : undefined}
                  disabled={submitting}
                />
                {domainMode && domain && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupText className="font-mono text-xs">@{domain}</InputGroupText>
                  </InputGroupAddon>
                )}
              </InputGroup>
              {domainMode && <FieldDescription>支持企业域工号 / 统一通行证登录，使用域账号密码验证，首次登录将自动建档。</FieldDescription>}
              {usernameMissing && <FieldError id="login-username-error">请输入{domainMode ? "域账号" : "用户名"}</FieldError>}
            </Field>

            <Field data-invalid={passwordMissing || undefined}>
              <FieldLabel htmlFor="login-password">{domainMode ? "域密码" : "登录密码"}</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Lock />
                </InputGroupAddon>
                <InputGroupInput
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  ref={passwordRef}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (error) setError("")
                  }}
                  onKeyDown={trackCapsLock}
                  onKeyUp={trackCapsLock}
                  onBlur={() => setCapsLock(false)}
                  placeholder={domainMode ? "请输入域账号密码" : "请输入登录密码"}
                  aria-invalid={passwordMissing || undefined}
                  aria-describedby={passwordMissing ? "login-password-error" : error ? "login-form-error" : undefined}
                  disabled={submitting}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {passwordMissing && <FieldError id="login-password-error">请输入密码</FieldError>}
              {capsLock && !passwordMissing && (
                <p role="status" className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <Info className="size-3.5" />
                  大写锁定已开启
                </p>
              )}
            </Field>

            <Button type="submit" size="lg" className="h-10 w-full" disabled={submitting || noDomains}>
              {submitting ? (
                <>
                  <Spinner />
                  正在验证身份…
                </>
              ) : (
                <>
                  {domainMode ? "使用域账号登录" : "登录控制台"}
                  <ArrowRight />
                </>
              )}
            </Button>
          </form>

        </div>
      </section>
    </div>
  )
}
