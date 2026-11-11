import { expect, test, type Page, type Route } from "@playwright/test"

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`
const entry = (number: number, name: string) => ({
  id: id(number),
  code: `DCIM-${number}`,
  name,
  status: 1,
  version: 2,
  created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z",
})
const list = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 20 })
const json = (route: Route, data: unknown) =>
  route.fulfill({ json: { code: 200000, message: "success", data } })
const subnet = {
  ...entry(10, "测试网段"),
  cidr: "10.0.0.0/24",
  network_scope_id: id(11),
  security_zone_id: id(12),
  usage_type: "production",
  is_allocatable: true,
}
const ip = {
  id: id(20),
  address: "10.0.0.2",
  allocation_state: "free",
  reservation_kind: "manual",
  conflicted: false,
  available: false,
  version: 3,
}
const conflict = {
  id: id(30),
  address_id: ip.id,
  observed_identity: "观测设备",
  evidence_ref: "证据-001",
  observed_at: "2026-11-10T00:00:00Z",
}

async function mockAPI(
  page: Page,
  handler: (route: Route, url: URL) => Promise<void> | undefined,
  permissions = ["*"],
) {
  await page.addInitScript(() => {
    window.EventSource = class extends EventTarget {
      readyState = 1
      close() {}
    } as unknown as typeof EventSource
  })
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/auth/setup")) return json(route, { initialized: true })
    if (url.pathname.endsWith("/auth/me"))
      return json(route, {
        id: id(1),
        username: "review",
        status: 1,
        auth_type: "local",
        roles: [],
        permissions,
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      })
    return handler(route, url) ?? json(route, list([]))
  })
}

async function chooseAction(page: Page, label: string) {
  const direct = page.getByRole("button", { name: label, exact: true })
  const menu = page.getByRole("button", { name: "更多行操作" }).first()
  await expect(direct.or(menu).first()).toBeVisible()
  if (await direct.count()) await direct.click()
  else {
    await menu.click()
    await page.getByRole("menuitem", { name: label, exact: true }).click()
  }
}

test("四层位置树从机房直接新建机柜", async ({ page }) => {
  const levels = [
    { uid: id(40), name: "北京数据中心", type: "datacenter", parent: null, ext: { address: "北京", contact: { name: "联系人" } }, has_children: true },
    { uid: id(41), name: "一号楼", type: "building", parent: id(40), ext: {}, has_children: true },
    { uid: id(42), name: "主机房", type: "room", parent: id(41), ext: { floor: 0 }, has_children: false },
  ]
  await mockAPI(page, (route, url) => {
    if (url.pathname.endsWith(`/locations/nodes/${id(50)}/units`)) {
      return json(route, { rack_id: id(50), units: [{ unit: 42, state: "free", available: true }] })
    }
    if (!url.pathname.endsWith("/locations/nodes")) return
    if (route.request().method() === "POST") {
      return json(route, { ...route.request().postDataJSON(), uid: id(50), status: 1, version: 1 })
    }
    const parentParam = url.searchParams.get("parent")
    const actualParent = parentParam === "root" ? null : parentParam
    return json(route, list(levels.filter(node => node.parent === actualParent).map(node => ({ ...node, status: 1, version: 1 }))))
  })
  await page.goto("/locations")
  await page.getByRole("button", { name: /展开.*北京数据中心/ }).click()
  await page.getByRole("button", { name: /展开.*一号楼/ }).click()
  await page.getByRole("button", { name: /主机房/ }).first().click()
  await expect(page.getByText(/0F|楼层/)).toBeVisible()
  await page.getByRole("button", { name: "新建机柜" }).first().click()
  await page.getByPlaceholder("请输入机柜名称").fill("测试机柜")
  await page.getByPlaceholder("A 或 1").fill("A")
  await page.getByPlaceholder("1", { exact: true }).fill("1")
  const request = page.waitForRequest(req => req.method() === "POST" && req.url().endsWith("/locations/nodes"))
  await page.getByRole("button", { name: "确认创建" }).click()
  expect((await request).postDataJSON()).toMatchObject({ parent: id(42), type: "rack", ext: { row: "A", column: 1, height_u: 42 } })
})

test("制造商编辑保留现有编码、版本和未展示字段", async ({ page }) => {
  const manufacturer = { ...entry(51, "制造商样例"), logo_url: "https://example.com/logo.svg" }
  await mockAPI(page, (route, url) => {
    if (url.pathname.endsWith("/manufacturers")) return json(route, list([manufacturer]))
    if (url.pathname.endsWith("/manufacturers/" + manufacturer.id)) return json(route, manufacturer)
  })
  await page.goto("/vendor-management")
  await chooseAction(page, "编辑制造商")
  const request = page.waitForRequest(
    (req) => req.method() === "PUT" && req.url().endsWith(manufacturer.id),
  )
  await page.getByRole("dialog").getByRole("button", { name: "保存更改" }).click()
  expect((await request).postDataJSON()).toMatchObject({
    expected_version: 2,
    data: { code: manufacturer.code, logo_url: manufacturer.logo_url },
  })
})

test("IP 人工保留可取消，解除冲突发送冲突记录 ID", async ({ page }) => {
  let manual = true
  let conflicted = false
  await mockAPI(page, (route, url) => {
    if (url.pathname.endsWith("/subnets")) return json(route, list([subnet]))
    if (url.pathname.endsWith("/addresses"))
      return json(
        route,
        list([{ ...ip, reservation_kind: manual ? "manual" : "none", conflicted }]),
      )
    if (url.pathname.endsWith("/reservation")) {
      manual = false
      conflicted = true
      return json(route, { ...ip, reservation_kind: "none", conflicted })
    }
    if (url.pathname.endsWith("/conflicts")) return json(route, list([conflict]))
    if (url.pathname.endsWith("/resolve")) return json(route, { resolved: true })
  })
  await page.goto("/ipam/subnets")
  await chooseAction(page, "查看地址池矩阵")
  await page.getByRole("button", { name: /\.2.*预留/ }).click()
  await page.getByRole("button", { name: "取消人工保留" }).click()
  await page
    .getByRole("dialog", { name: /取消人工保留/ })
    .locator("textarea")
    .fill("预留已结束")
  const release = page.waitForRequest(
    (req) => req.method() === "PATCH" && req.url().endsWith("/reservation"),
  )
  await page.getByRole("button", { name: "确认提交" }).click()
  expect((await release).postDataJSON()).toMatchObject({ reserved: false, expected_version: 3 })
  await page.getByRole("button", { name: /\.2.*冲突/ }).click()
  await expect(page.getByText(conflict.observed_identity)).toBeVisible()
  await page.getByRole("button", { name: "解除此冲突" }).click()
  await page
    .getByRole("dialog", { name: /解除 IP 冲突/ })
    .locator("textarea")
    .fill("已核实")
  const resolution = page.waitForRequest(
    (req) => req.method() === "PATCH" && req.url().endsWith("/resolve"),
  )
  await page.getByRole("button", { name: "确认解除冲突" }).click()
  expect(new URL((await resolution).url()).pathname).toContain(`/conflicts/${conflict.id}/resolve`)
})

test("只读角色看不到 IP 写操作", async ({ page }) => {
  await mockAPI(
    page,
    (route, url) => {
      if (url.pathname.endsWith("/subnets")) return json(route, list([subnet]))
      if (url.pathname.endsWith("/addresses"))
        return json(route, list([{ ...ip, conflicted: true }]))
      if (url.pathname.endsWith("/conflicts")) return json(route, list([conflict]))
    },
    ["ipam", "ipam:subnets:read", "ipam:subnets:history"],
  )
  await page.goto("/ipam/subnets")
  await chooseAction(page, "查看地址池矩阵")
  await page.getByRole("button", { name: /\.2.*冲突/ }).click()
  await expect(page.getByText(conflict.observed_identity)).toBeVisible()
  await expect(page.getByRole("button", { name: "报告冲突" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "取消人工保留" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "解除此冲突" })).toHaveCount(0)
})

test("地址空间选项异步加载不会清空已输入的子网草稿", async ({ page }) => {
  let allowOptions: () => void = () => {}
  const waitOptions = new Promise<void>((resolve) => {
    allowOptions = resolve
  })
  await mockAPI(page, (route, url) => {
    if (url.pathname.endsWith("/network-scopes"))
      return waitOptions.then(() => json(route, list([entry(11, "默认地址空间")])))
    if (url.pathname.endsWith("/security-zones"))
      return waitOptions.then(() => json(route, list([entry(12, "生产安全域")])))
  })
  await page.goto("/ipam/subnets")
  await page.getByRole("button", { name: "新建子网" }).click()
  const dialog = page.getByRole("dialog")
  const name = dialog.getByPlaceholder("如: 北京主中心-业务内网-1")
  const cidr = dialog.getByPlaceholder("如: 10.20.1.0/24")
  await name.fill("未保存的子网")
  await cidr.fill("10.20.1.0/24")
  allowOptions()
  await expect(dialog.getByLabel("所属地址空间")).toBeEnabled()
  await dialog.getByLabel("所属地址空间").selectOption(id(11))
  await dialog.getByLabel("所属安全域").selectOption(id(12))
  await expect(name).toHaveValue("未保存的子网")
  await expect(cidr).toHaveValue("10.20.1.0/24")
})

test("空库可以创建地址空间和安全域", async ({ page }) => {
  const datacenter = entry(61, "初始化数据中心")
  await mockAPI(page, (route, url) => {
    if (url.pathname.endsWith("/locations/nodes")) return json(route, list([{ ...datacenter, uid: datacenter.id }]))
    if (route.request().method() === "POST")
      return json(route, { ...entry(62, "新建档案"), ...route.request().postDataJSON() })
  })
  await page.goto("/ipam/subnets")
  await page.getByRole("button", { name: "地址空间", exact: true }).click()
  await page.getByRole("button", { name: "新建地址空间" }).click()
  const scopeForm = page.getByRole("dialog", { name: "新建地址空间" })
  await scopeForm.getByLabel("编码").fill("SCOPE-1")
  await scopeForm.getByLabel("名称").fill("生产地址空间")
  const createScope = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/network-scopes"),
  )
  await scopeForm.getByRole("button", { name: "保存" }).click()
  expect((await createScope).postDataJSON()).toMatchObject({
    code: "SCOPE-1",
    name: "生产地址空间",
  })
  await expect(scopeForm).toBeHidden()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "安全域", exact: true }).click()
  await page.getByRole("button", { name: "新建安全域" }).click()
  const zoneForm = page.getByRole("dialog", { name: "新建安全域" })
  await zoneForm.getByLabel("编码").fill("ZONE-1")
  await zoneForm.getByLabel("名称").fill("生产安全域")
  await zoneForm.getByLabel("所属数据中心", { exact: true }).selectOption(datacenter.id)
  const createZone = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/security-zones"),
  )
  await zoneForm.getByRole("button", { name: "保存" }).click()
  expect((await createZone).postDataJSON()).toMatchObject({
    code: "ZONE-1",
    datacenter_id: datacenter.id,
  })
})
