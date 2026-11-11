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

test("机柜列表和新增都使用真实的机柜列 ID", async ({ page }) => {
  const levels = [
    ["datacenters", "北京数据中心"],
    ["buildings", "一号楼"],
    ["floors", "一楼"],
    ["rooms", "主机房"],
    ["rack-rows", "A 列"],
  ] as const
  const rackRequests: URL[] = []
  await mockAPI(page, (route, url) => {
    const path = url.pathname.split("/").at(-1)
    const index = levels.findIndex(([resource]) => resource === path)
    if (index >= 0) {
      if (index > 0) expect(url.searchParams.get("parent_id")).toBe(id(39 + index))
      return json(route, list([{ ...entry(40 + index, levels[index][1]), kind: "primary" }]))
    }
    if (path === "racks" && route.request().method() === "GET") {
      rackRequests.push(url)
      return json(route, list([]))
    }
    if (path === "racks" && route.request().method() === "POST")
      return json(route, entry(50, "测试机柜"))
  })
  await page.goto("/locations")
  await expect(page.getByText("请选择机柜列")).toBeVisible()
  await expect(page.getByRole("button", { name: "新建机柜", exact: true })).toHaveCount(0)
  for (const [, name] of levels) await page.getByRole("button", { name, exact: true }).click()
  await expect.poll(() => rackRequests.at(-1)?.searchParams.get("parent_id")).toBe(id(44))
  await page.getByRole("button", { name: "新建机柜", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "新建服务器机柜" })
  await dialog.locator("input").nth(0).fill("RACK-1")
  await dialog.locator("input").nth(1).fill("测试机柜")
  const request = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/locations/racks"),
  )
  await dialog.getByRole("button", { name: "创建机柜" }).click()
  expect((await request).postDataJSON()).toMatchObject({ rack_row_id: id(44), code: "RACK-1" })
  await expect(dialog).toBeHidden()
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
    if (url.pathname.endsWith("/datacenters")) return json(route, list([datacenter]))
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

test("批量导入只允许提交已通过预检的记录，并附带幂等键", async ({ page }) => {
  await mockAPI(page, (route, url) => {
    if (url.pathname.endsWith("/manufacturers/import/preview")) {
      const { items } = route.request().postDataJSON()
      return json(route, {
        items: [],
        errors: items[0].code ? [] : [{ row: 1, message: "缺少编码" }],
      })
    }
    if (url.pathname.endsWith("/manufacturers/import"))
      return json(route, { items: [entry(63, "测试制造商")], errors: [] })
  })
  await page.goto("/vendor-management")
  await page.getByRole("button", { name: "导入", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "批量导入制造商" })
  const input = dialog.getByLabel("JSON 记录")
  const submit = dialog.getByRole("button", { name: "提交导入" })
  await input.fill('[{"name":"测试制造商"}]')
  await dialog.getByRole("button", { name: "预检", exact: true }).click()
  await expect(dialog.getByText("第 1 行：缺少编码")).toBeVisible()
  await expect(submit).toBeDisabled()
  await input.fill('[{"code":"MFR-1","name":"测试制造商"}]')
  await dialog.getByRole("button", { name: "预检", exact: true }).click()
  await expect(submit).toBeEnabled()
  const commit = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/manufacturers/import"),
  )
  await submit.click()
  const request = await commit
  expect(request.headers()["idempotency-key"]).toMatch(/^[a-f0-9]{32}$/)
  expect(request.postDataJSON()).toEqual({ items: [{ code: "MFR-1", name: "测试制造商" }] })
  await expect(dialog).toBeHidden()
})

test("机柜网段绑定可选择已有机柜和可分配子网", async ({ page }) => {
  const rack = entry(70, "机柜 A01")
  await mockAPI(page, (route, url) => {
    if (url.pathname.endsWith("/locations/racks")) return json(route, list([rack]))
    if (url.pathname.endsWith("/ipam/subnets"))
      return json(
        route,
        list([subnet, { ...subnet, id: id(71), name: "规划前缀", is_allocatable: false }]),
      )
    if (url.pathname.endsWith("/ipam/rack-bindings") && route.request().method() === "POST")
      return json(route, entry(72, "生产绑定"))
  })
  await page.goto("/ipam/rack-bindings")
  await page.getByRole("button", { name: "新建机柜网段绑定", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("编码", { exact: true }).fill("BIND-1")
  await dialog.getByLabel("名称", { exact: true }).fill("生产绑定")
  await dialog.getByLabel("机柜", { exact: true }).selectOption(rack.id)
  const subnetPicker = dialog.getByLabel("子网", { exact: true })
  await subnetPicker.selectOption(subnet.id)
  await expect(subnetPicker.locator(`option[value="${id(71)}"]`)).toHaveCount(0)
  await dialog.getByLabel("与子网一致的网络用途").selectOption("production")
  const request = page.waitForRequest(
    (req) => req.method() === "POST" && req.url().endsWith("/rack-bindings"),
  )
  await dialog.getByRole("button", { name: "保存" }).click()
  expect((await request).postDataJSON()).toMatchObject({
    code: "BIND-1",
    rack_id: rack.id,
    subnet_id: subnet.id,
    usage_type: "production",
    is_default: false,
  })
})
