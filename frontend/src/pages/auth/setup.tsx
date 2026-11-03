import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { AlertCircle, ArrowRight, Layers, ShieldCheck } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { getErrorMessage, getErrorStatus } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { authService } from "@/services/auth"
import { useAuth } from "@/stores/auth-context"

export default function SetupPage() {
  const navigate = useNavigate()
  const { checkSetup } = useAuth()
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [mismatch, setMismatch] = useState(false)

  useEffect(() => {
    let active = true
    // Recheck when this page mounts, independently of the initial app probe.
    void checkSetup().then((initialized) => {
      if (active && initialized === false) setChecking(false)
    })
    return () => {
      active = false
    }
  }, [checkSetup])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    setMismatch(password !== confirmation)
    if (password !== confirmation) return
    if (new TextEncoder().encode(password).length > 72) {
      setError("密码不能超过 72 字节")
      return
    }
    setSubmitting(true)
    try {
      await authService.initialize(password)
      setPassword("")
      setConfirmation("")
      notify.success("管理员初始化成功", "请使用 admin 和刚设置的密码登录")
      // Synchronize the global gate before leaving setup. On a read failure it
      // shows the retry screen instead of allowing another initialization.
      if ((await checkSetup()) === true) navigate("/login", { replace: true })
    } catch (err) {
      if (getErrorStatus(err) === 403) {
        if ((await checkSetup()) === false) setError(getErrorMessage(err, "初始化请求被拒绝"))
      } else {
        setError(getErrorMessage(err, "初始化失败，请稍后重试"))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-svh grid-cols-12 bg-background">
      <aside className="col-span-5 hidden flex-col justify-between border-r bg-muted/40 p-10 lg:flex">
        <div className="flex items-center gap-3 text-lg font-semibold">
          <Layers className="size-6 text-primary" />
          InfraNexus
        </div>
        <div className="flex max-w-md flex-col gap-5">
          <ShieldCheck className="size-12 text-primary" />
          <h2 className="text-4xl leading-tight font-semibold tracking-tight">
            从第一个管理员开始
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            设置管理员密码，开启统一的身份与权限管理工作台。
          </p>
        </div>
        <p className="text-xs text-muted-foreground">InfraNexus · 企业身份管理控制台</p>
      </aside>
      <main className="col-span-12 flex items-center justify-center p-6 sm:p-10 lg:col-span-7">
        <div className="flex w-full max-w-sm flex-col gap-7">
          <div className="flex flex-col gap-2">
            <div className="mb-4 flex items-center gap-2 font-semibold lg:hidden">
              <Layers className="size-5 text-primary" />
              InfraNexus
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">初始化管理员</h1>
            <p className="text-sm text-muted-foreground">首次使用，请为管理员账号设置登录密码。</p>
          </div>
          {checking ? (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              正在检查初始化状态…
            </div>
          ) : (
            <form onSubmit={submit}>
              <FieldGroup>
                {error && (
                  <Alert variant="destructive" role="alert">
                    <AlertCircle />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <FieldLabel htmlFor="setup-username">管理员账号</FieldLabel>
                  <Input id="setup-username" value="admin" readOnly autoComplete="username" />
                  <FieldDescription>内置管理员账号，用于管理系统和分配权限。</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="setup-password">初始密码</FieldLabel>
                  <Input
                    id="setup-password"
                    type="password"
                    autoComplete="new-password"
                    autoFocus
                    required
                    minLength={8}
                    maxLength={72}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    aria-describedby="setup-password-description"
                  />
                  <FieldDescription id="setup-password-description">
                    至少 8 位，包含大写字母、小写字母、数字、符号中的 3 类。
                  </FieldDescription>
                </Field>
                <Field data-invalid={mismatch || undefined}>
                  <FieldLabel htmlFor="setup-confirmation">确认密码</FieldLabel>
                  <Input
                    id="setup-confirmation"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(e) => {
                      setConfirmation(e.target.value)
                      setMismatch(false)
                    }}
                    disabled={submitting}
                    aria-invalid={mismatch || undefined}
                    aria-describedby={mismatch ? "setup-confirmation-error" : undefined}
                  />
                  {mismatch && (
                    <FieldError id="setup-confirmation-error">两次输入的密码不一致</FieldError>
                  )}
                </Field>
                <Button type="submit" size="lg" className="w-full" disabled={submitting}>
                  {submitting ? <Spinner /> : <ArrowRight data-icon="inline-start" />}
                  {submitting ? "正在初始化…" : "创建管理员"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
