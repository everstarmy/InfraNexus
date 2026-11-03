import { Check, X } from "lucide-react"
import { scorePassword } from "@/lib/password"
import { cn } from "@/lib/utils"

const barColors = ["bg-muted", "bg-rose-500", "bg-amber-500", "bg-sky-500", "bg-emerald-500"]
const textColors = ["text-muted-foreground", "text-rose-600 dark:text-rose-400", "text-amber-600 dark:text-amber-400", "text-sky-600 dark:text-sky-400", "text-emerald-600 dark:text-emerald-400"]

export function PasswordStrength({ password }: { password: string }) {
  const result = scorePassword(password)
  const rules = [
    { ok: result.checks.length, label: "至少 8 位" },
    { ok: result.checks.upper, label: "大写字母" },
    { ok: result.checks.lower, label: "小写字母" },
    { ok: result.checks.digit, label: "数字" },
    { ok: result.checks.symbol, label: "符号" },
  ]
  return (
    <div className="space-y-2" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1">
          {[1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={cn("h-1.5 rounded-full transition-colors duration-300", result.score >= level ? barColors[result.score] : "bg-muted")}
            />
          ))}
        </div>
        <span className={cn("w-10 text-right text-xs font-medium", textColors[result.score])}>{result.label || "—"}</span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {rules.map((rule) => (
          <li key={rule.label} className={cn("inline-flex items-center gap-1", rule.ok ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
            {rule.ok ? <Check className="size-3" /> : <X className="size-3" />}
            {rule.label}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">需满足：至少 8 位，且包含大写、小写、数字、符号中的任意 3 类</p>
    </div>
  )
}
