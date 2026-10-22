import { expect, test, type Route } from "@playwright/test";

const userID = "00000000-0000-4000-8000-000000000701";

function envelope<T>(data: T, status = 200) {
  return {
    code: status === 200 ? 200000 : status * 1000 + 1,
    message: status === 200 ? "success" : "revision conflict",
    data,
    request_id: "playwright-r10",
  };
}

test("user edit keeps its draft across a conflict and retries from the confirmed revision", async ({
  page,
}) => {
  let user = {
    id: userID,
    edit_revision: 1,
    username: "alice",
    domain: "",
    email: "alice@example.test",
    nickname: "Alice",
    status: 1,
    auth_type: "local",
    built_in: false,
    department_id: null,
    roles: [],
  };
  let conflictNextWrite = true;
  const writes: Array<{
    expected_revision: number;
    email?: string;
    nickname?: string;
  }> = [];

  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly readyState = 1;
      close() {
        this.readyState = MockEventSource.CLOSED;
      }
    }
    window.EventSource = MockEventSource as unknown as typeof EventSource;
  });
  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(envelope(data, status)),
      });

    if (path === "/auth/me")
      return json({
        id: "00000000-0000-4000-8000-000000000702",
        username: "admin",
        email: "admin@example.test",
        nickname: "管理员",
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
    if (path === "/options/departments")
      return json({ revision: 1, items: [] });
    if (path === "/options/roles") return json([]);
    if (path === "/departments/tree") return json({ revision: 1, items: [] });
    if (path === "/users" && request.method() === "GET")
      return json({ items: [user], total: 1, page: 1, page_size: 10 });
    if (path === `/users/${userID}` && request.method() === "GET")
      return json(user);
    if (path === `/users/${userID}` && request.method() === "PUT") {
      const body = request.postDataJSON() as {
        expected_revision: number;
        email?: string;
        nickname?: string;
      };
      writes.push(body);
      if (body.expected_revision !== user.edit_revision) return json(null, 409);
      if (conflictNextWrite) {
        conflictNextWrite = false;
        user = {
          ...user,
          nickname: "Bob 的更新",
          edit_revision: user.edit_revision + 1,
        };
        return json(null, 409);
      }
      user = {
        ...user,
        ...(body.email !== undefined && { email: body.email }),
        ...(body.nickname !== undefined && { nickname: body.nickname }),
        edit_revision: user.edit_revision + 1,
      };
      return json(user);
    }
    return json(null, 404);
  });

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  const alice = page.getByRole("row").filter({ hasText: "alice" });
  await alice.getByRole("button", { name: "alice 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "编辑资料" }).click();
  await page.getByLabel("电子邮箱").fill("alice-draft@example.test");
  await page.getByRole("button", { name: "保存修改" }).click();

  const conflict = page.getByRole("group", { name: "用户资料并发冲突" });
  await expect(conflict).toBeVisible();
  await expect(page.getByRole("alert")).toBeFocused();
  await expect(page.getByLabel("电子邮箱")).toHaveValue(
    "alice-draft@example.test",
  );
  await expect(conflict).toContainText("你的草稿“alice-draft@example.test”");
  await expect(conflict).toContainText("服务器当前值“alice@example.test”");
  await expect(conflict).toContainText(
    "昵称：你的草稿“Alice”；服务器当前值“Bob 的更新”",
  );
  expect(writes).toEqual([
    { expected_revision: 1, email: "alice-draft@example.test" },
  ]);

  await conflict
    .getByRole("button", { name: "确认保留草稿并继续编辑" })
    .click();
  await expect(
    page.getByRole("group", { name: "用户资料并发冲突" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "编辑用户" })).toHaveCount(0);
  expect(writes).toEqual([
    { expected_revision: 1, email: "alice-draft@example.test" },
    { expected_revision: 2, email: "alice-draft@example.test" },
  ]);
});
