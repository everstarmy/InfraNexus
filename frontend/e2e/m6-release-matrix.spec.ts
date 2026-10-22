import { expect, test, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const modules = [
  { path: "/dashboard", heading: /M6 验收员/ },
  { path: "/users", heading: "用户管理" },
  { path: "/departments", heading: "部门管理" },
  { path: "/roles", heading: "角色管理" },
  { path: "/permissions", heading: "权限清单" },
  { path: "/ldap", heading: "目录同步" },
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

test("six admin modules stay usable at release viewport widths during API failures", async ({
  page,
}) => {
  await installFailureMocks(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const viewport of viewports) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    for (const module of modules) {
      await page.goto(module.path);
      await expect(
        page.getByRole("heading", { name: module.heading }),
        `${module.path} heading should remain available at ${viewport.name}`,
      ).toBeVisible();
      const width = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(
        width,
        `${module.path} overflowed by ${width}px at ${viewport.name}`,
      ).toBeLessThanOrEqual(0);
      if (viewport.width === 1440) {
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        const summary = results.violations.map(({ id, impact, nodes }) => ({
          id,
          impact: impact ?? "unknown",
          nodes: nodes.map(({ target, failureSummary }) => ({
            target,
            failureSummary,
          })),
        }));
        console.log(
          `axe ${module.path}: ${JSON.stringify(summary) || "no violations"}`,
        );
        const severe = results.violations.filter(
          ({ impact }) => impact === "critical" || impact === "serious",
        );
        expect(
          severe.map(({ id, impact, nodes }) => ({
            id,
            impact,
            targets: nodes.map(({ target }) => target),
          })),
          `${module.path} has serious WCAG A/AA violations`,
        ).toEqual([]);
      }
    }
  }

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "切换至深色模式" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const module of modules) {
    await page.goto(module.path);
    await expect(
      page.getByRole("heading", { name: module.heading }),
    ).toBeVisible();
    await page
      .locator("html")
      .evaluate((element) => element.classList.add("dark"));
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const severe = results.violations.filter(
      ({ impact }) => impact === "critical" || impact === "serious",
    );
    expect(
      severe.map(({ id, impact, nodes }) => ({
        id,
        impact,
        targets: nodes.map(({ target }) => target),
      })),
      `${module.path} has serious dark-theme WCAG A/AA violations`,
    ).toEqual([]);
  }
  await page.keyboard.press("Tab");
  await expect
    .poll(() => page.evaluate(() => document.activeElement !== document.body))
    .toBe(true);
  expect(pageErrors).toEqual([]);
});
