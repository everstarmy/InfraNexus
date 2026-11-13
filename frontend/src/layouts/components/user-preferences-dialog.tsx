import { useMemo } from "react"
import { useStore } from "@tanstack/react-form"
import { AlertCircle, Clock, Palette, Save, ShieldCheck } from "lucide-react"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { FormField, useAppForm } from "@/components/form"
import { useAuth } from "@/stores/auth-context"
import { usersService } from "@/services/users"
import { notify } from "@/lib/notify"

interface UserPreferencesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TIMEOUT_OPTIONS = [
  { value: "0", label: "跟随系统默认 (30 分钟)" },
  { value: "900", label: "15 分钟" },
  { value: "1800", label: "30 分钟" },
  { value: "3600", label: "1 小时" },
  { value: "7200", label: "2 小时" },
  { value: "14400", label: "4 小时" },
  { value: "28800", label: "8 小时 (一个工作日)" },
  { value: "86400", label: "24 小时 (1 天)" },
  { value: "604800", label: "7 天 (绝对上限)" },
] as const

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "明亮浅色" },
  { value: "dark", label: "沉浸深色" },
] as const

const preferencesSchema = z.object({
  timeoutSec: z.string().refine(
    (v) => TIMEOUT_OPTIONS.some((opt) => opt.value === v),
    "请选择有效的会话空闲超时时间",
  ),
  theme: z.enum(["system", "light", "dark"], "请选择有效的界面主题"),
})

interface PreferencesFormValues {
  timeoutSec: string
  theme: "system" | "light" | "dark"
}

export function UserPreferencesDialog({ open, onOpenChange }: UserPreferencesDialogProps) {
  const { user, updateUserPreferences } = useAuth()

  const defaultValues = useMemo<PreferencesFormValues>(() => {
    const current = user?.preferences
    const rawTheme = current?.theme
    const theme: "system" | "light" | "dark" =
      rawTheme === "light" || rawTheme === "dark" ? rawTheme : "system"
    const rawTimeout = String(current?.session_timeout ?? 0)
    const timeoutSec = TIMEOUT_OPTIONS.some((opt) => opt.value === rawTimeout) ? rawTimeout : "0"
    return { timeoutSec, theme }
  }, [user?.preferences])

  const { form, formRef, submit, formError, hasChanges } = useAppForm<PreferencesFormValues>({
    open,
    resetKey: user?.id ?? "prefs",
    defaultValues,
    schema: preferencesSchema,
    serverFieldNames: {
      session_timeout: "timeoutSec",
      theme: "theme",
    },
    fallbackErrorMessage: "保存偏好设置失败",
    onSubmit: async (values) => {
      const parsedTimeout = Math.max(0, parseInt(values.timeoutSec, 10) || 0)
      const newPrefs = {
        ...(user?.preferences || {}),
        theme: values.theme,
        session_timeout: parsedTimeout,
      }
      await usersService.updateMyPreferences(newPrefs)
      updateUserPreferences(newPrefs)

      if (values.theme === "dark") {
        document.documentElement.classList.add("dark")
      } else if (values.theme === "light") {
        document.documentElement.classList.remove("dark")
      } else {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
        document.documentElement.classList.toggle("dark", dark)
      }

      notify.success("偏好设置已更新", "会话空闲超时与界面偏好已立即生效")
      onOpenChange(false)
    },
  })

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting)

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="size-5 text-primary" />
            个人偏好设置
          </DialogTitle>
          <DialogDescription>
            管理当前账号的登录会话超时与系统界面偏好。
          </DialogDescription>
        </DialogHeader>

        <form
          ref={formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
          className="space-y-4 py-1"
        >
          {formError && (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <form.Field name="timeoutSec">
            {(field) => (
              <FormField
                field={field}
                id="pref-session-timeout"
                label={
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-4 text-muted-foreground" />
                    会话空闲超时时间
                  </span>
                }
                description="离开电脑无任何操作达到该时间后系统自动退出；在持续操作期间会自动无感延期。"
              >
                {(inputProps) => (
                  <Select
                    value={field.state.value}
                    disabled={isSubmitting}
                    onValueChange={(val) => val && field.handleChange(String(val))}
                  >
                    <SelectTrigger id={inputProps.id} className="w-full" aria-invalid={inputProps["aria-invalid"]}>
                      <SelectValue placeholder="请选择超时时间" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEOUT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          </form.Field>

          <form.Field name="theme">
            {(field) => (
              <FormField
                field={field}
                id="pref-theme"
                label={
                  <span className="flex items-center gap-1.5">
                    <Palette className="size-4 text-muted-foreground" />
                    界面主题外观
                  </span>
                }
              >
                {(inputProps) => (
                  <Select
                    value={field.state.value}
                    disabled={isSubmitting}
                    onValueChange={(val) => {
                      if (val === "system" || val === "light" || val === "dark") {
                        field.handleChange(val)
                      }
                    }}
                  >
                    <SelectTrigger id={inputProps.id} className="w-full" aria-invalid={inputProps["aria-invalid"]}>
                      <SelectValue placeholder="请选择主题" />
                    </SelectTrigger>
                    <SelectContent>
                      {THEME_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          </form.Field>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <ShieldCheck className="size-4 text-primary" />
              安全提示
            </div>
            <p className="mt-1 leading-relaxed">
              个人设置的会话超时时间优先于系统默认生效，但受系统 7 天绝对生命周期约束。修改后当前活动会话与后续会话均自动生效。
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting || !hasChanges}>
              <Save />
              {isSubmitting ? "正在保存…" : "保存偏好"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
