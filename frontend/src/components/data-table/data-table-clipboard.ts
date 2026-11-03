import type { RowData } from "@tanstack/react-table"
import type { Table } from "./types"
export function spreadsheetText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "number" && !Number.isSafeInteger(value) && Number.isInteger(value))
    throw new Error("大整数必须以字符串提供，避免精度丢失")
  const text = String(value)
  return /^[\s\u0000-\u001f\ufeff\u200b]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)
    ? `'${text}`
    : text
}
function collectTableRows<TData extends RowData>(
  table: Table<TData>,
  labels?: Record<string, string>,
  rows?: { getValue: (id: string) => unknown; original?: TData }[],
): unknown[][] {
  const columns = [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ].filter(
    (c) =>
      !["select", "__detail", "actions"].includes(c.id) &&
      c.columnDef.meta?.export?.enabled !== false,
  )
  const targetRows = rows ?? table.getRowModel().rows
  return [
    columns.map(
      (c) =>
        c.columnDef.meta?.export?.label ??
        labels?.[c.id] ??
        (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id),
    ),
    ...targetRows.map((row) =>
      columns.map((c) =>
        c.columnDef.meta?.export?.value && row.original !== undefined
          ? c.columnDef.meta.export.value(row.original as TData)
          : row.getValue(c.id),
      ),
    ),
  ]
}
export function loadedRowsTSV(rows: unknown[][]): string
export function loadedRowsTSV<TData extends RowData>(
  table: Table<TData>,
  columnLabels?: Record<string, string>,
  rows?: { getValue: (id: string) => unknown; original?: TData }[],
): string
export function loadedRowsTSV<TData extends RowData>(
  input: unknown[][] | Table<TData>,
  columnLabels?: Record<string, string>,
  rows?: { getValue: (id: string) => unknown; original?: TData }[],
): string {
  const tableRows = Array.isArray(input) ? input : collectTableRows(input, columnLabels, rows)
  return serializeRows(tableRows, "tsv")
}

function serializeRows(rows: unknown[][], format: "csv" | "tsv"): string {
  const delimiter = format === "csv" ? "," : "\t"
  const special = format === "csv" ? /[,"\r\n]/ : /[\t\r\n"]/
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = spreadsheetText(value)
          return special.test(text) ? `"${text.replaceAll('"', '""')}"` : text
        })
        .join(delimiter),
    )
    .join("\r\n")
}

function downloadCSV(csv: string, filename: string): void {
  const anchor = document.createElement("a")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
  try {
    anchor.href = url
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export async function copyTableText(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error("浏览器不支持剪贴板，请使用安全连接")
  await navigator.clipboard.writeText(value)
}

/** Export the current row model, honoring visible column order and export metadata. */
export function exportLoadedRowsCSV<TData extends RowData>(
  table: Table<TData>,
  options?: {
    columnLabels?: Record<string, string>
    filename?: string
    rows?: { getValue: (id: string) => unknown; original?: TData }[]
  },
): string {
  // Complete collection/serialization before allocating browser download resources.
  const csv =
    "\ufeff" +
    serializeRows(collectTableRows(table, options?.columnLabels, options?.rows), "csv")
  if (options?.filename && typeof document !== "undefined") downloadCSV(csv, options.filename)
  return csv
}

/** Extract leaf data column IDs that are currently visible and enabled for export. */
export function getVisibleExportColumnIds<TData extends RowData>(table: Table<TData>): string[] {
  return [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ]
    .filter(
      (c) =>
        !["select", "__detail", "actions"].includes(c.id) &&
        c.columnDef.meta?.export?.enabled !== false,
    )
    .map((c) => c.id)
}
