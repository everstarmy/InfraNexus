import * as React from "react"
import type { PaginationState, SortingState } from "@tanstack/react-table"
import type { DateRange } from "react-day-picker"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
export interface UseServerTableOptions<
  TFilters extends Record<string, unknown> = Record<string, unknown>,
> {
  defaultPageSize?: number
  defaultSorting?: SortingState
  initialKeyword?: string
  initialFilters?: TFilters
  debounceMs?: number
}
export function useServerTable<TFilters extends Record<string, unknown> = Record<string, unknown>>(
  options: UseServerTableOptions<TFilters> = {},
) {
  const defaults = React.useRef(options)
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: options.defaultPageSize ?? 10,
  })
  const [sorting, setSorting] = React.useState<SortingState>(options.defaultSorting ?? [])
  const [keyword, updateKeyword] = React.useState(options.initialKeyword ?? "")
  const debounced = useDebouncedValue(keyword, options.debounceMs ?? 300)
  const [resetKeyword, setResetKeyword] = React.useState<string | null>(null)
  const debouncedKeyword = resetKeyword === keyword ? keyword : debounced
  const [filters, updateFilters] = React.useState<TFilters>(
    options.initialFilters ?? ({} as TFilters),
  )
  const [dateRange, updateDateRange] = React.useState<DateRange | undefined>()
  const resetPage = React.useCallback(
    () => setPagination((p) => (p.pageIndex ? { ...p, pageIndex: 0 } : p)),
    [],
  )
  const setKeyword = React.useCallback(
    (next: string) => {
      setResetKeyword(null)
      updateKeyword(next)
      resetPage()
    },
    [resetPage],
  )
  const setFilters = React.useCallback(
    (next: Partial<TFilters> | ((prev: TFilters) => TFilters)) => {
      updateFilters((prev) => (typeof next === "function" ? next(prev) : { ...prev, ...next }))
      resetPage()
    },
    [resetPage],
  )
  const setFilter = React.useCallback(
    <K extends keyof TFilters>(key: K, value: TFilters[K]) => {
      updateFilters((prev) => ({ ...prev, [key]: value }))
      resetPage()
    },
    [resetPage],
  )
  const setDateRange = React.useCallback(
    (next: DateRange | undefined) => {
      updateDateRange(next)
      resetPage()
    },
    [resetPage],
  )
  const onSortingChange = React.useCallback(
    (next: SortingState) => {
      setSorting(next)
      resetPage()
    },
    [resetPage],
  )
  const onPaginationChange = React.useCallback((next: PaginationState) => {
    setPagination((prev) =>
      next.pageSize !== prev.pageSize ? { pageIndex: 0, pageSize: next.pageSize } : next,
    )
  }, [])
  const resetFilters = React.useCallback(() => {
    const initialKw = defaults.current.initialKeyword ?? ""
    updateKeyword(initialKw)
    setResetKeyword(initialKw)
    updateFilters(defaults.current.initialFilters ?? ({} as TFilters))
    updateDateRange(undefined)
    resetPage()
  }, [resetPage])
  const queryParams = React.useMemo(
    () => ({
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      keyword: debouncedKeyword,
      sorting,
      filters,
      dateRange,
    }),
    [pagination, debouncedKeyword, sorting, filters, dateRange],
  )
  return {
    pagination,
    onPaginationChange,
    sorting,
    onSortingChange,
    keyword,
    debouncedKeyword,
    setKeyword,
    filters,
    setFilter,
    setFilters,
    dateRange,
    setDateRange,
    resetFilters,
    queryParams,
  }
}
export type UseServerTableResult<TFilters extends Record<string, unknown>> = ReturnType<
  typeof useServerTable<TFilters>
>
