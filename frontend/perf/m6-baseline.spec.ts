import { expect, test, type Page, type Route } from "@playwright/test";

const configID = "00000000-0000-4000-8000-000000000681";
const planID = "00000000-0000-4000-8000-000000000682";
let treeSize = 1_000;
let treeShape: "flat" | "mixed" = "flat";

function envelope<T>(data: T, status = 200) {
  return {
    code: status === 200 ? 200000 : status * 1000 + 1,
    message: status === 200 ? "success" : "temporary test failure",
    data,
    request_id: "playwright-m6-performance",
  };
}

function directoryConfig() {
  return {
    id: configID,
    name: "性能采样目录",
    type: "ldap",
    domain: "corp.example.test",
    server_host: "ldap.example.test",
    port: 636,
    use_ssl: true,
    start_tls: false,
    insecure_skip_verify: false,
    bind_dn: "CN=svc,DC=example,DC=test",
    base_dn: "DC=example,DC=test",
    user_filter: "(&(objectClass=user)(uid=%s))",
    attribute_mapping: {
      username: "uid",
      email: "mail",
      nickname: "cn",
      department: "ou",
      external_id: "entryUUID",
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
}

function departmentNodes(count: number) {
  const nodes = Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    const id = `00000000-0000-4000-8000-${suffix}`;
    return {
      id,
      parent_id: null as string | null,
      name: `性能采样部门 ${index + 1}`,
      code: `perf-${String(index + 1).padStart(5, "0")}`,
      sort_order: index + 1,
      leader_id: null,
      leader_name: "",
      phone: "",
      email: "",
      status: 1,
      source: "local" as const,
      tree_path: `/root/${id}`,
      depth: 0,
      member_count: 0,
      total_member_count: 0,
      children: [],
    };
  });
  if (treeShape === "flat") return nodes;
  for (let index = 1; index < nodes.length; index += 1) {
    const parent = nodes[Math.floor((index - 1) / 8)];
    const node = nodes[index];
    node.parent_id = parent.id;
    node.depth = parent.depth + 1;
    node.tree_path = `${parent.tree_path}/${node.id}`;
    parent.children.push(node);
  }
  return nodes.length ? [nodes[0]] : [];
}

function userPage(pageNumber: number, pageSize: number) {
  const first = (pageNumber - 1) * pageSize + 1;
  return Array.from({ length: pageSize }, (_, index) => {
    const number = first + index;
    const suffix = String(number).padStart(12, "0");
    return {
      id: `00000000-0000-4000-8000-${suffix}`,
      edit_revision: 1,
      username: `perf-user-${number}`,
      domain: "",
      email: `perf-user-${number}@example.test`,
      nickname: `性能用户 ${number}`,
      status: 1,
      auth_type: "local",
      built_in: false,
      roles: [],
      created_at: "2026-10-01T00:00:00Z",
    };
  });
}

async function installPerformanceMocks(page: Page) {
  await page.addInitScript(() => {
    const measurements: number[] = [];
    Object.defineProperty(window, "__m6StartedAt", {
      value: performance.now(),
      configurable: false,
    });
    Object.defineProperty(window, "__m6LongTasks", {
      value: measurements,
      configurable: false,
    });
    if ("PerformanceObserver" in window) {
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            measurements.push(entry.duration);
        }).observe({ type: "longtask", buffered: true });
      } catch {
        // The metric is optional in browsers without Long Tasks support.
      }
    }
  });

  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const json = (data: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(envelope(data)),
      });

    if (path === "/auth/me")
      return json({
        id: "00000000-0000-4000-8000-000000000689",
        username: "m6-perf",
        email: "perf@example.test",
        nickname: "性能采样员",
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
    if (path === "/departments/tree")
      return json({ revision: 1, items: departmentNodes(treeSize) });
    if (path === "/users") {
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("page_size") ?? 10);
      return json({
        items: userPage(pageNumber, pageSize),
        total: 1_000,
        page: pageNumber,
        page_size: pageSize,
      });
    }
    if (path === "/ldap/configs") return json([directoryConfig()]);
    if (path === "/ldap/sync-logs")
      return json({ items: [], total: 0, page: 1, page_size: 10 });
    if (path === "/options/departments")
      return json({ items: [], total: 0, page: 1, page_size: 100 });
    if (path === "/options/roles") return json([]);
    if (path === "/ldap/preview" && request.method() === "POST")
      return json({
        plan_id: planID,
        config_id: configID,
        domain: "corp.example.test",
        mode: "full",
        generated_at: "2026-10-22T10:00:00Z",
        expires_at: "2026-10-22T10:10:00Z",
        config_revision: "2026-10-22T09:00:00Z",
        summary: {
          total: 500,
          create: 500,
          update: 0,
          unchanged: 0,
          disable: 0,
          skip: 0,
          conflict: 0,
          departments_to_create: 0,
        },
        items: [],
        departments_to_create: [],
        truncated: true,
      });
    if (path === `/ldap/sync-plans/${planID}/items`) {
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("page_size") ?? 50);
      return json({
        items: Array.from({ length: Math.min(pageSize, 500) }, (_, index) => {
          const number = (pageNumber - 1) * pageSize + index + 1;
          return {
            action: "create",
            username: `perf-user-${String(number).padStart(4, "0")}`,
            nickname: `性能用户 ${number}`,
            email: `perf-user-${number}@example.test`,
            dn: `CN=Performance User ${number},OU=Engineering,DC=example,DC=test`,
            department: "Engineering",
            changes: ["username", "email", "department"],
            diff: [],
          };
        }),
        total: 500,
        page: pageNumber,
        page_size: pageSize,
      });
    }
    return json(null);
  });
}

function percentile(values: number[], p: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[
    Math.min(ordered.length - 1, Math.ceil(p * ordered.length) - 1)
  ];
}

test("records production bundle, large tree and paged LDAP preview baseline", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await installPerformanceMocks(page);

  await page.goto("/users");
  const userRows = page.locator("tbody tr");
  await expect(userRows).toHaveCount(10);
  const maxPageStarted = Date.now();
  await page.getByRole("button", { name: "10 条/页" }).click();
  await page.getByRole("menuitem", { name: "100 条/页" }).click();
  await expect(userRows).toHaveCount(100);
  const usersMaxPage = {
    rows: await userRows.count(),
    transitionWallClockMs: Date.now() - maxPageStarted,
    domElements: await page.evaluate(
      () => document.querySelectorAll("*").length,
    ),
  };

  const treeMeasurements = [];
  const treeScenarios = [
    { size: 1_000, shape: "flat" as const },
    { size: 10_000, shape: "flat" as const },
    { size: 10_000, shape: "mixed" as const },
  ];
  for (const { size, shape } of treeScenarios) {
    treeSize = size;
    treeShape = shape;
    const startupRuns: Array<{
      wallClockMs: number;
      browserMs: number;
      domElements: number;
      renderedRows: number;
      longestTaskMs: number;
    }> = [];
    for (let round = 0; round < 3; round += 1) {
      const startedAt = Date.now();
      if (size === 1_000 && round === 0) await page.goto("/departments");
      else if (size === 1_000) await page.reload();
      else if (round === 0) await page.goto("/departments");
      else await page.reload();
      const tree = page.locator("[role=tree]");
      const treeFilter = page.getByPlaceholder("搜索部门名称或编码");
      if (shape === "mixed") {
        await expect(treeFilter).toBeVisible({ timeout: 90_000 });
        await treeFilter.fill("perf-");
      }
      await expect(tree).toHaveAttribute("data-tree-total", String(size), {
        timeout: 90_000,
      });
      const browserMetrics = await page.evaluate(() => {
        const tasks = (window as Window & { __m6LongTasks: number[] })
          .__m6LongTasks;
        return {
          browserMs:
            performance.now() -
            (window as Window & { __m6StartedAt: number }).__m6StartedAt,
          domElements: document.querySelectorAll("*").length,
          renderedRows: Number(
            document
              .querySelector("[role=tree]")
              ?.getAttribute("data-tree-rendered") ?? 0,
          ),
          longestTaskMs: Math.max(0, ...tasks),
        };
      });
      startupRuns.push({
        wallClockMs: Date.now() - startedAt,
        ...browserMetrics,
      });
      expect(
        browserMetrics.renderedRows,
        `${size} department virtual row budget`,
      ).toBeLessThanOrEqual(80);
      expect(
        browserMetrics.domElements,
        `${size} department DOM budget`,
      ).toBeLessThan(10_000);
      expect(
        browserMetrics.longestTaskMs,
        `${size} department long-task budget`,
      ).toBeLessThanOrEqual(200);
    }
    const treeFilter = page.getByPlaceholder("搜索部门名称或编码");
    const treeFilterLatencyMs: number[] = [];
    for (let index = 1; index <= 20; index += 1) {
      const target = size - index;
      const started = await page.evaluate(() => performance.now());
      await treeFilter.fill(`perf-${String(target).padStart(5, "0")}`);
      await expect(
        page.locator("[data-department-tree-node][data-current-match]"),
      ).toHaveCount(1);
      treeFilterLatencyMs.push(
        await page.evaluate((start) => performance.now() - start, started),
      );
    }
    treeMeasurements.push({
      departments: size,
      shape,
      startupP95Ms: percentile(
        startupRuns.map((run) => run.wallClockMs),
        0.95,
      ),
      runs: startupRuns,
      treeFilterLatencyP50Ms: percentile(treeFilterLatencyMs, 0.5),
      treeFilterLatencyP95Ms: percentile(treeFilterLatencyMs, 0.95),
    });
    expect(
      percentile(
        startupRuns.map((run) => run.wallClockMs),
        0.95,
      ),
      `${size} ${shape} department startup p95`,
    ).toBeLessThanOrEqual(2_000);
    expect(
      percentile(treeFilterLatencyMs, 0.95),
      `${size} department filter p95`,
    ).toBeLessThan(100);
  }

  const viewportScenarios = [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ];
  const departmentSearch = page.getByPlaceholder("搜索部门名称或编码");
  await departmentSearch.fill("");
  for (const viewport of viewportScenarios) {
    for (const colorScheme of ["light", "dark"] as const) {
      for (const reducedMotion of ["reduce", "no-preference"] as const) {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme, reducedMotion });
        await expect(page.locator("[role=tree]")).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBeTruthy();
      }
    }
  }

  await page.goto("/ldap");
  await expect(page.getByRole("heading", { name: "目录同步" })).toBeVisible();
  const previewStart = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "预览同步" }).click();
  const preview = page.getByRole("dialog", { name: /同步预览/ });
  await expect(preview.getByText("perf-user-0001")).toBeVisible();
  await expect(preview.getByText(/影响总数 500/)).toBeVisible();
  const previewReady = await page.evaluate(() => performance.now());
  const filter = preview.getByPlaceholder("搜索当前页账号或部门");
  const filterLatencyMs: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const started = await page.evaluate(() => performance.now());
    await filter.fill(`perf-user-${String(index).padStart(4, "0")}`);
    filterLatencyMs.push(
      await page.evaluate((start) => performance.now() - start, started),
    );
  }

  console.log(
    JSON.stringify(
      {
        environment: {
          browser: browser.version(),
          userAgent: await page.evaluate(() => navigator.userAgent),
          devicePixelRatio: await page.evaluate(() => devicePixelRatio),
        },
        usersMaxPage,
        tree: treeMeasurements,
        ldapPreview: {
          planItems: 500,
          renderedPageSize: 50,
          readyMs: previewReady - previewStart,
          filterLatencyP50Ms: percentile(filterLatencyMs, 0.5),
          filterLatencyP95Ms: percentile(filterLatencyMs, 0.95),
        },
      },
      null,
      2,
    ),
  );
});
