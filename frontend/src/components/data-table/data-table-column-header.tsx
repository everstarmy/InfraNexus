import { DataTableSortContext } from "./data-table-sort-context"
import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Column } from "./types"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  EyeOff,
  HelpCircle,
  RotateCcw,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface DataTableColumnHeaderProps<
  TData extends RowData,
  TValue = unknown,
> extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>
  title: string
  description?: string
  tooltip?: React.ReactNode
}

export function DataTableColumnHeader<TData extends RowData, TValue = unknown>({
  column,
  title,
  description,
  tooltip,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  const multi = React.useContext(DataTableSortContext)
  const tooltipContent = tooltip ?? description

  if (!column.getCanSort()) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <span className="text-(length:--text-description)/5 font-medium tracking-normal text-muted-foreground">
          {title}
        </span>
        {tooltipContent && (
          <Tooltip>
            <TooltipTrigger className="inline-flex shrink-0 cursor-help text-muted-foreground/70 transition-colors hover:text-foreground">
              <HelpCircle className="size-3.5 shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {tooltipContent}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    )
  }

  const isSorted = column.getIsSorted()

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "-ms-2.5 inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-(length:--text-description)/5 font-medium tracking-normal text-muted-foreground transition-colors outline-none hover:bg-muted/80 hover:text-foreground",
            isSorted && "text-foreground"
          )}
        >
          <span className="truncate">{title}</span>
          {multi.enabled && isSorted && <span aria-label={`排序优先级 ${column.getSortIndex() + 1}`} className="shrink-0 text-[10px] tabular-nums">{column.getSortIndex() + 1}</span>}
          {isSorted === "desc" ? (
            <ArrowDown className="size-3.5 shrink-0 text-primary" />
          ) : isSorted === "asc" ? (
            <ArrowUp className="size-3.5 shrink-0 text-primary" />
          ) : (
            <ArrowUpDown className="size-3.5 shrink-0 opacity-50" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36 text-xs">
          <DropdownMenuItem
            onClick={() => column.toggleSorting(false, multi.enabled && !!isSorted)}
            className="flex cursor-pointer items-center gap-2"
          >
            <ArrowUp className="size-3.5 shrink-0 text-muted-foreground" />
            升序排列
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => column.toggleSorting(true, multi.enabled && !!isSorted)}
            className="flex cursor-pointer items-center gap-2"
          >
            <ArrowDown className="size-3.5 shrink-0 text-muted-foreground" />
            降序排列
          </DropdownMenuItem>
          {multi.enabled && multi.count > 0 && !isSorted && <DropdownMenuItem disabled={multi.count >= 3} onClick={() => column.toggleSorting(false, true)}>追加升序排序</DropdownMenuItem>}
          {isSorted && (
            <DropdownMenuItem
              onClick={() => column.clearSorting()}
              className="flex cursor-pointer items-center gap-2 text-muted-foreground"
            >
              <RotateCcw className="size-3.5 shrink-0" />
              恢复默认
            </DropdownMenuItem>
          )}
          {column.getCanHide() && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => column.toggleVisibility(false)}
                className="flex cursor-pointer items-center gap-2 text-muted-foreground"
              >
                <EyeOff className="size-3.5 shrink-0" />
                隐藏此列
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {tooltipContent && (
        <Tooltip>
          <TooltipTrigger className="inline-flex shrink-0 cursor-help text-muted-foreground/60 transition-colors hover:text-foreground">
            <HelpCircle className="size-3.5 shrink-0" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
