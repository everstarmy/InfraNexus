import { expect, test, type Page } from "@playwright/test";

const me = (permissions: string[]) => ({
  id: "00000000-0000-4000-8000-000000000901",
  username: "operator",
  nickname: "运营管理员",
  status: 1,
  auth_type: "local",
  is_admin: false,
  built_in: false,
  permissions,
  roles: [],
  preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
});

async function installMocks(page: Page, options: { permissions: string[]; loggedIn?: boolean }) {
  let loggedIn = options.loggedIn ?? true;
  const creates: Array<Record<string, unknown>> = [];
  const logins: Array<Record<string, unknown>> = [];
  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      readyState = 1;
      close() {
        this.readyState = 2;
      }
    }
    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, "");
    const json = (data: unknown, status = 200, code = status === 200 ? 200000 : status * 1000 + 1, message = "test") =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code, message, data }) });
    if (path === "/auth/me") return loggedIn ? json(me(options.permissions)) : json(null, 401);
    if (path === "/auth/login") {
      const body = req.postDataJSON();
      logins.push(body);
      if (body.password !== "Right!Pass1") return json(null, 401, 401002, "用户名或密码错误");
      loggedIn = true;
      return json({ user: me(options.permissions) });
    }
    if (path === "/auth/domains") return json([]);
    if (path === "/options/roles") return json([{ id: "r1", code: "auditor", name: "审计员", status: 1 }]);
    if (path === "/options/departments" || path === "/departments/tree") return json({ revision: 3, items: [] });
    if (path === "/users/stats")
      return json({ total: 0, active: 0, disabled: 0, local: 0, directory: 0, unassigned: 0, by_domain: [] });
    if (path === "/users" && req.method() === "POST") {
      const body = req.postDataJSON();
      creates.push(body);
      return json({ id: "00000000-0000-4000-8000-000000000902", ...body, roles: [], status: 1, auth_type: "local", edit_revision: 1 });
    }
    return json({ items: [], total: 0, page: 1, page_size: 10 });
  });
  return { creates, logins };
}

test("user creation without role-grant permission keeps the password field and explains invalid input", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mocks = await installMocks(page, {
    permissions: ["users", "users:create", "api:GET:/api/v1/users", "api:GET:/api/v1/users/stats", "api:POST:/api/v1/users"],
  });
  await page.goto("/users");
  await page.getByRole("button", { name: "新建用户" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新建用户" });
  await expect(dialog.getByLabel("初始密码")).toBeVisible();
  await expect(dialog.getByText("初始角色")).toHaveCount(0);

  const submit = dialog.getByRole("button", { name: "创建用户" });
  await expect(submit).toBeEnabled();
  await dialog.getByLabel("用户名").fill("ab");
  await submit.click();
  await expect(dialog.getByText("用户名需为 3-32 个字符")).toBeVisible();
  await expect(dialog.getByText("请输入有效的邮箱地址")).toBeVisible();
  await expect(dialog.getByText(/密码强度不足/)).toBeVisible();
  await expect(dialog.getByLabel("用户名")).toBeFocused();
  expect(mocks.creates).toHaveLength(0);

  await dialog.getByLabel("用户名").fill("new-operator");
  await expect(dialog.getByText("用户名需为 3-32 个字符")).toHaveCount(0);
  await dialog.getByLabel("电子邮箱").fill("new-operator@example.test");
  await dialog.getByRole("button", { name: "随机生成" }).click();
  await expect(dialog.getByText(/密码强度不足/)).toHaveCount(0);
  await submit.click();
  await expect(dialog).toBeHidden();
  expect(mocks.creates).toHaveLength(1);
  expect(mocks.creates[0]).not.toHaveProperty("role_ids");
  expect(String(mocks.creates[0].password)).not.toBe("");
  expect(errors).toEqual([]);
});

test("failed sign-in keeps the account, clears only the password and has no stale demo hint", async ({ page }) => {
  const mocks = await installMocks(page, { permissions: ["*"], loggedIn: false });
  await page.goto("/login");
  const username = page.getByLabel("用户名", { exact: true });
  const password = page.getByLabel("登录密码", { exact: true });
  await expect(username).toHaveValue("");
  await expect(password).toHaveValue("");
  await expect(page.getByText(/演示账号/)).toHaveCount(0);

  await page.getByRole("button", { name: "登录控制台", exact: true }).click();
  await expect(page.getByText("请输入用户名")).toBeVisible();
  await expect(username).toBeFocused();
  expect(mocks.logins).toHaveLength(0);

  await username.fill("admin");
  await password.fill("wrong-pass");
  await page.getByRole("button", { name: "登录控制台", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "用户名或密码错误" })).toBeVisible();
  await expect(username).toHaveValue("admin");
  await expect(password).toHaveValue("");
  await expect(password).toBeFocused();
  await expect(page.getByText("请输入密码")).toHaveCount(0);

  await password.fill("Right!Pass1");
  await expect(page.getByRole("alert").filter({ hasText: "用户名或密码错误" })).toHaveCount(0);
  await page.getByRole("button", { name: "登录控制台", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
});

test("a page whose code cannot be loaded shows a recoverable error inside the shell", async ({ page }) => {
  await installMocks(page, { permissions: ["*"] });
  await page.route("**/src/pages/roles/index.tsx*", (route) => route.abort());
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await page.getByRole("link", { name: "角色管理" }).first().click();
  const alert = page.getByRole("alert").filter({ hasText: "页面版本已更新" });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "重新加载" })).toBeVisible();
  await page.getByRole("link", { name: "用户管理" }).first().click();
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
});

test("pinned table columns share the header and row surface of scrolling columns", async ({ page }) => {
  await installMocks(page, { permissions: ["*"] });
  await page.route("**/api/v1/roles?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200000,
        message: "ok",
        data: {
          items: [{ id: "r1", code: "auditor", name: "审计员", description: "", status: 1, built_in: false, user_count: 0, edit_revision: 1, permissions: [] }],
          total: 1,
          page: 1,
          page_size: 20,
        },
      }),
    }),
  );
  await page.goto("/roles");
  const table = page.locator('[data-slot="data-table"] table');
  await expect(table.getByText("审计员", { exact: true })).toBeVisible();
  const background = (selector: string) =>
    table.locator(selector).evaluate((element) => {
      // Resolve the effective colour of a translucent cell against its row/table.
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      const layers: string[] = [];
      for (let node: Element | null = element; node && node !== document.body; node = node.parentElement)
        layers.unshift(getComputedStyle(node).backgroundColor);
      for (const layer of ["#fff", ...layers]) {
        ctx.fillStyle = layer;
        ctx.fillRect(0, 0, 1, 1);
      }
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    });
  const pinnedHead = await background("thead th:last-child");
  const plainHead = await background("thead th:nth-child(2)");
  plainHead.forEach((channel, index) => expect(Math.abs(channel - pinnedHead[index])).toBeLessThanOrEqual(2));

  const row = table.locator("tbody tr").first();
  await row.locator("td").nth(1).hover();
  await page.waitForTimeout(300);
  const pinnedCell = await background("tbody tr:first-child td:last-child");
  const plainCell = await background("tbody tr:first-child td:nth-child(2)");
  plainCell.forEach((channel, index) => expect(Math.abs(channel - pinnedCell[index])).toBeLessThanOrEqual(2));
});
