import type React from "react"
import type { LucideIcon } from "lucide-react"

export function PageHeader({
  title,
  description,
  icon: Icon,
  badge,
  actions,
}: {
  title: string
  description?: React.ReactNode
  icon?: LucideIcon
  badge?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="hidden size-11 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-gradient-to-b from-card to-muted/40 text-primary shadow-xs ring-1 ring-primary/10 sm:flex">
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h1>
            {badge}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
