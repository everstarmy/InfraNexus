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
          <div className="hidden size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-card text-primary shadow-2xs sm:flex">
            <Icon className="size-4.5" />
          </div>
        )}
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">{title}</h1>
            {badge}
          </div>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
