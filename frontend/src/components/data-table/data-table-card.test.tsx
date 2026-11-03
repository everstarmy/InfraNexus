import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { DataTable } from "./data-table"
import { DataTableCard, DataTableTitle } from "./data-table-card"

it("propagates header slots to child DataTable without repeating props", () => {
  type Row = { id: string; name: string }
  const html = renderToStaticMarkup(
    <DataTableCard
      label="角色列表"
      title={<DataTableTitle title="全部角色" count={3} trailing="仅直属" />}
      toolbarControls={<button type="button">视图切换</button>}
      actions={<button type="button">新建角色</button>}
    >
      <DataTable<Row>
        columns={[{ id: "name", accessorKey: "name", header: "名称" }]}
        data={[{ id: "1", name: "管理员" }]}
      />
    </DataTableCard>,
  )

  expect(html).toContain("全部角色")
  expect(html).toContain("3")
  expect(html).toContain("仅直属")
  expect(html).toContain("视图切换")
  expect(html).toContain("新建角色")
  expect(html).toContain("管理员")
})

it("preserves header controls when initial load fails or returns 403", () => {
  const html = renderToStaticMarkup(
    <DataTableCard
      label="用户列表"
      title={<DataTableTitle title="全部人员" count={0} />}
      actions={<button type="button">新建用户</button>}
      error={new Error("network failure")}
      hasData={false}
      onRetry={vi.fn()}
    >
      <div>table-body-should-not-render</div>
    </DataTableCard>,
  )

  expect(html).toContain("全部人员")
  expect(html).toContain("新建用户")
  expect(html).toContain("用户列表暂时无法加载")
  expect(html).not.toContain("table-body-should-not-render")
})

it("keeps child table mounted and shows inline alert when stale data exists", () => {
  const html = renderToStaticMarkup(
    <DataTableCard
      label="角色列表"
      title={<DataTableTitle title="全部角色" count={1} />}
      isPlaceholderData
      error={new Error("refresh failed")}
      hasData
      onRetry={vi.fn()}
    >
      <div>cached-table-content</div>
    </DataTableCard>,
  )

  expect(html).toContain("正在加载当前角色列表")
  expect(html).toContain("角色列表暂时无法加载")
  expect(html).toContain("cached-table-content")
})

it.each([false, true])("blocks forbidden cached content even without retry (retry=%s)", (retry) => {
  const html = renderToStaticMarkup(
    <DataTableCard error={{ isAxiosError: true, response: { status: 403 } }} hasData onRetry={retry ? vi.fn() : undefined}>
      <div>protected-cached-content</div>
    </DataTableCard>,
  )
  expect(html).toContain("没有查看权限")
  expect(html).not.toContain("protected-cached-content")
  expect(html.includes("重试")).toBe(retry)
})

it("shows initial and stale errors without requiring a retry action", () => {
  for (const hasData of [false, true]) {
    const html = renderToStaticMarkup(
      <DataTableCard error={new Error("offline")} hasData={hasData}>
        <div>cached-content</div>
      </DataTableCard>,
    )
    expect(html).toContain("列表数据暂时无法加载")
    expect(html.includes("cached-content")).toBe(hasData)
  }
})
