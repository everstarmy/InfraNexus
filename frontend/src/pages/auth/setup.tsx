import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useStore } from "@tanstack/react-form"
import { AlertCircle, ArrowRight, Layers, ShieldCheck } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { FormField, useAppForm } from "@/components/form"
import { getErrorMessage, getErrorStatus } from "@/lib/api-error"
import { notify } from "@/lib/notify"
import { meetsPolicy } from "@/lib/password"
import { authService } from "@/services/auth"
import { useAuth } from "@/stores/auth-context"

const setupSchema = z
  .object({
    password: z
      .string()
      .min(1, "请输入初始密码")
      .refine((v) => new TextEncoder().encode(v).length <= 72, "密码不能超过 72 字节")
      .refine(meetsPolicy, "至少 8 位，包含大写字母、小写字母、数字、符号中的 3 类"),
    confirmation: z.string().min(1, "请再次输入确认密码"),
  })
  .refine((data) => data.password === data.confirmation, {
    message: "两次输入的密码不一致",
    path: ["confirmation"],
  })

export default function SetupPage() {
  const navigate = useNavigate()
  const { checkSetup } = useAuth()
  const [checking, setChecking] = useState(true)
  const [setupError, setSetupError] = useState("")

  const defaultValues = useMemo(() => ({ password: "", confirmation: "" }), [])

  const { form, formRef, submit, formError } = useAppForm({
    open: !checking,
    resetKey: "setup",
    defaultValues,
    schema: setupSchema,
    serverFieldNames: { password: "password" },
    fallbackErrorMessage: "初始化失败，请稍后重试",
    onSubmit: async (values) => {
      setSetupError("")
      await authService.initialize(values.password)
      form.reset(defaultValues)
      notify.success("管理员初始化成功", "请使用 admin 和刚设置的密码登录")
      // Synchronize the global gate before leaving setup. On a read failure it
      // shows the retry screen instead of allowing another initialization.
      if ((await checkSetup()) === true) navigate("/login", { replace: true })
    },
    onError: async (err) => {
      if (getErrorStatus(err) === 403) {
        if ((await checkSetup()) === false) {
          setSetupError(getErrorMessage(err, "初始化请求被拒绝"))
        }
      }
    },
  })

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)

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

  const visibleError = setupError || formError

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
            <form
              ref={formRef}
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void submit()
              }}
            >
              <FieldGroup>
                {visibleError && (
                  <Alert variant="destructive" role="alert">
                    <AlertCircle />
                    <AlertDescription>{visibleError}</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <FieldLabel htmlFor="setup-username">管理员账号</FieldLabel>
                  <Input id="setup-username" value="admin" readOnly autoComplete="username" />
                  <FieldDescription>内置管理员账号，用于管理系统和分配权限。</FieldDescription>
                </Field>
                <form.Field name="password">
                  {(field) => (
                    <FormField
                      field={field}
                      label="初始密码"
                      idPrefix="setup"
                      required
                      description="至少 8 位，包含大写字母、小写字母、数字、符号中的 3 类。"
                    >
                      {(inputProps) => (
                        <Input
                          {...inputProps}
                          type="password"
                          autoComplete="new-password"
                          autoFocus
                          value={field.state.value}
                          onChange={(e) => {
                            if (setupError) setSetupError("")
                            field.handleChange(e.target.value)
                          }}
                          onBlur={field.handleBlur}
                          disabled={isSubmitting}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                <form.Field name="confirmation">
                  {(field) => (
                    <FormField
                      field={field}
                      label="确认密码"
                      idPrefix="setup"
                      required
                    >
                      {(inputProps) => (
                        <Input
                          {...inputProps}
                          type="password"
                          autoComplete="new-password"
                          value={field.state.value}
                          onChange={(e) => {
                            if (setupError) setSetupError("")
                            field.handleChange(e.target.value)
                          }}
                          onBlur={field.handleBlur}
                          disabled={isSubmitting}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <Spinner /> : <ArrowRight data-icon="inline-start" />}
                  {isSubmitting ? "正在初始化…" : "创建管理员"}
                </Button>
              </FieldGroup>
            </form>
          )}
        </div>
      </main>
    </div>
  )
}
