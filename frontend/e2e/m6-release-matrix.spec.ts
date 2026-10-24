import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const modules = [
  { path: "/dashboard", errorLabel: "工作台数据", heading: /M6 验收员/ },
  { path: "/users", errorLabel: "用户列表", heading: "用户管理" },
  { path: "/departments", errorLabel: "部门树", heading: "部门管理" },
  { path: "/roles", errorLabel: "角色列表", heading: "角色管理" },
  { path: "/permissions", errorLabel: "权限树", heading: "权限清单" },
  { path: "/ldap", errorLabel: "目录配置", heading: "身份源集成" },
] as const;

const viewports = [
  { name: "320px compact", width: 320, height: 740 },
  { name: "768px tablet", width: 768, height: 900 },
  { name: "1440px desktop", width: 1440, height: 1000 },
  { name: "2560px wide", width: 2560, height: 1440 },
] as const;

function envelope<T>(data: T, status = 200) {
  return {
    code: status === 200 ? 200000 : status * 1000 + 1,
    message: status === 200 ? "success" : "temporary test failure",
    data,
    request_id: "playwright-m6-release-matrix",
  };
}

async function installFailureMocks(page: Page) {
  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(envelope(data, status)),
      });

    if (path === "/auth/me")
      return json({
        id: "00000000-0000-4000-8000-000000000601",
        username: "m6-admin",
        email: "m6@example.test",
        nickname: "M6 验收员",
        status: 1,
        auth_type: "local",
        built_in: true,
        is_admin: true,
        permissions: ["*"],
        roles: [{ id: "admin", code: "admin", name: "管理员" }],
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      });
    if (path === "/auth/domains") return json([]);
    if (path === "/sse/notifications") return route.abort("failed");

    // Exercise each module's visible failure state while keeping shell and
    // navigation available for responsive layout checks.
    return json(null, 500);
  });
}

async function assertSettledFailure(page: Page, label: string) {
  const alert = page
    .getByRole("alert")
    .filter({ hasText: `${label}暂时无法加载` });
  await expect(alert).toBeVisible();
  await expect(
    alert.getByRole("button", { name: "重试", exact: true }),
  ).toBeEnabled();
}

async function assertAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      })),
    `${label} serious WCAG A/AA violations`,
  ).toEqual([]);
}

for (const viewport of viewports) {
  test(`six admin modules stay usable at ${viewport.name} during API failures`, async ({
    page,
  }, testInfo) => {
    await installFailureMocks(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const module of modules) {
      await page.goto(module.path);
      await expect(
        page.getByRole("heading", { name: module.heading }),
        `${module.path} heading at ${viewport.name}`,
      ).toBeVisible();
      await assertSettledFailure(page, module.errorLabel);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
        `${module.path} horizontal overflow at ${viewport.name}`,
      ).toBeLessThanOrEqual(0);
      if (viewport.width === 1440) await assertAxe(page, module.path);
    }
    await page.keyboard.press("Tab");
    await expect
      .poll(() => page.evaluate(() => document.activeElement !== document.body))
      .toBe(true);
    expect(pageErrors).toEqual([]);
    if (viewport.width === 1440 || viewport.width === 320)
      await testInfo.attach(`failure-layout-${viewport.width}`, {
        path: await page
          .screenshot({
            path: testInfo.outputPath(`failure-layout-${viewport.width}.png`),
          })
          .then(() =>
            testInfo.outputPath(`failure-layout-${viewport.width}.png`),
          ),
        contentType: "image/png",
      });
  });
}

test("six admin modules pass dark theme and reduced motion accessibility checks", async ({
  page,
}, testInfo) => {
  await installFailureMocks(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "切换至深色模式" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  for (const module of modules) {
    await page.goto(module.path);
    await expect(
      page.getByRole("heading", { name: module.heading }),
    ).toBeVisible();
    await assertSettledFailure(page, module.errorLabel);
    await page
      .locator("html")
      .evaluate((element) => element.classList.add("dark"));
    await assertAxe(page, `${module.path} dark theme`);
  }
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement !== document.body))
    .toBe(true);
  expect(pageErrors).toEqual([]);
  await testInfo.attach("dark-failure-layout", {
    path: await page
      .screenshot({ path: testInfo.outputPath("dark-failure-layout.png") })
      .then(() => testInfo.outputPath("dark-failure-layout.png")),
    contentType: "image/png",
  });
});
