import { expect, test, type Page } from "@playwright/test"

async function mockSetup(
  page: Page,
  options: { initialized?: boolean; failStatus?: boolean; closeOnPageCheck?: boolean } = {},
) {
  let initialized = options.initialized ?? false
  let failure = options.failStatus ?? false
  let checks = 0
  let submissions = 0
  let failSubmit = false
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const respond = (data: unknown, status = 200, message = "success") =>
      route.fulfill({
        status,
        json: {
          code: status === 403 ? 403001 : status * 1000,
          data,
          message,
          request_id: "setup-e2e",
        },
      })
    if (path === "/api/v1/auth/setup") {
      if (request.method() === "GET") {
        checks++
        if (options.closeOnPageCheck && checks >= 2) initialized = true
        if (failure) return respond(null, 500)
        return respond({ initialized })
      }
      submissions++
      if (failSubmit) {
        initialized = true
        return respond(null, 403, "管理员已初始化，不能重复创建")
      }
      if (initialized) return respond(null, 403)
      expect(request.postDataJSON()).toEqual({ password: "Setup!12345" })
      initialized = true
      return respond({ initialized })
    }
    if (path.endsWith("/auth/me")) return respond(null, 401)
    if (path.endsWith("/auth/domains")) return respond([])
    return respond(null, 404)
  })
  return {
    checks: () => checks,
    submissions: () => submissions,
    recover: () => {
      failure = false
    },
    competingSetup: () => {
      failSubmit = true
    },
  }
}

for (const width of [1440, 390]) {
  test(`first-run setup and password confirmation at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const state = await mockSetup(page)
    await page.goto("/users")
    await expect(page).toHaveURL(/\/setup$/)
    await expect(page.getByRole("heading", { name: "初始化管理员", exact: true })).toBeVisible()
    await expect(page.getByLabel("管理员账号", { exact: true })).toHaveValue("admin")
    await page.getByLabel("初始密码", { exact: true }).fill("Setup!12345")
    await page.getByLabel("确认密码", { exact: true }).fill("Other!12345")
    await page.getByRole("button", { name: "创建管理员", exact: true }).click()
    await expect(page.getByText("两次输入的密码不一致", { exact: true })).toBeVisible()
    expect(state.submissions()).toBe(0)
    expect(state.checks()).toBeGreaterThanOrEqual(2)
    await expect(page.locator("vite-error-overlay")).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`setup-${width}.png`) })
    await page.getByLabel("确认密码", { exact: true }).fill("Setup!12345")
    await page.getByRole("button", { name: "创建管理员", exact: true }).click()
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole("button", { name: "登录控制台", exact: true })).toBeVisible()
    expect(state.submissions()).toBe(1)
    await page.goto("/setup")
    await expect(page).toHaveURL(/\/login/)
    expect(errors).toEqual([])
  })
}

test("status failure shows retry without exposing initialization", async ({ page }) => {
  const state = await mockSetup(page, { failStatus: true })
  await page.goto("/")
  await expect(page.getByText("无法确认系统状态", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "创建管理员", exact: true })).toHaveCount(0)
  state.recover()
  await page.getByRole("button", { name: "重试", exact: true }).click()
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByLabel("初始密码", { exact: true })).toBeVisible()
})

test("setup page rechecks state and redirects if another client initialized", async ({ page }) => {
  await mockSetup(page, { closeOnPageCheck: true })
  await page.goto("/setup")
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole("button", { name: "登录控制台", exact: true })).toBeVisible()
})

test("competing initialization cannot leave a repeatable form", async ({ page }) => {
  const state = await mockSetup(page)
  await page.goto("/setup")
  await page.getByLabel("初始密码", { exact: true }).fill("Setup!12345")
  await page.getByLabel("确认密码", { exact: true }).fill("Setup!12345")
  state.competingSetup()
  await page.getByRole("button", { name: "创建管理员", exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  expect(state.submissions()).toBe(1)
})
