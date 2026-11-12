import { createTableStyleAdapter } from "./data-table-styles"
import { useDataTableCardSlots } from "./data-table-card"
import { DataTableHeader } from "./data-table-header"
import { DataTableBodyRow } from "./data-table-body-row"
import { resolveVirtualCompatibility } from "./data-table-compatibility"
import { createSelectColumn, resetSelectColumnAnchor } from "./data-table-select-column"
export { createSelectColumn, resetSelectColumnAnchor } from "./data-table-select-column"
import { getErrorMessage } from "@/lib/api-error"
import { computeTableGeometry, normalizeColumnPinning } from "./data-table-geometry"
export { normalizeColumnPinning } from "./data-table-geometry"
import { useColumnPreferences } from "./use-column-preferences"
import type { DataTableSelectionArea } from "./data-table-selection-area"
export type { DataTableSelectionArea } from "./data-table-selection-area"
import { tablePageSizes } from "@/lib/table-page-size"
import { DataTableSortContext } from "./data-table-sort-context"
import type { DateRange } from "react-day-picker"
import {
  DataTableVirtualBody,
  type DataTableVirtualization,
  type VirtualRowAttributes,
  type RestoreVirtualAnchor,
} from "./data-table-virtual-body"
import * as React from "react"
import { DataTableQueryEditor } from "./data-table-query-editor"
import { DataTableViewsMenu } from "./data-table-views-menu"
import { conditionLabel, type QueryField, type TableQuery } from "./data-table-query"
import type { TableViewSnapshot } from "./data-table-views"
import { sanitizePreferences, type ColumnPreferences } from "./data-table-preferences"
import { AlertCircle, Maximize2, Minimize2, Rows3, Ellipsis } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { DataTableViewportArea, type TableScrollPosition } from "./data-table-viewport"
import {
  isDensity,
  type DataTableViewport,
  type DataTableDensity,
} from "./data-table-layout"
export type { DataTableViewport, DataTableDensity, DataTableText } from "./data-table-layout"
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
  type DataTablePreset,
  type AppTableFeatures,
  type ColumnDef,
  type Table,
} from "./types"

import { TableBody, TableCell, TableRow } from "@/components/ui/table"
import { DataTableToolbar, type FacetedFilterConfig } from "./data-table-toolbar"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableSkeleton } from "./data-table-skeleton"
import { DataTableEmpty } from "./data-table-empty"

export type { ColumnDef, Table, AppTableFeatures, DataTableVirtualization }

export interface DataTableProps<TData extends RowData, TValue = unknown> {
  error?: unknown
  onRetry?: () => void
  errorTitle?: string
  totalRows?: number
  preset?: DataTablePreset
  /** Filtering and sorting are performed by the server across the complete dataset. */
  serverFiltering?: boolean
  /** Controlled ordering across the full server dataset. */
  serverSorting?: {
    sorting: SortingState
    onChange: (next: SortingState) => void
  }
  /** Column definitions */
  columns: ColumnDef<TData, TValue>[]
  /** Defaults to natural content height. */
  /** Opt-in windowing for large current-page row models; requires stable IDs and a bounded viewport. */
  virtualization?: DataTableVirtualization
  viewport?: DataTableViewport
  layoutControls?: { density?: boolean; fullscreen?: boolean; columns?: boolean }
  layoutState?: { value: ColumnPreferences; onChange: (value: ColumnPreferences) => void }
  advancedQuery?: {
    value: TableQuery
    fields: readonly QueryField[]
    onChange: (query: TableQuery) => void
    onApplyView: (view: TableViewSnapshot) => void
    onResetFilters?: (query: TableQuery) => void
    activeView?: { id: string; snapshot: TableViewSnapshot }
    initialLayout?: ColumnPreferences
  }
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
  externalDateRange?: {
    value: DateRange | undefined
    onChange: (value: DateRange | undefined) => void
    title?: string
  }
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
  /** Low-frequency actions collected with advanced query tools. */
  moreActions?: React.ReactNode
  /** Hide built-in buttons independently (default: false for refresh; view options defaults to hidden unless enabled). */
  hideRefresh?: boolean
  hideViewOptions?: boolean
  showViewOptions?: boolean
  /** Controls before refresh and column settings. */
  toolbarControls?: React.ReactNode
  /** Built-in group button slot for data export / download control */
  exportControl?: React.ReactNode | ((table: Table<TData>) => React.ReactNode)
  /** Top right custom action buttons (e.g. New Device, Export) */
  actions?: React.ReactNode
  /** Batch action renderer when rows are selected */
  selectionArea?: DataTableSelectionArea
  batchActions?: (selectedRows: TData[], resetSelection: () => void) => React.ReactNode
  /** Refresh callback for refresh button in toolbar */
  onRefresh?: () => void
  /** Indicates refresh in progress */
  isRefreshing?: boolean
  /** Available page size options */
  maxPageSize?: number
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
  /** Current-page projection of an externally owned selection descriptor. */
  controlledSelection?: { value: RowSelectionState; onChange: (value: RowSelectionState) => void }
  canSelectRow?: (row: TData) => boolean
  rowSelectionDisabledReason?: (row: TData) => string
  /** Disable interaction while rows are placeholders or an action is pending. */
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
  detail?: { width?: "viewport" | "table"; render: (row: TData) => React.ReactNode }
  summary?: { label: string; render: (rows: TData[]) => React.ReactNode }
  groupBy?: { label: string; key: (row: TData) => string }
  treeState?: {
    expanded: ExpandedState
    onChange: (value: ExpandedState) => void
    canExpand?: (row: TData) => boolean
  }
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

export function DataTable<TData extends RowData, TValue = unknown>(
  props: DataTableProps<TData, TValue>,
) {
  const inRouter = useInRouterContext()
  const cardSlots = useDataTableCardSlots()
  const defaults = props.preset
    ? {
        stickyActionColumn: true,
        enableColumnResizing: props.preset !== "simple",
        enableColumnPinning: props.preset === "advanced",
        layoutControls:
          props.preset === "simple"
            ? undefined
            : { density: true, fullscreen: true, columns: true },
      }
    : {}
  const resolved = {
    ...props,
    toolbarTitle: props.toolbarTitle ?? cardSlots?.toolbarTitle,
    toolbarControls: props.toolbarControls ?? cardSlots?.toolbarControls,
    actions: props.actions ?? cardSlots?.actions,
    stickyActionColumn: props.stickyActionColumn ?? defaults.stickyActionColumn,
    enableColumnResizing: props.enableColumnResizing ?? defaults.enableColumnResizing,
    enableColumnPinning: props.enableColumnPinning ?? defaults.enableColumnPinning,
    layoutControls: props.layoutControls ?? defaults.layoutControls,
  }
  return props.enableUrlSync && inRouter ? (
    <UrlDataTable {...resolved} />
  ) : (
    <DataTableCore {...resolved} />
  )
}

function UrlDataTable<TData extends RowData, TValue = unknown>(
  props: DataTableProps<TData, TValue>,
) {
  const [params, setParams] = useSearchParams()
  const options = React.useMemo(
    () => ({
      prefix: props.urlStateKey,
      searchKey: props.searchKey,
      facetKeys: (props.facetedFilters ?? []).map((item) => item.columnId),
      dateRangeKey: props.dateRangeKey,
      defaultPageSize: props.defaultPageSize ?? 10,
      pageSizeOptions: props.pageSizeOptions,
      maxPageSize: props.maxPageSize,
    }),
    [
      props.urlStateKey,
      props.searchKey,
      props.facetedFilters,
      props.dateRangeKey,
      props.defaultPageSize,
      props.pageSizeOptions,
      props.maxPageSize,
    ],
  )
  const state = React.useMemo(() => readTableUrl(params, options), [params, options])
  const update = (patch: Partial<TableUrlState>) =>
    setParams(
      (current) => {
        const previous = readTableUrl(current, options)
        return writeTableUrl(current, options, { ...previous, ...patch })
      },
      { replace: true },
    )
  const selectionKey = `${props.urlStateKey ?? "table"}_selected`
  const selection = Object.fromEntries(
    (params.get(selectionKey) ?? "")
      .split(",")
      .filter(Boolean)
      .map((id) => [id, true as const]),
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
                { replace: true },
              )
          : undefined
      }
    />
  )
}

function DataTableCore<TData extends RowData, TValue = unknown>({
  columns,
  data,
  viewport,
  virtualization,
  layoutControls,
  loading = false,
  error,
  onRetry,
  errorTitle = "数据加载失败",
  totalRows,
  searchKey,
  searchPlaceholder,
  externalSearch,
  hideSearch = false,
  facetedFilters = [],
  externalDateRange,
  dateRangeKey,
  dateRangeTitle,
  columnLabels,
  actions,
  toolbarTitle,
  toolbarLeading,
  searchLeading,
  searchTrailing,
  moreActions,
  hideRefresh,
  hideViewOptions,
  showViewOptions,
  toolbarControls,
  exportControl,
  selectionArea,
  batchActions,
  onRefresh,
  isRefreshing = false,
  pageSizeOptions: requestedPageSizes,
  defaultPageSize: requestedDefaultPageSize,
  maxPageSize,
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
  advancedQuery,
  layoutState,
  selectionScopeKey: explicitSelectionScopeKey,
  persistRowSelection = false,
  selectionDisabled = false,
  controlledSelection,
  canSelectRow,
  rowSelectionDisabledReason,
  serverPagination,
  serverFiltering = false,
  serverSorting,
  savedSelection,
  saveSelection,
  detail,
  summary,
  groupBy,
  treeState,
  getSubRows,
  defaultExpanded = {},
}: DataTableProps<TData, TValue> & {
  urlState?: TableUrlState
  savedSelection?: RowSelectionState
  saveSelection?: (next: RowSelectionState) => void
  updateUrlState?: (patch: Partial<TableUrlState>) => void
}) {
  const [fullscreen, setFullscreen] = React.useState(false)
  const [toolbarFiltersOpen, setToolbarFiltersOpen] = React.useState(false)
  const [paginationJumpPage, setPaginationJumpPage] = React.useState("")
  const { options: pageSizeOptions, fallback: defaultPageSize } = tablePageSizes({
    pageSizeOptions: requestedPageSizes,
    defaultPageSize: requestedDefaultPageSize,
    maxPageSize,
  })
  const detailPrefix = React.useId()
  const scrollPosition = React.useRef<TableScrollPosition | null>(null)
  const [resizeDirection, setResizeDirection] = React.useState<"ltr" | "rtl">("ltr")
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  React.useEffect(() => {
    const element = rootRef.current
    if (!element) return
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame)
      const width = Math.round(entry.contentRect.width)
      frame = requestAnimationFrame(() => setContainerWidth(width))
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fullscreen])
  const {
    resetColumnPreferences,
    storageKey,
    activeColumnPreferences,
    preferenceWarning,
    setSavedColumnPreferences,
    updateColumnPreference,
  } = useColumnPreferences({
    columns: columns as ColumnDef<TData, unknown>[],
    tablePreference,
    initialColumnVisibility,
    initialColumnPinning,
    layoutState,
    layoutControls,
    advancedQuery,
  })
  // Table states
  const [localSorting, setSorting] = React.useState<SortingState>([])
  const [localColumnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const columnVisibility = activeColumnPreferences.columnVisibility
  const [localSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const rowSelection = controlledSelection?.value ?? savedSelection ?? localSelection
  const [localGlobalFilter, setGlobalFilter] = React.useState<string>("")
  const [detailID, setDetailID] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<ExpandedState>(defaultExpanded)
  const savedPinning = activeColumnPreferences.columnPinning
  const hasSelect = activeColumnPreferences.columnOrder.includes("select")
  const detailPinning =
    enableColumnPinning && savedPinning.start.length
      ? {
          ...savedPinning,
          start: [
            ...(hasSelect ? ["select"] : []),
            ...(detail ? ["__detail"] : []),
            ...savedPinning.start.filter((id) => id !== "select" && id !== "__detail"),
          ],
        }
      : savedPinning
  const columnPinning = normalizeColumnPinning(
    enableColumnPinning ? detailPinning : { start: [], end: [] },
    stickyActionColumn,
  )
  const columnSizing = activeColumnPreferences.columnSizing
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
  const sorting =
    serverSorting?.sorting ??
    (advancedQuery
      ? advancedQuery.value.sorts.map((sort) => ({ id: sort.field, desc: sort.desc }))
      : (urlState?.sorting ?? localSorting))
  const columnFilters = urlState?.columnFilters ?? localColumnFilters
  const globalFilter = urlState?.globalFilter ?? localGlobalFilter
  const selectionScopeKey =
    explicitSelectionScopeKey ??
    (persistRowSelection
      ? undefined
      : JSON.stringify([
          currentPagination,
          sorting,
          columnFilters,
          globalFilter,
          externalSearch?.value,
          externalDateRange?.value,
          advancedQuery?.value,
          facetedFilters.map((filter) => filter.selectedValues),
        ]))
  const lastSelectionScope = React.useRef({ scope: selectionScopeKey, disabled: selectionDisabled })
  const hasDetail = Boolean(detail)
  const configuredColumns = React.useMemo(
    () =>
      [
        ...(hasDetail
          ? [
              {
                id: "__detail",
                header: () => <span className="sr-only">详情</span>,
                size: 36,
                minSize: 36,
                maxSize: 36,
                enableSorting: false,
                enableHiding: false,
                enableResizing: false,
                meta: { layout: { move: false, pin: false, hide: false } },
              } satisfies ColumnDef<TData, TValue>,
            ]
          : []),
        ...columns,
      ].map((column) => {
        const id = column.id ?? ("accessorKey" in column ? column.accessorKey : undefined)
        if (column.filterFn || typeof id !== "string") return column
        if (id === dateRangeKey)
          return {
            ...column,
            filterFn: (row, columnId, value) => matchesDateRange(row.getValue(columnId), value),
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
    [columns, dateRangeKey, facetedFilters, hasDetail],
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
      expanded: treeState?.expanded ?? expanded,
      columnPinning,
      columnSizing,
      columnOrder: detail
        ? [
            ...(activeColumnPreferences.columnOrder.includes("select") ? ["select"] : []),
            "__detail",
            ...activeColumnPreferences.columnOrder.filter(
              (id) => id !== "select" && id !== "__detail",
            ),
          ]
        : activeColumnPreferences.columnOrder,
    },
    enableRowSelection: (row) => !selectionDisabled && (canSelectRow?.(row.original) ?? true),
    getSubRows,
    getRowCanExpand: treeState?.canExpand ? (row) => treeState.canExpand!(row.original) : undefined,
    onExpandedChange: (updater) => {
      if (treeState)
        treeState.onChange(typeof updater === "function" ? updater(treeState.expanded) : updater)
      else setExpanded(updater)
    },
    onColumnPinningChange: (updater) => updateColumnPreference("columnPinning", updater),
    onColumnOrderChange: (updater) => updateColumnPreference("columnOrder", updater),
    onColumnSizingChange: (updater) => updateColumnPreference("columnSizing", updater),
    enableColumnPinning: enableColumnPinning || stickyActionColumn,
    enableColumnResizing,
    columnResizeMode: "onEnd",
    columnResizeDirection: resizeDirection,
    defaultColumn: enableColumnResizing ? { size: 160, minSize: 72, maxSize: 520 } : undefined,
    autoResetExpanded: false,
    paginateExpandedRows: false,
    filterFromLeafRows: true,
    onSortingChange: (updater) => {
      if (serverSorting)
        serverSorting.onChange(typeof updater === "function" ? updater(sorting) : updater)
      else if (advancedQuery) {
        const next = typeof updater === "function" ? updater(sorting) : updater
        advancedQuery.onChange({
          ...advancedQuery.value,
          sorts: next.map((sort) => ({ field: sort.id, desc: sort.desc })),
        })
      } else if (updateUrlState)
        updateUrlState({
          sorting: typeof updater === "function" ? updater(sorting) : updater,
          pagination: { ...currentPagination, pageIndex: 0 },
        })
      else setSorting(updater)
    },
    onColumnFiltersChange: (updater) => {
      if (updateUrlState)
        updateUrlState({
          columnFilters: typeof updater === "function" ? updater(columnFilters) : updater,
          pagination: { ...currentPagination, pageIndex: 0 },
        })
      else setColumnFilters(updater)
    },
    onColumnVisibilityChange: (updater) => updateColumnPreference("columnVisibility", updater),
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(rowSelection) : updater
      if (selectionDisabled && controlledSelection) return
      if (controlledSelection) controlledSelection.onChange(next)
      else if (saveSelection) saveSelection(next)
      else setRowSelection(next)
    },
    onGlobalFilterChange: (updater) => {
      if (updateUrlState)
        updateUrlState({
          globalFilter: typeof updater === "function" ? updater(globalFilter) : updater,
          pagination: { ...currentPagination, pageIndex: 0 },
        })
      else setGlobalFilter(updater)
    },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(currentPagination) : updater
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
    maxMultiSortColCount: advancedQuery ? 3 : undefined,
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
    if (scopeChanged) setDetailID(null)
    if (scopeChanged || becameDisabled) {
      if (!controlledSelection) table.resetRowSelection()
      resetSelectColumnAnchor(table)
    }
    lastSelectionScope.current = { scope: selectionScopeKey, disabled: selectionDisabled }
  }, [table, selectionScopeKey, selectionDisabled, controlledSelection])

  React.useEffect(() => {
    if (onTableInstance) {
      onTableInstance(table)
    }
  }, [table, onTableInstance])

  React.useEffect(() => {
    if (loading || viewport?.pending) return
    const lastPage = Math.max(0, table.getPageCount() - 1)
    if (currentPagination.pageIndex > lastPage) table.setPageIndex(lastPage)
  }, [
    table,
    loading,
    viewport?.pending,
    data,
    currentPagination.pageIndex,
    currentPagination.pageSize,
    serverPagination?.total,
  ])

  // React Router search-param callbacks do not merge consecutive writes in one event.
  const resetFilters = () => {
    if (advancedQuery) {
      // The controlled query owner clears mirrored filters, resets pagination and
      // invalidates selection in one transaction. Do not issue competing callbacks.
      const next: TableQuery = {
        ...advancedQuery.value,
        search: "",
        filter: { logic: "and", children: [] },
      }
      if (advancedQuery.onResetFilters) advancedQuery.onResetFilters(next)
      else {
        externalDateRange?.onChange(undefined)
        externalSearch?.onChange("")
        facetedFilters.forEach((filter) => filter.onSelectedChange?.([]))
        serverPagination?.onChange({ ...currentPagination, pageIndex: 0 })
        advancedQuery.onChange(next)
      }
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
      return
    }
    externalDateRange?.onChange(undefined)
    externalSearch?.onChange("")
    facetedFilters.forEach((filter) => filter.onSelectedChange?.([]))
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
  const isFiltered =
    Boolean(externalDateRange?.value?.from || externalDateRange?.value?.to) ||
    Boolean(advancedQuery?.value.search || advancedQuery?.value.filter.children.length) ||
    columnFilters.length > 0 ||
    Boolean(globalFilter) ||
    Boolean(externalSearch?.value) ||
    facetedFilters.some((filter) => Boolean(filter.selectedValues?.length))

  // Group only flat current-page rows; tree paths must retain their hierarchical order.
  const effectiveGroup = getSubRows ? undefined : groupBy
  const modelRows = table.getRowModel().rows
  const renderedRows = React.useMemo(
    () =>
      effectiveGroup
        ? [...modelRows].sort((a, b) =>
            effectiveGroup.key(a.original).localeCompare(effectiveGroup.key(b.original)),
          )
        : modelRows,
    [modelRows, effectiveGroup],
  )
  const groupCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    if (effectiveGroup)
      for (const row of renderedRows) {
        const key = effectiveGroup.key(row.original)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    return counts
  }, [renderedRows, effectiveGroup])

  // Saved sizes are the narrow-layout baseline. Distribute spare width among
  // data columns while keeping fixed controls (selection/actions) compact.
  const visibleColumns = [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ]
  const sizedLayout =
    enableColumnPinning ||
    !!detail ||
    !!virtualization ||
    enableColumnResizing ||
    visibleColumns.some((column) => column.columnDef.meta?.text)
  const fixedColumns = new Set(
    visibleColumns
      .filter(
        (column) =>
          column.columnDef.minSize !== undefined &&
          column.columnDef.minSize === column.columnDef.maxSize,
      )
      .map((column) => column.id),
  )
  const autoSizeColumn = (id: string) => {
    const column = table.getColumn(id)
    if (!column || !rootRef.current || fixedColumns.has(id) || !column.getCanResize()) return
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (!context) return
    context.font = getComputedStyle(rootRef.current).font
    const values = table
      .getPrePaginatedRowModel()
      .rows.slice(0, 100)
      .map((row) =>
        column.columnDef.meta?.autoSizeText
          ? column.columnDef.meta.autoSizeText(row.original)
          : row.getValue(id),
      )
    const labels = [
      columnLabels?.[id] ?? id,
      ...values
        .filter((value) => typeof value === "string" || typeof value === "number")
        .map(String),
    ]
    const measured =
      Math.max(...labels.map((value) => context.measureText(value.slice(0, 500)).width)) + 48
    table.setColumnSizing((current) => ({
      ...current,
      [id]: Math.max(
        column.columnDef.minSize ?? 72,
        Math.min(column.columnDef.maxSize ?? 520, measured),
      ),
    }))
  }
  const geometry = computeTableGeometry({
    columns: visibleColumns.map((column) => ({
      id: column.id,
      size: column.getSize(),
      minSize: column.columnDef.minSize,
      maxSize: column.columnDef.maxSize,
      enableResizing: column.columnDef.enableResizing,
      isDataColumn: !!column.accessorFn,
    })),
    pinning: columnPinning,
    sizedLayout,
    containerWidth,
    narrowPinnedColumns: !!layoutControls?.columns || (containerWidth > 0 && containerWidth < 640),
    enableColumnPinning,
    stickyActionColumn,
  })
  const { effectivePins, totalWidth, pinOffsets, pinBoundary, columnStyle } = createTableStyleAdapter({
    geometry,
    visibleColumns,
    table,
    sizedLayout,
  })

  const fill = fullscreen || viewport?.mode === "fill"
  const density = activeColumnPreferences.density
  const scrollQuery = JSON.stringify([
    currentPagination,
    sorting,
    columnFilters,
    globalFilter,
    viewport?.queryKey === undefined ? [advancedQuery?.value, externalDateRange?.value] : undefined,
    viewport?.queryKey === undefined ? externalSearch?.value : undefined,
    viewport?.queryKey === undefined
      ? facetedFilters.map((filter) => filter.selectedValues)
      : undefined,
  ])
  const scrollElement = React.useRef<HTMLDivElement>(null)
  const [scrollNode, setScrollNode] = React.useState<HTMLDivElement | null>(null)
  const virtualAnchor = React.useRef<RestoreVirtualAnchor | null>(null)
  const [compatibilityMode, setCompatibilityMode] = React.useState(false)
  React.useEffect(() => {
    if (compatibilityMode && currentPagination.pageSize > 100) table.setPageSize(100)
  }, [compatibilityMode, currentPagination.pageSize, table])
  const { fallback: virtualFallback, enabled: virtualEnabled } = resolveVirtualCompatibility({
    requested: !!virtualization,
    hasStableRowId: !!getRowId,
    hasDetail: !!detail,
    hasGroup: !!effectiveGroup,
    fill,
    viewport,
    compatibilityMode,
    rowCount: renderedRows.length,
  })
  const rowIDs = React.useMemo(() => renderedRows.map((row) => row.id), [renderedRows])
  const renderRow = (rowIndex: number, attributes: VirtualRowAttributes = {}) => (
    <DataTableBodyRow
      key={renderedRows[rowIndex].id}
      table={table}
      row={renderedRows[rowIndex]}
      previousRow={renderedRows[rowIndex - 1]}
      rowIndex={rowIndex}
      attributes={attributes}
      effectiveGroup={effectiveGroup}
      groupCounts={groupCounts}
      containerWidth={containerWidth}
      onRowClick={onRowClick}
      rowClassName={rowClassName}
      selectionDisabled={selectionDisabled}
      rowSelectionDisabledReason={rowSelectionDisabledReason}
      columnStyle={columnStyle}
      pinBoundary={pinBoundary}
      sizedLayout={sizedLayout}
      effectivePins={effectivePins}
      detailID={detailID}
      detailPrefix={detailPrefix}
      setDetailID={setDetailID}
      detail={detail}
    />
  )

  const shouldShowViewOptions =
    showViewOptions !== undefined
      ? showViewOptions
      : hideViewOptions !== undefined
      ? !hideViewOptions
      : Boolean(layoutControls?.columns)

  const content = (
    <div
      ref={rootRef}
      className={cn("data-table-root flex w-full min-w-0 flex-col gap-2", fill && "h-full min-h-0")}
      data-slot="data-table"
      data-density={density}
    >
      {virtualization && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <span>
            {virtualFallback
              ? `虚拟滚动未启用：${virtualFallback}`
              : compatibilityMode
                ? "分页兼容模式"
                : "虚拟滚动：仅挂载可见行；辅助技术可切换分页模式"}
          </span>
          {!virtualFallback && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setCompatibilityMode((value) => !value)
                table.setPageSize(Math.min(100, currentPagination.pageSize))
              }}
            >
              切换{compatibilityMode ? "虚拟滚动" : "分页兼容模式"}
            </Button>
          )}
        </div>
      )}
      {preferenceWarning && (
        <p role="status" className="text-xs text-muted-foreground">
          {preferenceWarning}
        </p>
      )}
      <DataTableToolbar
        table={table}
        searchKey={searchKey}
        searchPlaceholder={searchPlaceholder}
        externalSearch={externalSearch}
        hideSearch={hideSearch}
        facetedFilters={facetedFilters}
        isFiltered={isFiltered}
        externalDateRange={externalDateRange}
        onResetFilters={resetFilters}
        onResetLayout={resetColumnPreferences}
        dateRangeKey={dateRangeKey}
        dateRangeTitle={dateRangeTitle}
        columnLabels={columnLabels}
        enableColumnPinning={enableColumnPinning}
        columnManagement={layoutControls?.columns}
        onAutoSize={autoSizeColumn}
        actions={actions}
        toolbarTitle={toolbarTitle}
        toolbarLeading={toolbarLeading}
        searchLeading={searchLeading}
        searchTrailing={
          advancedQuery || moreActions ? (
            <>
              {searchTrailing}
              <Popover>
                <PopoverTrigger
                  render={<Button variant="outline" size="sm" aria-label="更多表格操作" />}
                >
                  <Ellipsis />
                  更多
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 max-w-[var(--available-width)]">
                  <PopoverTitle>更多操作</PopoverTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {moreActions}
                    {advancedQuery && sorting.length > 0 && (
                      <div className="w-full space-y-1" aria-label="当前排序">
                        {sorting.map((sort, index) => (
                          <div key={sort.id} className="flex items-center justify-between text-xs">
                            <span>
                              {index + 1}.{" "}
                              {advancedQuery.fields.find((field) => field.key === sort.id)?.label ??
                                sort.id}{" "}
                              · {sort.desc ? "降序" : "升序"}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`移除排序 ${sort.id}`}
                              onClick={() =>
                                table.setSorting(sorting.filter((item) => item.id !== sort.id))
                              }
                            >
                              移除
                            </Button>
                          </div>
                        ))}
                        <Button variant="ghost" size="sm" onClick={() => table.setSorting([])}>
                          清除排序
                        </Button>
                      </div>
                    )}
                    {advancedQuery && (
                      <DataTableQueryEditor
                        value={advancedQuery.value}
                        fields={advancedQuery.fields}
                        onChange={advancedQuery.onChange}
                      />
                    )}
                    {advancedQuery && storageKey && (
                      <DataTableViewsMenu
                        key={storageKey}
                        storageKey={storageKey}
                        fields={advancedQuery.fields}
                        activeView={advancedQuery.activeView}
                        pageSizePolicy={{ pageSizeOptions, defaultPageSize, maxPageSize }}
                        snapshot={{
                          query: advancedQuery.value,
                          layout: activeColumnPreferences,
                          pageSize: currentPagination.pageSize,
                        }}
                        apply={(view) => {
                          const value = sanitizePreferences(
                            view.layout,
                            columns as ColumnDef<TData, unknown>[],
                            initialColumnVisibility,
                            initialColumnPinning,
                            layoutControls?.columns,
                          )
                          if (layoutState) layoutState.onChange(value)
                          else setSavedColumnPreferences({ key: storageKey, value })
                          advancedQuery.onApplyView(view)
                        }}
                      />
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </>
          ) : (
            searchTrailing
          )
        }
        hideRefresh={hideRefresh}
        hideViewOptions={!shouldShowViewOptions}
        showViewOptions={shouldShowViewOptions}
        toolbarControls={toolbarControls}
        exportControl={typeof exportControl === "function" ? exportControl(table) : exportControl}
        layoutButtons={[
          layoutControls?.density ? (
            <DropdownMenu key="density">
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon" title="表格密度" aria-label="表格密度" />
                }
              >
                <Rows3 />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={density}
                  onValueChange={(value) => {
                    if (isDensity(value)) updateColumnPreference("density", value)
                  }}
                >
                  <DropdownMenuRadioItem closeOnClick value="compact">
                    紧凑
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem closeOnClick value="standard">
                    标准
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem closeOnClick value="comfortable">
                    宽松
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null,
          layoutControls?.fullscreen ? (
            <Button
              key="fullscreen"
              variant="outline"
              size="icon"
              title={fullscreen ? "还原窗口" : "全屏查看表格"}
              aria-label={fullscreen ? "退出全屏表格" : "全屏查看表格"}
              onClick={() => setFullscreen(!fullscreen)}
            >
              {fullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
          ) : null,
        ]}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        filtersOpen={toolbarFiltersOpen}
        onFiltersOpenChange={setToolbarFiltersOpen}
      />

      {advancedQuery && advancedQuery.value.filter.children.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="已应用的高级条件">
          {advancedQuery.value.filter.children.map((condition, index) => {
            const label = conditionLabel(condition, advancedQuery.fields)
            return (
              <Button
                key={index}
                variant="secondary"
                size="sm"
                className="max-w-full"
                title={label}
                aria-label={`移除${label}`}
                onClick={() =>
                  advancedQuery.onChange({
                    ...advancedQuery.value,
                    filter: {
                      ...advancedQuery.value.filter,
                      children: advancedQuery.value.filter.children.filter((_, i) => i !== index),
                    },
                  })
                }
              >
                <span className="truncate">{label}</span> ×
              </Button>
            )
          })}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              advancedQuery.onChange({
                ...advancedQuery.value,
                filter: { logic: "and", children: [] },
              })
            }
          >
            清空高级条件
          </Button>
        </div>
      )}
      {!!error && data.length > 0 && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs"
        >
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <span>
            {errorTitle}：{getErrorMessage(error, "请检查网络或稍后重试")}
          </span>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              重试
            </Button>
          )}
        </div>
      )}
      {/* Main Table Content Container */}
      <div
        className={cn(
          "flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-border/75 bg-card",
          fill && "min-h-0 flex-1",
        )}
      >
        <DataTableViewportArea
          updating={data.length > 0 && !loading && (isRefreshing || !!viewport?.pending)}
          pinOffsets={pinOffsets}
          virtualized={virtualEnabled}
          onScrollElement={virtualization ? setScrollNode : undefined}
          externalScrollRef={scrollElement}
          restoreVirtualAnchor={virtualAnchor}
          config={
            fullscreen
              ? { ...viewport, mode: "fill", maxHeight: undefined, mobileContent: false }
              : viewport
          }
          fill={fill}
          query={scrollQuery}
          ready={!loading && !viewport?.pending}
          revision={data}
          position={scrollPosition}
        >
          {loading && data.length === 0 ? (
            <DataTableSkeleton
              embedded
              columns={visibleColumns.map((column) => ({
                id: column.id,
                style: columnStyle(column),
              }))}
              headerRows={table.getHeaderGroups().length}
              tableStyle={
                sizedLayout
                  ? { width: "100%", minWidth: totalWidth, tableLayout: "fixed" }
                  : undefined
              }
              columnCount={visibleColumns.filter((column) => column.id !== "select").length}
              rowCount={currentPagination.pageSize > 10 ? 10 : currentPagination.pageSize}
              showCheckbox={visibleColumns.some((column) => column.id === "select")}
            />
          ) : (
            <table
              data-slot="table"
              data-virtualized={virtualEnabled || undefined}
              aria-rowcount={
                totalRows ??
                serverPagination?.total ??
                (virtualEnabled
                  ? renderedRows.length + table.getHeaderGroups().length + (summary ? 1 : 0)
                  : undefined)
              }
              className={cn("w-full caption-bottom text-sm", !sizedLayout && "min-w-max")}
              style={
                sizedLayout
                  ? { width: "100%", minWidth: totalWidth, tableLayout: "fixed" }
                  : undefined
              }
            >
              {sizedLayout && (
                <colgroup>
                  {visibleColumns.map((column) => (
                    <col key={column.id} style={{ width: columnStyle(column).width }} />
                  ))}
                </colgroup>
              )}
              <DataTableHeader
                table={table}
                headerGroups={table.getHeaderGroups()}
                columnStyle={columnStyle}
                pinBoundary={pinBoundary}
                sizedLayout={sizedLayout}
                effectivePins={effectivePins}
                fixedColumns={fixedColumns}
                enableColumnResizing={enableColumnResizing}
                columnLabels={columnLabels}
                setResizeDirection={setResizeDirection}
              />
              {virtualEnabled ? (
                <DataTableVirtualBody
                  ids={rowIDs}
                  scrollRef={scrollElement}
                  scrollNode={scrollNode}
                  restoreRef={virtualAnchor}
                  columns={visibleColumns.length}
                  headerRows={table.getHeaderGroups().length}
                  density={density}
                  options={virtualization!}
                >
                  {renderRow}
                </DataTableVirtualBody>
              ) : (
                <TableBody>
                  {table.getRowModel().rows?.length ? (
                    renderedRows.map((_, index) => renderRow(index))
                  ) : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={visibleColumns.length} className="h-64 p-0 text-center">
                        {/* Center within the scroll viewport, not the full horizontal table. */}
                        <div
                          className="sticky left-0 flex min-h-64 max-w-full items-center justify-center"
                          style={{
                            width: containerWidth > 0 ? Math.max(0, containerWidth - 2) : undefined,
                          }}
                        >
                          {error ? (
                            <div role="alert" className="flex flex-col items-center gap-2 p-4">
                              <AlertCircle className="size-5 text-destructive" />
                              <strong>{errorTitle}</strong>
                              <p className="text-xs text-muted-foreground">
                                {getErrorMessage(error, "请检查网络或稍后重试")}
                              </p>
                              {onRetry && (
                                <Button size="sm" variant="outline" onClick={onRetry}>
                                  重试
                                </Button>
                              )}
                            </div>
                          ) : (
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
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              )}
              {summary && (
                <tfoot>
                  <TableRow
                    aria-rowindex={
                      virtualEnabled
                        ? renderedRows.length + table.getHeaderGroups().length + 1
                        : undefined
                    }
                  >
                    <TableCell colSpan={table.getVisibleLeafColumns().length}>
                      <span className="mr-2 font-medium">{summary.label}</span>
                      {summary.render(table.getRowModel().rows.map((row) => row.original))}
                    </TableCell>
                  </TableRow>
                </tfoot>
              )}
            </table>
          )}
        </DataTableViewportArea>
        {/* Bottom Pagination Bar */}
        {!loading && (
          <DataTablePagination
            selectionArea={selectionArea}
            batchActions={batchActions}
            table={table}
            pageSizeOptions={
              compatibilityMode
                ? tablePageSizes({ pageSizeOptions, maxPageSize: 100 }).options
                : pageSizeOptions
            }
            totalCount={serverPagination?.total}
            selection={
              selectionArea
                ? { count: selectionArea.count, estimated: selectionArea.estimated }
                : undefined
            }
            jumpPage={paginationJumpPage}
            onJumpPageChange={setPaginationJumpPage}
          />
        )}
      </div>
    </div>
  )
  return (
    <DataTableSortContext.Provider value={{ enabled: !!advancedQuery, count: sorting.length }}>
      <Dialog
        open={fullscreen}
        onOpenChange={setFullscreen}
        onOpenChangeComplete={(open) => {
          if (!open)
            rootRef.current
              ?.querySelector<HTMLElement>('[aria-label="全屏查看表格"]')
              ?.focus({ preventScroll: true })
        }}
      >
        {!fullscreen && content}
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          finalFocus={() =>
            rootRef.current?.querySelector<HTMLElement>('[aria-label="全屏查看表格"]') ?? null
          }
          className="inset-0 top-0 left-0 flex h-svh w-full max-w-none translate-x-0 translate-y-0 flex-col overflow-y-auto rounded-none p-3 sm:max-w-none sm:p-5"
        >
          <DialogTitle className="sr-only">全屏表格</DialogTitle>
          {fullscreen && content}
        </DialogContent>
      </Dialog>
    </DataTableSortContext.Provider>
  )
}
