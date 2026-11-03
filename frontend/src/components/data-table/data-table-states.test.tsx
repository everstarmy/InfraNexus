import { renderToStaticMarkup } from "react-dom/server"
import { expect, it } from "vitest"
import { DataTable } from "./data-table"
const columns = [{ accessorKey: "name", header: "姓名" }]
it("presets only fill unspecified capabilities and retain legacy defaults", () => {
  const simple = renderToStaticMarkup(<DataTable columns={columns} data={[]} preset="simple" />)
  expect(simple).not.toContain("表格密度")
  expect(simple).not.toContain('role="separator"')
  const standard = renderToStaticMarkup(<DataTable columns={columns} data={[]} preset="standard" />)
  expect(standard).toContain("表格密度")
  expect(standard).toContain('role="separator"')
  const explicit = renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={[]}
      preset="advanced"
      enableColumnResizing={false}
      layoutControls={{}}
    />,
  )
  expect(explicit).not.toContain("表格密度")
  expect(explicit).not.toContain('role="separator"')
})
it("distinguishes failed initial loads from stale data and exposes refreshing without replacing rows", () => {
  const empty = renderToStaticMarkup(
    <DataTable
      columns={columns}
      data={[]}
      error={new Error("secret internals")}
      onRetry={() => {}}
    />,
  )
  expect(empty).toContain("数据加载失败")
  expect(empty).not.toContain("secret internals")
  expect(empty).toContain("重试")
  const stale = renderToStaticMarkup(
    <DataTable columns={columns} data={[{ name: "仍可查看" }]} error={true} isRefreshing />,
  )
  expect(stale).toContain("仍可查看")
  expect(stale).toContain('role="alert"')
  expect(stale).toContain("正在更新表格数据")
})
it("deduplicates aria-sort and resize handles on grouped placeholder headers and exposes pinned boundary", () => {
  const grouped = [
    {
      id: "profile",
      header: "基本信息",
      columns: [
        { accessorKey: "name", header: "姓名" },
        { accessorKey: "role", header: "角色" },
      ],
    },
    { accessorKey: "dept", header: "部门" },
  ]
  const html = renderToStaticMarkup(
    <DataTable
      columns={grouped}
      data={[{ name: "张三", role: "管理员", dept: "研发" }]}
      enableColumnResizing
      enableColumnPinning
      serverSorting={{
        sorting: [{ id: "dept", desc: false }],
        onChange: () => {},
      }}
      initialColumnPinning={{ start: ["name"], end: ["dept"] }}
    />,
  )
  expect(html.match(/data-column-resize-handle="dept"/g)?.length).toBe(1)
  expect(html.match(/aria-sort="ascending"/g)?.length).toBe(1)
  expect(html).toContain('data-pinned-edge="start"')
  expect(html).toContain('data-pinned-edge="end"')
})
