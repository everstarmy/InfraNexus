import type { CSSProperties } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface DataTableSkeletonProps {
  columns?: { id: string; style: CSSProperties }[]
  tableStyle?: CSSProperties
  headerRows?: number
  embedded?: boolean
  columnCount?: number
  rowCount?: number
  showCheckbox?: boolean
}

export function DataTableSkeleton({
  columns, tableStyle, headerRows = 1,
  embedded = false,
  columnCount = 6,
  rowCount = 5,
  showCheckbox = true,
}: DataTableSkeletonProps) {
  if (columns) return <div role="status" aria-label="正在加载表格数据" aria-busy="true">
    <span className="sr-only">正在加载表格数据…</span>
    <table className="w-full caption-bottom text-sm" style={tableStyle}>
      <colgroup>{columns.map(column => <col key={column.id} style={{ width: column.style.width }} />)}</colgroup>
      <TableHeader>{Array.from({ length: headerRows }, (_, index) => <TableRow key={index}>{columns.map(column => <TableHead key={column.id} style={column.style} className={`h-10 overflow-hidden bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))] ${column.style.position === "sticky" ? "z-20" : ""} ${column.id === "select" || column.id === "__detail" ? "px-1" : "px-3"}`}><Skeleton className="skeleton-shimmer h-4 w-2/3 max-w-24" /></TableHead>)}</TableRow>)}</TableHeader>
      <TableBody>{Array.from({ length: rowCount }, (_, row) => <TableRow key={row}>{columns.map(column => <TableCell key={column.id} style={column.style} className={`overflow-hidden bg-card py-2 ${column.style.position === "sticky" ? "z-10" : ""} ${column.id === "select" || column.id === "__detail" ? "px-1" : "px-3"}`}><Skeleton className={`skeleton-shimmer ${column.id === "select" || column.id === "__detail" ? "size-4" : "h-4 w-2/3 max-w-32"}`} /></TableCell>)}</TableRow>)}</TableBody>
    </table>
  </div>
  const Container = embedded ? "table" : Table
  return (
    <div className={embedded ? "bg-card" : "overflow-hidden rounded-md border bg-card"} role="status" aria-label="正在加载表格数据" aria-busy="true">
      <span className="sr-only">正在加载表格数据…</span>
      <Container className="w-full caption-bottom text-sm">
        <TableHeader className="bg-muted/40">
          <TableRow>
            {showCheckbox && (
              <TableHead className="w-10 px-3">
                <Skeleton className="skeleton-shimmer size-4 rounded-xs" />
              </TableHead>
            )}
            {Array.from({ length: columnCount }).map((_, i) => (
              <TableHead key={i} className="h-10 px-3">
                <Skeleton className="skeleton-shimmer h-4 w-24" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rowCount }).map((_, rowIndex) => (
            <TableRow key={rowIndex} className="border-b hover:bg-transparent">
              {showCheckbox && (
                <TableCell className="w-10 px-3">
                  <Skeleton className="size-4 rounded-xs" />
                </TableCell>
              )}
              {Array.from({ length: columnCount }).map((_, colIndex) => (
                <TableCell key={colIndex} className="p-3">
                  <Skeleton
                    className={`skeleton-shimmer h-4 ${
                      colIndex === 0 ? "w-32" : colIndex === 1 ? "w-24" : "w-16"
                    }`}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Container>
    </div>
  )
}
