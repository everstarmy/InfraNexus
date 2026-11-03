import React, { useState, useEffect } from "react"
import { Clock, Palette, Save, ShieldCheck } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
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
]

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "明亮浅色" },
  { value: "dark", label: "沉浸深色" },
]

export function UserPreferencesDialog({ open, onOpenChange }: UserPreferencesDialogProps) {
  const { user, updateUserPreferences } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const [timeoutSec, setTimeoutSec] = useState<string>("0")
  const [theme, setTheme] = useState<string>("system")

  useEffect(() => {
    if (!open) return
    const current = user?.preferences
    setTimeoutSec(String(current?.session_timeout ?? 0))
    setTheme(current?.theme || "system")
  }, [open, user])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const parsedTimeout = Math.max(0, parseInt(timeoutSec, 10) || 0)
      const newPrefs = {
        ...(user?.preferences || {}),
        theme,
        session_timeout: parsedTimeout,
      }
      await usersService.updateMyPreferences(newPrefs)
      updateUserPreferences(newPrefs)

      // 应用主题切换
      if (theme === "dark") {
        document.documentElement.classList.add("dark")
      } else if (theme === "light") {
        document.documentElement.classList.remove("dark")
      } else {
        const dark = window.matchMedia("(prefers-color-scheme: dark)").matches
        document.documentElement.classList.toggle("dark", dark)
      }

      notify.success("偏好设置已更新", "会话空闲超时与界面偏好已立即生效")
      onOpenChange(false)
    } catch (err) {
      notify.apiError(err, "保存偏好设置失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

        <form onSubmit={handleSave} className="space-y-4 py-1">
          <Field>
            <FieldLabel htmlFor="pref-session-timeout" className="flex items-center gap-1.5">
              <Clock className="size-4 text-muted-foreground" />
              会话空闲超时时间
            </FieldLabel>
            <Select
              value={timeoutSec}
              onValueChange={(val) => val && setTimeoutSec(String(val))}
            >
              <SelectTrigger id="pref-session-timeout" className="w-full">
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
            <FieldDescription className="text-[11px] leading-relaxed">
              离开电脑无任何操作达到该时间后系统自动退出；在持续操作期间会自动无感延期。
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="pref-theme" className="flex items-center gap-1.5">
              <Palette className="size-4 text-muted-foreground" />
              界面主题外观
            </FieldLabel>
            <Select
              value={theme}
              onValueChange={(val) => val && setTheme(String(val))}
            >
              <SelectTrigger id="pref-theme" className="w-full">
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
          </Field>

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
              disabled={submitting}
            >
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              <Save />
              {submitting ? "正在保存…" : "保存偏好"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
