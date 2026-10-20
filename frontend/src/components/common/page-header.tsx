import type React from "react"
import type { LucideIcon } from "lucide-react"

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string
  description?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="hidden size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-primary shadow-xs sm:flex">
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-foreground md:text-2xl">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
