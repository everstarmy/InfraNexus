import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Column } from "./types"
import { format, subDays, startOfDay, endOfDay } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface DataTableDateRangeFilterProps<
  TData extends RowData,
  TValue = unknown,
> {
  column?: Column<TData, TValue>
  title?: string
  dateRange?: DateRange
  onDateRangeChange?: (range: DateRange | undefined) => void
}

export function DataTableDateRangeFilter<
  TData extends RowData,
  TValue = unknown,
>({
  column,
  title = "时间范围",
  dateRange: externalRange,
  onDateRangeChange,
}: DataTableDateRangeFilterProps<TData, TValue>) {
  // Use column filter value or external state
  const columnFilterValue = column?.getFilterValue() as
    [Date | undefined, Date | undefined] | undefined
  const [internalRange, setInternalRange] = React.useState<
    DateRange | undefined
  >(() => {
    if (externalRange) return externalRange
    if (columnFilterValue && (columnFilterValue[0] || columnFilterValue[1])) {
      return { from: columnFilterValue[0], to: columnFilterValue[1] }
    }
    return undefined
  })

  const range = onDateRangeChange
    ? externalRange
    : column
      ? { from: columnFilterValue?.[0], to: columnFilterValue?.[1] }
      : internalRange

  const applyRange = (newRange: DateRange | undefined) => {
    setInternalRange(newRange)
    if (onDateRangeChange) {
      onDateRangeChange(newRange)
    }
    if (column) {
      if (newRange?.from || newRange?.to) {
        column.setFilterValue([
          newRange?.from ? startOfDay(newRange.from) : undefined,
          newRange?.to ? endOfDay(newRange.to) : undefined,
        ])
      } else {
        column.setFilterValue(undefined)
      }
    }
  }

  const setPreset = (days: number) => {
    const end = new Date()
    const start = days === 0 ? startOfDay(end) : subDays(end, days - 1)
    applyRange({ from: start, to: end })
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    applyRange(undefined)
  }

  const hasRange = Boolean(range?.from || range?.to)

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-input bg-background px-2.5 text-xs font-normal transition-colors outline-none hover:bg-accent hover:text-accent-foreground",
          hasRange &&
            "border-solid bg-accent font-medium text-accent-foreground"
        )}
      >
        <CalendarIcon className="size-3.5 text-muted-foreground" />
        <span>{title}</span>
        {hasRange ? (
          <>
            <span className="text-muted-foreground">:</span>
            <span className="font-semibold text-primary">
              {range?.from ? format(range.from, "yyyy/MM/dd") : ""}
              {range?.to ? ` ~ ${format(range.to, "yyyy/MM/dd")}` : ""}
            </span>

          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 text-xs" align="start">
        {/* Quick presets */}
        <div className="flex items-center gap-1 border-b bg-muted/30 p-2">
          <span className="mr-1 text-[11px] text-muted-foreground">
            快捷筛选:
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreset(0)}
            className="h-7 px-2 text-xs"
          >
            今天
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreset(7)}
            className="h-7 px-2 text-xs"
          >
            近 7 天
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPreset(30)}
            className="h-7 px-2 text-xs"
          >
            近 30 天
          </Button>
          {hasRange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            >
              清空
            </Button>
          )}
        </div>

        {/* DatePicker Calendar */}
        <div className="p-2">
          <Calendar
            mode="range"
            selected={range}
            onSelect={applyRange}
            numberOfMonths={2}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
