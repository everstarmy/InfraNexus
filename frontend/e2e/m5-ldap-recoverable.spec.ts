import { expect, test, type Page, type Route } from "@playwright/test";

const id = "00000000-0000-4000-8000-000000000501";
const taskId = "00000000-0000-4000-8000-000000000502";
const planId = "00000000-0000-4000-8000-000000000503";

function envelope<T>(data: T, status = 200) {
  return {
    code: status === 200 ? 200000 : status * 1000 + 1,
    message: status === 200 ? "success" : "request failed",
    data,
    request_id: "playwright-m5",
  };
}

function log(status: "running" | "partial" = "running") {
  return {
    id: taskId,
    config_id: id,
    domain: "corp.example.test",
    trigger: "manual",
    mode: "full",
    status,
    started_at: "2026-10-22T10:00:00Z",
    finished_at: status === "running" ? null : "2026-10-22T10:00:04Z",
    duration_ms: status === "running" ? 0 : 4000,
    report: {
      total: 10,
      created: 1,
      updated: 1,
      unchanged: 1,
      disabled: 0,
      skipped: 0,
      failed: 0,
      departments_created: 0,
      errors: [],
    },
    message: "",
    plan_id: planId,
    phase: status === "running" ? "applying" : "finalizing",
    processed: status === "running" ? 3 : 10,
    total: 10,
  };
}

async function installMocks(page: Page) {
  let isRunning = false;
  const syncRequests: Array<Record<string, unknown>> = [];
  const config = {
    id,
    name: "企业目录",
    type: "ad",
    domain: "corp.example.test",
    server_host: "ldap.example.test",
    port: 636,
    use_ssl: true,
    start_tls: false,
    insecure_skip_verify: false,
    bind_dn: "CN=svc,DC=example,DC=test",
    base_dn: "DC=example,DC=test",
    user_filter: "(&(objectClass=user)(sAMAccountName=%s))",
    attribute_mapping: {
      username: "sAMAccountName",
      email: "mail",
      nickname: "displayName",
      department: "department",
      external_id: "objectGUID",
    },
    department_sync: {
      strategy: "none",
      root_department_id: null,
      ou_mappings: [],
    },
    default_role_id: null,
    enabled: true,
    sync_enabled: false,
    sync_interval_minutes: 60,
    disable_missing_users: false,
    timeout_seconds: 5,
    sync_status: "idle",
    sync_started_at: null,
    sync_lease_expires_at: null,
    last_sync_at: null,
    last_success_at: null,
    has_bind_password: true,
    created_at: "2026-10-01T00:00:00Z",
  };

  await page.addInitScript(() => {
    class MockEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readyState = 1;
      onopen: ((event: Event) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      constructor() {
        super();
        queueMicrotask(() => {
          this.dispatchEvent(new MessageEvent("connected", { data: "{}" }));
          this.onopen?.(new Event("open"));
        });
      }
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
        id: "00000000-0000-4000-8000-000000000599",
        username: "m5-admin",
        email: "admin@example.test",
        nickname: "目录管理员",
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
    if (path === "/ldap/configs" && request.method() === "GET")
      return json([{ ...config, sync_status: isRunning ? "running" : "idle" }]);
    if (path === "/ldap/sync-logs" && request.method() === "GET") {
      const items = isRunning ? [log()] : [];
      return json({ items, total: items.length, page: 1, page_size: 10 });
    }
    if (path === "/options/departments")
      return json({ items: [], total: 0, page: 1, page_size: 100 });
    if (path === "/options/roles") return json([]);
    if (path === "/ldap/preview" && request.method() === "POST")
      return json({
        plan_id: planId,
        config_id: id,
        domain: config.domain,
        mode: request.postDataJSON().mode,
        generated_at: "2026-10-22T10:00:00Z",
        expires_at: "2026-10-22T10:10:00Z",
        config_revision: "2026-10-22T09:00:00Z",
        summary: {
          total: 10,
          create: 2,
          update: 3,
          unchanged: 4,
          disable: 0,
          skip: 1,
          conflict: 0,
          departments_to_create: 0,
        },
        items: [],
        departments_to_create: [],
        truncated: true,
      });
    if (path === `/ldap/sync-plans/${planId}/items`)
      return json({
        items: [
          {
            action: "update",
            username: "alice",
            nickname: "Alice",
            email: "alice@example.test",
            dn: "CN=Alice,OU=Engineering,DC=example,DC=test",
            department: "Engineering",
            changes: ["nickname"],
            diff: [{ field: "nickname", before: "A. Smith", after: "Alice" }],
          },
        ],
        total: 10,
        page: Number(url.searchParams.get("page") ?? 1),
        page_size: 50,
      });
    if (path === "/ldap/sync" && request.method() === "POST") {
      syncRequests.push(request.postDataJSON() as Record<string, unknown>);
      isRunning = true;
      return json(log());
    }
    if (path === `/ldap/sync-logs/${taskId}`) return json(log());
    return json(null, 404);
  });

  return { syncRequests };
}

test("LDAP sync uses a reviewed plan and restores persisted progress after reload", async ({
  page,
}) => {
  const mocks = await installMocks(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/ldap");
  expect(new URL(page.url()).pathname).toBe("/ldap");
  await expect(page).toHaveTitle(/InfraNexus/);
  await expect(page.getByRole("heading", { name: "目录同步" })).toBeVisible();
  await page.getByRole("button", { name: "预览同步" }).click();

  const preview = page.getByRole("dialog", { name: /同步预览/ });
  await expect(
    preview.getByText("按本次预览数据执行", { exact: false }),
  ).toBeVisible();
  await expect(preview.getByText("姓名：A. Smith → Alice")).toBeVisible();
  await expect(preview.getByText(/影响总数 10，明细按页读取/)).toBeVisible();
  if (process.env.M5_CAPTURE === "1") {
    await page.screenshot({
      path: "/private/tmp/infranexus-m5-ldap-preview.png",
      fullPage: false,
    });
  }

  await preview.getByRole("button", { name: "按此计划执行全量同步" }).click();
  const confirmation = page.getByRole("alertdialog", {
    name: "确认执行全量同步？",
  });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "按此计划执行" }).click();
  await expect.poll(() => mocks.syncRequests.length).toBe(1);
  expect(mocks.syncRequests[0]).toMatchObject({
    config_id: id,
    plan_id: planId,
    mode: "full",
  });
  expect(String(mocks.syncRequests[0].idempotency_key)).toMatch(
    /^[0-9a-f-]{36}$/,
  );

  await page.reload();
  await expect(page.getByRole("heading", { name: "目录同步" })).toBeVisible();
  await expect(page.getByRole("progressbar").first()).toHaveAttribute(
    "aria-valuenow",
    "30",
  );
  await page.getByRole("button", { name: "任务详情" }).click();
  await expect(
    page
      .getByRole("dialog", { name: /同步任务/ })
      .getByText(/已恢复任务快照：已处理 3 \/ 10/),
  ).toBeVisible();
  await expect(page.locator("[data-vite-error-overlay]")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  if (process.env.M5_CAPTURE === "1") {
    await page.screenshot({
      path: "/private/tmp/infranexus-m5-ldap-restored-task.png",
      fullPage: false,
    });
  }
});
