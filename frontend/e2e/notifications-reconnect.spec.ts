import { expect, test, type Page, type Route } from "@playwright/test"

function envelope<T>(data: T) {
  return { code: 200000, message: "success", data, request_id: "playwright-m2" }
}

async function installMocks(page: Page) {
  let userReads = 0
  let activeUsername = "stream-admin"
  await page.addInitScript(() => {
    const instances: Array<{ url: string; source: MockEventSource }> = []
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
      constructor(readonly url: string) {
        super()
        instances.push({ url, source: this })
        queueMicrotask(() => {
          this.onopen?.(new Event("open"))
          this.dispatchEvent(new MessageEvent("connected", { data: JSON.stringify({ status: "connected" }) }))
        })
      }
      close() { this.readyState = MockEventSource.CLOSED }
    }
    const target = window as typeof window & {
      __mockEventSources: typeof instances
      __failEventSource: (index: number) => void
      __emitEventSource: (index: number, name: string, data: string, lastEventId: string) => void
      __mockNotifications: { requestCount: number; delivered: Array<{ title: string; body: string }> }
    }
    target.__mockEventSources = instances
    target.__failEventSource = (index) => instances[index]?.source.onerror?.(new Event("error"))
    target.__emitEventSource = (index, name, data, lastEventId) => {
      instances[index]?.source.dispatchEvent(new MessageEvent(name, { data, lastEventId }))
    }
    class MockNotification {
      static permission: NotificationPermission = "default"
      static requestCount = 0
      static delivered: Array<{ title: string; body: string }> = []
      static async requestPermission() {
        this.requestCount += 1
        this.permission = "granted"
        return this.permission
      }
      constructor(title: string, options: NotificationOptions = {}) {
        MockNotification.delivered.push({ title, body: options.body ?? "" })
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: MockNotification })
    target.__mockNotifications = MockNotification
    window.EventSource = MockEventSource as unknown as typeof EventSource
  })

  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, "")
    const json = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(envelope(data)) })
    if (path === "/auth/me") {
      const replacement = activeUsername === "replacement-admin"
      return json({
        id: replacement ? "00000000-0000-4000-8000-000000000503" : "00000000-0000-4000-8000-000000000501",
        username: activeUsername,
        email: replacement ? "replacement@example.test" : "stream@example.test",
        nickname: replacement ? "替换管理员" : "实时事件管理员",
        status: 1,
        auth_type: "local",
        built_in: true,
        is_admin: true,
        permissions: ["*"],
        roles: [{ id: "00000000-0000-4000-8000-000000000502", code: "admin", name: "超级管理员" }],
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      })
    }
    if (path === "/auth/domains") return json([])
    if (path === "/auth/logout") return json({ logged_out: true })
    if (path === "/auth/login" && request.method() === "POST") {
      activeUsername = request.postDataJSON().username
      const replacement = activeUsername === "replacement-admin"
      return json({
        user: {
          id: replacement ? "00000000-0000-4000-8000-000000000503" : "00000000-0000-4000-8000-000000000501",
          username: activeUsername,
          email: replacement ? "replacement@example.test" : "stream@example.test",
          nickname: replacement ? "替换管理员" : "实时事件管理员",
          status: 1,
          auth_type: "local",
          built_in: true,
          is_admin: true,
          permissions: ["*"],
          roles: [{ id: "00000000-0000-4000-8000-000000000502", code: "admin", name: "超级管理员" }],
          preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
        },
      })
    }
    if (path === "/users" && request.method() === "GET") {
      userReads += 1
      return json({ items: [], total: 0, page: 1, page_size: 10 })
    }
    if (path === "/users/stats") return json({ total: 0, active: 0, disabled: 0, local: 0, directory: 0, unassigned: 0, by_domain: [] })
    if (path === "/options/departments") return json({ revision: 1, items: [] })
    if (path === "/options/roles") return json([])
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify(envelope(null)) })
  })

  return { userReads: () => userReads }
}

test("SSE reconnect backs off, resumes from its event ID, and stops after auth expiry", async ({ page }) => {
  const mocks = await installMocks(page)
  await page.goto("/users")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__mockEventSources.length)).toBe(1)

  await page.evaluate(() => (window as any).__failEventSource(0))
  await expect.poll(() => page.evaluate(() => (window as any).__mockEventSources.length), { timeout: 5_000 }).toBe(2)
  await page.getByRole("button", { name: /通知中心/ }).click()
  await expect(page.getByText("实时通道已恢复")).toBeVisible()
  await expect(page.getByRole("button", { name: "标记「实时通道已恢复」为已读" })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__mockNotifications.requestCount)).toBe(0)
  await page.getByRole("button", { name: "开启桌面通知" }).click()
  await expect(page.getByRole("button", { name: "桌面通知已授权" })).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__mockNotifications.requestCount)).toBe(1)
  await page.getByRole("button", { name: "开启通知声音" }).click()
  await expect(page.getByRole("button", { name: "关闭通知声音" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "标记「实时通道已恢复」为已读" }).click()
  await expect(page.getByRole("button", { name: /通知中心，实时通道已连接/ })).toBeVisible()
  await page.evaluate(() => (window as any).__emitEventSource(1, "ldap.sync.started", JSON.stringify({ task_id: "desktop-test", mode: "full", trigger: "manual" }), "1782400000000-1"))
  await expect.poll(() => page.evaluate(() => (window as any).__mockNotifications.delivered.length)).toBe(1)
  await page.evaluate(() => (window as any).__emitEventSource(1, "snapshot.required", JSON.stringify({ reason: "subscriber_lag" }), "1782400000000-2"))
  await expect.poll(mocks.userReads).toBeGreaterThan(1)

  await page.evaluate(() => (window as any).__failEventSource(1))
  await expect.poll(() => page.evaluate(() => (window as any).__mockEventSources.length), { timeout: 5_000 }).toBe(3)
  const resumedURL = await page.evaluate(() => (window as any).__mockEventSources[2].url as string)
  expect(new URL(resumedURL).searchParams.get("lastEventId")).toBe("1782400000000-2")

  await page.evaluate(() => (window as any).__emitEventSource(2, "auth.expired", JSON.stringify({ status: "closed" }), ""))
  await expect.poll(() => page.evaluate(() => (window as any).__mockEventSources[2].source.readyState)).toBe(2)
  await page.waitForTimeout(750)
  await expect(page.evaluate(() => (window as any).__mockEventSources.length)).resolves.toBe(3)
})

test("switching accounts closes the old stream and ignores its late events", async ({ page }) => {
  await installMocks(page)
  await page.goto("/users")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__mockEventSources.length)).toBe(1)

  await page.getByRole("button", { name: /实时事件管理员/ }).click()
  await page.getByText("退出登录", { exact: true }).click()
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible()
  await page.getByLabel("用户名").fill("replacement-admin")
  await page.getByLabel("登录密码").fill("test-password")
  await page.getByRole("button", { name: "登录控制台" }).click()
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__mockEventSources.length)).toBe(2)
  await expect.poll(() => page.evaluate(() => (window as any).__mockEventSources[0].source.readyState)).toBe(2)

  await page.evaluate(() => (window as any).__emitEventSource(0, "ldap.sync.finished", JSON.stringify({ task_id: "stale-task", status: "success" }), "1782400000000-4"))
  await page.getByRole("button", { name: /通知中心/ }).click()
  await expect(page.getByText("目录同步完成")).toHaveCount(0)
  await page.evaluate(() => (window as any).__emitEventSource(1, "ldap.sync.started", JSON.stringify({ task_id: "current-task", mode: "full", trigger: "manual" }), "1782400000000-5"))
  await expect(page.getByText("目录同步已开始")).toBeVisible()
})
