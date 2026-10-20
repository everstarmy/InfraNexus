import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
import { Search, X, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import {
  DataTableFacetedFilter,
  type FacetedOption,
} from "./data-table-faceted-filter"
import { DataTableDateRangeFilter } from "./data-table-date-range-filter"
import { DataTableViewOptions } from "./data-table-view-options"

export interface FacetedFilterConfig {
  columnId: string
  title: string
  options: FacetedOption[]
  selectedValues?: string[]
  onSelectedChange?: (values: string[]) => void
}

interface DataTableToolbarProps<TData extends RowData> {
  table: Table<TData>
  searchKey?: string
  searchPlaceholder?: string
  externalSearch?: { value: string; onChange: (value: string) => void }
  hideSearch?: boolean
  facetedFilters?: FacetedFilterConfig[]
  dateRangeKey?: string
  dateRangeTitle?: string
  columnLabels?: Record<string, string>
  actions?: React.ReactNode
  batchActions?: (
    selectedRows: TData[],
    resetSelection: () => void
  ) => React.ReactNode
  onResetFilters?: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
}

export function DataTableToolbar<TData extends RowData>({
  table,
  searchKey,
  searchPlaceholder = "快速搜索...",
  externalSearch,
  hideSearch = false,
  facetedFilters = [],
  dateRangeKey,
  dateRangeTitle = "时间范围",
  columnLabels = {},
  actions,
  batchActions,
  onResetFilters,
  onRefresh,
  isRefreshing = false,
}: DataTableToolbarProps<TData>) {
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const filtersId = React.useId()
  const hasFilters = facetedFilters.length > 0 || Boolean(dateRangeKey)
  const selectedFilterCount =
    table.getState().columnFilters.length +
    facetedFilters.filter((f) => f.onSelectedChange && f.selectedValues?.length)
      .length
  const isFiltered =
    table.getState().columnFilters.length > 0 ||
    Boolean(table.getState().globalFilter)
  const selectedRows = table
    .getFilteredSelectedRowModel()
    .rows.map((r) => r.original)
  const hasSelection = selectedRows.length > 0

  const searchColumn = searchKey ? table.getColumn(searchKey) : undefined
  const dateColumn = dateRangeKey ? table.getColumn(dateRangeKey) : undefined

  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const searchValue = externalSearch
    ? externalSearch.value
    : searchColumn
      ? ((searchColumn.getFilterValue() as string) ?? "")
      : ((table.getState().globalFilter as string) ?? "")

  // Press "/" to focus search input, Esc to clear and blur
  React.useEffect(() => {
    if (hideSearch) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement)?.tagName
        ) &&
        !(e.target as HTMLElement)?.isContentEditable
      ) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [hideSearch])

  const handleClearSearch = () => {
    if (externalSearch) {
      externalSearch.onChange("")
    } else if (searchColumn) {
      searchColumn.setFilterValue("")
    } else {
      table.setGlobalFilter("")
    }
    searchInputRef.current?.focus()
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5">
      {/* Batch Selection Action Bar (Appears when rows are selected) */}
      {hasSelection && batchActions && (
        <div className="flex w-full min-w-0 animate-in items-center justify-between rounded-lg border border-primary/20 bg-primary/10 px-3.5 py-2 text-xs text-primary fade-in-50 slide-in-from-top-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">
              已勾选 {selectedRows.length} 条数据
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => table.resetRowSelection()}
              className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              取消选择
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {batchActions(selectedRows, () => table.resetRowSelection())}
          </div>
        </div>
      )}

      {/* Main Filter & Action Bar */}
      <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {/* Search box with keyboard shortcut & quick clear */}
          {!hideSearch && (
            <div className="relative w-48 sm:w-64">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => {
                  if (externalSearch) {
                    externalSearch.onChange(e.target.value)
                  } else if (searchColumn) {
                    searchColumn.setFilterValue(e.target.value)
                  } else {
                    table.setGlobalFilter(e.target.value)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    handleClearSearch()
                    searchInputRef.current?.blur()
                  }
                }}
                className="h-8 w-full bg-background pr-7 pl-8 text-xs"
              />
              {searchValue ? (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="清空搜索"
                  className="absolute top-1 right-1 flex size-6 cursor-pointer items-center justify-center rounded-xs text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              ) : (
                <div className="pointer-events-none absolute top-2 right-2 hidden items-center sm:flex">
                  <kbd className="h-4 items-center justify-center rounded border border-border bg-muted/60 px-1 font-mono text-[9px] font-medium text-muted-foreground select-none">
                    /
                  </kbd>
                </div>
              )}
            </div>
          )}

          {hasFilters && (
            <Button
              variant="outline"
              size="sm"
              className="sm:hidden"
              aria-expanded={filtersOpen}
              aria-controls={filtersId}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              筛选{selectedFilterCount > 0 ? `（${selectedFilterCount}）` : ""}
            </Button>
          )}
          <div
            id={filtersId}
            className={cn(
              "w-full flex-wrap items-center gap-2 sm:flex sm:w-auto",
              filtersOpen ? "flex" : "hidden"
            )}
          >
            {/* Faceted Filters */}
            {facetedFilters.map((cfg) => {
              const col = table.getColumn(cfg.columnId)
              if (!col && !cfg.onSelectedChange) return null
              return (
                <DataTableFacetedFilter
                  key={cfg.columnId}
                  column={col}
                  title={cfg.title}
                  options={cfg.options}
                  selectedValues={cfg.selectedValues}
                  onSelectedChange={cfg.onSelectedChange}
                />
              )
            })}

            {/* Date Range Filter */}
            {dateColumn && (
              <DataTableDateRangeFilter
                column={dateColumn}
                title={dateRangeTitle}
              />
            )}

            {/* Reset Filters button */}
            {isFiltered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (onResetFilters) onResetFilters()
                  else {
                    table.resetColumnFilters()
                    table.setGlobalFilter("")
                  }
                }}
                className="h-8 gap-1 px-2 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
                重置筛选
              </Button>
            )}
          </div>
        </div>

        {/* Right side controls: Refresh + View Options + Custom Actions */}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="h-8 gap-1.5 px-2.5 text-xs font-normal"
              title="刷新列表"
            >
              <RotateCcw
                className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          )}

          <DataTableViewOptions table={table} columnLabels={columnLabels} />

          {actions}
        </div>
      </div>
    </div>
  )
}
