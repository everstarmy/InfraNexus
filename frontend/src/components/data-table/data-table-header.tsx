import type { CSSProperties } from "react"
import type { RowData } from "@tanstack/react-table"
import type { Column, Table } from "./types"
import { TableHeader, TableHead, TableRow } from "@/components/ui/table"
import { cn } from "cn"

const pinnedHeadSurface = "bg-[color-mix(in_oklab,var(--muted)_65%,var(--card))]"
interface DataTableHeaderProps<TData extends RowData> {
  table: Table<TData>
  headerGroups: ReturnType<Table<TData>["getHeaderGroups"]>
  columnStyle: (column: Column<TData>) => CSSProperties
  pinBoundary?: (columnId: string) => "start" | "end" | undefined
  sizedLayout: boolean
  effectivePins: ReadonlySet<string>
  fixedColumns: ReadonlySet<string>
  enableColumnResizing: boolean
  columnLabels?: Record<string, string>
  setResizeDirection: (direction: "ltr" | "rtl") => void
}
/** Internal stable component: updates preserve header controls and their focus. */
export function DataTableHeader<TData extends RowData>({
  table,
  headerGroups,
  columnStyle,
  pinBoundary,
  sizedLayout,
  effectivePins,
  fixedColumns,
  enableColumnResizing,
  columnLabels,
  setResizeDirection,
}: DataTableHeaderProps<TData>) {
  return (
    <TableHeader className="bg-muted/65">
      {headerGroups.map((headerGroup) => (
        <TableRow key={headerGroup.id} className="hover:bg-transparent">
          {headerGroup.headers.map((header) => {
            const isLeafHeader = !header.isPlaceholder && header.colSpan === 1
            const boundary = isLeafHeader ? pinBoundary?.(header.column.id) : undefined
            return (
              <TableHead
                key={header.id}
                colSpan={header.colSpan}
                data-pinned-edge={boundary}
                aria-sort={
                  isLeafHeader
                    ? header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : header.column.getCanSort()
                          ? "none"
                          : undefined
                    : undefined
                }
                style={columnStyle(header.column)}
                className={cn(
                  "relative h-10",
                  header.column.id === "select"
                    ? "px-1 pr-1!"
                    : header.column.id === "__detail"
                      ? "px-1"
                      : "px-3",
                  "text-(length:--text-description)/5 font-medium",
                  sizedLayout && "overflow-hidden",
                  effectivePins.has(header.column.id) &&
                    header.column.getIsPinned() &&
                    `z-20 ${pinnedHeadSurface}`,
                  boundary === "start" && "border-e border-border/60",
                  boundary === "end" && "border-s border-border/60",
                  header.column.columnDef.meta?.headerClassName,
                )}
              >
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                {isLeafHeader &&
                  enableColumnResizing &&
                  header.column.getCanResize() &&
                  !fixedColumns.has(header.column.id) && (
                    <button
                      type="button"
                      role="separator"
                      aria-orientation="vertical"
                      data-column-resize-handle={header.column.id}
                      title={`${columnLabels?.[header.column.id] ? `调整“${columnLabels[header.column.id]}”列宽；` : ""}拖动调整列宽，双击恢复默认`}
                      aria-label={`调整${header.column.id}列宽`}
                      aria-valuenow={header.getSize()}
                      aria-valuemin={header.column.columnDef.minSize ?? 72}
                      aria-valuemax={header.column.columnDef.maxSize ?? 520}
                      onMouseDown={(event) => {
                        setResizeDirection(
                          getComputedStyle(event.currentTarget).direction === "rtl" ? "rtl" : "ltr",
                        )
                        header.getResizeHandler()(event)
                      }}
                      onTouchStart={(event) => {
                        setResizeDirection(
                          getComputedStyle(event.currentTarget).direction === "rtl" ? "rtl" : "ltr",
                        )
                        header.getResizeHandler()(event)
                      }}
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
                        const rtl = getComputedStyle(event.currentTarget).direction === "rtl"
                        const next =
                          header.getSize() +
                          (event.key === "ArrowRight" ? 12 : -12) * (rtl ? -1 : 1)
                        table.setColumnSizing((current) => ({
                          ...current,
                          [header.column.id]: Math.max(
                            bounds.minSize ?? 72,
                            Math.min(bounds.maxSize ?? 520, next),
                          ),
                        }))
                      }}
                      className={cn(
                        "absolute inset-y-0 end-0 z-30 w-1.5 cursor-col-resize touch-none transition-colors focus-visible:bg-primary/50",
                        header.column.getIsResizing()
                          ? "bg-primary"
                          : "bg-transparent hover:bg-primary/40",
                      )}
                    />
                  )}
              </TableHead>
            )
          })}
        </TableRow>
      ))}
    </TableHeader>
  )
}
