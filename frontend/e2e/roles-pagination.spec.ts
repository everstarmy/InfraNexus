import { expect, test, type Page, type Route } from "@playwright/test"

function envelope<T>(data: T, status = 200) {
  return { code: status === 200 ? 200000 : status * 1000 + 1, message: status === 200 ? "success" : "list unavailable", data, request_id: "playwright-m1-roles" }
}

function makeRole(index: number) {
  const value = index.toString(16).padStart(12, "0")
  return {
    id: `00000000-0000-4000-8000-${value}`,
    edit_revision: 1,
    code: `m1-role-${index.toString().padStart(3, "0")}`,
    name: `角色 ${index.toString().padStart(3, "0")}`,
    description: "M1 pagination fixture",
    status: 1,
    built_in: false,
    user_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    permissions: [],
  }
}

async function installMocks(page: Page) {
  let roles = Array.from({ length: 141 }, (_, index) => makeRole(index))
  let failList = false
  let failedListRequests = 0
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      readonly CONNECTING = 0
      readonly OPEN = 1
      readonly CLOSED = 2
      readonly readyState = 1
      onopen: ((event: Event) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      constructor() {
        super()
        queueMicrotask(() => this.onopen?.(new Event("open")))
      }
      close() {}
    }
    window.EventSource = MockEventSource as unknown as typeof EventSource
  })
  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, "")
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data, status)) })

    if (path === "/auth/me" && request.method() === "GET") {
      return json({
        id: "00000000-0000-4000-8000-000000000501",
        username: "m1-role-admin",
        domain: "",
        email: "role-admin@example.test",
        nickname: "角色管理员",
        status: 1,
        auth_type: "local",
        built_in: true,
        is_admin: true,
        permissions: ["access", "roles", "roles:create", "roles:update", "roles:delete", "roles:assign"],
        roles: [{ id: "00000000-0000-4000-8000-000000000502", code: "admin", name: "超级管理员" }],
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      })
    }
    if (path === "/roles" && request.method() === "GET") {
      if (failList) {
        failedListRequests += 1
        return route.abort("failed")
      }
      const keyword = (url.searchParams.get("keyword") ?? "").toLowerCase()
      const filtered = roles.filter((role) => `${role.code} ${role.name}`.toLowerCase().includes(keyword))
      const page = Number(url.searchParams.get("page") ?? 1)
      const pageSize = Number(url.searchParams.get("page_size") ?? 20)
      const items = filtered.slice((page - 1) * pageSize, page * pageSize)
      return json({ items, total: filtered.length, page, page_size: pageSize })
    }
    const deleteMatch = path.match(/^\/roles\/([^/]+)$/)
    if (deleteMatch && request.method() === "DELETE") {
      roles = roles.filter((role) => role.id !== deleteMatch[1])
      return json({ deleted: true })
    }
    if (path === "/sse/notifications") return route.abort("failed")
    return json(null, 404)
  })
  return {
    failList() { failList = true },
    get failedListRequests() { return failedListRequests },
  }
}

async function openRoles(page: Page) {
  await page.goto("/roles")
  await expect(page.getByRole("heading", { name: "角色管理" })).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "角色 000" })).toBeVisible()
}

test("search reaches roles beyond the first hundred and failed refresh keeps the current rows", async ({ page }) => {
  const mocks = await installMocks(page)
  await openRoles(page)
  const search = page.getByPlaceholder("搜索角色名称或编码")
  await search.fill("m1-role-140")
  const lastRole = page.getByRole("row").filter({ hasText: "角色 140" })
  await expect(lastRole).toBeVisible()
  await expect(page.getByText("共 1 条记录")).toBeVisible()

  await search.fill("")
  await expect(page.getByRole("row").filter({ hasText: "角色 000" })).toBeVisible()
  await expect(page.getByText("共 141 条记录")).toBeVisible()
  await expect(page.getByTitle("刷新列表")).toBeEnabled()
  mocks.failList()
  await page.getByTitle("刷新列表").click()
  await expect.poll(() => mocks.failedListRequests).toBeGreaterThan(0)
  await expect(page.getByText("角色列表暂时无法加载")).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "角色 000" })).toBeVisible()
})

test("deleting the only row on the last page moves back to the previous valid page", async ({ page }) => {
  await installMocks(page)
  await openRoles(page)
  await page.getByRole("button", { name: "末页" }).click()
  await expect(page.getByText("第 8 / 8 页")).toBeVisible()
  const lastRow = page.getByRole("row").filter({ hasText: "角色 140" })
  await expect(lastRow).toBeVisible()
  await lastRow.getByRole("button", { name: "角色 140 的操作" }).click()
  await page.getByRole("menuitem", { name: "删除角色" }).click()
  await expect(page.getByRole("alertdialog", { name: "删除角色「角色 140」？" })).toBeVisible()
  await page.getByRole("button", { name: "确认删除" }).click()
  await expect(page.getByText("第 7 / 7 页")).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "角色 139" })).toBeVisible()
})
