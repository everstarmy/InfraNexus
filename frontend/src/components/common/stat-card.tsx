import type React from "react"
import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info" | "violet"

export const toneIconStyles: Record<Tone, string> = {
  default: "bg-muted text-muted-foreground ring-1 ring-border/80",
  primary: "bg-primary/10 text-primary ring-1 ring-primary/25",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/25",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/25",
  danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/25",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/25",
  violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/25",
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
        "group/stat relative col-span-12 gap-3.5 overflow-hidden rounded-xl border border-border/80 bg-card p-4.5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md sm:col-span-6 xl:col-span-3",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-8 w-20" />
          ) : (
            <p className="font-mono text-3xl font-bold tracking-tight text-foreground">{value}</p>
          )}
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl shadow-2xs transition-transform duration-200 group-hover/stat:scale-105",
            toneIconStyles[tone],
          )}
        >
          <Icon className="size-5" />
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
      {hint && <div className="truncate text-xs text-muted-foreground/90">{hint}</div>}
    </Card>
  )
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid w-full grid-cols-12 gap-3 md:gap-4", className)}>{children}</div>
}
