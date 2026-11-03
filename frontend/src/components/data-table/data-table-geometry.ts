import type { ColumnPinningState } from "@tanstack/react-table"

export interface NormalizePinningOptions {
  columnIds: string[]
  stickyActionColumn?: boolean
  enableColumnPinning?: boolean
  /** Compatibility hint only; computeTableGeometry applies the actual width budget. */
  narrowViewport?: boolean
}
/** Boolean overload retains the original public helper contract. */
export function normalizeColumnPinning(
  saved: { start?: string[]; end?: string[] },
  options: boolean | NormalizePinningOptions,
): ColumnPinningState {
  const sticky = typeof options === "boolean" ? options : !!options.stickyActionColumn
  const enabled = typeof options === "boolean" || options.enableColumnPinning !== false
  const ids = typeof options === "boolean" ? undefined : new Set(options.columnIds)
  const valid = (id: string) => !ids || ids.has(id)
  const end = [
    ...new Set(
      (enabled ? (saved.end ?? []) : []).filter((id) => valid(id) && (!sticky || id !== "actions")),
    ),
  ]
  if (sticky && valid("actions")) end.push("actions")
  return {
    start: [...new Set(enabled ? (saved.start ?? []) : [])].filter(
      (id) => valid(id) && !end.includes(id),
    ),
    end,
  }
}
export interface GeometryColumnInput {
  id: string
  size: number
  minSize?: number
  maxSize?: number
  enableResizing?: boolean
  isActionColumn?: boolean
  isDataColumn?: boolean
}
export interface ComputeTableGeometryInput {
  columns: GeometryColumnInput[]
  pinning: ColumnPinningState
  sizedLayout: boolean
  containerWidth: number
  narrowPinnedColumns: boolean
  enableColumnPinning?: boolean
  stickyActionColumn?: boolean
}
export interface ComputedColumnGeometry {
  width: number
  renderWidth: number | string
  isGrowColumn: boolean
  pinPosition: "start" | "end" | false
  startOffset?: number
  endOffset?: number
  isLastStartPinned: boolean
  isFirstEndPinned: boolean
}
export interface TableGeometryResult {
  effectivePinning: ColumnPinningState
  totalWidth: number
  growColumnId?: string
  otherWidth: number
  columnsById: Record<string, ComputedColumnGeometry>
}
const auxiliary = new Set(["select", "__detail", "actions"])
export function computeTableGeometry(input: ComputeTableGeometryInput): TableGeometryResult {
  const { columns, pinning, containerWidth, sizedLayout } = input
  const budget = Math.max(0, containerWidth - Math.min(240, Math.max(160, containerWidth * 0.3)))
  const data = (c: GeometryColumnInput) =>
    c.isDataColumn ?? (!c.isActionColumn && !auxiliary.has(c.id))
  const startIds = new Set(pinning.start)
  const endIds = new Set(pinning.end)
  const configured = columns.filter((c) => startIds.has(c.id) || endIds.has(c.id))
  const effective = new Set<string>()
  let pinnedWidth = 0
  for (const c of [...configured.filter((c) => !data(c)), ...configured.filter(data)]) {
    if (
      (input.enableColumnPinning !== false || (input.stickyActionColumn && c.id === "actions")) &&
      (!input.narrowPinnedColumns ||
        containerWidth <= 0 ||
        !data(c) ||
        pinnedWidth + c.size <= budget)
    ) {
      effective.add(c.id)
      pinnedWidth += c.size
    }
  }
  const start = columns.filter((c) => effective.has(c.id) && startIds.has(c.id))
  const end = columns.filter((c) => effective.has(c.id) && endIds.has(c.id))
  const grow = sizedLayout
    ? columns.find(
        (c) =>
          data(c) &&
          c.enableResizing !== false &&
          !(c.minSize !== undefined && c.minSize === c.maxSize) &&
          !effective.has(c.id),
      )
    : undefined
  const totalWidth = columns.reduce((sum, c) => sum + c.size, 0)
  const otherWidth = totalWidth - (grow?.size ?? 0)
  const columnsById: Record<string, ComputedColumnGeometry> = Object.create(null)
  // Preserve first-match semantics for duplicate IDs, including boundary flags.
  const starts = new Map<string, { offset: number; index: number }>()
  let startOffset = 0
  for (let index = 0; index < start.length; index++) {
    const column = start[index]
    if (!starts.has(column.id)) starts.set(column.id, { offset: startOffset, index })
    startOffset += column.size
  }
  const ends = new Map<string, { offset: number; index: number }>()
  let endOffset = 0
  for (let index = end.length - 1; index >= 0; index--) {
    const column = end[index]
    // Reverse traversal deliberately overwrites so the earliest duplicate wins.
    ends.set(column.id, { offset: endOffset, index })
    endOffset += column.size
  }
  for (const c of columns) {
    const startEntry = starts.get(c.id)
    const endEntry = ends.get(c.id)
    columnsById[c.id] = {
      width: c.size,
      renderWidth: c.id === grow?.id ? `calc(100% - ${otherWidth}px)` : c.size,
      isGrowColumn: c.id === grow?.id,
      pinPosition: startEntry ? "start" : endEntry ? "end" : false,
      startOffset: startEntry?.offset,
      endOffset: endEntry?.offset,
      isLastStartPinned: startEntry?.index === start.length - 1,
      isFirstEndPinned: endEntry?.index === 0,
    }
  }
  return {
    effectivePinning: { start: start.map((c) => c.id), end: end.map((c) => c.id) },
    totalWidth,
    growColumnId: grow?.id,
    otherWidth,
    columnsById,
  }
}
/** Aggregate grouped header widths without distributing spare space among columns. */
export function geometryWidth(result: TableGeometryResult, ids: string[]): string {
  const columns = ids.map((id) => result.columnsById[id]).filter(Boolean)
  const pixels = columns.reduce((sum, c) => sum + c.width, 0)
  return columns.some((c) => c.isGrowColumn)
    ? `calc(100% - ${result.totalWidth - pixels}px)`
    : `${pixels}px`
}
