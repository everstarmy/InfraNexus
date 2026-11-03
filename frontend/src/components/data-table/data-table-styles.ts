import type * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Column, Table } from "./types"
import { geometryWidth, type TableGeometryResult } from "./data-table-geometry"

/** One per-render style cache shared by headers, cells, colgroup and skeleton. */
export function createTableStyleAdapter<TData extends RowData>({
  geometry,
  visibleColumns,
  table,
  sizedLayout,
}: {
  geometry: TableGeometryResult
  visibleColumns: Column<TData>[]
  table: Table<TData>
  sizedLayout: boolean
}) {
  const effectivePins = new Set([
    ...geometry.effectivePinning.start,
    ...geometry.effectivePinning.end,
  ])
  const totalWidth = geometry.totalWidth
  const visibleIds = new Set(visibleColumns.map((column) => column.id))
  const widthOf = (columns: Column<TData>[]) =>
    geometryWidth(
      geometry,
      columns.map((column) => column.id),
    )
  const activeStartPins = table
    .getStartVisibleLeafColumns()
    .filter((item) => effectivePins.has(item.id))
  const activeEndPins = table
    .getEndVisibleLeafColumns()
    .filter((item) => effectivePins.has(item.id))
  const pinOffsets = {
    start: activeStartPins.length
      ? `${activeStartPins.reduce((sum, item) => sum + (geometry.columnsById[item.id]?.width ?? item.getSize()), 0)}px`
      : "0px",
    end: activeEndPins.length
      ? `${activeEndPins.reduce((sum, item) => sum + (geometry.columnsById[item.id]?.width ?? item.getSize()), 0)}px`
      : "0px",
  }
  const pinBoundary = (columnId: string): "start" | "end" | undefined => {
    const colGeo = geometry.columnsById[columnId]
    if (!colGeo) return undefined
    if (colGeo.isLastStartPinned) return "start"
    if (colGeo.isFirstEndPinned) return "end"
    return undefined
  }
  const columnStyles = new Map<string, React.CSSProperties>()
  const columnStyle = (column: Column<TData>): React.CSSProperties => {
    const cached = columnStyles.get(column.id)
    if (cached) return cached
    const colGeo = !column.columns.length ? geometry.columnsById[column.id] : undefined
    const pinned = colGeo ? colGeo.pinPosition : effectivePins.has(column.id) && column.getIsPinned()
    const activePinnedColumns =
      pinned === "start" ? activeStartPins : pinned === "end" ? activeEndPins : []
    const pinIndex = activePinnedColumns.findIndex((item) => item.id === column.id)
    const style: React.CSSProperties = {
      width: sizedLayout
        ? widthOf(
            (column.columns.length ? column.getLeafColumns() : [column]).filter((item) =>
              visibleIds.has(item.id),
            ),
          )
        : undefined,
      position: pinned ? "sticky" : undefined,
      insetInlineStart:
        pinned === "start"
          ? colGeo
            ? `${colGeo.startOffset ?? 0}px`
            : sizedLayout
              ? widthOf(activePinnedColumns.slice(0, pinIndex))
              : column.getStart("start")
          : undefined,
      insetInlineEnd:
        pinned === "end"
          ? colGeo
            ? `${colGeo.endOffset ?? 0}px`
            : sizedLayout
              ? widthOf(activePinnedColumns.slice(pinIndex + 1))
              : column.getAfter("end")
          : undefined,
    }
    columnStyles.set(column.id, style)
    return style
  }

  return { effectivePins, totalWidth, pinOffsets, pinBoundary, columnStyle }
}
