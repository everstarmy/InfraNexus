import * as React from "react"
import { cn } from "cn"
import {
  readTableUrl,
  writeTableUrl,
  matchesDateRange,
  type TableUrlState,
} from "@/lib/table-url-state"
import { useInRouterContext, useSearchParams } from "react-router-dom"
import {
  useTable,
  type RowData,
  type SortingState,
  type ColumnFiltersState,
  type ColumnVisibilityState,
  type RowSelectionState,
  type PaginationState,
} from "@tanstack/react-table"
import {
  appTableFeatures,
  type AppTableFeatures,
  type ColumnDef,
  type Table,
} from "./types"

export type { ColumnDef, Table, AppTableFeatures }

import {
  Table as ShadcnTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DataTableToolbar,
  type FacetedFilterConfig,
} from "./data-table-toolbar"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableSkeleton } from "./data-table-skeleton"
import { DataTableEmpty } from "./data-table-empty"

export interface DataTableProps<TData extends RowData, TValue = unknown> {
  /** Filtering and sorting are performed by the server across the complete dataset. */
  serverFiltering?: boolean
  /** Controlled ordering across the full server dataset. */
  serverSorting?: {
    sorting: SortingState
    onChange: (next: SortingState) => void
  }
  /** Column definitions */
  columns: ColumnDef<TData, TValue>[]
  /** Dataset */
  data: TData[]
  /** Loading state indicator (shows skeleton when true) */
  loading?: boolean
  /** Specific column key for search filter. If omitted, global filter is used */
  searchKey?: string
  /** Search input placeholder */
  searchPlaceholder?: string
  externalSearch?: { value: string; onChange: (value: string) => void }
  /** The parent renders a shared search control for responsive views. */
  hideSearch?: boolean
  /** Multi-select faceted filters */
  facetedFilters?: FacetedFilterConfig[]
  /** Date range filter column key */
  dateRangeKey?: string
  /** Date range filter label */
  dateRangeTitle?: string
  /** Custom friendly labels for columns in the View Options toggle menu */
  columnLabels?: Record<string, string>
  /** Top right custom action buttons (e.g. New Device, Export) */
  actions?: React.ReactNode
  /** Batch action renderer when rows are selected */
  batchActions?: (
    selectedRows: TData[],
    resetSelection: () => void
  ) => React.ReactNode
  /** Refresh callback for refresh button in toolbar */
  onRefresh?: () => void
  /** Indicates refresh in progress */
  isRefreshing?: boolean
  /** Available page size options */
  pageSizeOptions?: number[]
  /** Default page size (default: 10) */
  defaultPageSize?: number
  /** Empty state title */
  emptyTitle?: string
  /** Empty state description */
  emptyDescription?: string
  /** Empty state custom action */
  emptyAction?: React.ReactNode
  /** Row click callback */
  onRowClick?: (row: TData) => void
  /** Business-specific row emphasis, using semantic theme colors. */
  rowClassName?: (row: TData) => string | undefined
  /** Unique row key generator */
  getRowId?: (row: TData, index: number) => string
  /** External table instance callback if parent component needs direct table control */
  onTableInstance?: (table: Table<TData>) => void
  /** Whether to sync search query and page index to URL search params (default: false) */
  enableUrlSync?: boolean
  urlStateKey?: string
  /** Preserve meaningful selection while drilling into another route. */
  persistRowSelection?: boolean
  /** Keep the last action column in view while horizontally scrolling. */
  stickyActionColumn?: boolean
  /** Default hidden columns; users may show them from View Options. */
  initialColumnVisibility?: ColumnVisibilityState
  /** Controlled server pagination; the data prop contains one page. */
  serverPagination?: {
    pageIndex: number
    pageSize: number
    total: number
    onChange: (next: PaginationState) => void
  }
}

/**
 * Standard selectable checkbox column helper to prepend to column definitions.
 */
export function createSelectColumn<TData extends RowData>(): ColumnDef<
  TData,
  unknown
> {
  return {
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center px-1">
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected()
          }
          onCheckedChange={(checked) =>
            table.toggleAllPageRowsSelected(!!checked)
          }
          aria-label="全选当页数据"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div
        className="flex items-center justify-center px-1"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => row.toggleSelected(!!checked)}
          aria-label="勾选该行数据"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }
}

export function DataTable<TData extends RowData, TValue = unknown>(
  props: DataTableProps<TData, TValue>
) {
  const inRouter = useInRouterContext()
  return props.enableUrlSync && inRouter ? (
    <UrlDataTable {...props} />
  ) : (
    <DataTableCore {...props} />
  )
}

function UrlDataTable<TData extends RowData, TValue = unknown>(
  props: DataTableProps<TData, TValue>
) {
  const [params, setParams] = useSearchParams()
  const options = React.useMemo(
    () => ({
      prefix: props.urlStateKey,
      searchKey: props.searchKey,
      facetKeys: (props.facetedFilters ?? []).map((item) => item.columnId),
      dateRangeKey: props.dateRangeKey,
      defaultPageSize: props.defaultPageSize ?? 10,
    }),
    [
      props.urlStateKey,
      props.searchKey,
      props.facetedFilters,
      props.dateRangeKey,
      props.defaultPageSize,
    ]
  )
  const state = React.useMemo(
    () => readTableUrl(params, options),
    [params, options]
  )
  const update = (patch: Partial<TableUrlState>) =>
    setParams(
      (current) => {
        const previous = readTableUrl(current, options)
        return writeTableUrl(current, options, { ...previous, ...patch })
      },
      { replace: true }
    )
  const selectionKey = `${props.urlStateKey ?? "table"}_selected`
  const selection = Object.fromEntries(
    (params.get(selectionKey) ?? "")
      .split(",")
      .filter(Boolean)
      .map((id) => [id, true as const])
  )
  return (
    <DataTableCore
      {...props}
      urlState={state}
      updateUrlState={update}
      savedSelection={props.persistRowSelection ? selection : undefined}
      saveSelection={
        props.persistRowSelection
          ? (next) =>
              setParams(
                (current) => {
                  const p = new URLSearchParams(current)
                  const ids = Object.keys(next)
                    .filter((id) => next[id])
                    .join(",")
                  if (ids) p.set(selectionKey, ids)
                  else p.delete(selectionKey)
                  return p
                },
                { replace: true }
              )
          : undefined
      }
    />
  )
}

function DataTableCore<TData extends RowData, TValue = unknown>({
  columns,
  data,
  loading = false,
  searchKey,
  searchPlaceholder,
  externalSearch,
  hideSearch = false,
  facetedFilters = [],
  dateRangeKey,
  dateRangeTitle,
  columnLabels,
  actions,
  batchActions,
  onRefresh,
  isRefreshing = false,
  pageSizeOptions = [10, 20, 50, 100],
  defaultPageSize = 10,
  emptyTitle,
  emptyDescription,
  emptyAction,
  onRowClick,
  rowClassName,
  getRowId,
  onTableInstance,
  urlState,
  updateUrlState,
  stickyActionColumn = false,
  initialColumnVisibility = {},
  serverPagination,
  serverFiltering = false,
  serverSorting,
  savedSelection,
  saveSelection,
}: DataTableProps<TData, TValue> & {
  urlState?: TableUrlState
  savedSelection?: RowSelectionState
  saveSelection?: (next: RowSelectionState) => void
  updateUrlState?: (patch: Partial<TableUrlState>) => void
}) {
  // Table states
  const [localSorting, setSorting] = React.useState<SortingState>([])
  const [localColumnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>(initialColumnVisibility)
  const [localSelection, setRowSelection] = React.useState<RowSelectionState>(
    {}
  )
  const rowSelection = savedSelection ?? localSelection
  const [localGlobalFilter, setGlobalFilter] = React.useState<string>("")
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  })
  const currentPagination = serverPagination
    ? {
        pageIndex: serverPagination.pageIndex,
        pageSize: serverPagination.pageSize,
      }
    : (urlState?.pagination ?? pagination)
  const sorting = serverSorting?.sorting ?? urlState?.sorting ?? localSorting
  const columnFilters = urlState?.columnFilters ?? localColumnFilters
  const globalFilter = urlState?.globalFilter ?? localGlobalFilter
  const configuredColumns = React.useMemo(
    () =>
      columns.map((column) => {
        const id =
          column.id ??
          ("accessorKey" in column ? column.accessorKey : undefined)
        if (column.filterFn || typeof id !== "string") return column
        if (id === dateRangeKey)
          return {
            ...column,
            filterFn: (row, columnId, value) =>
              matchesDateRange(row.getValue(columnId), value),
          } satisfies ColumnDef<TData, TValue>
        if (facetedFilters.some((item) => item.columnId === id))
          return {
            ...column,
            filterFn: (row, columnId, value) =>
              !Array.isArray(value) ||
              !value.length ||
              value.includes(String(row.getValue(columnId))),
          } satisfies ColumnDef<TData, TValue>
        return column
      }),
    [columns, dateRangeKey, facetedFilters]
  )

  // Table instance configuration
  const baseTable = useTable<AppTableFeatures, TData>({
    features: appTableFeatures,
    data,
    columns: configuredColumns as ColumnDef<TData, unknown>[],
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      globalFilter,
      pagination: currentPagination,
    },
    enableRowSelection: true,
    onSortingChange: (updater) => {
      if (serverSorting)
        serverSorting.onChange(
          typeof updater === "function" ? updater(sorting) : updater
        )
      else if (updateUrlState)
        updateUrlState({
          sorting: typeof updater === "function" ? updater(sorting) : updater,
          pagination: { ...currentPagination, pageIndex: 0 },
        })
      else setSorting(updater)
    },
    onColumnFiltersChange: (updater) => {
      if (updateUrlState)
        updateUrlState({
          columnFilters:
            typeof updater === "function" ? updater(columnFilters) : updater,
          pagination: { ...currentPagination, pageIndex: 0 },
        })
      else setColumnFilters(updater)
    },
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater
      if (saveSelection) saveSelection(next)
      else setRowSelection(next)
    },
    onGlobalFilterChange: (updater) => {
      if (updateUrlState)
        updateUrlState({
          globalFilter:
            typeof updater === "function" ? updater(globalFilter) : updater,
          pagination: { ...currentPagination, pageIndex: 0 },
        })
      else setGlobalFilter(updater)
    },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(currentPagination) : updater
      if (serverPagination) serverPagination.onChange(next)
      else if (updateUrlState) updateUrlState({ pagination: next })
      else setPagination(next)
    },
    // URL state owns resets on filter/sort changes; refreshing data must keep the current page.
    autoResetPageIndex: urlState ? false : undefined,
    manualPagination: Boolean(serverPagination),
    manualFiltering: serverFiltering,
    manualSorting: Boolean(serverSorting) || serverFiltering,
    rowCount: serverPagination?.total,
    getRowId,
  })

  const table = React.useMemo<Table<TData>>(() => {
    return Object.assign(baseTable, {
      getState: () => baseTable.state,
    })
  }, [baseTable])

  React.useEffect(() => {
    if (onTableInstance) {
      onTableInstance(table)
    }
  }, [table, onTableInstance])

  // React Router search-param callbacks do not merge consecutive writes in one event.
  const resetFilters = () => {
    if (updateUrlState)
      updateUrlState({
        columnFilters: [],
        globalFilter: "",
        pagination: { ...currentPagination, pageIndex: 0 },
      })
    else {
      table.resetColumnFilters(true)
      table.setGlobalFilter("")
    }
  }
  const isFiltered = columnFilters.length > 0 || Boolean(globalFilter)

  return (
    <div className="w-full min-w-0 space-y-3.5" data-slot="data-table">
      <DataTableToolbar
        table={table}
        searchKey={searchKey}
        searchPlaceholder={searchPlaceholder}
        externalSearch={externalSearch}
        hideSearch={hideSearch}
        facetedFilters={facetedFilters}
        onResetFilters={resetFilters}
        dateRangeKey={dateRangeKey}
        dateRangeTitle={dateRangeTitle}
        columnLabels={columnLabels}
        actions={actions}
        batchActions={batchActions}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />

      {/* Main Table Content Container */}
      <div className="w-full min-w-0 overflow-hidden rounded-lg border bg-card shadow-xs">
        {loading ? (
          <DataTableSkeleton
            columnCount={columns.length}
            rowCount={
              currentPagination.pageSize > 10 ? 10 : currentPagination.pageSize
            }
            showCheckbox={columns.some((c) => c.id === "select")}
          />
        ) : (
          <ShadcnTable className="min-w-max">
            <TableHeader className="bg-muted/40">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
                        className={`h-10 px-3 text-xs font-semibold ${stickyActionColumn && header.column.id === "actions" ? "sticky right-0 z-20 border-l bg-muted shadow-[-6px_0_10px_-8px_rgba(0,0,0,0.25)]" : ""}`}
                      >
                        {header.isPlaceholder ? null : (
                          <table.FlexRender header={header} />
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    onClick={() => onRowClick?.(row.original)}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        onRowClick &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault()
                        onRowClick(row.original)
                      }
                    }}
                    className={cn(
                      onRowClick
                        ? "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary data-[state=selected]:bg-muted"
                        : "transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted/60",
                      rowClassName?.(row.original)
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={`p-3 text-xs ${stickyActionColumn && cell.column.id === "actions" ? "sticky right-0 z-10 border-l bg-card shadow-[-6px_0_10px_-8px_rgba(0,0,0,0.25)]" : ""}`}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={columns.length}
                    className="h-64 text-center"
                  >
                    <DataTableEmpty
                      isFiltered={isFiltered}
                      title={isFiltered ? "未找到符合条件的结果" : emptyTitle}
                      description={
                        isFiltered
                          ? "当前筛选条件下无匹配项，请尝试调整搜索关键字或重置过滤条件"
                          : emptyDescription
                      }
                      action={!isFiltered ? emptyAction : undefined}
                      onResetFilters={resetFilters}
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </ShadcnTable>
        )}

        {/* Bottom Pagination Bar */}
        {!loading && (
          <DataTablePagination
            table={table}
            pageSizeOptions={pageSizeOptions}
            totalCount={serverPagination?.total}
          />
        )}
      </div>
    </div>
  )
}
