import type { RowData } from "@tanstack/react-table"
import { Checkbox } from "@/components/ui/checkbox"
import type { ColumnDef } from "./types"

const selectColumnAnchors = new WeakMap<object, string>()

export function resetSelectColumnAnchor(table: object) {
  selectColumnAnchors.delete(table)
}

/**
 * Standard selectable checkbox column helper to prepend to column definitions.
 */
export function createSelectColumn<TData extends RowData>(): ColumnDef<TData, unknown> {
  let shiftPressed = false
  let visualOrder: string[] | undefined
  return {
    id: "select",
    size: 42,
    minSize: 42,
    maxSize: 42,
    header: ({ table }) => (
      <div className="flex items-center justify-center px-1">
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
          onCheckedChange={(checked) => table.toggleAllPageRowsSelected(!!checked)}
          disabled={!table.getRowModel().rows.some((row) => row.getCanSelect())}
          aria-label="全选当页数据"
        />
      </div>
    ),
    cell: ({ row, table }) => (
      <div
        className="flex items-center justify-center px-1"
        onClickCapture={(event) => {
          shiftPressed = event.shiftKey
          const element = event.currentTarget.closest("table")
          visualOrder = element?.dataset.virtualized
            ? undefined
            : Array.from(element?.querySelectorAll<HTMLElement>("tbody tr[data-row-id]") ?? []).map(
                (element) => element.dataset.rowId!,
              )
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onCheckedChange={(checked) => {
            const shouldSelect = !!checked
            const order = visualOrder
            const positions = new Map(order?.map((id, index) => [id, index]))
            const visibleRows = order
              ? [...table.getRowModel().rows].sort(
                  (a, b) => (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0),
                )
              : table.getRowModel().rows
            const currentIndex = visibleRows.findIndex((item) => item.id === row.id)
            const anchorId = selectColumnAnchors.get(table)
            const anchorIndex = anchorId
              ? visibleRows.findIndex((item) => item.id === anchorId)
              : -1
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
            visualOrder = undefined
          }}
          aria-label="勾选该行；按住 Shift 可连续选择"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }
}
