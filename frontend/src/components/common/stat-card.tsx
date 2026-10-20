import type React from "react"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info" | "violet"

export const toneIconStyles: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
}

const toneBarStyles: Record<Tone, { fill: string; track: string }> = {
  default: { fill: "bg-muted-foreground/60", track: "bg-muted-foreground/15" },
  primary: { fill: "bg-primary", track: "bg-primary/15" },
  success: { fill: "bg-emerald-500", track: "bg-emerald-500/15" },
  warning: { fill: "bg-amber-500", track: "bg-amber-500/15" },
  danger: { fill: "bg-rose-500", track: "bg-rose-500/15" },
  info: { fill: "bg-sky-500", track: "bg-sky-500/15" },
  violet: { fill: "bg-violet-500", track: "bg-violet-500/15" },
}

export interface StatCardProps {
  label: string
  value: React.ReactNode
  icon: LucideIcon
  hint?: React.ReactNode
  tone?: Tone
  ratio?: number
  loading?: boolean
  className?: string
}

export function StatCard({ label, value, icon: Icon, hint, tone = "default", ratio, loading, className }: StatCardProps) {
  return (
    <Card
      className={cn(
        "col-span-12 gap-3 px-4 shadow-xs ring-border/70 transition-[box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-sm sm:col-span-6 xl:col-span-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-7 w-20" />
          ) : (
            <p className="text-2xl leading-none font-semibold tracking-tight">{value}</p>
          )}
        </div>
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", toneIconStyles[tone])}>
          <Icon className="size-4.5" />
        </div>
      </div>
      {ratio !== undefined && (
        <div
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}
          className={cn("h-1.5 w-full overflow-hidden rounded-full", toneBarStyles[tone].track)}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-700 ease-out", toneBarStyles[tone].fill)}
            style={{ width: `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%` }}
          />
        </div>
      )}
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </Card>
  )
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid w-full grid-cols-12 gap-3 md:gap-4", className)}>{children}</div>
}
