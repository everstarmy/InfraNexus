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
  const tooltipContent = tooltip ?? description

  if (!column.getCanSort()) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {title}
        </span>
        {tooltipContent && (
          <Tooltip>
            <TooltipTrigger className="inline-flex cursor-help text-muted-foreground/70 transition-colors hover:text-foreground">
              <HelpCircle className="size-3.5" />
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
    <div className={cn("flex items-center gap-1", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "-ml-2.5 inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase transition-colors outline-none hover:bg-muted/80 hover:text-foreground",
            isSorted && "font-bold text-foreground"
          )}
        >
          <span>{title}</span>
          {isSorted === "desc" ? (
            <ArrowDown className="size-3.5 text-primary" />
          ) : isSorted === "asc" ? (
            <ArrowUp className="size-3.5 text-primary" />
          ) : (
            <ArrowUpDown className="size-3.5 opacity-50" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-36 text-xs">
          <DropdownMenuItem
            onClick={() => column.toggleSorting(false)}
            className="flex cursor-pointer items-center gap-2"
          >
            <ArrowUp className="size-3.5 text-muted-foreground" />
            升序排列
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => column.toggleSorting(true)}
            className="flex cursor-pointer items-center gap-2"
          >
            <ArrowDown className="size-3.5 text-muted-foreground" />
            降序排列
          </DropdownMenuItem>
          {isSorted && (
            <DropdownMenuItem
              onClick={() => column.clearSorting()}
              className="flex cursor-pointer items-center gap-2 text-muted-foreground"
            >
              <RotateCcw className="size-3.5" />
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
                <EyeOff className="size-3.5" />
                隐藏此列
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {tooltipContent && (
        <Tooltip>
          <TooltipTrigger className="inline-flex cursor-help text-muted-foreground/60 transition-colors hover:text-foreground">
            <HelpCircle className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {tooltipContent}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
