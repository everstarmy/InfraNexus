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
  columnCount?: number
  rowCount?: number
  showCheckbox?: boolean
}

export function DataTableSkeleton({
  columnCount = 6,
  rowCount = 5,
  showCheckbox = true,
}: DataTableSkeletonProps) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            {showCheckbox && (
              <TableHead className="w-10 px-3">
                <Skeleton className="size-4 rounded-xs" />
              </TableHead>
            )}
            {Array.from({ length: columnCount }).map((_, i) => (
              <TableHead key={i} className="h-10 px-3">
                <Skeleton className="h-4 w-24" />
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
                    className={`h-4 ${
                      colIndex === 0 ? "w-32" : colIndex === 1 ? "w-24" : "w-16"
                    }`}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
