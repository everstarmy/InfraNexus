import { expect, it } from "vitest"
import type { Table } from "./types"
import { loadedRowsTSV, exportLoadedRowsCSV } from "./data-table-clipboard"
it("honors visible order, exclusion, label precedence, BOM, CSV escaping and formula protection", () => {
  const column = (id: string, meta = {}) => ({ id, columnDef: { header: id, meta } })
  const table = {
    getStartVisibleLeafColumns: () => [column("select")],
    getCenterVisibleLeafColumns: () => [
      column("name", { export: { enabled: true, label: "姓名" } }),
      column("secret", { export: { enabled: false } }),
      column("note"),
    ],
    getEndVisibleLeafColumns: () => [column("actions")],
    getRowModel: () => ({
      rows: [{ getValue: (id: string) => (id === "name" ? "=1+1" : 'a,"b"\nc') }],
    }),
  } as unknown as Table<{ name: string }>
  expect(loadedRowsTSV(table, { name: "ignored" })).toContain("姓名\tnote")
  const csv = exportLoadedRowsCSV(table)
  expect(csv).toBe('\ufeff姓名,note\r\n\'=1+1,"a,""b""\nc"')
  expect(csv).not.toContain("secret")
  expect(csv).not.toContain("actions")
  expect(loadedRowsTSV([["x", 0]])).toBe("x\t0")
})

it("preserves exact TSV escaping and existing String conversion semantics", () => {
  expect(loadedRowsTSV([["中文", 'a"b', "a,b", "line\r\nnext", "a\tb", null, undefined]])).toBe(
    '中文\t"a""b"\ta,b\t"line\r\nnext"\t"a\tb"\t\t',
  )
  const date = new Date("2026-10-31T00:00:00Z")
  expect(loadedRowsTSV([[date, [1, 2], { x: 1 }, true]])).toBe(
    `${String(date)}\t1,2\t[object Object]\ttrue`,
  )
})

it("protects formula and control/whitespace prefixes without losing string integers", async () => {
  const { spreadsheetText } = await import("./data-table-clipboard")
  for (const value of [
    "=1",
    "+1",
    "-1",
    "@SUM(A1)",
    "  =1",
    "\ufeff\u200b +1",
    "\u0000@x",
    "\tplain",
    "\rplain",
    "\nplain",
  ])
    expect(spreadsheetText(value)).toBe(`'${value}`)
  expect(spreadsheetText("9007199254740993123456789")).toBe("9007199254740993123456789")
  expect(spreadsheetText(9007199254740991)).toBe("9007199254740991")
  expect(spreadsheetText(1.25)).toBe("1.25")
  expect(() => spreadsheetText(9007199254740992)).toThrow("大整数必须以字符串提供")
  expect(() => spreadsheetText(-9007199254740992)).toThrow("大整数必须以字符串提供")
})
