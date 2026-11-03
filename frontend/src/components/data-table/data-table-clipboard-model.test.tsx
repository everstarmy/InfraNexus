import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DataTable, type DataTableProps } from "./data-table"
import type { Table, ColumnDef } from "./types"
import { exportLoadedRowsCSV, loadedRowsTSV } from "./data-table-clipboard"

type Item = { id: string; name: string; count?: number; code?: string; children?: Item[] }
const columns: ColumnDef<Item>[] = [
  { accessorKey: "name", header: "名称", cell: ({ row }) => `UI:${row.original.name}` },
]
/** Capture the actual configured DataTable model while its auxiliary header renders. */
function realTable(props: Partial<DataTableProps<Item>> & { data: Item[] }) {
  let captured: Table<Item> | undefined
  const markup = renderToStaticMarkup(
    <DataTable<Item>
      getRowId={(row) => row.id}
      {...props}
      columns={[
        ...(props.columns ?? columns),
        {
          id: "actions",
          header: ({ table }) => {
            captured = table as Table<Item>
            return "操作"
          },
        },
      ]}
    />,
  )
  if (!captured) throw new Error("Table header did not render")
  return { table: captured, markup }
}

describe("exports from the real DataTable row model", () => {
  it("honors visible reordered pinned columns, metadata and raw accessor values", () => {
    const { table } = realTable({
      data: [{ id: "one", name: "原始姓名", count: 7, code: "代码值" }],
      columns: [
        { id: "select", header: "选择" },
        { accessorKey: "name", header: "名称", cell: () => "仅UI格式化" },
        {
          accessorKey: "count",
          header: "数量原表头",
          meta: { export: { enabled: true, label: "数量" } },
        },
        { accessorKey: "code", header: () => "代码UI表头" },
        { id: "hidden", accessorFn: () => "不应导出隐藏值" },
        { id: "secret", accessorFn: () => "不应导出禁用值", meta: { export: { enabled: false } } },
      ],
      enableColumnPinning: true,
      layoutState: {
        value: {
          density: "standard",
          columnVisibility: { hidden: false },
          columnOrder: ["select", "code", "count", "name", "hidden", "secret", "actions"],
          columnPinning: { start: ["count"], end: ["code"] },
          columnSizing: {},
        },
        onChange: () => {},
      },
    })
    expect(loadedRowsTSV(table, { name: "姓名", count: "被meta覆盖" })).toBe(
      "数量\t姓名\tcode\r\n7\t原始姓名\t代码值",
    )
    expect(exportLoadedRowsCSV(table, { columnLabels: { name: "姓名" } })).toBe(
      "\ufeff数量,姓名,code\r\n7,原始姓名,代码值",
    )
  })
  it("exports only the current client page, rather than every loaded record", () => {
    const { table } = realTable({
      data: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ],
      defaultPageSize: 2,
      pageSizeOptions: [2],
    })
    expect(table.getPrePaginatedRowModel().rows).toHaveLength(3)
    expect(loadedRowsTSV(table)).toBe("名称\r\nA\r\nB")
  })
  it("uses a controlled server page as supplied and never fabricates unloaded rows", () => {
    const { table } = realTable({
      data: [{ id: "page2", name: "第二页" }],
      serverPagination: { pageIndex: 1, pageSize: 1, total: 30, onChange: () => {} },
    })
    expect(loadedRowsTSV(table)).toBe("名称\r\n第二页")
  })
  it("empty models export the header only", () => {
    expect(exportLoadedRowsCSV(realTable({ data: [] }).table)).toBe("\ufeff名称")
  })
  it("exports expanded tree model rows and excludes collapsed descendants", () => {
    const data = [{ id: "root", name: "根", children: [{ id: "child", name: "子" }] }]
    const props = {
      data,
      getSubRows: (row: Item) => row.children,
      defaultPageSize: 1,
      pageSizeOptions: [1],
    }
    expect(loadedRowsTSV(realTable(props).table)).toBe("名称\r\n根")
    expect(loadedRowsTSV(realTable({ ...props, defaultExpanded: true }).table)).toBe(
      "名称\r\n根\r\n子",
    )
  })
  it("flat group headers and visual group sorting do not add synthetic export rows", () => {
    const { table, markup } = realTable({
      data: [
        { id: "z", name: "Z" },
        { id: "a", name: "A" },
      ],
      groupBy: { label: "分组", key: (row) => row.name },
    })
    expect(markup).toContain("当前页")
    expect(loadedRowsTSV(table)).toBe("名称\r\nZ\r\nA")
    expect(exportLoadedRowsCSV(table)).not.toContain("分组")
  })
})
