import { useMemo } from "react"
import { useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-form"
import { Copy, KeyRound, RefreshCw, ShieldAlert } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { PasswordStrength } from "@/components/common/password-strength"
import { FormField, useAppForm } from "@/components/form"
import { notify } from "@/lib/notify"
import { generatePassword, meetsPolicy } from "@/lib/password"
import type { UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "密码长度至少 8 位")
      .refine(meetsPolicy, "密码需包含大小写字母、数字、特殊符号中的至少 3 类"),
    confirm: z.string().min(1, "请再次输入新密码"),
  })
  .refine((data) => data.password === data.confirm, {
    message: "两次输入的密码不一致",
    path: ["confirm"],
  })

type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

export function ResetPasswordDialog({
  user,
  isSelf,
  onOpenChange,
  onSelfReset,
}: {
  user: UserDTO | null
  isSelf: boolean
  onOpenChange: (open: boolean) => void
  onSelfReset: () => void
}) {
  const defaultValues = useMemo<ResetPasswordValues>(
    () => ({
      password: "",
      confirm: "",
    }),
    [user?.id],
  )

  const mutation = useMutation({
    mutationFn: (newPassword: string) => usersService.resetPassword(user!.id, newPassword),
    onSuccess: () => {
      notify.success("密码已重置", `${user?.nickname || user?.username} 的全部会话已失效，需使用新密码重新登录`)
      onOpenChange(false)
      if (isSelf) onSelfReset()
    },
    onError: (error) => notify.apiError(error, "重置密码失败"),
  })

  const { form, formError, formRef, submit } = useAppForm({
    defaultValues,
    resetKey: user?.id,
    schema: resetPasswordSchema,
    open: Boolean(user),
    onSubmit: async (values) => {
      await mutation.mutateAsync(values.password)
    },
    fallbackErrorMessage: "重置密码失败",
  })

  const currentPassword = useStore(form.store, (s) => s.values.password)

  const fillGenerated = () => {
    const next = generatePassword()
    form.setFieldValue("password", next)
    form.setFieldValue("confirm", next)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(currentPassword)
      notify.success("已复制新密码", "请通过安全渠道告知用户")
    } catch {
      notify.error("复制失败", "浏览器未授予剪贴板权限，请手动复制")
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4.5 text-primary" />
            重置登录密码
          </DialogTitle>
          <DialogDescription>
            为 <span className="font-medium text-foreground">{user?.nickname || user?.username}</span>（{user?.username}）设置新的登录密码
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
        >
          <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200">
            <ShieldAlert />
            <AlertDescription className="text-amber-800 dark:text-amber-200/90">
              重置后，该账号已登录的所有浏览器会话与 API 令牌将立即失效{isSelf ? "（包括你当前的会话，你将被要求重新登录）" : ""}。
            </AlertDescription>
          </Alert>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-4">
            <form.Field name="password">
              {(field) => (
                <FormField field={field} label="新密码" required idPrefix="reset">
                  {(props) => (
                    <>
                      <InputGroup>
                        <InputGroupInput
                          {...props}
                          type="password"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          onBlur={field.handleBlur}
                          className="font-mono"
                          autoComplete="new-password"
                          placeholder="至少 8 位，含 3 类字符"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            type="button"
                            size="icon-xs"
                            onClick={copy}
                            disabled={!currentPassword}
                            aria-label="复制密码"
                          >
                            <Copy />
                          </InputGroupButton>
                          <InputGroupButton type="button" size="xs" onClick={fillGenerated}>
                            <RefreshCw />
                            生成
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                      <PasswordStrength password={field.state.value} />
                    </>
                  )}
                </FormField>
              )}
            </form.Field>

            <form.Field name="confirm">
              {(field) => (
                <FormField field={field} label="确认新密码" required idPrefix="reset">
                  {(props) => (
                    <InputGroup>
                      <InputGroupInput
                        {...props}
                        type="password"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        className="font-mono"
                        autoComplete="new-password"
                      />
                    </InputGroup>
                  )}
                </FormField>
              )}
            </form.Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting]}>
              {([isSubmitting]) => (
                <Button type="submit" disabled={isSubmitting || mutation.isPending}>
                  {(isSubmitting || mutation.isPending) && <Spinner />}
                  确认重置
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
