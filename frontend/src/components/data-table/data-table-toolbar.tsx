import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
import { Search, X, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { DataTableFacetedFilter, type FacetedOption } from "./data-table-faceted-filter"
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
  toolbarTitle?: React.ReactNode
  /** @deprecated Use toolbarTitle. */
  toolbarLeading?: React.ReactNode
  searchLeading?: React.ReactNode
  searchTrailing?: React.ReactNode
  hideRefresh?: boolean
  hideViewOptions?: boolean
  toolbarControls?: React.ReactNode
  actions?: React.ReactNode
  batchActions?: (selectedRows: TData[], resetSelection: () => void) => React.ReactNode
  onResetLayout?: () => void
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
  toolbarTitle,
  toolbarLeading,
  searchLeading,
  searchTrailing,
  hideRefresh = false,
  hideViewOptions = false,
  toolbarControls,
  batchActions,
  onResetLayout,
  onResetFilters,
  onRefresh,
  isRefreshing = false,
}: DataTableToolbarProps<TData>) {
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const filtersId = React.useId()
  const availableFilters = facetedFilters.filter(
    (f) => f.onSelectedChange || table.getColumn(f.columnId),
  )
  const hasFilters =
    availableFilters.length > 0 || Boolean(dateRangeKey && table.getColumn(dateRangeKey))
  const selectedFilterCount =
    table.getState().columnFilters.length +
    facetedFilters.filter((f) => f.onSelectedChange && f.selectedValues?.length).length
  const isFiltered =
    table.getState().columnFilters.length > 0 ||
    Boolean(table.getState().globalFilter) ||
    Boolean(externalSearch?.value) ||
    facetedFilters.some((f) => Boolean(f.selectedValues?.length))
  const selectedRows = table.getFilteredSelectedRowModel().rows.map((r) => r.original)
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
        !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName) &&
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

  const heading = toolbarTitle ?? toolbarLeading
  const hasContent = (node: React.ReactNode) =>
    React.Children.toArray(node).some((child) => child !== "")
  const hasControls =
    hasContent(toolbarControls) ||
    (!hideRefresh && Boolean(onRefresh)) ||
    !hideViewOptions ||
    hasContent(actions)
  const hasHeader = hasContent(heading) || hasControls
  const hasSearchRow =
    !hideSearch ||
    hasFilters ||
    isFiltered ||
    hasContent(searchLeading) ||
    hasContent(searchTrailing)

  if (!hasHeader && !hasSearchRow && !(hasSelection && batchActions)) return null

  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5">
      {/* Batch Selection Action Bar (Appears when rows are selected) */}
      {hasSelection && batchActions && (
        <div
          role="region"
          aria-label="批量操作"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex max-h-[45svh] w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 animate-in flex-col items-stretch gap-2 overflow-y-auto rounded-lg border border-primary/30 bg-background/95 px-3.5 py-2.5 text-xs text-primary shadow-xl backdrop-blur-md fade-in-50 slide-in-from-bottom-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
        >
          <div className="flex items-center justify-between gap-2 sm:justify-start">
            <span role="status" aria-live="polite" className="font-semibold">
              已勾选 {selectedRows.length} 条（筛选结果内）
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => table.resetRowSelection()}
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              取消选择
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {batchActions(selectedRows, () => table.resetRowSelection())}
          </div>
        </div>
      )}

      {hasHeader && (
        <div
          data-slot="data-table-header"
          className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2"
        >
          {hasContent(heading) && <div className="min-w-0 flex-auto">{heading}</div>}
          {/* Right side controls: Refresh + View Options + Custom Actions */}
          {hasControls && (
            <div className="ml-auto flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
              {toolbarControls}
              {!hideRefresh && onRefresh && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="h-8 gap-1.5 px-2.5 text-xs font-normal"
                  title="刷新列表"
                  aria-label="刷新"
                >
                  <RotateCcw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                  <span className="hidden sm:inline">刷新</span>
                </Button>
              )}

              {!hideViewOptions && (
                <DataTableViewOptions
                  table={table}
                  columnLabels={columnLabels}
                  onResetLayout={onResetLayout}
                />
              )}

              {actions}
            </div>
          )}
        </div>
      )}
      {hasSearchRow && (
        <div
          data-slot="data-table-search"
          className="flex w-full min-w-0 flex-wrap items-center gap-2 [&>*]:max-w-full"
        >
          {searchLeading}
          {/* Search box with keyboard shortcut & quick clear */}
          {!hideSearch && (
            <div className="relative w-full min-w-0 sm:w-64">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                aria-label={searchPlaceholder}
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
          {(hasFilters || isFiltered) && (
            <div
              id={filtersId}
              className={cn(
                "w-full flex-wrap items-center gap-2 sm:flex sm:w-auto",
                filtersOpen || !hasFilters ? "flex" : "hidden",
              )}
            >
              {/* Faceted Filters */}
              {availableFilters.map((cfg) => {
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
                <DataTableDateRangeFilter column={dateColumn} title={dateRangeTitle} />
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
          )}
          {searchTrailing}
        </div>
      )}
    </div>
  )
}
