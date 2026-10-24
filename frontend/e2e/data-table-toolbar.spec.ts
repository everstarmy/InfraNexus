import { expect, test, type Page } from "@playwright/test"

async function mountTable(
  page: Page,
  options: {
    hideRefresh?: boolean
    hideViewOptions?: boolean
    hideSearch?: boolean
    slots?: boolean
    title?: boolean
    legacy?: boolean
  } = {},
) {
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      status: route.request().url().endsWith("/auth/me") ? 401 : 200,
      json: { code: 401001, data: [] },
    }),
  )
  await page.goto("/login")
  await expect(page.getByRole("button", { name: "登录控制台", exact: true })).toBeVisible()
  await page.evaluate(async (options) => {
    const reactPath = "/node_modules/.vite/deps/react.js"
    const domPath = "/node_modules/.vite/deps/react-dom_client.js"
    const tablePath = "/src/components/data-table/data-table.tsx"
    const [react, dom, { DataTable }] = await Promise.all([
      import(reactPath),
      import(domPath),
      import(tablePath),
    ])
    const h = react.default.createElement
    const createRoot = dom.default.createRoot
    const container = document.createElement("div")
    container.style.padding = "16px"
    document.body.replaceChildren(container)
    const heading = options.title === false ? undefined : h("h2", null, "验收表格")
    createRoot(container).render(
      h(DataTable, {
        columns: [{ accessorKey: "name", header: "名称" }],
        data: [{ name: "Alpha" }, { name: "Beta" }],
        toolbarTitle: options.legacy ? undefined : heading,
        toolbarLeading: options.legacy ? heading : undefined,
        hideSearch: options.hideSearch,
        hideRefresh: options.hideRefresh,
        hideViewOptions: options.hideViewOptions,
        onRefresh: () => {
          container.dataset.refreshed = "yes"
        },
        searchLeading: options.slots ? h("button", null, "前置筛选") : undefined,
        searchTrailing: options.slots ? h("button", null, "后置筛选") : undefined,
      }),
    )
  }, options)
  await expect(page.getByRole("columnheader", { name: "名称" })).toBeVisible()
}

for (const width of [390, 1440]) {
  test(`toolbar separates header and search slots at ${width}px`, async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await mountTable(page, { slots: true })
    const header = page.locator('[data-slot="data-table-header"]')
    const search = page.locator('[data-slot="data-table-search"]')
    await expect(header.getByRole("heading", { name: "验收表格" })).toBeVisible()
    await expect(header.getByRole("button", { name: "刷新" })).toBeVisible()
    const titleBox = (await header.getByRole("heading").boundingBox())!
    const refreshBox = (await header.getByRole("button", { name: "刷新" }).boundingBox())!
    expect(
      Math.abs(titleBox.y + titleBox.height / 2 - refreshBox.y - refreshBox.height / 2),
    ).toBeLessThan(3)
    const a = (await header.boundingBox())!
    const b = (await search.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
    await expect(search.getByRole("button", { name: "前置筛选" })).toBeVisible()
    await expect(search.getByRole("button", { name: "后置筛选" })).toBeVisible()
    await page.keyboard.press("/")
    const input = search.getByRole("textbox")
    await expect(input).toBeFocused()
    await input.fill("Alpha")
    await expect(page.getByRole("cell", { name: "Beta", exact: true })).toHaveCount(0)
    await input.press("Escape")
    await expect(page.getByRole("cell", { name: "Beta", exact: true })).toBeVisible()
    await header.getByRole("button", { name: "刷新" }).click()
    await expect(page.locator('[data-refreshed="yes"]')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator("vite-error-overlay")).toHaveCount(0)
    expect(errors).toEqual([])
    await page.screenshot({ path: `/tmp/infranexus-toolbar-v2-${width}.png` })
  })
}

test("toolbar hides built-ins independently and removes empty rows", async ({ page }) => {
  await mountTable(page, { hideSearch: true, hideRefresh: true, legacy: true })
  await expect(page.getByRole("heading", { name: "验收表格" })).toBeVisible()
  await expect(page.getByRole("button", { name: "刷新" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "自定义显示列和固定列" })).toBeVisible()
  await expect(page.locator('[data-slot="data-table-search"]')).toHaveCount(0)
  await mountTable(page, { hideSearch: true, hideViewOptions: true, slots: true })
  await expect(page.getByRole("button", { name: "刷新" })).toBeVisible()
  await expect(page.getByRole("button", { name: "自定义显示列和固定列" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "前置筛选" })).toBeVisible()
  await mountTable(page, {
    hideSearch: true,
    hideRefresh: true,
    hideViewOptions: true,
    title: false,
  })
  await expect(page.locator('[data-slot="data-table-header"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="data-table-search"]')).toHaveCount(0)
})
