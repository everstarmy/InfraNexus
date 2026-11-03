// @vitest-environment happy-dom
import { expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { DataTableSelectionControls } from "./data-table-selection-controls"
import { getVisibleExportColumnIds } from "./data-table-clipboard"
import type { Table } from "./types"

it("renders plain record count without batch buttons when count is 0", () => {
  const onClear = vi.fn()
  const markup = renderToStaticMarkup(
    <DataTableSelectionControls
      total={42}
      selectedRows={[]}
      onClear={onClear}
      batchActions={() => <button>批量操作</button>}
    />,
  )
  expect(markup).toContain("共 42 条记录")
  expect(markup).not.toContain("批量操作")
  expect(markup).not.toContain("数据操作")
  expect(markup).not.toContain("<button")
})

it("renders batch action trigger and clear button only when count > 0", () => {
  const onClear = vi.fn()
  const markup = renderToStaticMarkup(
    <DataTableSelectionControls
      total={42}
      selectedRows={[{ id: "1" }, { id: "2" }]}
      onClear={onClear}
      batchActions={() => <button>批量删除</button>}
    />,
  )
  expect(markup).toContain("已选 2 条 · 批量操作")
  expect(markup).toContain("aria-label=\"批量操作\"")
  expect(markup).toContain("aria-label=\"取消选择\"")
})

it("extracts visible exportable columns correctly", () => {
  const mockTable = {
    getStartVisibleLeafColumns: () => [{ id: "select", columnDef: {} }],
    getCenterVisibleLeafColumns: () => [
      { id: "username", columnDef: { meta: { export: { enabled: true } } } },
      { id: "email", columnDef: { meta: {} } },
      { id: "password", columnDef: { meta: { export: { enabled: false } } } },
    ],
    getEndVisibleLeafColumns: () => [{ id: "actions", columnDef: {} }],
  } as unknown as Table<Record<string, unknown>>

  const ids = getVisibleExportColumnIds(mockTable)
  expect(ids).toEqual(["username", "email"])
  expect(ids).not.toContain("select")
  expect(ids).not.toContain("password")
  expect(ids).not.toContain("actions")
})
