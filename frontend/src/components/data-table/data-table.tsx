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
  type ExpandedState,
  type ColumnPinningState,
} from "@tanstack/react-table"
import {
  appTableFeatures,
  type AppTableFeatures,
  type ColumnDef,
  type Column,
  type Table,
} from "./types"


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

// Sticky cells need opaque fills; mix the same translucent muted tints the
// header and rows use so pinned and scrolling columns read as one surface.
const pinnedHeadSurface = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]"
const pinnedCellSurface =
  "bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] group-has-aria-expanded/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] group-data-[state=selected]/row:bg-[color-mix(in_oklab,var(--muted)_70%,var(--card))]"

export type { ColumnDef, Table, AppTableFeatures }

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
  /** First row title, description or status. */
  toolbarTitle?: React.ReactNode
  /** @deprecated Title alias; use toolbarTitle. */
  toolbarLeading?: React.ReactNode
  /** Second row slots before search and after built-in filters. */
  searchLeading?: React.ReactNode
  searchTrailing?: React.ReactNode
  /** Hide built-in buttons independently (default: false). */
  hideRefresh?: boolean
  hideViewOptions?: boolean
  /** Controls before refresh and column settings. */
  toolbarControls?: React.ReactNode
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
  /** Clear page-scoped selection when the query, ordering, or page changes. */
  selectionScopeKey?: string
  /** Disable selection while rows are placeholders or stale during a query transition. */
  selectionDisabled?: boolean
  /** Keep the last action column in view while horizontally scrolling. */
  stickyActionColumn?: boolean
  enableColumnResizing?: boolean
  enableColumnPinning?: boolean
  /** Persist only layout preferences for this user/table/schema combination. */
  tablePreference?: { userId: string; tableId: string; schemaVersion: number }
  /** Default hidden columns; users may show them from View Options. */
  initialColumnVisibility?: ColumnVisibilityState
  /** Initial fixed columns, overridden by a saved preference. */
  initialColumnPinning?: ColumnPinningState
  /** Tree data: returns the children of a row to render expandable sub rows. */
  getSubRows?: (row: TData, index: number) => TData[] | undefined
  /** Initial expansion for tree data (true expands every level). */
  defaultExpanded?: ExpandedState
  /** Controlled server pagination; the data prop contains one page. */
  serverPagination?: {
    pageIndex: number
    pageSize: number
    total: number
    onChange: (next: PaginationState) => void
  }
}

type ColumnPreferences = {
  columnVisibility: ColumnVisibilityState
  columnPinning: ColumnPinningState
  columnSizing: Record<string, number>
}

function preferenceStorageKey(preference: DataTableProps<RowData>["tablePreference"]) {
  if (!preference?.userId || !preference.tableId) return null
  return `infranexus:table:${encodeURIComponent(preference.userId)}:${encodeURIComponent(preference.tableId)}:v${preference.schemaVersion}`
}

function getColumnId<TData extends RowData>(column: ColumnDef<TData, unknown>) {
  const key = column.id ?? ("accessorKey" in column ? column.accessorKey : undefined)
  return typeof key === "string" ? key : undefined
}

function readColumnPreferences<TData extends RowData>(
  storageKey: string | null,
  columns: ColumnDef<TData, unknown>[],
  visibility: ColumnVisibilityState,
  pinning: ColumnPinningState,
): ColumnPreferences {
  const validIds = new Set(columns.map(getColumnId).filter((id): id is string => !!id))
  const dataIds = new Set(columns.filter(column => "accessorKey" in column || "accessorFn" in column).map(getColumnId))
  const oneDataColumn = (ids: string[]) => {
    let kept = false
    return ids.filter(id => {
      if (!dataIds.has(id)) return true
      if (kept) return false
      kept = true
      return true
    })
  }
  const defaults: ColumnPreferences = {
    columnVisibility: { ...visibility },
    columnPinning: {
      start: oneDataColumn(pinning.start.filter((id) => validIds.has(id))),
      end: oneDataColumn(pinning.end.filter((id) => validIds.has(id) && !pinning.start.includes(id))),
    },
    columnSizing: {},
  }
  if (!storageKey || typeof window === "undefined") return defaults
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as Partial<ColumnPreferences> | null
    if (!stored || typeof stored !== "object") return defaults
    const columnVisibility = { ...defaults.columnVisibility }
    for (const [id, value] of Object.entries(stored.columnVisibility ?? {})) {
      if (validIds.has(id) && typeof value === "boolean") columnVisibility[id] = value
    }
    const columnSizing: Record<string, number> = {}
    for (const [id, value] of Object.entries(stored.columnSizing ?? {})) {
      const column = columns.find((item) => getColumnId(item) === id)
      if (!column || typeof value !== "number" || !Number.isFinite(value)) continue
      columnSizing[id] = Math.max(column.minSize ?? 72, Math.min(column.maxSize ?? 520, value))
    }
    const pinList = (values: unknown) => Array.isArray(values)
      ? [...new Set(values.filter((id): id is string => typeof id === "string" && validIds.has(id)))]
      : []
    const start = pinList(stored.columnPinning?.start ?? defaults.columnPinning.start)
    const end = pinList(stored.columnPinning?.end ?? defaults.columnPinning.end).filter((id) => !start.includes(id))
    return { columnVisibility, columnSizing, columnPinning: { start: oneDataColumn(start), end: oneDataColumn(end) } }
  } catch {
    return defaults
  }
}

const selectColumnAnchors = new WeakMap<object, string>()

export function resetSelectColumnAnchor(table: object) {
  selectColumnAnchors.delete(table)
}

/**
 * Standard selectable checkbox column helper to prepend to column definitions.
 */
export function createSelectColumn<TData extends RowData>(): ColumnDef<
  TData,
  unknown
> {
  let shiftPressed = false
  return {
    id: "select",
    size: 42,
    minSize: 42,
    maxSize: 42,
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
          disabled={!table.getRowModel().rows.some((row) => row.getCanSelect())}
          aria-label="全选当页数据"
        />
      </div>
    ),
    cell: ({ row, table }) => (
      <div
        className="flex items-center justify-center px-1"
        onClickCapture={(event) => { shiftPressed = event.shiftKey }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onCheckedChange={(checked) => {
            const shouldSelect = !!checked
            const visibleRows = table.getRowModel().rows
            const currentIndex = visibleRows.findIndex((item) => item.id === row.id)
            const anchorId = selectColumnAnchors.get(table)
            const anchorIndex = anchorId ? visibleRows.findIndex((item) => item.id === anchorId) : -1
            if (shiftPressed && anchorIndex >= 0 && currentIndex >= 0) {
              const start = Math.min(anchorIndex, currentIndex)
              const end = Math.max(anchorIndex, currentIndex)
              const rangeIds = visibleRows
                .slice(start, end + 1)
                .filter((visibleRow) => visibleRow.getCanSelect())
                .map((visibleRow) => visibleRow.id)
              table.setRowSelection((current) => {
                const next = { ...current }
                for (const id of rangeIds) {
                  if (shouldSelect) next[id] = true
                  else delete next[id]
                }
                return next
              })
            } else {
              row.toggleSelected(shouldSelect)
            }
            selectColumnAnchors.set(table, row.id)
            shiftPressed = false
          }}
          aria-label="勾选该行；按住 Shift 可连续选择"
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
  toolbarTitle,
  toolbarLeading,
  searchLeading,
  searchTrailing,
  hideRefresh,
  hideViewOptions,
  toolbarControls,
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
  enableColumnResizing = false,
  enableColumnPinning = false,
  initialColumnVisibility = {},
  initialColumnPinning = { start: [], end: [] },
  tablePreference,
  selectionScopeKey: explicitSelectionScopeKey,
  persistRowSelection = false,
  selectionDisabled = false,
  serverPagination,
  serverFiltering = false,
  serverSorting,
  savedSelection,
  saveSelection,
  getSubRows,
  defaultExpanded = {},
}: DataTableProps<TData, TValue> & {
  urlState?: TableUrlState
  savedSelection?: RowSelectionState
  saveSelection?: (next: RowSelectionState) => void
  updateUrlState?: (patch: Partial<TableUrlState>) => void
}) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  React.useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setContainerWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const allowDataPinning = containerWidth === 0 || containerWidth >= 640
  const storageKey = preferenceStorageKey(tablePreference)
  const visibilityKey = JSON.stringify(initialColumnVisibility)
  const pinningKey = JSON.stringify(initialColumnPinning)
  const schemaKey = JSON.stringify(columns.map(column => ({ id: getColumnId(column as ColumnDef<TData, unknown>), min: column.minSize, max: column.maxSize })))
  const preferenceDefaults = React.useMemo(
    () => readColumnPreferences(storageKey, columns as ColumnDef<TData, unknown>[], initialColumnVisibility, initialColumnPinning),
    [storageKey, schemaKey, visibilityKey, pinningKey],
  )
  const [savedColumnPreferences, setSavedColumnPreferences] = React.useState(() => ({
    key: storageKey,
    value: preferenceDefaults,
  }))
  const activeColumnPreferences = savedColumnPreferences.key === storageKey
    ? savedColumnPreferences.value
    : preferenceDefaults

  React.useLayoutEffect(() => {
    if (savedColumnPreferences.key !== storageKey) {
      setSavedColumnPreferences({ key: storageKey, value: preferenceDefaults })
    }
  }, [savedColumnPreferences.key, storageKey, preferenceDefaults])

  React.useEffect(() => {
    if (!storageKey || savedColumnPreferences.key !== storageKey || typeof window === "undefined") return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(savedColumnPreferences.value))
    } catch {
      // Storage can be unavailable in private browsing; table controls still work in memory.
    }
  }, [storageKey, savedColumnPreferences])

  // Table states
  const [localSorting, setSorting] = React.useState<SortingState>([])
  const [localColumnFilters, setColumnFilters] =
    React.useState<ColumnFiltersState>([])
  const columnVisibility = activeColumnPreferences.columnVisibility
  const [localSelection, setRowSelection] = React.useState<RowSelectionState>(
    {}
  )
  const rowSelection = savedSelection ?? localSelection
  const [localGlobalFilter, setGlobalFilter] = React.useState<string>("")
  const [expanded, setExpanded] = React.useState<ExpandedState>(defaultExpanded)
  const columnPinning = activeColumnPreferences.columnPinning
  const columnSizing = activeColumnPreferences.columnSizing
  const updateColumnPreference = <K extends keyof ColumnPreferences>(key: K, updater: React.SetStateAction<ColumnPreferences[K]>) => {
    setSavedColumnPreferences((current) => {
      const base = current.key === storageKey ? current.value : preferenceDefaults
      const currentValue = base[key]
      const nextValue = typeof updater === "function"
        ? (updater as (value: ColumnPreferences[K]) => ColumnPreferences[K])(currentValue)
        : updater
      return { key: storageKey, value: { ...base, [key]: nextValue } }
    })
  }
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
  const selectionScopeKey = explicitSelectionScopeKey ?? (persistRowSelection ? undefined : JSON.stringify([currentPagination, sorting, columnFilters, globalFilter, externalSearch?.value, facetedFilters.map(filter => filter.selectedValues)]))
  const lastSelectionScope = React.useRef({ scope: selectionScopeKey, disabled: selectionDisabled })
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
      expanded,
      columnPinning,
      columnSizing,
    },
    enableRowSelection: !selectionDisabled,
    getSubRows,
    onExpandedChange: setExpanded,
    onColumnPinningChange: (updater) => updateColumnPreference("columnPinning", updater),
    onColumnSizingChange: (updater) => updateColumnPreference("columnSizing", updater),
    enableColumnPinning,
    enableColumnResizing,
    columnResizeMode: "onEnd",
    defaultColumn: enableColumnResizing ? { size: 160, minSize: 72, maxSize: 520 } : undefined,
    autoResetExpanded: false,
    paginateExpandedRows: false,
    filterFromLeafRows: true,
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
    onColumnVisibilityChange: (updater) => updateColumnPreference("columnVisibility", updater),
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
    enableSorting: !serverFiltering || Boolean(serverSorting),
    rowCount: serverPagination?.total,
    getRowId,
  })

  const table = React.useMemo<Table<TData>>(() => {
    return Object.assign(baseTable, {
      getState: () => baseTable.state,
    })
  }, [baseTable])

  React.useLayoutEffect(() => {
    const previous = lastSelectionScope.current
    const scopeChanged = selectionScopeKey !== undefined && previous.scope !== selectionScopeKey
    const becameDisabled = selectionDisabled && !previous.disabled
    if (scopeChanged || becameDisabled) {
      table.resetRowSelection()
      resetSelectColumnAnchor(table)
    }
    lastSelectionScope.current = { scope: selectionScopeKey, disabled: selectionDisabled }
  }, [table, selectionScopeKey, selectionDisabled])

  React.useEffect(() => {
    if (onTableInstance) {
      onTableInstance(table)
    }
  }, [table, onTableInstance])

  React.useEffect(() => {
    if (loading) return
    const lastPage = Math.max(0, table.getPageCount() - 1)
    if (currentPagination.pageIndex > lastPage) table.setPageIndex(lastPage)
  }, [table, loading, data, currentPagination.pageIndex, currentPagination.pageSize, serverPagination?.total])

  // React Router search-param callbacks do not merge consecutive writes in one event.
  const resetFilters = () => {
    externalSearch?.onChange("")
    facetedFilters.forEach(filter => filter.onSelectedChange?.([]))
    if (serverPagination) serverPagination.onChange({ ...currentPagination, pageIndex: 0 })
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
  const isFiltered = columnFilters.length > 0 || Boolean(globalFilter) || Boolean(externalSearch?.value) || facetedFilters.some(filter => Boolean(filter.selectedValues?.length))

  const hasBatchSelection = !!batchActions && table.getFilteredSelectedRowModel().rows.length > 0

  // Saved sizes are the narrow-layout baseline. Distribute spare width among
  // data columns while keeping fixed controls (selection/actions) compact.
  const visibleColumns = table.getVisibleLeafColumns()
  const fixedColumns = new Set(visibleColumns
    .filter((column) => column.columnDef.minSize !== undefined && column.columnDef.minSize === column.columnDef.maxSize)
    .map((column) => column.id))
  const growColumn = visibleColumns.find(column => !fixedColumns.has(column.id) && column.accessorFn !== undefined)
  const allocationFixedColumns = new Set(visibleColumns.filter(column => column.id !== growColumn?.id).map(column => column.id))
  const fixedWidth = visibleColumns.reduce((sum, column) => sum + (allocationFixedColumns.has(column.id) ? column.getSize() : 0), 0)
  const totalWidth = visibleColumns.reduce((sum, column) => sum + column.getSize(), 0)
  const flexibleWidth = totalWidth - fixedWidth
  const visibleIds = new Set(visibleColumns.map((column) => column.id))
  const widthOf = (columns: Column<TData>[], stickyOffset = false) => {
    let fixed = 0
    let flexible = 0
    for (const column of columns) {
      if (allocationFixedColumns.has(column.id)) fixed += column.getSize()
      else flexible += column.getSize()
    }
    if (!flexible || !flexibleWidth) return `${fixed}px`
    const share = flexible / flexibleWidth
    const offset = fixed - share * fixedWidth
    const width = `calc(${share * 100}% ${offset < 0 ? "-" : "+"} ${Math.abs(offset)}px)`
    // Sticky percentages resolve against the scroll viewport; clamp to the
    // baseline when the table is wider than that viewport.
    return stickyOffset ? `max(${fixed + flexible}px, ${width})` : width
  }
  const columnStyles = new Map<string, React.CSSProperties>()
  const columnStyle = (column: Column<TData>): React.CSSProperties => {
    const cached = columnStyles.get(column.id)
    if (cached) return cached
    const pinned = enableColumnPinning && allowDataPinning && column.getIsPinned()
    const pinnedColumns = pinned === "start" ? table.getStartVisibleLeafColumns()
      : pinned === "end" ? table.getEndVisibleLeafColumns() : []
    const pinIndex = pinnedColumns.findIndex((item) => item.id === column.id)
    const style: React.CSSProperties = {
      width: enableColumnResizing ? widthOf((column.columns.length ? column.getLeafColumns() : [column]).filter((item) => visibleIds.has(item.id))) : undefined,
      position: pinned ? "sticky" : undefined,
      insetInlineStart: pinned === "start" ? (enableColumnResizing ? widthOf(pinnedColumns.slice(0, pinIndex), true) : column.getStart("start")) : undefined,
      insetInlineEnd: pinned === "end" ? (enableColumnResizing ? widthOf(pinnedColumns.slice(pinIndex + 1), true) : column.getAfter("end")) : undefined,
    }
    columnStyles.set(column.id, style)
    return style
  }

  return (
    <div ref={rootRef} className={cn("w-full min-w-0 space-y-3.5", hasBatchSelection && "pb-20")} data-slot="data-table">
      <DataTableToolbar
        table={table}
        searchKey={searchKey}
        searchPlaceholder={searchPlaceholder}
        externalSearch={externalSearch}
        hideSearch={hideSearch}
        facetedFilters={facetedFilters}
        onResetFilters={resetFilters}
        onResetLayout={() => setSavedColumnPreferences({ key: storageKey, value: readColumnPreferences(null, columns as ColumnDef<TData, unknown>[], initialColumnVisibility, initialColumnPinning) })}
        dateRangeKey={dateRangeKey}
        dateRangeTitle={dateRangeTitle}
        columnLabels={columnLabels}
        actions={actions}
        toolbarTitle={toolbarTitle}
        toolbarLeading={toolbarLeading}
        searchLeading={searchLeading}
        searchTrailing={searchTrailing}
        hideRefresh={hideRefresh}
        hideViewOptions={hideViewOptions}
        toolbarControls={toolbarControls}
        batchActions={batchActions}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
      />

      {/* Main Table Content Container */}
      <div className="w-full min-w-0 rounded-lg border bg-card shadow-xs">
        {loading ? (
          <DataTableSkeleton
            columnCount={visibleColumns.filter(column => column.id !== "select").length}
            rowCount={
              currentPagination.pageSize > 10 ? 10 : currentPagination.pageSize
            }
            showCheckbox={visibleColumns.some(column => column.id === "select")}
          />
        ) : (
          <ShadcnTable className={enableColumnResizing ? undefined : "min-w-max"} style={enableColumnResizing ? { width: "100%", minWidth: totalWidth, tableLayout: "fixed" } : undefined}>
            {enableColumnResizing && <colgroup>{visibleColumns.map(column => <col key={column.id} style={{ width: columnStyle(column).width }} />)}</colgroup>}
            <TableHeader className="bg-muted/40">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
                        aria-sort={header.column.getIsSorted() === "asc" ? "ascending" : header.column.getIsSorted() === "desc" ? "descending" : undefined}
                        style={columnStyle(header.column)}
                        className={`relative h-10 px-3 text-xs font-semibold ${stickyActionColumn && header.column.id === "actions" ? `sticky right-0 z-20 border-l ${pinnedHeadSurface} shadow-[-6px_0_10px_-8px_rgba(0,0,0,0.25)]` : ""} ${enableColumnPinning && header.column.getIsPinned() ? `z-20 ${pinnedHeadSurface}` : ""}`}
                      >
                        {header.isPlaceholder ? null : (
                          <table.FlexRender header={header} />
                        )}
                        {enableColumnResizing && header.column.getCanResize() && !fixedColumns.has(header.column.id) && (
                          <button
                            type="button"
                            role="separator"
                            aria-orientation="vertical"
                            title="拖动调整列宽，双击恢复默认"
                            aria-label={`调整${header.column.id}列宽`}
                            aria-valuenow={header.getSize()}
                            aria-valuemin={header.column.columnDef.minSize ?? 72}
                            aria-valuemax={header.column.columnDef.maxSize ?? 520}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => {
                              event.stopPropagation()
                              header.column.resetSize()
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Home") {
                                event.preventDefault()
                                header.column.resetSize()
                                return
                              }
                              if (event.key === "End") {
                                event.preventDefault()
                                const bounds = header.column.columnDef
                                table.setColumnSizing((current) => ({
                                  ...current,
                                  [header.column.id]: bounds.maxSize ?? 520,
                                }))
                                return
                              }
                              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
                              event.preventDefault()
                              const bounds = header.column.columnDef
                              const next = header.getSize() + (event.key === "ArrowRight" ? 12 : -12)
                              table.setColumnSizing((current) => ({
                                ...current,
                                [header.column.id]: Math.max(bounds.minSize ?? 72, Math.min(bounds.maxSize ?? 520, next)),
                              }))
                            }}
                            className="absolute inset-y-0 right-0 z-30 w-1.5 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/50"
                          />
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
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role=checkbox], [role=switch], [role=button]")) return
                      onRowClick?.(row.original)
                    }}
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
                      "group/row",
                      "transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted/70",
                      onRowClick && "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                      rowClassName?.(row.original)
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={columnStyle(cell.column)}
                        className={`p-3 text-xs ${stickyActionColumn && cell.column.id === "actions" ? `sticky right-0 z-10 border-l ${pinnedCellSurface} shadow-[-6px_0_10px_-8px_rgba(0,0,0,0.25)]` : ""} ${enableColumnPinning && cell.column.getIsPinned() ? `z-10 ${pinnedCellSurface}` : ""}`}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={visibleColumns.length}
                    className="h-64 p-0 text-center"
                  >
                    {/* Center within the scroll viewport, not the full horizontal table. */}
                    <div
                      className="sticky left-0 flex min-h-64 max-w-full items-center justify-center"
                      style={{ width: containerWidth > 0 ? Math.max(0, containerWidth - 2) : undefined }}
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
                    </div>
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
