import { expect, test, type Page, type Route } from "@playwright/test"

const roleAID = "00000000-0000-4000-8000-000000000001"
const roleBID = "00000000-0000-4000-8000-000000000002"
const permissionAID = "00000000-0000-4000-8000-000000000011"
const permissionBID = "00000000-0000-4000-8000-000000000012"

const permissionTree = [
  {
    id: "00000000-0000-4000-8000-000000000010",
    code: "users",
    name: "用户管理",
    type: "menu",
    children: [
      { id: permissionAID, code: "users:read", name: "读取用户", type: "button" },
      { id: permissionBID, code: "users:update", name: "更新用户", type: "button" },
    ],
  },
]

function envelope<T>(data: T, code = 200000, message = "success") {
  return { code, message, data, request_id: "playwright-m0" }
}

function role(id: string, name: string, permissions: string[], revision = 1) {
  return {
    id,
    edit_revision: revision,
    code: id === roleAID ? "auditor-a" : "auditor-b",
    name,
    status: 1,
    built_in: false,
    user_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    permissions: permissions.map((permissionId) => {
      const node = permissionTree[0].children.find((permission) => permission.id === permissionId)!
      return { ...node }
    }),
  }
}

type MockOptions = {
  treeFailure?: "403" | "500" | "offline"
  detailFailure?: "403" | "500" | "offline"
  conflictOnce?: boolean
}

async function installMocks(page: Page, options: MockOptions = {}) {
  const assignRequests: Array<{ body: Record<string, unknown>; status: number }> = []
  let roleAReads = 0
  let assignCalls = 0

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
        queueMicrotask(() => {
          this.onopen?.(new Event("open"))
          this.dispatchEvent(new MessageEvent("connected", { data: JSON.stringify({ message: "connected" }) }))
        })
      }
      close() {}
      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
        super.addEventListener(type, listener, options)
      }
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
        id: "00000000-0000-4000-8000-000000000101",
        username: "m0-reviewer",
        domain: "",
        email: "reviewer@example.test",
        nickname: "M0 审核员",
        status: 1,
        auth_type: "local",
        built_in: false,
        is_admin: false,
        permissions: ["access", "users", "roles", "roles:assign"],
        roles: [{ id: "00000000-0000-4000-8000-000000000201", code: "reviewer", name: "审核员" }],
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      })
    }

    if (path === "/roles" && request.method() === "GET") {
      return json({ items: [role(roleAID, "审计员 A", [permissionAID]), role(roleBID, "审计员 B", [permissionBID])], total: 2, page: 1, page_size: 20 })
    }

    if (path === "/users" && request.method() === "GET") return json({ items: [], total: 0, page: 1, page_size: 10 })
    if (path === "/users/stats" && request.method() === "GET") return json({ total: 0, active: 0, disabled: 0, local: 0, directory: 0, unassigned: 0, by_domain: [] })
    if (path === "/options/departments" && request.method() === "GET") return json({ revision: 1, items: [] })
    if (path === "/options/roles" && request.method() === "GET") return json([])

    if (path === "/roles/permission-tree" && request.method() === "GET") {
      if (options.treeFailure === "offline") return route.abort("failed")
      if (options.treeFailure) {
        const status = options.treeFailure === "403" ? 403 : 500
        return json(null, status, status * 1000 + 1, "permission tree unavailable")
      }
      return json(permissionTree)
    }

    const detailMatch = path.match(/^\/roles\/([^/]+)$/)
    if (detailMatch && request.method() === "GET") {
      if (options.detailFailure === "offline") return route.abort("failed")
      if (options.detailFailure) {
        const status = options.detailFailure === "403" ? 403 : 500
        return json(null, status, status * 1000 + 1, "role detail unavailable")
      }
      if (detailMatch[1] === roleAID) {
        roleAReads += 1
        const currentPermissions = options.conflictOnce && roleAReads > 1 ? [permissionBID] : [permissionAID]
        return json(role(roleAID, "审计员 A", currentPermissions, options.conflictOnce && roleAReads > 1 ? 2 : 1))
      }
      return json(role(roleBID, "审计员 B", [permissionBID]))
    }

    const assignMatch = path.match(/^\/roles\/([^/]+)\/permissions$/)
    if (assignMatch && request.method() === "POST") {
      assignCalls += 1
      const body = request.postDataJSON() as Record<string, unknown>
      if (options.conflictOnce && assignCalls === 1) {
        assignRequests.push({ body, status: 409 })
        return json(null, 409, 409001, "role authorization changed")
      }
      assignRequests.push({ body, status: 200 })
      return json({ assigned: true })
    }

    if (path === "/sse/notifications") return route.abort("failed")
    return json(null, 404, 404001, `unmocked API ${request.method()} ${path}`)
  })

  return {
    assignRequests,
    get assignCalls() { return assignCalls },
  }
}

async function openPermissionDialog(page: Page, roleName = "审计员 A") {
  await page.goto("/roles")
  await expect(page.getByRole("heading", { name: "角色管理" })).toBeVisible()
  const row = page.getByRole("row").filter({ hasText: roleName })
  await expect(row).toBeVisible()
  await row.getByText(roleName, { exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByRole("button", { name: "保存授权" })).toBeVisible()
}

for (const failure of ["403", "500", "offline"] as const) {
  test(`permission-tree ${failure} failure keeps save disabled and sends no assignment`, async ({ page }, testInfo) => {
    const mocks = await installMocks(page, { treeFailure: failure })
    await openPermissionDialog(page)
    await expect(page.getByRole("alert")).toBeVisible()
    await expect(page.getByRole("button", { name: "保存授权" })).toBeDisabled()
    expect(mocks.assignCalls).toBe(0)
    if (failure === "403") {
      await page.screenshot({ path: testInfo.outputPath("permission-tree-403-save-disabled.png") })
    }
  })
}

test("role-detail failure also prevents empty authorization submission", async ({ page }) => {
  const mocks = await installMocks(page, { detailFailure: "500" })
  await openPermissionDialog(page)
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page.getByRole("button", { name: "保存授权" })).toBeDisabled()
  expect(mocks.assignCalls).toBe(0)
})

test("switching roles initializes from the new role's saved permissions", async ({ page }) => {
  const mocks = await installMocks(page)
  await openPermissionDialog(page, "审计员 A")
  await expect(page.getByText("读取用户", { exact: true })).toBeVisible()
  await expect(page.getByText("已选").locator("..", {}).getByText("1", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "取消" }).click()

  await page.getByRole("row").filter({ hasText: "审计员 B" }).getByText("审计员 B", { exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page.getByText("更新用户", { exact: true })).toBeVisible()
  const readUserCheckbox = page.locator("label").filter({ hasText: "读取用户" }).locator('[role="checkbox"]', {})
  const updateUserCheckbox = page.locator("label").filter({ hasText: "更新用户" }).locator('[role="checkbox"]', {})
  await expect(readUserCheckbox).toHaveAttribute("aria-checked", "false")
  await expect(updateUserCheckbox).toHaveAttribute("aria-checked", "true")
  expect(mocks.assignCalls).toBe(0)
})

test("filtered permission actions leave hidden assignments untouched and report mixed state", async ({ page }) => {
  await installMocks(page)
  await openPermissionDialog(page)

  const moduleCheckbox = page.locator("label").filter({ hasText: "用户管理" }).first().locator('[role="checkbox"]')
  await expect(moduleCheckbox).toHaveAttribute("aria-checked", "mixed")
  await page.getByPlaceholder("按名称、编码或接口路径过滤").fill("users:update")
  await page.getByRole("button", { name: "选中「用户管理」的匹配结果" }).click()

  const readUserCheckbox = page.locator("label").filter({ hasText: "读取用户" }).locator('[role="checkbox"]')
  const updateUserCheckbox = page.locator("label").filter({ hasText: "更新用户" }).locator('[role="checkbox"]')
  await expect(readUserCheckbox).toHaveCount(0)
  await expect(updateUserCheckbox).toHaveAttribute("aria-checked", "true")
  await expect(page.getByText("当前显示匹配结果及其上级节点；勾选、全选、反选和清空只作用于可见结果，隐藏权限保持不变。")).toBeVisible()

  await page.getByRole("button", { name: "清空「用户管理」的匹配结果" }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  await page.getByRole("alertdialog").getByRole("button", { name: "清空权限" }).click()
  await expect(updateUserCheckbox).toHaveAttribute("aria-checked", "false")
  await page.getByPlaceholder("按名称、编码或接口路径过滤").fill("")
  await expect(readUserCheckbox).toHaveAttribute("aria-checked", "true")
})

test("dirty permission draft confirms Escape close and restores keyboard focus on cancel", async ({ page }) => {
  await installMocks(page)
  await openPermissionDialog(page)
  const updateUserCheckbox = page.locator("label").filter({ hasText: "更新用户" }).locator('[role="checkbox"]')
  await updateUserCheckbox.click()

  await page.keyboard.press("Escape")
  const confirmation = page.getByRole("alertdialog")
  await expect(confirmation.getByText("放弃授权草稿？")).toBeVisible()
  await confirmation.getByRole("button", { name: "取消" }).click()
  await expect(page.getByRole("dialog", { name: "为「审计员 A」分配权限" })).toBeVisible()
  await expect(updateUserCheckbox).toBeFocused()

  const unloadWasPrevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(unloadWasPrevented).toBe(true)

  await page.mouse.click(1, 1)
  await expect(page.getByRole("alertdialog").getByText("放弃授权草稿？")).toBeVisible()
  await page.getByRole("alertdialog").getByRole("button", { name: "取消" }).click()
  await expect(page.getByRole("dialog", { name: "为「审计员 A」分配权限" })).toBeVisible()

  await page.keyboard.press("Escape")
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃更改" }).click()
  await expect(page.getByRole("dialog", { name: "为「审计员 A」分配权限" })).toBeHidden()
})

test("dirty permission draft blocks browser back until the user confirms leaving", async ({ page }) => {
  await installMocks(page)
  await page.goto("/users")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await page.getByRole("link", { name: "角色管理" }).click()
  await expect(page.getByRole("heading", { name: "角色管理" })).toBeVisible()
  const roleRow = page.getByRole("row").filter({ hasText: "审计员 A" })
  await expect(roleRow).toBeVisible()
  await roleRow.getByText("审计员 A", { exact: true }).click()
  await expect(page.getByRole("dialog", { name: "为「审计员 A」分配权限" })).toBeVisible()
  await page.getByText("更新用户", { exact: true }).click()
  await expect(page.getByText("新增 1 · 移除 0")).toBeVisible()

  await page.evaluate(() => window.history.back())
  await expect(page.getByRole("alertdialog").getByText("离开当前页面？")).toBeVisible()
  await page.getByRole("alertdialog").getByRole("button", { name: "取消" }).click()
  await expect(page).toHaveURL(/\/roles$/)
  await expect(page.getByRole("dialog", { name: "为「审计员 A」分配权限" })).toBeVisible()

  await page.evaluate(() => window.history.back())
  await page.getByRole("alertdialog").getByRole("button", { name: "放弃更改" }).click()
  await expect(page).toHaveURL(/\/users$/)
})

test("concurrent administrator update preserves the draft and requires explicit acknowledgement", async ({ page }) => {
  const mocks = await installMocks(page, { conflictOnce: true })
  await openPermissionDialog(page)
  await page.getByText("更新用户", { exact: true }).click()
  await expect(page.getByText("新增 1 · 移除 0")).toBeVisible()
  await page.getByRole("button", { name: "保存授权" }).click()

  await expect(page.getByText(/服务器授权已更新到版本 2/)).toBeVisible()
  await expect(page.getByText(/新增 1、移除 0/)).toBeVisible()
  const readUserCheckbox = page.locator("label").filter({ hasText: "读取用户" }).locator('[role="checkbox"]')
  const updateUserCheckbox = page.locator("label").filter({ hasText: "更新用户" }).locator('[role="checkbox"]')
  await expect(readUserCheckbox).toHaveAttribute("aria-checked", "true")
  await expect(updateUserCheckbox).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("button", { name: "保存授权" })).toBeDisabled()

  await page.getByRole("button", { name: "使用最新授权" }).click()
  await expect(readUserCheckbox).toHaveAttribute("aria-checked", "false")
  await expect(updateUserCheckbox).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("button", { name: "保存授权" })).toBeDisabled()
  await page.getByText("读取用户", { exact: true }).click()
  await page.getByRole("button", { name: "保留草稿并继续" }).click()
  await expect(page.getByRole("button", { name: "保存授权" })).toBeEnabled()
  await page.getByRole("button", { name: "保存授权" }).click()
  await expect(page.getByRole("dialog", { name: "为「审计员 A」分配权限" })).toBeHidden()

  expect(mocks.assignRequests).toHaveLength(2)
  expect(mocks.assignRequests[0].status).toBe(409)
  expect(mocks.assignRequests[1].status).toBe(200)
  expect(mocks.assignRequests[1].body.expected_revision).toBe(2)
  expect(mocks.assignRequests[1].body.permission_ids).toEqual(expect.arrayContaining([permissionAID, permissionBID]))
  expect(mocks.assignRequests[1].body.permission_ids).toHaveLength(2)
})
