import { DataTableSelectionControls } from "./data-table-selection-controls"
import type { DataTableSelectionArea } from "./data-table-selection-area"
import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"

export interface DataTablePaginationProps<TData extends RowData> {
  table: Table<TData>
  pageSizeOptions?: number[]
  totalCount?: number
  selectionArea?: DataTableSelectionArea
  batchActions?: (selectedRows: TData[], resetSelection: () => void) => React.ReactNode
  selection?: { count: number; estimated?: boolean }
  jumpPage?: string
  onJumpPageChange?: (value: string) => void
}

export function DataTablePagination<TData extends RowData>({
  table,
  pageSizeOptions = [10, 20, 50, 100],
  totalCount,
  selection,
  selectionArea,
  batchActions,
  jumpPage: controlledJumpPage,
  onJumpPageChange,
}: DataTablePaginationProps<TData>) {
  const jumpRangeId = React.useId()
  const [localJumpPage, setLocalJumpPage] = React.useState<string>("")
  const jumpPage = controlledJumpPage ?? localJumpPage
  const setJumpPage = (next: string) => {
    setLocalJumpPage(next)
    onJumpPageChange?.(next)
  }

  const currentPage = table.getState().pagination.pageIndex + 1
  const pageCount = table.getPageCount() || 1
  const pageSize = table.getState().pagination.pageSize
  const selectedCount = selection?.count ?? table.getFilteredSelectedRowModel().rows.length
  const totalRows = totalCount ?? table.getFilteredRowModel().rows.length
  const invalidJump =
    jumpPage !== "" &&
    (!Number.isInteger(Number(jumpPage)) ||
      Number(jumpPage) < 1 ||
      Number(jumpPage) > pageCount)

  const handleJump = () => {
    const pageNum = Number(jumpPage)
    if (jumpPage !== "" && !invalidJump) {
      table.setPageIndex(pageNum - 1)
      setJumpPage("")
    }
  }

  return (
    <div data-slot="data-table-pagination" className="tabular-nums flex shrink-0 flex-col gap-4 border-t border-border/70 bg-muted/25 px-3.5 py-2.5 text-xs text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
      <div className="flex h-8 min-w-0 shrink-0 items-center gap-2 sm:w-56">
        {selectionArea || batchActions ? (
          <DataTableSelectionControls
            total={totalRows}
            selectionArea={selectionArea}
            selectedRows={table.getFilteredSelectedRowModel().rows.map(row => row.original)}
            batchActions={batchActions}
            onClear={() => table.resetRowSelection()}
          />
        ) : <span>{selectedCount > 0 ? `已选择 ${selectedCount} / ${totalRows} 行` : `共 ${totalRows} 条记录`}</span>}
      </div>

      {/* Pagination Controls */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-4 lg:gap-6">
        {/* Page size dropdown */}
        <div className="flex items-center gap-2">
          <span>每页显示</span>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent hover:text-accent-foreground">
              {pageSize} 条/页
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-28 text-xs">
              {pageSizeOptions.map((size) => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => table.setPageSize(size)}
                  className="cursor-pointer"
                >
                  {size} 条/页
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Current page indicator */}
        <div className="flex items-center justify-center font-medium" style={{ minWidth: `${String(pageCount).length * 2 + 6}ch` }}>
          第 {currentPage} / {pageCount} 页
        </div>

        {/* Quick jump to page */}
        {pageCount > 1 && <div className="flex flex-wrap items-center gap-1.5">
          <span>跳至</span>
          <Input
            aria-label="跳转页码"
            aria-invalid={invalidJump}
            aria-describedby={jumpRangeId}
            title={`输入 1 至 ${pageCount} 页`}
            type="number"
            min={1}
            max={pageCount}
            value={jumpPage}
            onChange={(e) => setJumpPage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleJump()
            }}
            placeholder={String(currentPage)}
            className="h-8 w-14 px-1 text-center text-xs"
          />
          <span>页</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleJump}
            disabled={!jumpPage || invalidJump}
            className="h-8 px-2 text-xs"
          >
            跳转
          </Button>
          <span
            id={jumpRangeId}
            className={
              invalidJump ? "text-destructive" : "sr-only"
            }
            role={invalidJump ? "alert" : undefined}
          >
            请输入 1–{pageCount} 的整数页码
          </span>
        </div>}

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8 p-0"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            title="首页"
          >
            <ChevronsLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 p-0"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            title="上一页"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 p-0"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            title="下一页"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8 p-0"
            onClick={() => table.setPageIndex(pageCount - 1)}
            disabled={!table.getCanNextPage()}
            title="末页"
          >
            <ChevronsRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
