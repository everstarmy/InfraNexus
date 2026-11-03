import { expect, test, type Page } from "@playwright/test"

async function mockLists(page: Page, total = 2) {
  const requests: Array<{ path: string; page: number; size: number }> = []
  await page.addInitScript(() => {
    class QuietEventSource extends EventTarget {
      readyState = 1
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() { super(); queueMicrotask(() => this.onopen?.()) }
      close() { this.readyState = 2 }
    }
    window.EventSource = QuietEventSource as unknown as typeof EventSource
  })
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace("/api/v1", "")
    if (path.endsWith("/auth/setup")) return route.fulfill({ json: { code: 200000, data: { initialized: true } } })
    const json = (data: unknown) => route.fulfill({ json: { code: 200000, message: "success", request_id: "table-layout", data } })
    if (path === "/auth/me") return json({
      id: "table-layout-reviewer", username: "table-layout", nickname: "表格验收员", status: 1,
      auth_type: "local", is_admin: true, roles: [], permissions: ["*"],
      preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
    })
    if (path === "/auth/domains" || path === "/options/roles") return json([])
    if (path === "/options/departments") return json({ revision: 1, items: [] })
    if (path === "/users/stats") return json({ total, active: total, disabled: 0, local: total, directory: 0, unassigned: total, by_domain: [] })
    if (path === "/roles" || path === "/users") {
      const current = Number(url.searchParams.get("page") ?? 1)
      const size = Number(url.searchParams.get("page_size") ?? 10)
      const filteredTotal = url.searchParams.get("keyword") ? 2 : total
      requests.push({ path, page: current, size })
      const items = Array.from({ length: Math.max(0, Math.min(size, filteredTotal - (current - 1) * size)) }, (_, i) => {
        const index = (current - 1) * size + i + 1
        return path === "/roles" ? {
          id: `role-${index}`, name: `测试角色 ${index}`, code: `role-${index}`, description: "用于验证宽屏表格和分页",
          status: 1, built_in: false, user_count: index, permissions: [], created_at: "2026-10-01T00:00:00Z",
        } : {
          id: `user-${index}`, username: `table-user-${index}`, nickname: `测试用户 ${index}`, email: `user${index}@example.test`,
          edit_revision: 1, status: 1, auth_type: "local", domain: "", built_in: false, department: null,
          department_id: null, roles: [], created_at: "2026-10-01T00:00:00Z", last_login_at: null,
        }
      })
      return json({ items, total: filteredTotal, page: current, page_size: size })
    }
    return json([])
  })
  return requests
}

async function assertTableFills(page: Page) {
  const container = page.locator('[data-slot="data-table"] [data-slot="table-container"]').first()
  const dimensions = await container.evaluate((element) => {
    const table = element.querySelector("table")!
    const headers = table.querySelectorAll("thead tr:last-child th")
    return { container: element.clientWidth, table: table.getBoundingClientRect().width,
      minimum: parseFloat(table.style.minWidth) || parseFloat(table.style.width) || 0,
      action: headers[headers.length - 1].getBoundingClientRect().width }
  })
  expect(dimensions.table).toBeGreaterThanOrEqual(dimensions.container - 1)
  expect(dimensions.table).toBeLessThanOrEqual(Math.max(dimensions.container, dimensions.minimum) + 1)
  expect(dimensions.action).toBeLessThanOrEqual(64)
}

for (const path of ["/roles", "/users"]) {
  test(`${path} fills wide canvases and hides one-page jump`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") errors.push(message.text()) })
    await mockLists(page)
    for (const width of [1440, 2560, 3840, 6014]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(path)
      await expect(page.getByRole("heading", { name: path === "/roles" ? "角色管理" : "用户管理" })).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`${path}$`))
      await expect(page).toHaveTitle(/InfraNexus/)
      await expect(page.locator("vite-error-overlay")).toHaveCount(0)
      await expect(page.getByText("第 1 / 1 页", { exact: true })).toBeVisible()
      await expect(page.getByRole("spinbutton", { name: "跳转页码" })).toHaveCount(0)
      await assertTableFills(page)
      if (width === 2560) await page.screenshot({ path: testInfo.outputPath(`infranexus-table-${path.slice(1)}-wide.png`) })
    }
    expect(errors).toEqual([])
  })
}

test("multi-page jumps validate input and disappear after filtering to one page", async ({ page }) => {
  const requests = await mockLists(page, 45)
  await page.goto("/roles")
  await expect(page.getByText("第 1 / 3 页", { exact: true })).toBeVisible()
  const input = page.getByRole("spinbutton", { name: "跳转页码" })
  await expect(input).toBeVisible()
  const range = page.getByText("请输入 1–3 的整数页码", { exact: true })
  await expect(range).toHaveClass("sr-only")
  for (const invalid of ["0", "4", "1.5"]) {
    await input.fill(invalid)
    await expect(input).toHaveAttribute("aria-invalid", "true")
    await expect(page.getByRole("alert").filter({ hasText: "请输入 1–3 的整数页码" })).toBeVisible()
    await expect(page.getByRole("button", { name: "跳转", exact: true })).toBeDisabled()
    await input.press("Enter")
    await expect(page.getByText("第 1 / 3 页", { exact: true })).toBeVisible()
  }
  await input.fill("3")
  await expect(input).toHaveAttribute("aria-invalid", "false")
  await input.press("Enter")
  await expect(page.getByText("第 3 / 3 页", { exact: true })).toBeVisible()
  expect(requests.some((r) => r.path === "/roles" && r.page === 3)).toBe(true)
  await page.getByPlaceholder("搜索角色名称或编码").fill("测试")
  await expect(page.getByText("第 1 / 1 页", { exact: true })).toBeVisible()
  await expect(input).toHaveCount(0)
})

test("users keep column sizing, visibility and pinned columns usable", async ({ page }) => {
  await mockLists(page)
  await page.setViewportSize({ width: 2560, height: 1000 })
  await page.goto("/users")
  await expect(page.getByText("第 1 / 1 页", { exact: true })).toBeVisible()
  const resize = page.getByRole("separator", { name: "调整username列宽" })
  await resize.focus()
  await resize.press("End")
  await expect(resize).toHaveAttribute("aria-valuenow", "420")
  await assertTableFills(page)
  await resize.press("Home")
  await expect(resize).toHaveAttribute("aria-valuenow", "280")
  await page.getByRole("button", { name: "表格设置" }).click()
  await page.getByRole("checkbox", { name: "显示最近登录", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("columnheader", { name: "最近登录" })).toHaveCount(0)
  await assertTableFills(page)
  await page.reload()
  await expect(page.getByRole("columnheader", { name: "最近登录" })).toHaveCount(0)
  await assertTableFills(page)
  await page.setViewportSize({ width: 1024, height: 900 })
  const scroller = page.locator('[data-slot="data-table"] [data-slot="table-container"]').first()
  await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth })
  const geometry = await scroller.evaluate((element) => {
    const headers = element.querySelectorAll("thead th")
    return { left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      check: headers[0].getBoundingClientRect().right, name: headers[1].getBoundingClientRect().left,
      action: headers[headers.length - 1].getBoundingClientRect().right }
  })
  expect(Math.abs(geometry.name - geometry.check)).toBeLessThanOrEqual(1)
  expect(Math.abs(geometry.action - geometry.right)).toBeLessThanOrEqual(1)
  // Sidebar + page padding leave about 595px for this table: pins should
  // depend on actual remaining space, rather than a blanket 640px cutoff.
  await page.setViewportSize({ width: 920, height: 900 })
  await expect.poll(() => scroller.evaluate(el => el.clientWidth)).toBeGreaterThan(570)
  await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth })
  await expect.poll(() => scroller.evaluate(el => {
    const cells = el.querySelectorAll('tbody tr:first-child td')
    return Array.from(cells).slice(0, 3).every(cell => getComputedStyle(cell).position === 'sticky')
  })).toBe(true)
  const pinnedLeft = await scroller.evaluate(el => {
    const cells = el.querySelectorAll('tbody tr:first-child td')
    return Math.abs(cells[0].getBoundingClientRect().left - el.getBoundingClientRect().left)
  })
  expect(pinnedLeft).toBeLessThanOrEqual(1)
  await page.getByRole("button", { name: "表格设置" }).click()
  await page.getByRole("button", { name: "用户不固定", exact: true }).click()
  await page.keyboard.press("Escape")
  await scroller.evaluate((element) => { element.scrollLeft = 120 })
  await expect.poll(() => scroller.evaluate(el => {
    const cells = el.querySelectorAll('tbody tr:first-child td')
    return [cells[0], cells[1]].every(cell => getComputedStyle(cell).position === 'sticky')
  })).toBe(true)
  const unpinnedGeometry = await scroller.evaluate((element) => {
    const cells = element.querySelectorAll("tbody tr:first-child td")
    const check = cells[0].getBoundingClientRect()
    const detail = cells[1].getBoundingClientRect()
    return { checkWidth: Math.round(check.width), detailWidth: Math.round(detail.width), gap: Math.abs(detail.left - check.right) }
  })
  expect(unpinnedGeometry).toEqual({ checkWidth: 42, detailWidth: 36, gap: 0 })
})

test("compact lists and pagination stay inside the mobile viewport", async ({ page }, testInfo) => {
  await mockLists(page, 45)
  await page.setViewportSize({ width: 375, height: 812 })
  for (const path of ["/roles", "/users"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { name: path === "/roles" ? "角色管理" : "用户管理" })).toBeVisible()
    await expect(page.getByRole("spinbutton", { name: "跳转页码" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  }
  await page.getByRole("spinbutton", { name: "跳转页码" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath("infranexus-table-mobile.png") })
})

test("pinning a new column replaces the previous business column", async ({ page }) => {
  await mockLists(page)
  await page.setViewportSize({ width: 2560, height: 1000 })
  await page.goto("/roles")
  await expect(page.getByText("第 1 / 1 页", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "表格设置" }).click()
  // Name is already pinned; the first remaining left-pin action is Code.
  await page.getByRole("button", { name: "角色编码固定左侧", exact: true }).click()
  await expect(page.getByRole("button", { name: "角色不固定", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("Escape")
  for (const width of [2560, 900]) {
    await page.setViewportSize({ width, height: 1000 })
    const scroller = page.locator('[data-slot="data-table"] [data-slot="table-container"]').first()
    await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    const edges = await page.locator("thead th").evaluateAll((headers) => {
      const name = headers.find((head) => head.querySelector('[aria-label="调整name列宽"]'))!
      const code = headers.find((head) => head.querySelector('[aria-label="调整code列宽"]'))!
      return { name: name.getBoundingClientRect().right, code: code.getBoundingClientRect().left }
    })
    expect(Number.isFinite(edges.code)).toBe(true)
    const pinned = await page.locator("thead th").evaluateAll(headers => headers.filter(head => getComputedStyle(head).position === "sticky").map(head => head.textContent))
    if (width === 2560) { expect(pinned.some(text => text?.includes("角色编码"))).toBe(true); expect(pinned.some(text => text === "角色")).toBe(false) }
  }
})

test("empty lists preserve the visible column count without a jump control", async ({ page }) => {
  await mockLists(page, 0)
  await page.setViewportSize({ width: 2560, height: 1000 })
  for (const path of ["/roles", "/users"]) {
    await page.goto(path)
    await expect(page.getByText("共 0 条记录", { exact: true })).toBeVisible()
    await expect(page.getByRole("spinbutton", { name: "跳转页码" })).toHaveCount(0)
    const table = page.locator('[data-slot="data-table"] table')
    await expect(table.locator("tbody td")).toHaveAttribute("colspan", String(await table.locator("thead th").count()))
    await assertTableFills(page)
  }
})


test("column settings support continuous edits, search and reset", async ({ page }, testInfo) => {
  await mockLists(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/users")
  await page.getByRole("button", { name: "表格设置" }).click()
  const panel = page.getByRole("dialog")
  await expect(panel).toBeVisible()
  await page.getByRole("checkbox", { name: "显示最近登录", exact: true }).click()
  await page.getByRole("checkbox", { name: "显示来源", exact: true }).click()
  await expect(panel).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "来源", exact: true })).toHaveCount(0)
  await page.getByRole("textbox", { name: "搜索列", exact: true }).fill("创建")
  await expect(panel.getByRole("checkbox")).toHaveCount(1)
  await page.getByRole("button", { name: "恢复默认", exact: true }).click()
  await expect(page.getByRole("checkbox", { name: "显示来源", exact: true })).toBeChecked()
  await expect(page.getByRole("checkbox", { name: "显示创建时间", exact: true })).not.toBeChecked()
  await page.screenshot({ path: testInfo.outputPath("infranexus-column-settings-after.png") })
})

test("external search resets and unsupported server sorting is unavailable", async ({ page }) => {
  await mockLists(page, 45)
  await page.goto("/roles")
  await page.getByPlaceholder("搜索角色名称或编码").fill("测试")
  await page.getByRole("button", { name: "重置筛选", exact: true }).click()
  await expect(page.getByPlaceholder("搜索角色名称或编码")).toHaveValue("")
  await expect(page.getByRole("columnheader", { name: "角色编码", exact: true }).getByRole("button")).toHaveCount(0)
})


test("column panel fits mobile and narrow tables release data pinning", async ({ page }, testInfo) => {
  await mockLists(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/users")
  const trigger = page.getByRole("button", { name: "表格设置" })
  await trigger.click()
  const panel = page.getByRole("dialog")
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  await expect(page.getByRole("button", { name: "用户固定左侧", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: testInfo.outputPath("infranexus-column-settings-mobile.png") })
  await page.keyboard.press("Escape")
  await expect(panel).toBeHidden()
  const name = page.getByRole("columnheader").filter({ has: page.locator('[aria-label="调整username列宽"]') })
  await expect(name).not.toHaveCSS("position", "sticky")
})


test("enhanced pin icon groups preserve multiple pins and allow clearing", async ({ page }, testInfo) => {
  await mockLists(page)
  await page.goto("/users")
  await page.getByRole("button", { name: "表格设置" }).click()
  const pin = (name: string) => page.getByRole("button", { name, exact: true })
  await pin("来源固定左侧").click()
  await expect(pin("用户固定左侧")).toHaveAttribute("aria-pressed", "true")
  await expect(pin("来源固定左侧")).toHaveAttribute("aria-pressed", "true")
  await pin("部门固定右侧").click()
  await pin("状态固定右侧").click()
  await expect(pin("部门固定右侧")).toHaveAttribute("aria-pressed", "true")
  await expect(pin("状态固定右侧")).toHaveAttribute("aria-pressed", "true")
  await pin("来源固定右侧").click()
  await expect(pin("状态固定右侧")).toHaveAttribute("aria-pressed", "true")
  await expect(pin("来源固定右侧")).toHaveAttribute("aria-pressed", "true")
  await pin("来源不固定").click()
  await expect(pin("来源不固定")).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("infranexus-column-pin-icons.png") })
})

test("department members separate title controls from filters", async ({ page }, testInfo) => {
  await mockLists(page)
  await page.route("**/api/v1/departments/tree", route => route.fulfill({ json: {
    code: 200000, message: "success", request_id: "department-toolbar",
    data: { revision: 1, items: [{ id: "dept-1", parent_id: null, name: "总行", code: "head", sort_order: 0, leader_id: null, leader_name: "", phone: "", email: "", status: 1, source: "local", tree_path: "/dept-1/", depth: 0, member_count: 2, total_member_count: 2, children: [] }] },
  } }))
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto("/departments")
  const summary = page.locator('[data-slot="department-summary-header"]')
  const parentPath = (await summary.getByText("顶级部门", { exact: true }).boundingBox())!
  const heading = (await summary.getByRole("heading", { name: "总行", exact: true }).boundingBox())!
  expect(Math.abs(parentPath.y + parentPath.height / 2 - heading.y - heading.height / 2)).toBeLessThan(2)
  expect((await summary.boundingBox())!.height).toBeLessThan(70)
  const table = page.locator('[data-slot="data-table"]')
  await expect(table.getByText("部门成员", { exact: true })).toBeVisible()
  const toggle = table.getByRole("switch", { name: "含下级部门" })
  const refresh = table.getByTitle("刷新列表", { exact: true })
  await expect(refresh).toBeVisible()
  const a = (await table.getByText("部门成员", { exact: true }).boundingBox())!
  const b = (await refresh.boundingBox())!
  expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(12)
  expect((await toggle.boundingBox())!.y).toBeGreaterThan(b.y + b.height)
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.screenshot({ path: testInfo.outputPath("infranexus-department-toolbar.png") })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(refresh).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
})

test("users keep scope title and table controls together above filters", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await mockLists(page)
  await page.goto("/users")
  for (const width of [1280, 1920, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const table = page.locator('[data-slot="data-table"]')
    await expect(table.getByText("table-user-1", { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`infranexus-users-header-${width}.png`), fullPage: true })
    const header = table.locator('[data-slot="data-table-header"]')
    const title = header.getByText("全部人员", { exact: true })
    await expect(title).toBeVisible()
    const titleBox = (await title.boundingBox())!
    const refreshBox = (await header.getByRole("button", { name: "刷新", exact: true }).boundingBox())!
    expect(Math.abs(titleBox.y + titleBox.height / 2 - refreshBox.y - refreshBox.height / 2)).toBeLessThan(3)
    const search = table.locator('[data-slot="data-table-search"]')
    expect((await search.boundingBox())!.y).toBeGreaterThanOrEqual((await header.boundingBox())!.y + (await header.boundingBox())!.height)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.getByRole("button", { name: "收起组织架构" }).click()
  const expand = page.locator('[data-slot="data-table-header"]').getByRole("button", { name: "展开组织架构" })
  await expect(expand).toBeVisible()
  await expand.click()
  await expect(page.getByRole("button", { name: "收起组织架构" })).toBeVisible()
  expect(errors).toEqual([])
})

test('M2 query applies atomically, saves a default view and keeps URL namespaces', async ({ page }, info) => {
  await mockLists(page, 45)
  const queries: URL[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/users') queries.push(new URL(request.url())) })
  await page.goto('/users?other_query=keep')
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  if (!await page.getByRole('button', { name: '更多表格操作' }).getAttribute('aria-expanded').then(value => value === 'true')) await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: /^高级查询/ }).click()
  await page.getByRole('button', { name: '添加条件', exact: true }).click()
  await page.getByLabel('条件1字段', { exact: true }).selectOption('status')
  await page.getByLabel('条件1值1', { exact: true }).selectOption('2')
  await page.getByRole('button', { name: '添加排序', exact: true }).click()
  await page.getByLabel('排序1字段').selectOption('created_at')
  await page.getByRole('button', { name: '添加排序', exact: true }).click()
  await page.getByLabel('排序2字段').selectOption('status')
  await page.getByRole('button', { name: '应用查询', exact: true }).click()
  await expect.poll(() => queries.at(-1)?.searchParams.get('query')).toContain('"value":2')
  expect(queries.at(-1)?.searchParams.get('page')).toBe('1')
  if (!await page.getByRole('button', { name: '更多表格操作' }).getAttribute('aria-expanded').then(value => value === 'true')) await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: /^保存视图/ }).click()
  await page.getByLabel('视图名称', { exact: true }).fill('禁用人员')
  await page.getByRole('button', { name: '另存为新视图', exact: true }).click()
  await page.getByRole('button', { name: '设为默认', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  if (!await page.getByRole('button', { name: '更多表格操作' }).getAttribute('aria-expanded').then(value => value === 'true')) await page.getByRole('button', { name: '更多表格操作' }).click()
  await expect(page.getByRole('button', { name: '高级查询 · 已应用' })).toBeVisible()
  await page.getByRole('button', { name: /^保存视图/ }).click()
  await expect(page.getByText('禁用人员（当前）（默认）', { exact: true })).toBeVisible()
  await expect(page.getByLabel('视图名称', { exact: true })).toHaveValue('禁用人员')
  await expect(page.getByRole('button', { name: '覆盖当前视图', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect.poll(() => queries.at(-1)?.searchParams.get('query')).toContain('"value":2')
  if (!await page.getByRole('button', { name: '更多表格操作' }).getAttribute('aria-expanded').then(value => value === 'true')) await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: '生成查询链接', exact: true }).click()
  await expect(page).toHaveURL(/users_query=/)
  expect(new URL(page.url()).searchParams.get('other_query')).toBe('keep')
  if (!await page.getByRole('button', { name: '更多表格操作' }).getAttribute('aria-expanded').then(value => value === 'true')) await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: /^高级查询/ }).click()
  await page.screenshot({ path: info.outputPath('m2-query-dialog.png') })
})

test('M2 column order, sampled width and multiple pins persist', async ({ page }) => {
  await mockLists(page)
  await page.setViewportSize({ width: 1920, height: 1000 })
  await page.goto('/users')
  await page.getByRole('button', { name: '表格设置' }).click()
  await page.getByRole('button', { name: '来源前移', exact: true }).click()
  await page.getByRole('button', { name: '适配来源列宽', exact: true }).click()
  await page.getByRole('button', { name: '来源固定左侧', exact: true }).click()
  await expect(page.getByRole('button', { name: '用户固定左侧', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('infranexus:table:table-layout-reviewer:users:v1')!))
  expect(saved.columnOrder.indexOf('auth_type')).toBeLessThan(saved.columnOrder.indexOf('username'))
  expect(saved.columnPinning.start).toContain('auth_type')
  expect(saved.columnPinning.start).toContain('username')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('infranexus:table:table-layout-reviewer:users:v1')!))
  expect(restored.columnPinning).toEqual(saved.columnPinning)
  expect(restored.columnOrder).toEqual(saved.columnOrder)
})

test('M2 view rename, conflict detection and deletion do not silently overwrite', async ({ page }) => {
  await mockLists(page)
  await page.goto('/users')
  if (!await page.getByRole('button', { name: '更多表格操作' }).getAttribute('aria-expanded').then(value => value === 'true')) await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: /^保存视图/ }).click()
  await page.getByLabel('视图名称', { exact: true }).fill('布局 A')
  await page.getByRole('button', { name: '另存为新视图', exact: true }).click()
  await page.getByLabel('视图名称', { exact: true }).fill('布局 B')
  await page.getByRole('button', { name: '重命名当前视图', exact: true }).click()
  await expect(page.getByText('布局 B', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const key = 'infranexus:table:table-layout-reviewer:users:v1:views:v1'
    const store = JSON.parse(localStorage.getItem(key)!); store.views[0].name = '另一标签页'
    localStorage.setItem(key, JSON.stringify(store))
  })
  await page.getByRole('button', { name: '重命名当前视图', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('其他标签页已修改视图')
  await page.keyboard.press('Escape')
  if (!await page.getByRole('button', { name: '更多表格操作' }).getAttribute('aria-expanded').then(value => value === 'true')) await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: /^保存视图/ }).click()
  await expect(page.getByText('另一标签页', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  const confirmation = page.getByRole('alertdialog')
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByText('另一标签页', { exact: true })).toHaveCount(0)
})

test('M2 URL history replays queries and IME input waits for composition end', async ({ page }) => {
  await mockLists(page)
  const queries: URL[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/users') queries.push(new URL(request.url())) })
  const q = (value: number) => encodeURIComponent(JSON.stringify({ version: 1, search: '', filter: { logic: 'and', children: [{ field: 'status', op: 'eq', value }] }, sorts: [] }))
  await page.goto(`/users?users_query=${q(1)}&users_pageSize=20`)
  await expect.poll(() => queries.at(-1)?.searchParams.get('page_size')).toBe('20')
  await expect.poll(() => queries.at(-1)?.searchParams.get('query')).toContain('"value":1')
  await page.goto(`/users?users_query=${q(2)}`)
  await expect.poll(() => queries.at(-1)?.searchParams.get('query')).toContain('"value":2')
  await page.goBack()
  await expect(page.getByRole('button', { name: '移除状态 等于 启用', exact: true })).toBeVisible()
  const search = page.getByPlaceholder('搜索用户名、姓名或邮箱')
  await page.clock.install()
  await search.dispatchEvent('compositionstart')
  await search.fill('中文')
  await page.clock.fastForward(400)
  expect(queries.at(-1)?.searchParams.get('keyword')).toBeNull()
  await search.dispatchEvent('compositionend', { data: '中文' })
  await expect.poll(() => queries.at(-1)?.searchParams.get('keyword')).toBe('中文')
})
