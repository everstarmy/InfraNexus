import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Column } from "./types"
import { Check, PlusCircle, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"

export interface FacetedOption {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
  count?: number
}

interface DataTableFacetedFilterProps<TData extends RowData, TValue = unknown> {
  column?: Column<TData, TValue>
  title?: string
  options: FacetedOption[]
  selectedValues?: string[]
  onSelectedChange?: (values: string[]) => void
}

export function DataTableFacetedFilter<
  TData extends RowData,
  TValue = unknown,
>({
  column,
  title,
  options,
  selectedValues: externalSelected,
  onSelectedChange,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const [search, setSearch] = React.useState("")
  const columnFilterValue = column?.getFilterValue() as string[] | undefined
  const selectedSet = React.useMemo(() => {
    if (externalSelected !== undefined) {
      return new Set(externalSelected)
    }
    return new Set(columnFilterValue || [])
  }, [externalSelected, columnFilterValue])

  const filteredOptions = React.useMemo(() => {
    if (!search.trim()) return options
    const s = search.toLowerCase()
    return options.filter((opt) => opt.label.toLowerCase().includes(s))
  }, [options, search])

  const toggleOption = (val: string) => {
    const next = new Set(selectedSet)
    if (next.has(val)) {
      next.delete(val)
    } else {
      next.add(val)
    }
    const arr = Array.from(next)
    if (onSelectedChange) {
      onSelectedChange(arr)
    }
    if (column && !onSelectedChange) {
      column.setFilterValue(arr.length > 0 ? arr : undefined)
    }
  }

  const clear = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (onSelectedChange) {
      onSelectedChange([])
    }
    if (column && !onSelectedChange) {
      column.setFilterValue(undefined)
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-input bg-background px-2.5 text-xs font-normal transition-colors outline-none hover:bg-accent hover:text-accent-foreground",
          selectedSet.size > 0 &&
            "border-solid bg-accent font-medium text-accent-foreground"
        )}
      >
        <PlusCircle className="size-3.5 text-muted-foreground" />
        <span>{title}</span>
        {selectedSet.size > 0 && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Badge
              variant="secondary"
              className="rounded-sm px-1.5 text-[10px] font-semibold lg:hidden"
            >
              {selectedSet.size}
            </Badge>
            <div className="hidden gap-1 lg:flex">
              {selectedSet.size > 2 ? (
                <Badge
                  variant="secondary"
                  className="rounded-sm px-1.5 text-[10px] font-semibold"
                >
                  已选 {selectedSet.size} 项
                </Badge>
              ) : (
                options
                  .filter((opt) => selectedSet.has(opt.value))
                  .map((opt) => (
                    <Badge
                      variant="secondary"
                      key={opt.value}
                      className="rounded-sm px-1.5 text-[10px] font-normal"
                    >
                      {opt.label}
                    </Badge>
                  ))
              )}
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              className="ml-1 rounded-full p-0.5 text-muted-foreground hover:bg-background/80 hover:text-foreground"
            >
              <X className="size-3" />
            </span>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0 text-xs" align="start">
        <div className="border-b p-2">
          <Input
            placeholder={`搜索${title}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>

        <div className="max-h-60 overflow-y-auto p-1">
          {filteredOptions.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              未找到选项
            </div>
          ) : (
            filteredOptions.map((opt) => {
              const isSelected = selectedSet.has(opt.value)
              return (
                <Button
                  type="button"
                  variant="ghost"
                  aria-pressed={isSelected}
                  key={opt.value}
                  onClick={() => toggleOption(opt.value)}
                  className={cn(
                    "flex h-auto min-h-8 w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-xs select-none",
                    isSelected && "bg-accent/50 font-medium text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "flex size-4 items-center justify-center rounded-xs border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50"
                      )}
                    >
                      {isSelected && <Check className="size-3" />}
                    </div>
                    {opt.icon && (
                      <opt.icon className="size-3.5 text-muted-foreground" />
                    )}
                    <span>{opt.label}</span>
                  </div>
                  {opt.count !== undefined && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {opt.count}
                    </span>
                  )}
                </Button>
              )
            })
          )}
        </div>

        {selectedSet.size > 0 && (
          <div className="border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={clear}
              className="h-7 w-full justify-center text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              清空所选项
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
