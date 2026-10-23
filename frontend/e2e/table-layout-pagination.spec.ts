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
  test(`${path} fills wide canvases and hides one-page jump`, async ({ page }) => {
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
      if (width === 2560) await page.screenshot({ path: `/private/tmp/infranexus-table-${path.slice(1)}-wide.png` })
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
  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
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
})

test("compact lists and pagination stay inside the mobile viewport", async ({ page }) => {
  await mockLists(page, 45)
  await page.setViewportSize({ width: 375, height: 812 })
  for (const path of ["/roles", "/users"]) {
    await page.goto(path)
    await expect(page.getByRole("heading", { name: path === "/roles" ? "角色管理" : "用户管理" })).toBeVisible()
    await expect(page.getByRole("spinbutton", { name: "跳转页码" })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
  }
  await page.getByRole("spinbutton", { name: "跳转页码" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: "/private/tmp/infranexus-table-mobile.png" })
})

test("pinning a new column replaces the previous business column", async ({ page }) => {
  await mockLists(page)
  await page.setViewportSize({ width: 2560, height: 1000 })
  await page.goto("/roles")
  await expect(page.getByText("第 1 / 1 页", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
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


test("column settings support continuous edits, search and reset", async ({ page }) => {
  await mockLists(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/users")
  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
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
  await page.screenshot({ path: "/private/tmp/infranexus-column-settings-after.png" })
})

test("external search resets and unsupported server sorting is unavailable", async ({ page }) => {
  await mockLists(page, 45)
  await page.goto("/roles")
  await page.getByPlaceholder("搜索角色名称或编码").fill("测试")
  await page.getByRole("button", { name: "重置筛选", exact: true }).click()
  await expect(page.getByPlaceholder("搜索角色名称或编码")).toHaveValue("")
  await expect(page.getByRole("columnheader", { name: "角色编码", exact: true }).getByRole("button")).toHaveCount(0)
})


test("column panel fits mobile and narrow tables release data pinning", async ({ page }) => {
  await mockLists(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/users")
  const trigger = page.getByRole("button", { name: "自定义显示列和固定列" })
  await trigger.click()
  const panel = page.getByRole("dialog")
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  await expect(page.getByRole("button", { name: "用户固定左侧", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.screenshot({ path: "/private/tmp/infranexus-column-settings-mobile.png" })
  await page.keyboard.press("Escape")
  await expect(panel).toBeHidden()
  const name = page.getByRole("columnheader").filter({ has: page.locator('[aria-label="调整username列宽"]') })
  await expect(name).not.toHaveCSS("position", "sticky")
})


test("pin icon groups replace either side and allow clearing", async ({ page }) => {
  await mockLists(page)
  await page.goto("/users")
  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
  const pin = (name: string) => page.getByRole("button", { name, exact: true })
  await pin("来源固定左侧").click()
  await expect(pin("用户不固定")).toHaveAttribute("aria-pressed", "true")
  await expect(pin("来源固定左侧")).toHaveAttribute("aria-pressed", "true")
  await pin("部门固定右侧").click()
  await pin("状态固定右侧").click()
  await expect(pin("部门不固定")).toHaveAttribute("aria-pressed", "true")
  await expect(pin("状态固定右侧")).toHaveAttribute("aria-pressed", "true")
  await pin("来源固定右侧").click()
  await expect(pin("状态不固定")).toHaveAttribute("aria-pressed", "true")
  await expect(pin("来源固定右侧")).toHaveAttribute("aria-pressed", "true")
  await pin("来源不固定").click()
  await expect(pin("来源不固定")).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.screenshot({ path: "/private/tmp/infranexus-column-pin-icons.png" })
})

test("department members share one toolbar with title and controls", async ({ page }) => {
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
  const a = (await toggle.boundingBox())!
  const b = (await refresh.boundingBox())!
  expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(2)
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await page.screenshot({ path: "/private/tmp/infranexus-department-toolbar.png" })
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(refresh).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0)
})
