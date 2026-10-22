import { Fragment } from "react"
import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
import { SlidersHorizontal, Check, Pin, PinOff } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface DataTableViewOptionsProps<TData extends RowData> {
  table: Table<TData>
  columnLabels?: Record<string, string>
}

export function DataTableViewOptions<TData extends RowData>({
  table,
  columnLabels = {},
}: DataTableViewOptionsProps<TData>) {
  const columns = table
    .getAllColumns()
    .filter(
      (column) =>
        typeof column.accessorFn !== "undefined" && column.getCanHide()
    )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="自定义显示列和固定列" className="ml-auto inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-normal outline-none hover:bg-accent hover:text-accent-foreground">
        <SlidersHorizontal className="size-3.5 text-muted-foreground" />
        <span className="hidden sm:inline">显示列</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 text-xs">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            自定义显示的列
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {columns.map((column) => {
            const isVisible = column.getIsVisible()
            const label = columnLabels[column.id] ?? column.id
            return (
              <Fragment key={column.id}>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault()
                    column.toggleVisibility(!isVisible)
                  }}
                  className="flex cursor-pointer items-center justify-between"
                >
                  <span>{label}</span>
                  <div
                    className={`flex size-3.5 items-center justify-center rounded-xs border ${
                      isVisible
                        ? "border-primary bg-primary text-primary-foreground"
                        : "opacity-40"
                    }`}
                  >
                    {isVisible && <Check className="size-2.5 stroke-[3]" />}
                  </div>
                </DropdownMenuItem>
              {table.options.enableColumnPinning && column.getCanPin() && (
                <>
                  <DropdownMenuSeparator />
                  {column.getIsPinned() ? (
                    <DropdownMenuItem onClick={(e) => { e.preventDefault(); column.pin(false) }}>
                      <PinOff /> 取消固定
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={(e) => { e.preventDefault(); column.pin("start") }}>
                        <Pin /> 固定到左侧
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={(e) => { e.preventDefault(); column.pin("end") }}>
                        <Pin /> 固定到右侧
                      </DropdownMenuItem>
                    </>
                  )}
                </>
              )}
              </Fragment>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
