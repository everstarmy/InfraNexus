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
    if (path.endsWith("/auth/setup")) return route.fulfill({ json: { code: 200000, data: { initialized: true } } })
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

test("user tables retain selection across pages, expose keyboard sizing, and persist user-specific layout", async ({ page }) => {
  const mocks = await installMocks(page)
  await page.goto("/users")
  await expect(page.getByRole("heading", { name: "全部人员", exact: true })).toBeVisible()
  await expect(page.getByRole("row").filter({ hasText: "m4-user-01" })).toBeVisible()

  const rowChecks = page.getByRole("checkbox", { name: "勾选该行；按住 Shift 可连续选择" })
  await rowChecks.nth(0).click()
  await rowChecks.nth(2).click({ modifiers: ["Shift"] })
  await expect(page.getByRole("button", { name: "批量操作", exact: true })).toContainText("已选 3 条")
  await page.getByTitle("下一页").click()
  await expect(page.getByText("第 2 / 2 页")).toBeVisible()
  await expect(page.getByRole("button", { name: "批量操作", exact: true })).toContainText("已选 3 条")
  await expect(page.getByRole("checkbox", { name: "勾选该行；按住 Shift 可连续选择" }).first()).not.toBeChecked()
  await page.getByRole("button", { name: "取消选择", exact: true }).click()

  const resizeHandle = page.getByRole("separator", { name: "调整username列宽" })
  await resizeHandle.focus()
  await resizeHandle.press("End")
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "420")
  await resizeHandle.press("Home")
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "280")

  await page.getByRole("button", { name: "表格设置" }).click()
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
  const resizeErrors: string[] = []
  page.on('pageerror', error => { if (error.message.includes('ResizeObserver')) resizeErrors.push(error.message) })
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
  await page.getByRole("button", { name: "重新加载并核对最新版本" }).click()
  await page.getByRole("button", { name: "保存昵称" }).click()
  await expect(firstRow.getByText("草稿昵称")).toBeVisible()
  expect(mocks.profileUpdates.map((item) => item.expected_revision)).toEqual([1, 2])
  await expect(page.locator('[data-slot="toast-content"]').first()).toBeVisible()
  await page.waitForTimeout(200) // Cover the toast height transition, where the feedback loop occurred.
  expect(resizeErrors).toEqual([])
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

test("table M4 keeps drafts across pages and guards navigation without autosaving", async ({ page }) => {
 const mocks=await installMocks(page)
 await page.goto("/users")
 await page.getByRole("button",{name:"编辑 用户 01 的昵称",exact:true}).click()
 const input=page.getByRole("textbox",{name:"编辑 m4-user-01 的昵称",exact:true})
 await input.fill("跨页草稿")
 await input.press("Tab")
 expect(mocks.profileUpdates).toHaveLength(0)
 await page.getByRole("button",{name:"下一页",exact:true}).click()
 await expect(page.getByRole("row").filter({hasText:"m4-user-11"})).toBeVisible()
 await expect(page.getByText(/有 1 行编辑草稿/)).toBeVisible()
 await page.getByRole("button",{name:"上一页",exact:true}).click()
 await expect(input).toHaveValue("跨页草稿")
 await page.getByRole("link",{name:"角色管理",exact:true}).click()
 await expect(page.getByRole("alertdialog")).toContainText("离开当前页面")
 await page.getByRole("button",{name:"取消",exact:true}).click()
 await expect(input).toHaveValue("跨页草稿")
 await input.press("Escape")
 await expect(page.getByText(/有 1 行编辑草稿/)).toHaveCount(0)
 expect(mocks.profileUpdates).toHaveLength(0)
})

test("table details remain independent and optional grouping stays current-page", async ({ page }) => {
 await installMocks(page)
 let loads=0
 let failDetails=true
 await page.route(`**/api/v1/users/${uuid(1)}`,async route=>{loads++;if(failDetails)return route.fulfill({status:500,json:envelope(null,500)});return route.fulfill({json:envelope(makeUser(1))})})
 await page.goto("/users")
 const row=page.getByRole("row").filter({hasText:"m4-user-01"})
 await row.getByRole("button",{name:"展开行详情",exact:true}).click()
 await expect(page.getByRole("button",{name:"重试详情",exact:true})).toBeVisible()
 failDetails=false
 await page.getByRole("button",{name:"重试详情",exact:true}).click()
 await expect(page.getByRole("definition").filter({hasText:"m4-user-1@example.test"})).toBeVisible()
 const loadedCount=loads
 await row.getByRole("button",{name:"收起行详情",exact:true}).click()
 await row.getByRole("button",{name:"展开行详情",exact:true}).click()
 expect(loads).toBe(loadedCount)
 await page.getByRole("button", {name:"更多表格操作"}).click()
 await page.getByRole("button",{name:"按来源分组（当前页）",exact:true}).click()
 await page.keyboard.press("Escape")
 await expect(page.getByRole("cell",{name:"身份来源：local · 当前页 10 条",exact:true})).toBeVisible()
 await expect(page.getByText(/共 10 人.*不代表全量/)).toHaveCount(0)
})

test("table M4 lazy permission roots retain paths and retry children without counting them as roots", async ({page})=>{
 await installMocks(page)
 const root={id:uuid(500),name:"根权限",code:"root",type:"menu",has_children:true}
 const child={id:uuid(501),name:"子权限",code:"child",type:"button",has_children:true}
 let childLoads=0
 await page.route("**/api/v1/permissions",route=>route.fulfill({json:envelope([])}))
 await page.route("**/api/v1/permissions/nodes?*",route=>{
  const url=new URL(route.request().url());const parent=url.searchParams.get("parent_id")
  if(parent===root.id){childLoads++;if(childLoads===1)return route.fulfill({status:500,json:envelope(null,500)})}
  const items=parent===root.id?[child]:parent===child.id?[]:[root]
  return route.fulfill({json:envelope({items,total:items.length,root_total:1,matched_nodes:1,retained_nodes:2,page:1,page_size:20})})
 })
 await page.goto("/permissions")
 await page.getByRole("button",{name:"按需浏览权限节点",exact:true}).click()
 await expect(page.getByText("子权限",{exact:true})).toHaveCount(0)
 await page.getByRole("button",{name:"展开 根权限",exact:true}).click()
 await page.getByRole("button",{name:"加载失败，重试（单级最多 500 项）",exact:true}).click()
 await expect(page.getByText("子权限",{exact:true})).toBeVisible()
 await expect(page.getByText(/根节点 1 · 直接匹配 1 · 含祖先 2/)).toBeVisible()
 await page.getByRole("button",{name:"展开 子权限",exact:true}).click()
 await expect(page.getByText("无匹配子节点",{exact:true})).toBeVisible()
 await page.getByRole("button",{name:"收起 根权限",exact:true}).click()
 await page.getByRole("button",{name:"展开 根权限",exact:true}).click()
 await expect(page.getByText("子权限",{exact:true})).toBeVisible()
 expect(childLoads).toBe(2)
 await page.getByRole("textbox",{name:"搜索权限路径（保留祖先）",exact:true}).pressSequentially("child")
 await expect(page.getByRole("textbox",{name:"搜索权限路径（保留祖先）",exact:true})).toHaveValue("child")
 await page.screenshot({path:"/tmp/infranexus-m4-tree.png",fullPage:true})
})

test("table M4 holds refreshed rows while selected until explicit acceptance", async ({page})=>{
 const mocks=await installMocks(page)
 await page.goto("/users")
 await page.getByRole("checkbox",{name:"勾选该行；按住 Shift 可连续选择"}).first().click()
 mocks.users[0].nickname="后台新昵称"
 await page.getByRole("button",{name:"刷新",exact:true}).click()
 await expect(page.getByRole("button",{name:"有新数据，点击更新表格（草稿保留）",exact:true})).toBeVisible()
 await expect(page.getByText("后台新昵称",{exact:true})).toHaveCount(0)
 await page.getByRole("button",{name:"有新数据，点击更新表格（草稿保留）",exact:true}).click()
 await expect(page.getByText("后台新昵称",{exact:true})).toBeVisible()
})

test("table M4 preserves failed drafts, blocks duplicate writes and reacts to permission loss", async ({page})=>{
 await page.clock.install()
 const permissions=["*"]
 await installMocks(page,{permissions})
 let writes=0
 let release: (()=>void)|undefined
 await page.route(`**/api/v1/users/${uuid(1)}`,async route=>{
  if(route.request().method()!=="PUT")return route.fallback()
  writes++
  await new Promise<void>(resolve=>{release=resolve})
  return route.fulfill({status:503,json:envelope(null,503)})
 })
 await page.goto("/users")
 await page.getByRole("button",{name:"编辑 用户 01 的昵称",exact:true}).click()
 const input=page.getByRole("textbox",{name:"编辑 m4-user-01 的昵称",exact:true})
 await input.fill("失败草稿")
 await input.press("Enter")
 await expect.poll(()=>writes).toBe(1)
 await expect(page.getByRole("button",{name:"保存昵称",exact:true})).toBeDisabled()
 await expect(page.getByRole("button",{name:"取消编辑昵称",exact:true})).toBeDisabled()
 release?.()
 await expect(input).toHaveValue("失败草稿")
 await expect(input).toBeEnabled()
 permissions.splice(0,permissions.length,"org","users","api:GET:/api/v1/users","api:GET:/api/v1/users/:id","api:GET:/api/v1/users/stats","api:GET:/api/v1/options/departments","api:GET:/api/v1/options/roles")
 await page.clock.fastForward(6000)
 await page.evaluate(()=>window.dispatchEvent(new Event("infranexus:permissions-stale")))
 await expect(page.getByText("编辑权限已变化，草稿保留；无法保存。",{exact:true})).toBeVisible()
 await expect(input).toHaveValue("失败草稿")
 await expect(page.getByRole("button",{name:"保存昵称",exact:true})).toBeDisabled()
 expect(writes).toBe(1)
})

test("table M4 Shift selection follows grouped visual order",async({page})=>{
 const mocks=await installMocks(page)
 mocks.users[8].auth_type="ad";mocks.users[4].auth_type="ldap"
 await page.goto("/users")
 await page.getByRole("button", {name:"更多表格操作"}).click()
 await page.getByRole("button",{name:"按来源分组（当前页）",exact:true}).click()
 await page.keyboard.press("Escape")
 const checks=page.getByRole("checkbox",{name:"勾选该行；按住 Shift 可连续选择",exact:true})
 await checks.nth(0).click()
 await checks.nth(2).click({modifiers:["Shift"]})
 await expect(page.getByRole("button",{name:"批量操作",exact:true})).toContainText("已选 3 条")
 for(const name of ["m4-user-09","m4-user-05","m4-user-01"])await expect(page.getByRole("row").filter({hasText:name}).getByRole("checkbox")).toBeChecked()
})

test("workspace preserves nickname drafts through list 403 and recovery", async ({ page }) => {
  await installMocks(page)
  await page.goto("/users")
  await page.getByRole("button", { name: "编辑 用户 01 的昵称", exact: true }).click()
  const input = page.getByRole("textbox", { name: "编辑 m4-user-01 的昵称", exact: true })
  await input.fill("权限恢复后继续编辑")
  let forbidden = true
  await page.route("**/api/v1/users?*", route => forbidden
    ? route.fulfill({ status: 403, json: envelope(null, 403) }) : route.fallback())
  await page.getByRole("button", { name: "刷新", exact: true }).click()
  const alert = page.getByRole("alert").filter({ hasText: "没有查看权限" })
  await expect(alert).toBeVisible()
  await expect(page.getByText(/有 1 行编辑草稿/)).toBeVisible()
  await expect(page.locator('[data-slot="table-container"]')).toHaveCount(0)
  forbidden = false
  await alert.getByRole("button", { name: "重试", exact: true }).click()
  await expect(input).toHaveValue("权限恢复后继续编辑")
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 1440, height: 500 }]) {
  test(`workspace list layout ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport)
    await installMocks(page, { departmentCount: 60 })
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    const permissions = Array.from({ length: 55 }, (_, i) => ({ id: uuid(500 + i), name: `权限 ${i}`, code: `permission-${i}`, type: i === 0 ? "button" : "menu", built_in: false, sort_order: i, children: [], has_children: false }))
    await page.route("**/api/v1/permissions", route => route.fulfill({ json: envelope(permissions) }))
    await page.route("**/api/v1/permissions/nodes?*", route => route.fulfill({ json: envelope({ items: permissions.slice(0, 20), total: 55, root_total: 55, matched_nodes: 55, retained_nodes: 55 }) }))
    await page.route("**/api/v1/roles?*", route => route.fulfill({ json: envelope({ items: Array.from({ length: 20 }, (_, i) => ({ id: uuid(700+i), name: i === 0 ? "超级管理员" : `角色 ${i}`, description: "拥有平台所有最高管理权限以及更多需要省略显示的角色说明", code: `role-${i}`, status: 1, built_in: i === 0, user_count: 0, permissions: [], created_at: "2026-10-01T00:00:00Z" })), total: 55 }) }))
    const bounded = viewport.width >= 1024 && viewport.height >= 640
    for (const path of ["/users", "/roles", "/permissions"]) {
      await page.goto(path)
      const table = page.locator('[data-slot="table-container"]')
      await expect(table.locator("tbody tr").first()).toBeVisible()
      await expect(page.locator('[data-slot="data-table-pagination"]')).toBeVisible()
      if (path === "/permissions") await expect(page.getByText("一级菜单 54", { exact: false })).toBeVisible()
      if (path === "/roles") {
        const roleCell = table.locator("tbody tr").first().locator("td").first()
        const bounds = await roleCell.evaluate(cell => {
          const rect = cell.getBoundingClientRect()
          const title = cell.querySelector("span[title]")!
          const badge = cell.querySelector('[data-slot="badge"]')!
          return { width: rect.width, titleFits: title.scrollWidth <= title.clientWidth,
            badgeFits: badge.getBoundingClientRect().right <= rect.right,
            contentFits: cell.scrollWidth <= cell.clientWidth }
        })
        expect(bounds.width).toBeGreaterThanOrEqual(240)
        expect(bounds.titleFits).toBe(true)
        expect(bounds.badgeFits).toBe(true)
        expect(bounds.contentFits).toBe(true)
      }
      if (bounded) {
        await expect.poll(() => page.locator("main").last().evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
        await expect(page.locator('[data-slot="data-table-pagination"]')).toBeInViewport()
        if (path === "/users") {
          const tree = page.locator(".table-workspace-tree")
          await tree.evaluate(el => { el.scrollTop = el.scrollHeight })
          expect(await tree.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
        }
        await table.evaluate(el => { el.scrollTop = el.scrollHeight })
        const overflowing = await table.evaluate(el => el.scrollHeight > el.clientHeight)
        if (overflowing) await expect.poll(() => table.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
      } else {
        expect(await page.locator("main").last().evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${path.slice(1)}.png`) })
      if (path === "/permissions") {
        await page.getByRole("button", { name: "按需浏览权限节点", exact: true }).click()
        await expect(page.getByRole("heading", { name: "权限节点", exact: true })).toBeVisible()
        if (bounded) await expect.poll(() => page.locator("main").last().evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
        await page.getByRole("button", { name: "返回完整权限树", exact: true }).click()
        await page.getByRole("button", { name: "全屏查看表格", exact: true }).click()
        await expect(page.getByRole("dialog", { name: "全屏表格" })).toBeVisible()
        await page.getByRole("button", { name: "退出全屏表格", exact: true }).click()
      }
    }
    expect(errors).toEqual([])
  })
}

for (const width of [1440, 390]) {
  test(`pagination batch controls keep layout stable at ${width}px`, async ({ page }, info) => {
    await installMocks(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/users")
    const pagination = page.locator('[data-slot="data-table-pagination"]')
    const table = page.locator('[data-slot="table-container"]')
    await expect(page.getByRole("button", { name: "数据操作", exact: true })).toBeVisible()
    const before = await table.boundingBox()
    const footerBefore = await pagination.boundingBox()
    await page.getByRole("checkbox", { name: "勾选该行；按住 Shift 可连续选择" }).first().click()
    expect((await table.boundingBox())!.height).toBeCloseTo(before!.height, 0)
    expect((await pagination.boundingBox())!.height).toBeCloseTo(footerBefore!.height, 0)
    await expect(page.getByRole("heading", { name: "全部人员", exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="data-table-batch-bar"]')).toHaveCount(0)
    await expect(page.getByRole("button", { name: "批量停用", exact: true })).toBeHidden()
    await pagination.scrollIntoViewIfNeeded()
    await page.getByRole("button", { name: "批量操作", exact: true }).click()
    await expect(page.getByRole("button", { name: "批量停用", exact: true })).toBeVisible()
    const popup = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "批量操作", exact: true }) })
    const popupBox = (await popup.boundingBox())!
    const pageSizeBox = (await pagination.getByRole("button", { name: "10 条/页", exact: true }).boundingBox())!
    expect(popupBox.y + popupBox.height).toBeLessThanOrEqual(pageSizeBox.y)
    await page.screenshot({ path: info.outputPath("pagination-selection.png") })
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "下一页", exact: true }).click()
    await expect(page.getByRole("button", { name: "批量操作", exact: true })).toContainText("已选 1 条")
    await page.getByRole("checkbox", { name: "全选当页数据", exact: true }).click()
    await page.getByRole("button", { name: "批量操作", exact: true }).click()
    await page.getByRole("button", { name: "选择全部匹配 12 条", exact: true }).click()
    await expect(page.getByRole("button", { name: "批量操作", exact: true })).toContainText("已选 约 12 条")
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "取消选择", exact: true }).click()
    await expect(page.getByRole("button", { name: "批量操作", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "全屏查看表格", exact: true }).click()
    await page.getByRole("checkbox", { name: "勾选该行；按住 Shift 可连续选择" }).first().click()
    await page.getByRole("button", { name: "批量操作", exact: true }).click()
    await expect(page.getByRole("button", { name: "选择详情", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "取消选择", exact: true }).click()
    await page.getByRole("button", { name: "退出全屏表格", exact: true }).click()
  })
}
