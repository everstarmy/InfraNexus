import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const id = "00000000-0000-4000-8000-000000000701";
async function installCASMocks(context: BrowserContext) {
  let user = {
    id,
    username: "alice",
    email: "alice@example.test",
    nickname: "Alice",
    edit_revision: 1,
    domain: "",
    status: 1,
    auth_type: "local",
    built_in: false,
    roles: [],
    department_id: null,
  };
  const writes: Array<Record<string, unknown>> = [];
  let fail = false;
  let reads = 0;
  await context.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      close() {
        this.readyState = 2;
      }
      constructor() {
        super();
        (window as any).__source = this;
      }
    }
    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
  await context.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api\/v1/, "");
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          code: status === 200 ? 200000 : status * 1000 + 1,
          message: status === 500 ? "injected save failure" : "test",
          data,
        }),
      });
    if (path === "/auth/me")
      return json({
        id: "admin",
        username: "admin",
        nickname: "管理员",
        status: 1,
        auth_type: "local",
        is_admin: true,
        built_in: true,
        permissions: ["*"],
        roles: [],
        preferences: { theme: "light", locale: "zh-CN", pinned_routes: [] },
      });
    if (path === "/auth/domains" || path === "/options/roles") return json([]);
    if (path === "/options/departments" || path === "/departments/tree")
      return json({ revision: 1, items: [] });
    if (path === "/users/stats")
      return json({
        total: 1,
        active: 1,
        disabled: 0,
        local: 1,
        directory: 0,
        unassigned: 1,
        by_domain: [],
      });
    if (path === "/users" && req.method() === "GET") {
      reads++;
      return json({ items: [user], total: 1, page: 1, page_size: 10 });
    }
    if (path === `/users/${id}` && req.method() === "GET") return json(user);
    if (path === `/users/${id}` && req.method() === "PUT") {
      const body = req.postDataJSON();
      writes.push(body);
      if (fail) return json(null, 500);
      if (body.expected_revision !== user.edit_revision) return json(null, 409);
      user = {
        ...user,
        ...(body.email !== undefined && { email: body.email }),
        ...(body.nickname !== undefined && { nickname: body.nickname }),
        edit_revision: user.edit_revision + 1,
      };
      return json(user);
    }
    return json({ items: [], total: 0, page: 1, page_size: 10 });
  });
  return {
    writes,
    current: () => user,
    reads: () => reads,
    failSave: (value: boolean) => {
      fail = value;
    },
  };
}
async function openEdit(page: Page) {
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await page.getByRole("button", { name: "alice 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑资料" }).click();
  await expect(page.getByRole("heading", { name: "编辑用户" })).toBeVisible();
}

test("two user forms preserve separate field changes across refetch and conflict", async ({
  context,
  page,
}) => {
  const mock = await installCASMocks(context);
  const other = await context.newPage();
  await page.goto("/users");
  await other.goto("/users");
  await openEdit(page);
  await openEdit(other);
  await page.getByLabel("电子邮箱").fill("draft@example.test");
  await other.getByRole("textbox", { name: "姓名 / 昵称", exact: true }).fill("Bob updated");
  await other.getByRole("button", { name: "保存修改" }).click();
  await expect(other.getByRole("heading", { name: "编辑用户" })).toHaveCount(0);
  const before = mock.reads();
  await page.evaluate(() =>
    (window as any).__source.dispatchEvent(
      new MessageEvent("snapshot.required", {
        data: "{}",
        lastEventId: "100-1",
      }),
    ),
  );
  await expect.poll(mock.reads).toBeGreaterThan(before);
  await expect(page.getByLabel("电子邮箱")).toHaveValue("draft@example.test");
  await expect(page.getByRole("textbox", { name: "姓名 / 昵称", exact: true })).toHaveValue("Alice");
  await page.getByRole("button", { name: "保存修改" }).click();
  const conflict = page.getByRole("group", { name: "用户资料并发冲突" });
  await expect(conflict).toBeVisible();
  expect(mock.writes[1]).toEqual({
    expected_revision: 1,
    email: "draft@example.test",
  });
  await conflict
    .getByRole("button", { name: "确认保留草稿并继续编辑" })
    .click();
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "编辑用户" })).toHaveCount(0);
  expect(mock.current()).toMatchObject({
    nickname: "Bob updated",
    email: "draft@example.test",
    edit_revision: 3,
  });
});

test("failed user save keeps back-navigation and unload protection until success", async ({
  context,
  page,
}) => {
  const mock = await installCASMocks(context);
  await page.goto("/roles");
  await page.getByRole("link", { name: "用户管理", exact: true }).click();
  await openEdit(page);
  await page.getByLabel("电子邮箱").fill("draft@example.test");
  mock.failSave(true);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("alert")).toBeFocused();
  const unloadAllowed = () =>
    page.evaluate(() =>
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    );
  expect(await unloadAllowed()).toBe(false);
  const back = page.goBack();
  const prompt = page.getByRole("alertdialog");
  await expect(prompt).toContainText("离开当前页面？");
  await prompt.getByRole("button", { name: "取消", exact: true }).click();
  await back;
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByLabel("电子邮箱")).toHaveValue("draft@example.test");
  mock.failSave(false);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "编辑用户" })).toHaveCount(0);
  expect(await unloadAllowed()).toBe(true);
  await page.getByRole("link", { name: "角色管理", exact: true }).click();
  await expect(page).toHaveURL(/\/roles$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
