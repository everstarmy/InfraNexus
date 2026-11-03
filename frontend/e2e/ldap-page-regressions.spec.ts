import { expect, test, type Page } from "@playwright/test"

async function directoryPage(page: Page, total = 25, sourceCount = 2, readOnly = false, toggleAllowed = true) {
  const config = (id: string, domain: string) => ({
    id,
    domain,
    name: `企业身份源 ${domain}`,
    type: "ad",
    server_host: "ldap.example.test",
    port: 636,
    use_ssl: true,
    start_tls: false,
    insecure_skip_verify: false,
    bind_dn: "CN=svc,DC=example,DC=test",
    base_dn: "DC=example,DC=test",
    attribute_mapping: {
      username: "sAMAccountName",
      nickname: "displayName",
      email: "mail",
      external_id: "objectGUID",
    },
    department_sync: { strategy: "none", ou_mappings: [] },
    user_filter: "(&(objectClass=user)(sAMAccountName=%s))",
    default_role_id: null,
    has_bind_password: true,
    enabled: true,
    sync_enabled: true,
    sync_interval_minutes: 60,
    disable_missing_users: false,
    timeout_seconds: 5,
    sync_status: "idle",
    last_sync_at: null,
    last_success_at: null,
  })
  let configs = [config("source-a", "alpha.example.test"), config("source-b", "beta.example.test")]
  configs = sourceCount <= 2 ? configs.slice(0, sourceCount) : [
    ...configs,
    ...Array.from({ length: sourceCount - 2 }, (_, index) => config(`source-${index + 3}`, `domain-${index + 3}.example.test`)),
  ]
  let failSave = false
  const writes: Array<{ id: string; body: Record<string, unknown> }> = []
  let failDomain = ""
  const reads: Array<{ config: string | null; page: number }> = []
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path.endsWith("/auth/setup")) return route.fulfill({ json: { code: 200000, data: { initialized: true } } })
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          data,
          code: status * 1000,
          message: "test",
          request_id: "ldap-regression",
        }),
      })
    if (path.endsWith("/auth/me"))
      return json({
        id: "reviewer",
        username: "reviewer",
        nickname: "审查员",
        permissions: readOnly ? ["ldap"] : [
          "ldap",
          "ldap:create",
          "ldap:update",
          ...(toggleAllowed ? ["ldap:toggle-status", "api:PATCH:/api/v1/ldap/configs/:id/status"] : []),
          "ldap:delete",
          "ldap:test",
          "ldap:sync",
          "api:GET:/api/v1/ldap/sync-plans/:id/items",
          "api:GET:/api/v1/ldap/sync-logs/:id",
        ],
        roles: [],
        preferences: {},
        auth_type: "local",
        status: 1,
      })
    const statusId = path.match(/\/ldap\/configs\/([^/]+)\/status$/)?.[1]
    if (statusId && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON()
      writes.push({ id: statusId, body })
      if (failSave) return json(null, 500)
      configs = configs.map((cfg) => cfg.id === statusId ? { ...cfg, ...body } : cfg)
      return json(configs.find((cfg) => cfg.id === statusId))
    }
    const editingId = path.match(/\/ldap\/configs\/([^/]+)$/)?.[1]
    if (editingId && route.request().method() === "PUT") {
      const body = route.request().postDataJSON()
      writes.push({ id: editingId, body })
      if (failSave) return json(null, 500)
      configs = configs.map((cfg) => cfg.id === editingId ? { ...cfg, ...body } : cfg)
      return json(configs.find((cfg) => cfg.id === editingId))
    }
    if (path.endsWith("/ldap/configs")) return json(configs)
    if (path.endsWith("/ldap/sync-logs")) {
      const source = url.searchParams.get("config_id")
      const currentPage = Number(url.searchParams.get("page") || 1)
      reads.push({ config: source, page: currentPage })
      if (source === failDomain) return json(null, 500)
      return json({ items: [], total, page: currentPage, page_size: 10 })
    }
    if (path.endsWith("/options/departments")) return json({ items: [], revision: 1 })
    return json([])
  })
  return {
    reads,
    writes,
    failSave: () => { failSave = true },
    fail: (id: string) => {
      failDomain = id
    },
    removeSource: () => {
      configs = configs.slice(1)
    },
  }
}

test("LDAP log filters remain available when one source fails", async ({ page }) => {
  const fixture = await directoryPage(page)
  await page.goto("/ldap")
  await page.getByRole("button", { name: "同步日志", exact: true }).click()
  const filters = page.getByRole("group", { name: "按身份源域筛选同步日志" })
  fixture.fail("source-a")
  await filters.getByRole("button", { name: "alpha.example.test", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "同步日志" })).toBeVisible()
  await expect(filters.getByRole("button", { name: "全部域", exact: true })).toBeVisible()
  await filters.getByRole("button", { name: "全部域", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "同步日志" })).toHaveCount(0)
})

test("removing the filtered source resets log pagination", async ({ page }) => {
  const fixture = await directoryPage(page)
  await page.goto("/ldap")
  await page.getByRole("button", { name: "同步日志", exact: true }).click()
  await page
    .getByRole("group", { name: "按身份源域筛选同步日志" })
    .getByRole("button", { name: "alpha.example.test", exact: true })
    .click()
  await page.getByLabel("同步日志", { exact: true }).getByTitle("下一页").click()
  await expect.poll(() => fixture.reads.at(-1)?.page).toBe(2)
  await page.keyboard.press("Escape")
  fixture.removeSource()
  await page
    .getByRole("button", { name: "企业身份源 alpha.example.test 的操作", exact: true })
    .click()
  await page.getByRole("menuitem", { name: "删除配置" }).click()
  await page.getByRole("alertdialog").getByRole("button", { name: "确认删除", exact: true }).click()
  await expect.poll(() => fixture.reads.at(-1)).toEqual({ config: null, page: 1 })
})

test("populated LDAP page fits compact and wide viewports", async ({ page }, testInfo) => {
  await directoryPage(page, 0)
  await page.goto("/ldap")
  await expect(page.getByRole("heading", { name: "身份源集成" })).toBeVisible()
  await page.getByRole("button", { name: "同步日志", exact: true }).click()
  for (const width of [390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const logsDialog = page.getByLabel("同步日志", { exact: true })
    const title = await logsDialog.locator('[data-slot="card-title"]').boundingBox()
    expect(title?.width).toBeGreaterThan(50)
    expect(title?.height).toBeLessThan(36)
    await expect
      .poll(async () => {
        const empty = await logsDialog.getByText("暂无同步记录", { exact: true }).boundingBox()
        const scrollArea = await logsDialog.locator('[data-slot="table-container"]').boundingBox()
        return Math.abs(empty!.x + empty!.width / 2 - (scrollArea!.x + scrollArea!.width / 2))
      })
      .toBeLessThan(4)
    await page.screenshot({ path: testInfo.outputPath(`ldap-${width}.png`), fullPage: true })
  }
})

test("LDAP logs reuse the shared column pinning controls and remember layout", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await directoryPage(page)
  await page.goto("/ldap")
  await page.getByRole("button", { name: "同步日志", exact: true }).click()
  await page.getByLabel("同步日志", { exact: true }).getByRole("button", { name: "表格设置" }).click()
  const pinRight = page.getByRole("button", { name: "目录域固定右侧", exact: true })
  await expect(pinRight).toBeVisible()
  await pinRight.click()
  await expect(pinRight).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "目录域不固定", exact: true }).click()
  await expect(page.getByRole("button", { name: "目录域不固定", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.getByRole("button", { name: "目录域固定左侧", exact: true }).click()
  await expect(page.getByRole("button", { name: "目录域固定左侧", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.reload()
  await page.getByRole("button", { name: "同步日志", exact: true }).click()
  await page.getByLabel("同步日志", { exact: true }).getByRole("button", { name: "表格设置" }).click()
  await expect(page.getByRole("button", { name: "目录域固定左侧", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.keyboard.press("Escape")
  const domainHeader = page
    .getByLabel("同步日志", { exact: true })
    .getByRole("columnheader")
    .filter({ has: page.getByRole("separator", { name: "调整domain列宽" }) })
  await expect(domainHeader).toHaveCSS("position", "sticky")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(domainHeader).not.toHaveCSS("position", "sticky")
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect(domainHeader).toHaveCSS("position", "sticky")
  await page.getByLabel("同步日志", { exact: true }).getByRole("button", { name: "表格设置" }).click()
  await expect(page.getByLabel("同步日志", { exact: true })).toHaveCSS("opacity", "1")
  await page.screenshot({ path: testInfo.outputPath("ldap-column-pinning.png") })
})

test("single-source log heading shares one row with table controls", async ({ page }, testInfo) => {
  await directoryPage(page, 0, 1)
  await page.goto("/ldap")
  await page.getByRole("button", { name: "同步日志", exact: true }).click()
  const logsDialog = page.getByLabel("同步日志", { exact: true })
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect
      .poll(async () => {
        const heading = await logsDialog
          .locator('[data-slot="card-title"]')
          .locator("..")
          .boundingBox()
        const refresh = await logsDialog.getByRole("button", { name: "刷新", exact: true }).boundingBox()
        return Math.abs(heading!.y + heading!.height / 2 - refresh!.y - refresh!.height / 2)
      })
      .toBeLessThan(3)
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`), fullPage: true })
  }
})

test("multiple domains support searching, filtering, pagination and scoped login configuration", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const fixture = await directoryPage(page, 0, 23)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto("/ldap")
  const directories = page.getByRole("region", { name: "目录配置", exact: true })
  await expect(directories.getByRole("row")).toHaveCount(11)
  expect(await page.getByText("23 个域独立配置，支持 AD / OpenLDAP", { exact: true }).evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(80)
  await directories.getByTitle("下一页").click()
  await expect(directories.getByRole("row")).toHaveCount(11)
  const search = directories.getByPlaceholder("搜索目录名称、域名或服务器…")
  await search.fill("beta.example.test")
  await expect(directories.getByRole("row")).toHaveCount(2)
  const betaSwitch = directories.getByRole("switch", { name: "切换 beta.example.test 的域账号登录", exact: true })
  await expect(betaSwitch).toBeVisible()
  await expect(betaSwitch).toBeChecked()
  await betaSwitch.click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  expect(fixture.writes[0].id).toBe("source-b")
  expect(fixture.writes[0].body).toEqual({ enabled: false })
  await expect(betaSwitch).not.toBeChecked()
  await search.fill("")
  await directories.getByRole("button", { name: "域登录", exact: true }).click()
  await page.getByRole("button", { name: /禁止登录/ }).click()
  await page.keyboard.press("Escape")
  await expect(directories.getByRole("row")).toHaveCount(2)
  await expect(directories.getByText("beta.example.test", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("multi-domain-filtered.png"), fullPage: true })
  await directories.getByRole("button", { name: "重置筛选", exact: true }).click()
  await expect(directories.getByRole("row")).toHaveCount(11)
  await directories.getByRole("button", { name: "企业身份源 alpha.example.test", exact: true }).click()
  const detailSheet = page.locator('[data-slot="sheet-content"]')
  await expect(detailSheet.getByText("服务器端点", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(detailSheet).toHaveCount(0)
  await page.getByRole("button", { name: "同步日志", exact: true }).click()
  const logFilter = page.getByRole("combobox", { name: "按身份源域筛选同步日志" })
  await logFilter.click()
  await page.getByRole("option", { name: "企业身份源 domain-23.example.test（domain-23.example.test）", exact: true }).click()
  await expect.poll(() => fixture.reads.at(-1)?.config).toBe("source-23")
  await page.keyboard.press("Escape")
  await page.locator("main.overflow-y-auto").evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: testInfo.outputPath("multi-domain-desktop.png"), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(directories.getByPlaceholder("搜索目录名称、域名或服务器…")).toBeVisible()
  await expect(page.locator("vite-error-overlay")).toHaveCount(0)
  expect(errors).toEqual([])
  await search.fill("beta.example.test")
  await page.locator("main.overflow-y-auto").evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: testInfo.outputPath("multi-domain-mobile.png"), fullPage: true })
})

test("a failed domain login-policy save retains its draft and does not claim success", async ({ page }) => {
  const fixture = await directoryPage(page)
  fixture.failSave()
  await page.goto("/ldap")
  await page.getByRole("button", { name: "企业身份源 alpha.example.test 的操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "配置域登录" }).click()
  const configDialog = page.locator('[data-slot="ldap-config-dialog"]')
  await configDialog.getByRole("switch", { name: "允许域账号登录" }).uncheck()
  await configDialog.getByRole("button", { name: "保存配置", exact: true }).click()
  await expect(configDialog.getByRole("alert").filter({ hasText: "test" })).toBeVisible()
  await expect(configDialog.getByRole("switch", { name: "允许域账号登录" })).not.toBeChecked()
  await expect(configDialog).toBeVisible()
  const row = page.locator("tbody tr").filter({ hasText: "alpha.example.test" })
  await expect(row.locator('[role="switch"]')).toBeChecked()
})

test("read-only directory users cannot change domain login policy", async ({ page }) => {
  const fixture = await directoryPage(page, 0, 2, true)
  await page.goto("/ldap")
  await expect(page.getByRole("switch", { name: "切换 alpha.example.test 的域账号登录", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "企业身份源 alpha.example.test 的操作", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "配置域登录" })).toHaveCount(0)
  await expect(page.getByRole("menuitem", { name: "编辑配置" })).toHaveCount(0)
  expect(fixture.writes).toEqual([])
})

test("domain sign-in displays enabled domains and submits the selected domain", async ({ page }) => {
  let enabledDomains = [
    { domain: "alpha.example.test", name: "总部", type: "ad" },
    { domain: "beta.example.test", name: "分部", type: "ldap" },
  ]
  const logins: Array<Record<string, unknown>> = []
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: { code: status === 200 ? 200000 : 401002, data, message: "凭据无效" } })
    if (path.endsWith("/auth/setup")) return json({ initialized: true })
    if (path.endsWith("/auth/domains")) return json(enabledDomains)
    if (path.endsWith("/auth/login")) {
      logins.push(route.request().postDataJSON())
      return json(null, 401)
    }
    return json(null, 401)
  })
  await page.goto("/login")
  await page.getByRole("tab", { name: "企业 AD 域账号" }).click()
  await page.getByRole("combobox", { name: "认证域" }).click()
  await page.getByRole("option", { name: "分部（beta.example.test）", exact: true }).click()
  await page.getByLabel("域账号", { exact: true }).fill("same-user")
  await page.getByLabel("域密码", { exact: true }).fill("Demo!Password1")
  await page.getByRole("button", { name: "使用域账号登录", exact: true }).click()
  await expect.poll(() => logins.length).toBe(1)
  expect(logins[0].domain).toBe("beta.example.test")
  enabledDomains = enabledDomains.slice(0, 1)
  await page.reload()
  await expect(page.getByRole("combobox", { name: "认证域" }).locator('[data-slot="select-value"]')).toHaveText("总部（alpha.example.test）")
  await expect(page.getByRole("combobox", { name: "认证域" })).toBeDisabled()
  enabledDomains = []
  await page.reload()
  await expect(page.getByText("尚未配置可用的企业域", { exact: false })).toBeVisible()
  await expect(page.getByRole("button", { name: "使用域账号登录", exact: true })).toBeDisabled()
})

test("legacy directory editors keep editing but cannot use an ungranted status API", async ({ page }) => {
  await directoryPage(page, 0, 2, false, false)
  await page.goto("/ldap")
  await expect(page.getByRole("switch", { name: "切换 alpha.example.test 的域账号登录", exact: true })).toBeDisabled()
  await page.getByRole("button", { name: "企业身份源 alpha.example.test", exact: true }).click()
  await expect(page.getByRole("switch", { name: "侧栏切换 alpha.example.test 的域账号登录", exact: true })).toBeDisabled()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "企业身份源 alpha.example.test 的操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "配置域登录", exact: true }).click()
  const dialog = page.locator('[data-slot="ldap-config-dialog"]')
  await expect(dialog.getByRole("switch", { name: "允许域账号登录" })).toBeEnabled()
  await dialog.getByRole("switch", { name: "允许域账号登录" }).uncheck()
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByRole("switch", { name: "切换 alpha.example.test 的域账号登录", exact: true })).not.toBeChecked()
})

test("status PATCH result updates the switch before delayed list refetch and supports reversing", async ({ page }) => {
  const fixture = await directoryPage(page)
  await page.goto("/ldap")
  const sw = page.getByRole("switch", { name: "切换 alpha.example.test 的域账号登录", exact: true })
  await expect(sw).toBeChecked()
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/api/v1/ldap/configs", async (route) => {
    await gate
    await route.fallback().catch(() => {})
  })
  try {
    await sw.click()
    await expect(sw).not.toBeChecked()
    await expect(sw).toBeEnabled()
    await sw.click()
    await expect(sw).toBeChecked()
    await expect.poll(() => fixture.writes.length).toBe(2)
    expect(fixture.writes.map((item) => item.body)).toEqual([{ enabled: false }, { enabled: true }])
  } finally { release() }
})

test("a failed status PATCH preserves the previous switch state", async ({ page }) => {
  const fixture = await directoryPage(page)
  fixture.failSave()
  await page.goto("/ldap")
  const sw = page.getByRole("switch", { name: "切换 alpha.example.test 的域账号登录", exact: true })
  await sw.click()
  await expect.poll(() => fixture.writes.length).toBe(1)
  await expect(page.getByText("切换域账号登录状态失败", { exact: true })).toBeVisible()
  await expect(sw).toBeChecked()
  await expect(sw).toBeEnabled()
})

test("configuration steps support arrow keys, Home/End and linked tab panels", async ({ page }, testInfo) => {
  await directoryPage(page)
  await page.goto("/ldap")
  await page.getByRole("button", { name: "企业身份源 alpha.example.test 的操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "编辑配置", exact: true }).click()
  const dialog = page.locator('[data-slot="ldap-config-dialog"]')
  const first = dialog.getByRole("tab", { name: /连接与目录/ })
  const second = dialog.getByRole("tab", { name: /属性映射/ })
  const last = dialog.getByRole("tab", { name: /同步与登录/ })
  await first.focus()
  await page.keyboard.press("ArrowRight")
  await expect(second).toBeFocused()
  await page.keyboard.press("Enter")
  await expect(second).toHaveAttribute("aria-selected", "true")
  const panelId = await second.getAttribute("aria-controls")
  expect(panelId).toBeTruthy()
  await expect(page.locator(`[id="${panelId}"]`)).toBeVisible()
  await page.keyboard.press("End")
  await expect(last).toBeFocused()
  await page.keyboard.press("Home")
  await expect(first).toBeFocused()
  await page.keyboard.press("Enter")
  await page.screenshot({ path: testInfo.outputPath("ldap-config-keyboard-desktop.png") })
  await page.setViewportSize({ width: 390, height: 844 })
  const sizes = await dialog.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }))
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
  await page.screenshot({ path: testInfo.outputPath("ldap-config-keyboard-mobile.png") })
})

async function editServer(page: Page, host: string) {
  await page.getByRole("button", { name: "企业身份源 alpha.example.test 的操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "编辑配置", exact: true }).click()
  const dialog = page.locator('[data-slot="ldap-config-dialog"]')
  await dialog.getByLabel("服务器地址", { exact: true }).fill(host)
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click()
  await expect(dialog).not.toBeVisible()
}

async function probeServer(page: Page) {
  await page.getByRole("button", { name: "企业身份源 alpha.example.test 的操作", exact: true }).click()
  await page.getByRole("menuitem", { name: "测试连接", exact: true }).click()
}

test("saving connection changes invalidates the previous server probe", async ({ page }) => {
  await directoryPage(page)
  await page.route("**/api/v1/ldap/test", (route) => route.fulfill({ json: { code: 200000, data: { success: true, stage: "done", latency_ms: 8, message: "ok", server_url: "ldaps://ldap.example.test:636", sample_users: [] } } }))
  await page.goto("/ldap")
  await probeServer(page)
  const row = page.getByRole("row").filter({ hasText: "alpha.example.test" })
  await expect(row.getByText("连通 8 ms", { exact: true })).toBeVisible()
  await editServer(page, "new-server.example.test")
  await expect(row.getByText("new-server.example.test:636", { exact: true })).toBeVisible()
  await expect(row.getByText("连通 8 ms", { exact: true })).toHaveCount(0)
})

test("a late probe response cannot mark a changed server as connected", async ({ page }) => {
  await directoryPage(page)
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  let started = false
  await page.route("**/api/v1/ldap/test", async (route) => {
    started = true
    await gate
    await route.fulfill({ json: { code: 200000, data: { success: true, stage: "done", latency_ms: 8, message: "old host", server_url: "ldaps://ldap.example.test:636", sample_users: [] } } })
  })
  await page.goto("/ldap")
  await probeServer(page)
  await expect.poll(() => started).toBe(true)
  await editServer(page, "new-server.example.test")
  const response = page.waitForResponse((item) => item.url().endsWith("/ldap/test"))
  release()
  await response
  const row = page.getByRole("row").filter({ hasText: "alpha.example.test" })
  await expect(row.getByText("new-server.example.test:636", { exact: true })).toBeVisible()
  await expect(row.getByText("连通 8 ms", { exact: true })).toHaveCount(0)
  await expect(page.getByText("连接正常 · 8 ms", { exact: true })).toHaveCount(0)
})
