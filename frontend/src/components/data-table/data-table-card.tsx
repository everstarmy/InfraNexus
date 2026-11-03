import * as React from "react"
import {
  QueryErrorState,
  QueryPlaceholderNotice,
  isForbiddenQueryError,
} from "@/components/common/query-error-state"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export interface DataTableCardSlots {
  toolbarTitle?: React.ReactNode
  toolbarControls?: React.ReactNode
  actions?: React.ReactNode
}

const DataTableCardContext = React.createContext<DataTableCardSlots | null>(null)

export function useDataTableCardSlots() {
  return React.useContext(DataTableCardContext)
}

export interface DataTableTitleProps {
  title: React.ReactNode
  count?: React.ReactNode
  leading?: React.ReactNode
  trailing?: React.ReactNode
  description?: React.ReactNode
  className?: string
}

export function DataTableTitle({
  title,
  count,
  leading,
  trailing,
  description,
  className,
}: DataTableTitleProps) {
  const headingRow = (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {leading}
      <h2 className="truncate text-sm font-medium text-foreground">{title}</h2>
      {count !== undefined && count !== null && (
        <Badge variant="secondary" className="font-mono">
          {count}
        </Badge>
      )}
      {trailing && (
        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
          {trailing}
        </span>
      )}
    </div>
  )

  if (!description) return headingRow

  return (
    <div className="min-w-0 space-y-0.5">
      {headingRow}
      <p className="truncate text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

export interface DataTableCardProps extends Omit<React.ComponentProps<typeof Card>, "title"> {
  label?: string
  title?: React.ReactNode
  toolbarControls?: React.ReactNode
  actions?: React.ReactNode
  isPlaceholderData?: boolean
  error?: unknown
  hasData?: boolean
  onRetry?: () => void
  retrying?: boolean
  notice?: React.ReactNode
  contentClassName?: string
}

export function DataTableCard({
  label = "列表数据",
  title,
  toolbarControls,
  actions,
  isPlaceholderData,
  error,
  hasData,
  onRetry,
  retrying,
  notice,
  className,
  contentClassName,
  children,
  ...props
}: DataTableCardProps) {
  const forbidden = isForbiddenQueryError(error)
  const blocked = Boolean(error) && (!hasData || forbidden)
  const hasStaleError = Boolean(error) && Boolean(hasData) && !forbidden

  const slots = React.useMemo<DataTableCardSlots>(
    () => ({ toolbarTitle: title, toolbarControls, actions }),
    [title, toolbarControls, actions],
  )

  return (
    <Card
      size="sm"
      data-slot="data-table-card"
      className={cn(
        "min-w-0 gap-0 rounded-xl border border-border/80 bg-card py-0 ring-0 shadow-xs",
        className,
      )}
      {...props}
    >
      <CardContent className={cn("flex min-w-0 flex-col gap-2.5 p-2 sm:p-2.5", contentClassName)}>
        {isPlaceholderData && <QueryPlaceholderNotice label={label} />}
        {hasStaleError && (
          <QueryErrorState error={error} label={label} onRetry={onRetry} retrying={retrying} />
        )}
        {notice}
        {blocked ? (
          <div className="flex min-w-0 flex-col gap-2.5">
            {(title || toolbarControls || actions) && (
              <div
                data-slot="data-table-header"
                className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2"
              >
                {title && <div className="min-w-0 flex-auto">{title}</div>}
                {(toolbarControls || actions) && (
                  <div className="ml-auto flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
                    {toolbarControls}
                    {actions}
                  </div>
                )}
              </div>
            )}
            <QueryErrorState error={error} label={label} onRetry={onRetry} retrying={retrying} />
          </div>
        ) : (
          <DataTableCardContext.Provider value={slots}>{children}</DataTableCardContext.Provider>
        )}
      </CardContent>
    </Card>
  )
}
