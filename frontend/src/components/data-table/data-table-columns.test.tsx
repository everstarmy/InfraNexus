import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { DataTable } from "./data-table"
import { exportLoadedRowsCSV } from "./data-table-clipboard"
import {
  createTextColumn,
  createNumberColumn,
  createDateColumn,
  createBadgeColumn,
  createActionsColumn,
} from "./data-table-columns"
it("provides typed accessors, display labels, null handling and export boundaries", () => {
  type R = { name: string | null; n: number; date: string; status: string }
  const row: R = { name: null, n: 1234, date: "invalid", status: "ok" }
  const text = createTextColumn<R>({ accessorKey: "name", title: "姓名" })
  expect(text.meta?.autoSizeText?.(row)).toBe("—")
  expect(text.meta?.export?.label).toBe("姓名")
  const numCol = createNumberColumn<R>({ accessorKey: "n", title: "数量", unit: "台" })
  expect(numCol.meta?.autoSizeText?.(row)).toBe("1,234台")
  expect(numCol.meta?.export?.value?.(row)).toBe("1,234台")
  const dateCol = createDateColumn<R>({ accessorKey: "date", title: "日期" })
  expect(dateCol.meta?.autoSizeText?.(row)).toBe("—")
  expect(dateCol.meta?.export?.value?.(row)).toBe("")
  expect(dateCol.meta?.autoSizeText?.({ ...row, date: "2026-02-31" })).toBe("—")
  expect(dateCol.meta?.autoSizeText?.({ ...row, date: "2026-10-01" })).toContain("2026")
  const badgeCol = createBadgeColumn<R>({
    accessorKey: "status",
    title: "状态",
    options: { ok: { label: "正常" } },
  })
  expect(badgeCol.meta?.autoSizeText?.(row)).toBe("正常")
  expect(badgeCol.meta?.export?.value?.(row)).toBe("正常")
  expect(createActionsColumn<R>({}).meta?.export?.enabled).toBe(false)
  expect(() => createTextColumn<R>({ accessorFn: (r) => r.name, title: "姓名" })).toThrow("id")

  const copyableEmptyHtml = renderToStaticMarkup(
    <DataTable
      columns={[createTextColumn<R>({ accessorKey: "name", title: "姓名", copyable: true })]}
      data={[row]}
    />,
  )
  expect(copyableEmptyHtml).not.toContain("复制 姓名")
})

it("exports formatted values via ColumnMeta.export.value", () => {
  type R = { status: string }
  const badgeCol = createBadgeColumn<R>({
    accessorKey: "status",
    title: "状态",
    options: { ok: { label: "正常" } },
  })
  const col = { id: "status", columnDef: badgeCol }
  const csv = exportLoadedRowsCSV({
    getStartVisibleLeafColumns: () => [],
    getCenterVisibleLeafColumns: () => [col],
    getEndVisibleLeafColumns: () => [],
    getRowModel: () => ({
      rows: [{ original: { status: "ok" }, getValue: () => "ok" }],
    }),
  } as never)
  expect(csv).toBe("\ufeff状态\r\n正常")
})
