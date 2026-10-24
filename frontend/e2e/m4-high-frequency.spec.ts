import { expect, test, type Page, type Route } from "@playwright/test"

function envelope<T>(data: T, status = 200, message = status === 200 ? "success" : "request failed") {
  return {
    code: status === 200 ? 200000 : status * 1000 + 1,
    message,
    data,
    request_id: "playwright-m4",
  }
}

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`
}

function makeUser(index: number) {
  return {
    id: uuid(index),
    edit_revision: 1,
    username: `m4-user-${index.toString().padStart(2, "0")}`,
    domain: "",
    email: `m4-user-${index}@example.test`,
    nickname: `用户 ${index.toString().padStart(2, "0")}`,
    status: 1,
    auth_type: "local",
    built_in: false,
    department_id: null,
    department: null,
    roles: [],
    created_at: "2026-10-01T00:00:00Z",
    last_login_at: null,
  }
}

function makeDepartment(id: number, name: string, code: string, parentId: string | null, children: ReturnType<typeof makeDepartment>[] = []) {
  return {
    id: uuid(id),
    parent_id: parentId,
    leader_id: null,
    leader_name: "",
    name,
    code,
    sort_order: id * 10,
    phone: "",
    email: "",
    status: 1,
    source: "local",
    tree_path: parentId ? `0/${parentId}/${uuid(id)}` : `0/${uuid(id)}`,
    depth: parentId ? 2 : 1,
    member_count: 0,
    total_member_count: 2,
    children,
  }
}

async function installMocks(
  page: Page,
  options: { permissions?: string[]; conflictFirstNicknameUpdate?: boolean; departmentCount?: number } = {},
) {
  const users = Array.from({ length: 12 }, (_, index) => makeUser(index + 1))
  let departments = [
    makeDepartment(101, "研发部", "rd", null, [
      makeDepartment(102, "工程中心", "engineering", uuid(101), [
        makeDepartment(103, "工程平台", "engineering-platform", uuid(102)),
      ]),
      makeDepartment(104, "产品中心", "product", uuid(101)),
    ]),
    makeDepartment(201, "业务部", "business", null, [
      makeDepartment(202, "销售中心", "sales", uuid(201)),
    ]),
  ]
  if (options.departmentCount) departments = Array.from({ length: options.departmentCount }, (_, i) => makeDepartment(1000 + i, `虚拟部门 ${i}`, `virtual-${i}`, null))
  let treeRevision = 7
  let failFirstNicknameUpdate = !!options.conflictFirstNicknameUpdate
  const profileUpdates: Array<{ id: string; expected_revision?: number; nickname?: string }> = []
  const commandUserSearches: string[] = []
  const relativeMoves: Array<{ id: string; target_id: string; position: string; expected_revision: number }> = []

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
        queueMicrotask(() => this.onopen?.(new Event("open")))
      }
      close() { this.readyState = MockEventSource.CLOSED }
    }
    window.EventSource = MockEventSource as unknown as typeof EventSource
  })

  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api\/v1/, "")
    const json = (data: unknown, status = 200, message?: string) => route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(envelope(data, status, message)),
    })

    if (path === "/auth/me" && request.method() === "GET") {
      return json({
        id: uuid(900), username: "m4-reviewer", email: "reviewer@example.test", nickname: "M4 审查员",
        status: 1, auth_type: "local", built_in: true, is_admin: false,
        permissions: options.permissions ?? ["*"],
        roles: [], preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      })
    }
    if (path === "/auth/domains") return json([])
    if (path === "/sse/notifications") return route.abort("failed")
    if (path === "/dashboard/overview") return json({
      users: { total: users.length, active: users.length, disabled: 0, local: users.length, directory: 0, unassigned: users.length, by_domain: [] },
      departments: { total: 2, enabled: 2, disabled: 0, from_directory: 0 },
      roles: { total: 0, built_in: 0 }, permissions: { menus: 2, buttons: 1, apis: 3 },
      directories: [], recent_syncs: [],
    })
    if (path === "/users/stats") return json({ total: users.length, active: users.length, disabled: 0, local: users.length, directory: 0, unassigned: users.length, by_domain: [] })
    if (path === "/options/departments") return json({ revision: treeRevision, items: departments })
    if (path === "/options/roles") return json([])
    if (path === "/departments/tree") return json({ revision: treeRevision, items: departments })
    if (path === "/departments" && request.method() === "GET") return json({ items: departments, total: departments.length, page: 1, page_size: 100 })

    if (path === "/users" && request.method() === "GET") {
      const keyword = (url.searchParams.get("keyword") ?? "").toLocaleLowerCase()
      if (url.searchParams.get("page_size") === "8" && keyword) commandUserSearches.push(keyword)
      const filtered = users.filter((user) => `${user.username} ${user.nickname} ${user.email}`.toLocaleLowerCase().includes(keyword))
      const currentPage = Number(url.searchParams.get("page") ?? 1)
      const pageSize = Number(url.searchParams.get("page_size") ?? 10)
      return json({ items: filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize), total: filtered.length, page: currentPage, page_size: pageSize })
    }
    const userMatch = path.match(/^\/users\/([^/]+)$/)
    if (userMatch && request.method() === "GET") {
      const user = users.find((item) => item.id === userMatch[1])
      return user ? json(user) : json(null, 404)
    }
    if (userMatch && request.method() === "PUT") {
      const body = request.postDataJSON() as { nickname?: string; expected_revision?: number }
      profileUpdates.push({ id: userMatch[1], ...body })
      const user = users.find((item) => item.id === userMatch[1])
      if (!user) return json(null, 404)
      if (failFirstNicknameUpdate) {
        failFirstNicknameUpdate = false
        user.nickname = "并发更新版本"
        user.edit_revision += 1
        return json(null, 409, "profile revision conflict")
      }
      if (body.expected_revision !== user.edit_revision) return json(null, 409, "profile revision conflict")
      user.nickname = body.nickname ?? user.nickname
      user.edit_revision += 1
      return json(user)
    }

    const moveMatch = path.match(/^\/departments\/([^/]+)\/move$/)
    if (moveMatch && request.method() === "POST") {
      const body = request.postDataJSON() as { target_id: string; position: string; expected_revision: number }
      relativeMoves.push({ id: moveMatch[1], ...body })
      if (body.expected_revision !== treeRevision) return json(null, 409, "tree revision conflict")
      const moving = findDepartment(departments, moveMatch[1])
      const target = findDepartment(departments, body.target_id)
      if (!moving || !target) return json(null, 404)
      removeDepartment(departments, moving.id)
      const destination = findDepartment(departments, target.parent_id ?? "")
      const siblings = destination ? destination.children : departments
      const targetIndex = siblings.findIndex((node) => node.id === target.id)
      siblings.splice(targetIndex + (body.position === "after" ? 1 : 0), 0, moving)
      moving.parent_id = target.parent_id
      treeRevision += 1
      return json(moving)
    }

    return json(null, 404, `unmocked ${request.method()} ${path}`)
  })

  return { users, profileUpdates, commandUserSearches, relativeMoves }
}

function findDepartment(nodes: ReturnType<typeof makeDepartment>[], id: string) {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findDepartment(node.children, id)
    if (found) return found
  }
  return undefined
}

function removeDepartment(nodes: ReturnType<typeof makeDepartment>[], id: string) {
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].id === id) {
      const [removed] = nodes.splice(index, 1)
      return removed
    }
    const removed = removeDepartment(nodes[index].children, id)
    if (removed) return removed
  }
  return undefined
}

test("user tables keep Shift selection page-scoped, expose keyboard sizing, and persist user-specific layout", async ({ page }) => {
  const mocks = await installMocks(page)
  await page.goto("/users")
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "m4-user-01" })).toBeVisible()

  const rowChecks = page.getByRole("checkbox", { name: "勾选该行；按住 Shift 可连续选择" })
  await rowChecks.nth(0).click()
  await rowChecks.nth(2).click({ modifiers: ["Shift"] })
  await expect(page.getByRole("region", { name: "批量操作" })).toContainText("已勾选 3 条")
  await page.getByTitle("下一页").click()
  await expect(page.getByText("第 2 / 2 页")).toBeVisible()
  await expect(page.getByRole("region", { name: "批量操作" })).toHaveCount(0)

  const resizeHandle = page.getByRole("separator", { name: "调整username列宽" })
  await resizeHandle.focus()
  await resizeHandle.press("End")
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "420")
  await resizeHandle.press("Home")
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "280")

  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
  await page.getByRole("checkbox", { name: "显示最近登录", exact: true }).click()
  await expect(page.getByRole("columnheader", { name: "最近登录" })).toHaveCount(0)
  const preferenceKey = `infranexus:table:${uuid(900)}:users:v1`
  const savedPreference = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), preferenceKey)
  expect(savedPreference.columnVisibility.last_login_at).toBe(false)
  expect(JSON.stringify(savedPreference)).not.toContain("m4-user")
  await page.reload()
  await expect(page.getByRole("columnheader", { name: "最近登录" })).toHaveCount(0)
  expect(mocks.users).toHaveLength(12)
})

test("inline nickname edit keeps its draft after a revision conflict and retries against the latest revision", async ({ page }) => {
  const mocks = await installMocks(page, { conflictFirstNicknameUpdate: true })
  await page.goto("/users")
  const firstRow = page.getByRole("row").filter({ hasText: "m4-user-01" })
  await firstRow.getByRole("button", { name: "编辑 用户 01 的昵称" }).click()
  const input = page.getByRole("textbox", { name: "编辑 m4-user-01 的昵称" })
  await input.fill("草稿昵称")
  await input.press("Enter")
  await expect(page.getByRole("alert").filter({ hasText: "草稿已保留" })).toBeVisible()
  await expect(input).toHaveValue("草稿昵称")
  await expect.poll(() => mocks.profileUpdates.length).toBe(1)
  await page.getByRole("button", { name: "保存昵称" }).click()
  await expect(firstRow.getByText("草稿昵称")).toBeVisible()
  expect(mocks.profileUpdates.map((item) => item.expected_revision)).toEqual([1, 2])
})

test("department tree supports roving keyboard search and revision-safe relative drag moves", async ({ page }) => {
  const mocks = await installMocks(page)
  await page.goto("/departments")
  const search = page.getByRole("textbox", { name: "搜索部门名称或编码" })
  await search.fill("工程")
  await expect(page.getByRole("status").filter({ hasText: "找到 2 个部门" })).toBeVisible()
  await page.getByRole("button", { name: "下一处" }).click()
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.currentMatch)).toBe("true")
  await expect(page.getByRole("status").filter({ hasText: "2/2" })).toBeVisible()

  await search.fill("")
  const root = page.locator(`[data-tree-focus="${uuid(101)}"]`)
  await root.focus()
  await root.press("ArrowDown")
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.treeFocus)).toBe(uuid(102))

  await expect(page.locator(`[data-tree-focus="${uuid(202)}"]`)).toBeVisible()
  const dragSource = page.locator(`[data-department-tree-row="${uuid(102)}"]`)
  const dragTarget = page.locator(`[data-department-tree-row="${uuid(202)}"]`)
  await expect(dragSource).toHaveAttribute("draggable", "true")
  await page.evaluate(({ sourceId, targetId }) => {
    const source = document.querySelector<HTMLElement>(`[data-department-tree-row="${sourceId}"]`)
    const target = document.querySelector<HTMLElement>(`[data-department-tree-row="${targetId}"]`)
    if (!source || !target) throw new Error("department drag rows are not mounted")
    const dataTransfer = new DataTransfer()
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }))
    const targetBounds = target.getBoundingClientRect()
    const clientY = targetBounds.top + 6
    const dragOver = new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer, clientY })
    target.dispatchEvent(dragOver)
    if (!dragOver.defaultPrevented) throw new Error("department row did not accept a valid drag target")
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer, clientY }))
  }, { sourceId: uuid(102), targetId: uuid(202) })
  await expect(page.getByRole("alertdialog", { name: "确认移动部门「工程中心」？" })).toBeVisible()
  await page.getByRole("button", { name: "确认移动" }).click()
  await expect.poll(() => mocks.relativeMoves.length).toBe(1)
  expect(mocks.relativeMoves[0]).toEqual({ id: uuid(102), target_id: uuid(202), position: "before", expected_revision: 7 })
})

test("department actions stay visible and usable on touch screens", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  try {
    await installMocks(page)
    await page.goto("/departments")
    const row = page.locator(`[data-department-tree-row="${uuid(101)}"]`)
    const trigger = page.getByRole("button", { name: "研发部 的操作" })
    await expect(row).toBeVisible()
    await expect(trigger).toBeVisible()
    expect(await trigger.evaluate((element) => getComputedStyle(element.parentElement!).opacity)).toBe("1")
    await trigger.tap()
    await expect(page.getByRole("menuitem", { name: "移动到…" })).toBeVisible()
  } finally {
    await context.close()
  }
})

test("command palette searches entities only with exact API permissions and honors shortcut scope", async ({ page }) => {
  const allowed = [
    "dashboard", "users", "departments", "roles", "permissions",
    "api:GET:/api/v1/users", "api:GET:/api/v1/users/:id", "api:GET:/api/v1/departments/tree",
    "users:create", "departments:create", "roles:create",
  ]
  const mocks = await installMocks(page, { permissions: allowed })
  await page.goto("/dashboard")
  await expect(page.getByRole("button", { name: /搜索页面与操作/ }).first()).toBeVisible()
  await page.keyboard.press("Control+k")
  const input = page.getByPlaceholder("搜索页面、用户、部门或操作…")
  await expect(input).toBeFocused()
  await page.keyboard.press("Control+k")
  await expect(page.getByRole("dialog", { name: "全局导航" })).toBeVisible()
  await input.fill("m4-user-01")
  await expect.poll(() => mocks.commandUserSearches.length).toBe(1)
  await page.getByRole("option", { name: /用户 01/ }).click()
  await expect(page.getByText("m4-user-1@example.test", { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), `infranexus:command-recent-routes:v1:${uuid(900)}`)).toContain("/users")

  const denied = await page.context().newPage()
  const deniedMocks = await installMocks(denied, { permissions: ["dashboard"] })
  await denied.goto("/dashboard")
  await expect(denied.getByRole("button", { name: /搜索页面与操作/ }).first()).toBeVisible()
  await denied.keyboard.press("Control+k")
  await denied.getByPlaceholder("搜索页面、用户、部门或操作…").fill("m4-user-01")
  await expect(denied.getByText("当前账号没有用户或部门搜索权限。" )).toBeVisible()
  await expect.poll(() => deniedMocks.commandUserSearches.length).toBe(0)
})

test("department drag keeps its source mounted across virtual windows and scrolls at edges", async ({
  page,
}) => {
  const mocks = await installMocks(page, { departmentCount: 400 });
  await page.goto("/departments");
  const sourceId = uuid(1000),
    targetId = uuid(1150);
  const source = page.locator(`[data-department-tree-row="${sourceId}"]`);
  await expect(source).toBeVisible();
  const first = page.locator(`[data-tree-focus="${sourceId}"]`);
  const last = page.locator(`[data-tree-focus="${uuid(1399)}"]`);
  await first.focus();
  await first.press("End");
  await expect(last).toBeFocused();
  await last.press("Home");
  await expect(first).toBeFocused();
  await page.evaluate((id) => {
    const row = document.querySelector<HTMLElement>(
      `[data-department-tree-row="${id}"]`,
    )!;
    let scroll = row.parentElement!;
    while (
      scroll &&
      !["auto", "scroll"].includes(getComputedStyle(scroll).overflowY)
    )
      scroll = scroll.parentElement!;
    if (!scroll) throw new Error("tree has no scroll container");
    const transfer = new DataTransfer();
    (window as any).__treeDrag = {
      row,
      scroll,
      transfer,
      initial: scroll.scrollTop,
    };
    row.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
  }, sourceId);
  // Wait for the drag lifecycle to mount its edge-scroll listener.
  await expect(
    page.getByRole("status").filter({ hasText: "正在拖动" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const { scroll, transfer } = (window as any).__treeDrag;
    const bounds = scroll.getBoundingClientRect();
    scroll.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: bounds.left + 20,
        clientY: bounds.bottom - 5,
      }),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { scroll, initial } = (window as any).__treeDrag;
        return scroll.scrollTop > initial;
      }),
    )
    .toBe(true);
  await page.evaluate(() => {
    const { scroll, transfer } = (window as any).__treeDrag;
    document.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        dataTransfer: transfer,
        clientX: -1,
        clientY: -1,
      }),
    );
    scroll.scrollTop = 150 * 34;
  });
  const target = page.locator(`[data-department-tree-row="${targetId}"]`);
  await expect(target).toBeAttached();
  expect(
    await page.evaluate(() => (window as any).__treeDrag.row.isConnected),
  ).toBe(true);
  await page.evaluate((id) => {
    const target = document.querySelector<HTMLElement>(
      `[data-department-tree-row="${id}"]`,
    )!;
    const { transfer } = (window as any).__treeDrag;
    const bounds = target.getBoundingClientRect();
    target.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientY: bounds.top + 4,
      }),
    );
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientY: bounds.top + 4,
      }),
    );
  }, targetId);
  await expect(
    page.getByRole("alertdialog", { name: "确认移动部门「虚拟部门 0」？" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认移动" }).click();
  await expect.poll(() => mocks.relativeMoves.length).toBe(1);
  expect(mocks.relativeMoves[0]).toEqual({
    id: sourceId,
    target_id: targetId,
    position: "before",
    expected_revision: 7,
  });
});
