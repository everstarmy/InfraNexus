import { expect, test, type Page } from "@playwright/test"

async function directoryPage(page: Page, total = 25, sourceCount = 2) {
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
    enabled: true,
    sync_enabled: false,
    sync_interval_minutes: 60,
    disable_missing_users: false,
    timeout_seconds: 5,
    sync_status: "idle",
    last_sync_at: null,
    last_success_at: null,
  })
  let configs = [config("source-a", "alpha.example.test"), config("source-b", "beta.example.test")]
  configs = configs.slice(0, sourceCount)
  let failDomain = ""
  const reads: Array<{ config: string | null; page: number }> = []
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
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
        permissions: [
          "ldap",
          "ldap:create",
          "ldap:update",
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
  await page
    .getByRole("group", { name: "按身份源域筛选同步日志" })
    .getByRole("button", { name: "alpha.example.test", exact: true })
    .click()
  await page.getByTitle("下一页").click()
  await expect.poll(() => fixture.reads.at(-1)?.page).toBe(2)
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
  for (const width of [390, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const title = await page.getByText("同步日志", { exact: true }).boundingBox()
    expect(title?.width).toBeGreaterThan(150)
    expect(title?.height).toBeLessThan(36)
    await expect
      .poll(async () => {
        const empty = await page.getByText("暂无同步记录", { exact: true }).boundingBox()
        const scrollArea = await page.locator('[data-slot="table-container"]').boundingBox()
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
  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
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
  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
  await expect(page.getByRole("button", { name: "目录域固定左侧", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.keyboard.press("Escape")
  const domainHeader = page
    .getByRole("columnheader")
    .filter({ has: page.getByRole("separator", { name: "调整domain列宽" }) })
  await expect(domainHeader).toHaveCSS("position", "sticky")
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(domainHeader).not.toHaveCSS("position", "sticky")
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect(domainHeader).toHaveCSS("position", "sticky")
  await page.getByRole("button", { name: "自定义显示列和固定列" }).click()
  await expect(page.getByRole("dialog")).toHaveCSS("opacity", "1")
  await page.screenshot({ path: testInfo.outputPath("ldap-column-pinning.png") })
})

test("single-source log heading shares one row with table controls", async ({ page }, testInfo) => {
  await directoryPage(page, 0, 1)
  await page.goto("/ldap")
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await expect
      .poll(async () => {
        const heading = await page
          .getByText("同步日志", { exact: true })
          .locator("..")
          .boundingBox()
        const refresh = await page.getByRole("button", { name: "刷新", exact: true }).boundingBox()
        return Math.abs(heading!.y + heading!.height / 2 - refresh!.y - refresh!.height / 2)
      })
      .toBeLessThan(3)
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`), fullPage: true })
  }
})
