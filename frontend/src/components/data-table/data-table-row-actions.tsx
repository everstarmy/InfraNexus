import type { ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
export interface RowActionItem<TData> {
  key: string
  label: string
  icon?: ReactNode
  onSelect: (row: TData) => void
  hidden?: boolean
  disabled?: boolean
  disabledReason?: string
  destructive?: boolean
}
export interface DataTableRowActionsProps<TData> {
  row: TData
  actions: RowActionItem<TData>[]
  maxInline?: number
  triggerAriaLabel?: string
  disabled?: boolean
}
export function DataTableRowActions<TData>({
  row,
  actions,
  maxInline = 0,
  triggerAriaLabel = "更多行操作",
  disabled = false,
}: DataTableRowActionsProps<TData>) {
  const visible = actions.filter((item) => !item.hidden)
  const normal = visible.filter((item) => !item.destructive),
    danger = visible.filter((item) => item.destructive)
  const inline = normal.slice(0, Math.max(0, Math.floor(maxInline) || 0))
  const remaining = normal.slice(inline.length)
  if (!visible.length) return null
  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {inline.map((item) => (
        <Button
          key={item.key}
          size="sm"
          variant="ghost"
          disabled={disabled || item.disabled}
          title={item.disabledReason}
          onClick={() => item.onSelect(row)}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
      {!!(remaining.length || danger.length) && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={disabled}
                aria-label={triggerAriaLabel}
                title={triggerAriaLabel}
              />
            }
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {remaining.map((item) => (
              <DropdownMenuItem
                key={item.key}
                disabled={item.disabled}
                title={item.disabledReason}
                onClick={() => item.onSelect(row)}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
            {!!remaining.length && !!danger.length && <DropdownMenuSeparator />}
            {danger.map((item) => (
              <DropdownMenuItem
                key={item.key}
                variant="destructive"
                disabled={item.disabled}
                title={item.disabledReason}
                onClick={() => item.onSelect(row)}
              >
                {item.icon}
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
