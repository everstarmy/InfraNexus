import type { RowData, ColumnVisibilityState, ColumnPinningState } from "@tanstack/react-table"
import type { ColumnDef } from "./types"
import { isDensity, type DataTableDensity } from "./data-table-layout"

export interface ColumnPreferences {
  density: DataTableDensity
  columnVisibility: ColumnVisibilityState
  columnPinning: ColumnPinningState
  columnSizing: Record<string, number>
  columnOrder: string[]
}
export interface TablePreferenceScope {
  userId: string
  tableId: string
  schemaVersion: number
}
export function preferenceStorageKey(scope?: TablePreferenceScope) {
  return scope?.userId && scope.tableId
    ? `infranexus:table:${encodeURIComponent(scope.userId)}:${encodeURIComponent(scope.tableId)}:v${scope.schemaVersion}`
    : null
}
export function getColumnId<T extends RowData>(column: ColumnDef<T, unknown>) {
  const key = column.id ?? ("accessorKey" in column ? column.accessorKey : undefined)
  return typeof key === "string" ? key : undefined
}
export function leafDefinitions<T extends RowData>(
  columns: readonly ColumnDef<T, unknown>[],
): ColumnDef<T, unknown>[] {
  return columns.flatMap((column) =>
    "columns" in column && column.columns?.length ? leafDefinitions(column.columns) : [column],
  )
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
/** Sanitize on every schema change, including in-memory state after permission changes. */
export function sanitizePreferences<T extends RowData>(
  raw: unknown,
  columns: readonly ColumnDef<T, unknown>[],
  visibility: ColumnVisibilityState = {},
  pinning: ColumnPinningState = { start: [], end: [] },
  multiple = false,
): ColumnPreferences {
  const leaves = leafDefinitions(columns)
  const ids = leaves.map(getColumnId).filter((id): id is string => !!id)
  const valid = new Set(ids)
  const stored = record(raw)
  const columnVisibility: ColumnVisibilityState = { ...visibility }
  const columnSizing: Record<string, number> = {}
  for (const column of leaves) {
    const id = getColumnId(column)
    if (!id) continue
    const visible = record(stored.columnVisibility)[id]
    if (typeof visible === "boolean") columnVisibility[id] = visible
    if (column.enableHiding === false || column.meta?.layout?.hide === false)
      columnVisibility[id] = true
    const width = record(stored.columnSizing)[id]
    if (typeof width === "number" && Number.isFinite(width))
      columnSizing[id] = Math.max(column.minSize ?? 72, Math.min(column.maxSize ?? 520, width))
  }
  for (const id of Object.keys(columnVisibility)) if (!valid.has(id)) delete columnVisibility[id]
  const data = leaves.filter((column) => "accessorKey" in column || "accessorFn" in column)
  if (data.length && data.every((column) => columnVisibility[getColumnId(column)!] === false))
    columnVisibility[getColumnId(data[0])!] = true
  const list = (value: unknown) =>
    Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && valid.has(id)))]
      : []
  const storedPin = record(stored.columnPinning)
  const allowedPins = (values: unknown) => {
    let kept = false
    return list(values).filter((id) => {
      const column = leaves.find((item) => getColumnId(item) === id)!
      if (column.enablePinning === false || column.meta?.layout?.pin === false) return false
      if (multiple || !data.some((item) => getColumnId(item) === id)) return true
      if (kept) return false
      kept = true
      return true
    })
  }
  const start = allowedPins(storedPin.start ?? pinning.start)
  const end = allowedPins(storedPin.end ?? pinning.end).filter((id) => !start.includes(id))
  // Reorder only within sibling groups and never move through a locked/system column.
  const requested = list(stored.columnOrder)
  const orderGroup = (group: readonly ColumnDef<T, unknown>[]): string[] => {
    const result: string[] = []
    let movable: string[] = []
    const flush = () => {
      result.push(
        ...requested.filter((id) => movable.includes(id)),
        ...movable.filter((id) => !requested.includes(id)),
      )
      movable = []
    }
    for (const column of group) {
      if ("columns" in column && column.columns?.length) {
        flush()
        result.push(...orderGroup(column.columns))
        continue
      }
      const id = getColumnId(column)
      if (!id) continue
      if (
        column.meta?.layout?.move === false ||
        !("accessorKey" in column || "accessorFn" in column)
      ) {
        flush()
        result.push(id)
      } else movable.push(id)
    }
    flush()
    return result
  }
  return {
    density: isDensity(stored.density) ? stored.density : "standard",
    columnVisibility,
    columnSizing,
    columnPinning: { start, end },
    columnOrder: orderGroup(columns),
  }
}
export function readColumnPreferences<T extends RowData>(
  key: string | null,
  columns: readonly ColumnDef<T, unknown>[],
  visibility: ColumnVisibilityState,
  pinning: ColumnPinningState,
  multiple = false,
) {
  let raw: unknown
  try {
    raw = key ? JSON.parse(localStorage.getItem(key) ?? "null") : null
  } catch {
    /* In-memory defaults remain usable. */
  }
  return sanitizePreferences(raw, columns, visibility, pinning, multiple)
}
