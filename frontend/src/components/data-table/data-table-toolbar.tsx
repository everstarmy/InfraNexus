import type { DateRange } from "react-day-picker"
import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
import { Search, X, RotateCcw } from "lucide-react"

import { ButtonGroup } from "@/components/ui/button-group"
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

export interface DataTableToolbarProps<TData extends RowData> {
  table: Table<TData>
  searchKey?: string
  searchPlaceholder?: string
  externalSearch?: { value: string; onChange: (value: string) => void }
  hideSearch?: boolean
  facetedFilters?: FacetedFilterConfig[]
  externalDateRange?: { value: DateRange | undefined; onChange: (value: DateRange | undefined) => void; title?: string }
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
  settingsControls?: React.ReactNode
  exportControl?: React.ReactNode
  layoutButtons?: React.ReactNode[]
  toolbarControls?: React.ReactNode
  actions?: React.ReactNode
  enableColumnPinning?: boolean
  columnManagement?: boolean
  onAutoSize?: (id: string) => void
  onResetLayout?: () => void
  isFiltered?: boolean
  onResetFilters?: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
  filtersOpen?: boolean
  onFiltersOpenChange?: (open: boolean) => void
}

export function DataTableToolbar<TData extends RowData>({
  table,
  searchKey,
  searchPlaceholder = "快速搜索...",
  externalSearch,
  hideSearch = false,
  facetedFilters = [],
  externalDateRange,
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
  exportControl,
  layoutButtons = [],
  settingsControls,
  enableColumnPinning,
  columnManagement,
  onAutoSize,
  onResetLayout,
  isFiltered: controlledIsFiltered,
  onResetFilters,
  onRefresh,
  isRefreshing = false,
  filtersOpen: controlledFiltersOpen,
  onFiltersOpenChange,
}: DataTableToolbarProps<TData>) {
  const composing = React.useRef(false)
  const [compositionDraft, setCompositionDraft] = React.useState<string | null>(null)
  const [localFiltersOpen, setLocalFiltersOpen] = React.useState(false)
  const filtersOpen = controlledFiltersOpen ?? localFiltersOpen
  const setFiltersOpen = (next: boolean) => {
    setLocalFiltersOpen(next)
    onFiltersOpenChange?.(next)
  }
  const filtersId = React.useId()
  const availableFilters = facetedFilters.filter(
    (f) => f.onSelectedChange || table.getColumn(f.columnId),
  )
  const hasFilters =
    availableFilters.length > 0 || Boolean(externalDateRange) || Boolean(dateRangeKey && table.getColumn(dateRangeKey))
  const selectedFilterCount =
    Number(Boolean(externalDateRange?.value?.from || externalDateRange?.value?.to)) + table.getState().columnFilters.length +
    facetedFilters.filter((f) => f.onSelectedChange && f.selectedValues?.length).length
  const isFiltered = controlledIsFiltered ?? (
    Boolean(externalDateRange?.value?.from || externalDateRange?.value?.to) ||
    table.getState().columnFilters.length > 0 ||
    Boolean(table.getState().globalFilter) ||
    Boolean(externalSearch?.value) ||
    facetedFilters.some((f) => Boolean(f.selectedValues?.length)))

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
  const builtInButtons = [
    ...layoutButtons,
    exportControl ? (
      <React.Fragment key="export">{exportControl}</React.Fragment>
    ) : null,
    !hideRefresh && onRefresh ? (
      <Button key="refresh"
        variant="outline"
        size="icon"
        onClick={onRefresh}
        disabled={isRefreshing}
        title="刷新列表"
        aria-label="刷新"
      >
        <RotateCcw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
      </Button>
    ) : null,

    !hideViewOptions || settingsControls ? (
      <DataTableViewOptions key="settings"
        hideColumns={hideViewOptions}
        extraControls={settingsControls}
        enableColumnPinning={enableColumnPinning}
        enhanced={columnManagement}
        onAutoSize={onAutoSize}
        table={table}
        columnLabels={columnLabels}
        onResetLayout={onResetLayout}
      />
    ) : null,
  ].filter(Boolean)
  const hasControls =
    builtInButtons.length > 0 ||
    hasContent(toolbarControls) ||
    hasContent(actions)
  const hasHeader = hasContent(heading) || hasControls
  const hasSearchRow =
    !hideSearch ||
    hasFilters ||
    isFiltered ||
    hasContent(searchLeading) ||
    hasContent(searchTrailing)

  if (!hasHeader && !hasSearchRow) return null

  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5">

      {hasHeader && (
        <div
          data-slot="data-table-header"
          className="flex w-full min-w-0 flex-wrap items-center justify-between gap-2"
        >
          {hasContent(heading) && <div className="min-w-0 flex-auto">{heading}</div>}
          {/* Right side controls: Custom Actions + Built-in Table Tools */}
          {hasControls && (
            <div className="ml-auto flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2">
              {toolbarControls}
              {actions}
              {builtInButtons.length > 1 ? <ButtonGroup aria-label="表格工具">{builtInButtons}</ButtonGroup> : builtInButtons}
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
                value={compositionDraft ?? searchValue}
                onCompositionStart={() => { composing.current = true; setCompositionDraft(searchValue) }}
                onCompositionEnd={e => {
                  composing.current = false; setCompositionDraft(null)
                  if (externalSearch) externalSearch.onChange(e.currentTarget.value)
                  else if (searchColumn) searchColumn.setFilterValue(e.currentTarget.value)
                  else table.setGlobalFilter(e.currentTarget.value)
                }}
                onChange={(e) => {
                  if (composing.current) { setCompositionDraft(e.target.value); return }
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
              onClick={() => setFiltersOpen(!filtersOpen)}
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
              {externalDateRange ? <DataTableDateRangeFilter dateRange={externalDateRange.value} onDateRangeChange={externalDateRange.onChange} title={externalDateRange.title ?? dateRangeTitle} /> : dateColumn && (
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
                      externalDateRange?.onChange(undefined)
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
