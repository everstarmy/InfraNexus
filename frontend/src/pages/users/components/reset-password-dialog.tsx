import { useEffect, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Copy, KeyRound, RefreshCw, ShieldAlert } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { PasswordStrength } from "@/components/common/password-strength"
import { notify } from "@/lib/notify"
import { generatePassword, meetsPolicy } from "@/lib/password"
import type { UserDTO } from "@/services/types"
import { usersService } from "@/services/users"

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
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")

  useEffect(() => {
    setPassword("")
    setConfirm("")
  }, [user])

  const mutation = useMutation({
    mutationFn: () => usersService.resetPassword(user!.id, password),
    onSuccess: () => {
      notify.success("密码已重置", `${user?.nickname || user?.username} 的全部会话已失效，需使用新密码重新登录`)
      onOpenChange(false)
      if (isSelf) onSelfReset()
    },
    onError: (error) => notify.apiError(error, "重置密码失败"),
  })

  const mismatch = confirm.length > 0 && confirm !== password
  const valid = meetsPolicy(password) && confirm === password

  const fillGenerated = () => {
    const next = generatePassword()
    setPassword(next)
    setConfirm(next)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password)
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
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) mutation.mutate()
          }}
        >
          <Alert className="border-amber-500/30 bg-amber-500/5 text-amber-900 dark:text-amber-200">
            <ShieldAlert />
            <AlertDescription className="text-amber-800 dark:text-amber-200/90">
              重置后，该账号已登录的所有浏览器会话与 API 令牌将立即失效{isSelf ? "（包括你当前的会话，你将被要求重新登录）" : ""}。
            </AlertDescription>
          </Alert>
          <Field>
            <FieldLabel htmlFor="reset-password">新密码</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="reset-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="font-mono"
                autoComplete="new-password"
                placeholder="至少 8 位，含 3 类字符"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" onClick={copy} disabled={!password} aria-label="复制密码">
                  <Copy />
                </InputGroupButton>
                <InputGroupButton size="xs" onClick={fillGenerated}>
                  <RefreshCw />
                  生成
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <PasswordStrength password={password} />
          </Field>
          <Field data-invalid={mismatch || undefined}>
            <FieldLabel htmlFor="reset-confirm">确认新密码</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="reset-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="font-mono"
                autoComplete="new-password"
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? "reset-confirm-error" : undefined}
              />
            </InputGroup>
            {mismatch && <FieldError id="reset-confirm-error">两次输入的密码不一致</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Spinner />}
              确认重置
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
