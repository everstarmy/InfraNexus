import * as React from "react"
import type { RowData } from "@tanstack/react-table"
import type { Column, Table } from "./types"
import type { VirtualRowAttributes } from "./data-table-virtual-body"
import { TableRow, TableCell } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronRight } from "lucide-react"
import { DataTableTextCell } from "./data-table-text"
import { cn } from "cn"

const pinnedCellSurface =
  "bg-card group-hover/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] group-has-aria-expanded/row:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))] group-data-[state=selected]/row:bg-[color-mix(in_oklab,var(--muted)_70%,var(--card))]"
type ModelRow<TData extends RowData> = ReturnType<Table<TData>["getRowModel"]>["rows"][number]
interface DataTableBodyRowProps<TData extends RowData> {
  table: Table<TData>
  row: ModelRow<TData>
  previousRow?: ModelRow<TData>
  rowIndex: number
  attributes?: VirtualRowAttributes
  effectiveGroup?: { label: string; key: (row: TData) => string }
  groupCounts: ReadonlyMap<string, number>
  containerWidth: number
  onRowClick?: (row: TData) => void
  rowClassName?: (row: TData) => string | undefined
  selectionDisabled: boolean
  rowSelectionDisabledReason?: (row: TData) => string
  columnStyle: (column: Column<TData>) => React.CSSProperties
  pinBoundary?: (columnId: string) => "start" | "end" | undefined
  sizedLayout: boolean
  effectivePins: ReadonlySet<string>
  detailID: string | null
  detailPrefix: string
  setDetailID: React.Dispatch<React.SetStateAction<string | null>>
  detail?: { width?: "viewport" | "table"; render: (row: TData) => React.ReactNode }
}
/** Internal stable row; virtual attributes are forwarded to the measured data tr. */
export function DataTableBodyRow<TData extends RowData>({
  table,
  row,
  previousRow,
  rowIndex,
  attributes = {},
  effectiveGroup,
  groupCounts,
  containerWidth,
  onRowClick,
  rowClassName,
  selectionDisabled,
  rowSelectionDisabledReason,
  columnStyle,
  pinBoundary,
  sizedLayout,
  effectivePins,
  detailID,
  detailPrefix,
  setDetailID,
  detail,
}: DataTableBodyRowProps<TData>) {
  return (
    <React.Fragment key={row.id}>
      {effectiveGroup &&
        (rowIndex === 0 ||
          effectiveGroup.key(previousRow!.original) !== effectiveGroup.key(row.original)) && (
          <TableRow>
            <TableCell
              colSpan={row.getVisibleCells().length}
              className="bg-muted text-xs font-medium"
            >
              <div
                className="sticky start-0 truncate"
                style={{ width: Math.max(0, containerWidth - 32), maxWidth: "100%" }}
              >
                {effectiveGroup.label}：{effectiveGroup.key(row.original)} · 当前页{" "}
                {groupCounts.get(effectiveGroup.key(row.original))} 条
              </div>
            </TableCell>
          </TableRow>
        )}
      <TableRow
        {...attributes}
        key={row.id}
        data-row-id={row.id}
        data-state={row.getIsSelected() && "selected"}
        onClick={(event) => {
          const selection = window.getSelection()
          if (
            selection &&
            !selection.isCollapsed &&
            selection.rangeCount &&
            selection.getRangeAt(0).intersectsNode(event.currentTarget)
          )
            return
          if (
            (event.target as HTMLElement).closest(
              "button, a, input, select, textarea, [role=checkbox], [role=switch], [role=button]",
            )
          )
            return
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
          onRowClick &&
            "cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          rowClassName?.(row.original),
        )}
      >
        {row.getVisibleCells().map((cell) => {
          const customCellClass =
            typeof cell.column.columnDef.meta?.cellClassName === "function"
              ? cell.column.columnDef.meta.cellClassName(row.original, cell.getValue())
              : cell.column.columnDef.meta?.cellClassName
          const boundary = pinBoundary?.(cell.column.id)
          return (
            <TableCell
              key={cell.id}
              data-pinned-edge={boundary}
              title={
                cell.column.id === "select" && !row.getCanSelect()
                  ? selectionDisabled
                    ? "数据加载或操作执行中，暂不可选择"
                    : (rowSelectionDisabledReason?.(row.original) ?? "此记录不可选择")
                  : undefined
              }
              style={columnStyle(cell.column)}
              className={cn(
                cell.column.id === "select"
                  ? "px-1 pr-1!"
                  : cell.column.id === "__detail"
                    ? "px-1"
                    : "px-3",
                "py-2 text-xs",
                sizedLayout && "overflow-hidden",
                effectivePins.has(cell.column.id) &&
                  cell.column.getIsPinned() &&
                  `z-10 ${pinnedCellSurface}`,
                boundary === "start" && "border-e border-border/60",
                boundary === "end" && "border-s border-border/60",
                customCellClass,
              )}
            >
              {cell.column.id === "__detail" && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={detailID === row.id ? "收起行详情" : "展开行详情"}
                  aria-expanded={detailID === row.id}
                  aria-controls={detailID === row.id ? `${detailPrefix}-${row.id}` : undefined}
                  onClick={(event) => {
                    event.stopPropagation()
                    setDetailID((current) => (current === row.id ? null : row.id))
                  }}
                >
                  {detailID === row.id ? <ChevronDown /> : <ChevronRight />}
                </Button>
              )}
              {cell.column.columnDef.meta?.text &&
              (typeof cell.getValue() === "string" || typeof cell.getValue() === "number") ? (
                <DataTableTextCell
                  value={String(cell.getValue())}
                  config={cell.column.columnDef.meta.text}
                />
              ) : (
                <table.FlexRender cell={cell} />
              )}
            </TableCell>
          )
        })}
      </TableRow>
      {detail && detailID === row.id && (
        <TableRow id={`${detailPrefix}-${row.id}`} className="bg-muted/15 hover:bg-muted/15">
          <TableCell colSpan={row.getVisibleCells().length}>
            {
              <div
                className="overflow-auto whitespace-normal"
                style={
                  detail.width === "table"
                    ? undefined
                    : {
                        position: "sticky",
                        insetInlineStart: 0,
                        width: Math.max(0, containerWidth - 32),
                        maxWidth: "100%",
                      }
                }
              >
                {detail.render(row.original)}
              </div>
            }
          </TableCell>
        </TableRow>
      )}
    </React.Fragment>
  )
}
