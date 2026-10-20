export interface TableUrlState {
  sorting: { id: string; desc: boolean }[]
  columnFilters: { id: string; value: unknown }[]
  globalFilter: string
  pagination: { pageIndex: number; pageSize: number }
}
export interface TableUrlOptions {
  prefix?: string
  searchKey?: string
  facetKeys: string[]
  dateRangeKey?: string
  defaultPageSize: number
}
const positive = (value: string | null, fallback: number) => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function readTableUrl(
  params: URLSearchParams,
  options: TableUrlOptions
): TableUrlState {
  const key = (name: string) =>
    `${options.prefix ? `${options.prefix}_` : ""}${name}`
  const search =
    params.get(key(options.searchKey ? `q_${options.searchKey}` : "q")) ?? ""
  const columnFilters: TableUrlState["columnFilters"] = []
  if (options.searchKey && search)
    columnFilters.push({ id: options.searchKey, value: search })
  for (const id of options.facetKeys) {
    const values = params
      .get(key(`f_${id}`))
      ?.split(",")
      .filter(Boolean)
    if (values?.length) columnFilters.push({ id, value: values })
  }
  if (options.dateRangeKey) {
    const value = ["from", "to"].map((part) => {
      const raw = params.get(key(`${options.dateRangeKey}_${part}`))
      const date = raw ? new Date(raw) : undefined
      return date && Number.isFinite(date.getTime()) ? date : undefined
    })
    if (value.some(Boolean))
      columnFilters.push({ id: options.dateRangeKey, value })
  }
  const sorting = (params.get(key("sort")) ?? "")
    .split(",")
    .flatMap((entry) => {
      const [id, order] = entry.split(":")
      return id && (order === "asc" || order === "desc")
        ? [{ id, desc: order === "desc" }]
        : []
    })
  const pageSize = positive(
    params.get(key("pageSize")),
    options.defaultPageSize
  )
  return {
    sorting,
    columnFilters,
    globalFilter: options.searchKey ? "" : search,
    pagination: {
      pageIndex: positive(params.get(key("page")), 1) - 1,
      pageSize: Math.min(pageSize, 100),
    },
  }
}

export function writeTableUrl(
  params: URLSearchParams,
  options: TableUrlOptions,
  state: TableUrlState
) {
  const next = new URLSearchParams(params)
  const put = (name: string, value: string) => {
    const key = `${options.prefix ? `${options.prefix}_` : ""}${name}`
    if (value) next.set(key, value)
    else next.delete(key)
  }
  const filter = (id: string) =>
    state.columnFilters.find((item) => item.id === id)?.value
  put(
    options.searchKey ? `q_${options.searchKey}` : "q",
    options.searchKey
      ? String(filter(options.searchKey) ?? "")
      : state.globalFilter
  )
  for (const id of options.facetKeys) {
    const value = filter(id)
    put(`f_${id}`, Array.isArray(value) ? value.join(",") : "")
  }
  if (options.dateRangeKey) {
    const value = filter(options.dateRangeKey)
    for (const [index, part] of ["from", "to"].entries()) {
      const date: unknown = Array.isArray(value) ? value[index] : undefined
      put(
        `${options.dateRangeKey}_${part}`,
        date instanceof Date && Number.isFinite(date.getTime())
          ? date.toISOString()
          : ""
      )
    }
  }
  put(
    "sort",
    state.sorting
      .map(({ id, desc }) => `${id}:${desc ? "desc" : "asc"}`)
      .join(",")
  )
  put(
    "page",
    state.pagination.pageIndex ? String(state.pagination.pageIndex + 1) : ""
  )
  put(
    "pageSize",
    state.pagination.pageSize === options.defaultPageSize
      ? ""
      : String(state.pagination.pageSize)
  )
  return next
}

export function matchesDateRange(value: unknown, range: unknown) {
  if (!Array.isArray(range)) return true
  const timestamp = new Date(String(value)).getTime()
  if (!Number.isFinite(timestamp)) return false
  const [from, to]: unknown[] = range
  return (
    (!(from instanceof Date) || timestamp >= from.getTime()) &&
    (!(to instanceof Date) || timestamp <= to.getTime())
  )
}
