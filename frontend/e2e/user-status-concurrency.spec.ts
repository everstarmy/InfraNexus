import { expect, test, type Page, type Route } from "@playwright/test"

const userAID = "00000000-0000-4000-8000-000000000301"
const userBID = "00000000-0000-4000-8000-000000000302"

function envelope<T>(data: T, code = 200000, message = "success") {
  return { code, message, data, request_id: "playwright-m1" }
}

function user(id: string, username: string, status = 1, editRevision = 1) {
  return {
    id,
    edit_revision: editRevision,
    username,
    domain: "",
    email: `${username}@example.test`,
    nickname: username,
    status,
    auth_type: "local",
    built_in: false,
    department_id: null,
    roles: [],
  }
}

async function installMocks(page: Page, failUserA = false, delayMs = 0) {
  const users = new Map([
    [userAID, user(userAID, "alice")],
    [userBID, user(userBID, "bob")],
  ])
  const statusRequests: Array<{ id: string; status: number; expected_revision: number }> = []
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
    const json = (data: unknown, status = 200, code = status === 200 ? 200000 : status * 1000 + 1, message = "request failed") =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(envelope(data, code, message)) })

    if (path === "/auth/me" && request.method() === "GET") {
      return json({
        id: "00000000-0000-4000-8000-000000000401",
        username: "m1-admin",
        domain: "",
        email: "admin@example.test",
        nickname: "M1 管理员",
        status: 1,
        auth_type: "local",
        built_in: true,
        is_admin: true,
        permissions: ["org", "users", "users:status", "users:create", "users:update", "users:delete", "users:assign-roles", "users:move"],
        roles: [{ id: "00000000-0000-4000-8000-000000000402", code: "admin", name: "超级管理员" }],
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      })
    }
    if (path === "/users" && request.method() === "GET") {
      return json({ items: [...users.values()], total: users.size, page: 1, page_size: 10 })
    }
    if (path === "/users/stats" && request.method() === "GET") {
      const values = [...users.values()]
      const active = values.filter((item) => item.status === 1).length
      return json({ total: values.length, active, disabled: values.length - active, local: values.length, directory: 0, unassigned: values.length, by_domain: [] })
    }
    if (path === "/options/departments" && request.method() === "GET") return json([])
    if (path === "/options/roles" && request.method() === "GET") return json([])
    const statusMatch = path.match(/^\/users\/([^/]+)\/status$/)
    if (statusMatch && request.method() === "PATCH") {
      const id = statusMatch[1]
      const body = request.postDataJSON() as { status: number; expected_revision: number }
      statusRequests.push({ id, ...body })
      if (failUserA && id === userAID) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
        return json(null, 500, 500001, "simulated write failure")
      }
      const current = users.get(id)
      if (!current || current.edit_revision !== body.expected_revision) return json(null, 409, 409001, "revision conflict")
      const updated = { ...current, status: body.status, edit_revision: current.edit_revision + 1 }
      users.set(id, updated)
      return json(updated)
    }
    if (path === "/sse/notifications") return route.abort("failed")
    return json(null, 404, 404001, `unmocked API ${request.method()} ${path}`)
  })

  return { statusRequests }
}

async function openUsers(page: Page) {
  await page.goto("/users")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "alice" })).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "bob" })).toBeVisible()
}

test("a failed row mutation does not roll back another row's successful update", async ({ page }) => {
  const mocks = await installMocks(page, true, 350)
  await openUsers(page)
  const alice = page.getByRole("row").filter({ hasText: "alice" })
  const bob = page.getByRole("row").filter({ hasText: "bob" })
  const aliceSwitch = alice.getByRole("switch")
  const bobSwitch = bob.getByRole("switch")

  await aliceSwitch.click()
  await expect(aliceSwitch).toHaveAttribute("aria-checked", "false")
  await bobSwitch.click()
  await expect(bobSwitch).toHaveAttribute("aria-checked", "false")
  await expect(aliceSwitch).toHaveAttribute("aria-checked", "true")
  await expect(bobSwitch).toHaveAttribute("aria-checked", "false")

  expect(mocks.statusRequests).toEqual([
    { id: userAID, status: 2, expected_revision: 1 },
    { id: userBID, status: 2, expected_revision: 1 },
  ])
})

test("same-row status control stays pending and undo sends a new revision-checked request", async ({ page }) => {
  const mocks = await installMocks(page, false, 150)
  await openUsers(page)
  const aliceSwitch = page.getByRole("row").filter({ hasText: "alice" }).getByRole("switch")

  await aliceSwitch.click()
  await expect(aliceSwitch).toBeDisabled()
  await expect(aliceSwitch).toHaveAttribute("aria-checked", "false")
  await expect(aliceSwitch).toBeEnabled()
  await page.getByRole("button", { name: "撤销" }).click()
  await expect(aliceSwitch).toHaveAttribute("aria-checked", "true")

  expect(mocks.statusRequests).toEqual([
    { id: userAID, status: 2, expected_revision: 1 },
    { id: userAID, status: 1, expected_revision: 2 },
  ])
})
