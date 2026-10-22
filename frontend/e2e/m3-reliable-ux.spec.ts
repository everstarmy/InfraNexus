import { expect, test, type Page, type Route } from "@playwright/test"

function envelope<T>(data: T, code = 200000, message = "success") {
  return { code, message, data, request_id: "playwright-m3" }
}

async function installDashboardMocks(page: Page) {
  let overviewReads = 0
  let dashboardAvailable = false
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      readonly CONNECTING = 0
      readonly OPEN = 1
      readonly CLOSED = 2
      readyState = 1
      onopen: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      constructor() {
        super()
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("connected", { data: "{}" })))
      }
      close() { this.readyState = MockEventSource.CLOSED }
    }
    window.EventSource = MockEventSource as unknown as typeof EventSource
  })

  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "")
    const json = (data: unknown, status = 200, code = status === 200 ? 200000 : status * 1000 + 1, message = "request failed") =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data, code, message)) })

    if (path === "/auth/me") {
      return json({
        id: "00000000-0000-4000-8000-000000000701",
        username: "m3-reviewer",
        email: "m3@example.test",
        nickname: "M3 审查员",
        status: 1,
        auth_type: "local",
        built_in: true,
        is_admin: true,
        permissions: ["*"],
        roles: [{ id: "00000000-0000-4000-8000-000000000702", code: "admin", name: "超级管理员" }],
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      })
    }
    if (path === "/auth/domains") return json([])
    if (path === "/sse/notifications") return route.abort("failed")
    if (path === "/dashboard/overview") {
      overviewReads += 1
      if (!dashboardAvailable) return json(null, 500, 500001, "dashboard temporarily unavailable")
      return json({
        users: { total: 3, active: 2, disabled: 1, local: 3, directory: 0, unassigned: 1, by_domain: [] },
        departments: { total: 0, enabled: 0, disabled: 0, from_directory: 0 },
        roles: { total: 1, built_in: 1 },
        permissions: { menus: 1, buttons: 1, apis: 1 },
        directories: [],
        recent_syncs: [],
      })
    }
    return json(null, 404, 404001, `unmocked ${request.method()} ${path}`)
  })

  return {
    get overviewReads() { return overviewReads },
    restoreDashboard() { dashboardAvailable = true },
  }
}

test("dashboard distinguishes a failed initial load, retries, and reports its data timestamp", async ({ page }) => {
  const mocks = await installDashboardMocks(page)
  await page.goto("/dashboard")

  await expect(page.getByRole("heading", { name: /M3 审查员/ })).toBeVisible()
  await expect(page.getByRole("alert").getByText("工作台数据暂时无法加载")).toBeVisible()
  await expect.poll(() => mocks.overviewReads).toBeGreaterThan(0)
  await expect(page.getByRole("status").filter({ hasText: "数据更新失败" })).toBeVisible()
  await expect(page.getByText("账号构成")).toHaveCount(0)

  mocks.restoreDashboard()
  await page.getByRole("button", { name: "重试" }).click()
  await expect(page.getByText("账号构成")).toBeVisible()
  await expect(page.getByRole("status").filter({ hasText: "数据已加载" })).toBeVisible()
  await expect(page.getByText(/数据更新于 \d{4}-\d{2}-\d{2}/)).toBeVisible()

  await page.emulateMedia({ reducedMotion: "reduce" })
  const statusDot = page.getByRole("status").filter({ hasText: "数据已加载" }).locator("span").first()
  await expect.poll(() => statusDot.evaluate((element) => getComputedStyle(element).animationName)).toBe("none")

  await page.getByRole("button", { name: "切换至深色模式" }).click()
  await expect.poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(true)
  await page.getByRole("button", { name: "切换至浅色模式" }).click()
  await expect.poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(false)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
