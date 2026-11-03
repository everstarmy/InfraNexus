import { test, expect } from "@playwright/test"

test("cross-page selection, exclusions and batch notifications without result panels", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const users = Array.from({ length: 12 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    username: `member${i}`,
    nickname: `成员${i}`,
    email: `m${i}@example.test`,
    status: 1,
    auth_type: "local",
    roles: [],
    edit_revision: 1,
  }))
  const exports: { selection: { mode: string; ids: string[] }; fields: string[] }[] = []
  const executions: { items: { id: string }[] }[] = []
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "")
    const json = (data: unknown) => route.fulfill({ json: { code: 200000, data } })
    if (path === "/auth/setup") return json({ initialized: true })
    if (path === "/auth/me")
      return json({
        ...users[0],
        id: "actor",
        is_admin: true,
        permissions: ["*"],
        preferences: {},
        roles: [],
      })
    if (path === "/users") {
      const p = Number(new URL(route.request().url()).searchParams.get("page") || 1)
      return json({ items: users.slice((p - 1) * 10, p * 10), total: 12, page: p, page_size: 10 })
    }
    if (path === "/users/stats")
      return json({
        total: 12,
        active: 12,
        disabled: 0,
        local: 12,
        directory: 0,
        unassigned: 12,
        by_domain: [],
      })
    if (path === "/options/departments" || path === "/departments/tree")
      return json({ revision: 1, items: [] })
    if (path === "/users/export") {
      exports.push(route.request().postDataJSON())
      return route.fulfill({
        contentType: "text/csv; charset=utf-8",
        body: "\ufeff用户名\r\nmember10\r\n",
      })
    }
    if (path === "/users/batch-status/preview") {
      const selection = route.request().postDataJSON().selection
      const matched = selection.mode === "ids" ? users.filter(user => selection.ids.includes(user.id)) : users.slice(0, 2)
      return json({
        matched: 2,
        eligible: 2,
        skipped: 0,
        items: matched.map((user) => ({ id: user.id, revision: 1, outcome: "eligible" })),
      })
    }
    if (path === "/users/batch-status") {
      const body = route.request().postDataJSON()
      executions.push(body)
      return json({
        success: 1,
        failed: executions.length === 1 ? 1 : 0,
        skipped: 0,
        new_matches: 0,
        items: body.items.map((item: { id: string }, i: number) => ({
          ...item,
          outcome: executions.length === 1 && i === 1 ? "failed" : "success",
          reason: "临时错误",
          retryable: i === 1,
        })),
      })
    }
    return json([])
  })
  await page.goto("/users")
  await page.getByRole("button", { name: "数据操作", exact: true }).click()
  const exportButton = page.getByRole("button", { name: "导出", exact: true })
  await expect(exportButton).toHaveText("")
  await exportButton.click()
  await expect(page.getByRole("button", { name: "导出当前页 CSV", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  for (const checkbox of [page.getByRole('checkbox', { name: '全选当页数据' }), page.getByRole('checkbox', { name: '勾选该行；按住 Shift 可连续选择' }).first()]) {
    const offset = await checkbox.evaluate(el => {
      const box = el.getBoundingClientRect(), cell = el.closest('th,td')!.getBoundingClientRect()
      return Math.abs(box.left + box.width / 2 - cell.left - cell.width / 2)
    })
    expect(offset).toBeLessThanOrEqual(1)
  }
  const row = page.locator('tbody tr[data-row-id]').first()
  expect(await row.getByRole('button', { name: '展开行详情' }).evaluate(el => el.closest('td')?.cellIndex)).not.toBe(
    await row.getByRole('checkbox', { name: '勾选该行；按住 Shift 可连续选择' }).evaluate(el => el.closest('td')?.cellIndex),
  )
  for (const width of [390, 1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/infranexus-table-refined-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const username = page.getByText('member0', { exact: true })
  const box = (await username.boundingBox())!
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('member')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: '高级查询' }).click()
  await expect(page.getByRole('dialog', { name: '高级查询与排序' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByText(/选择与批量操作/)).toHaveCount(0)
  await expect(page.getByRole("button", { name: /复制.*单元格/ })).toHaveCount(0)
  await expect(page.getByText("左右滚动查看更多列")).toHaveCount(0)
  await page.getByRole("checkbox", { name: "勾选该行；按住 Shift 可连续选择" }).first().click()
  await page.getByRole("button", { name: "批量操作", exact: true }).click()
  await expect(page.getByRole("button", { name: "选择详情", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "批量操作", exact: true })).toContainText("已选 1 条")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "下一页", exact: true }).click()
  await page.getByRole("button", { name: "批量操作", exact: true }).click()
  await page.getByRole("button", { name: "选择详情", exact: true }).click()
  await expect(page.getByRole("heading", { name: "已选 1 条 · 当前页 0 条" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-slot="data-table-pagination"]')).toContainText("已选 1 条")
  await page.getByRole("checkbox", { name: "全选当页数据" }).click()
  if (!await page.getByRole("button", { name: "选择全部匹配 12 条" }).isVisible()) await page.getByRole("button", { name: "批量操作", exact: true }).click()
  await page.getByRole("button", { name: "选择全部匹配 12 条" }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("checkbox", { name: "全选当页数据" }).click()
  await page.getByRole("button", { name: "批量操作", exact: true }).click()
  await expect(page.getByRole("button", { name: "选择详情", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "批量操作", exact: true })).toContainText("已选 约 10 条")
  await expect(page.locator('[data-slot="data-table-pagination"]')).toContainText("已选 约 10 条")
  await page.getByRole("button", { name: "批量停用", exact: true }).click()
  await page.getByRole("button", { name: "确认执行", exact: true }).click()
  await page.getByRole("button", { name: "批量操作", exact: true }).click()
  await expect(page.getByRole("button", { name: "批量操作", exact: true })).toContainText("已选 1 条")
  await expect(page.getByRole("button", { name: "操作结果", exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "仅重试可重试失败项", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "批量停用", exact: true }).click()
  await page.getByRole("button", { name: "确认执行", exact: true }).click()
  await expect.poll(() => executions.length).toBe(2)
  await page.getByRole("button", { name: "数据操作", exact: true }).click()
  await expect(page.getByRole("button", { name: "导出", exact: true })).toBeEnabled()
  await expect(page.getByRole("button", { name: "操作结果", exact: true })).toHaveCount(0)
  await expect(page.getByRole("alertdialog")).not.toBeVisible()
  await page.screenshot({ path: "/tmp/infranexus-m3-selection.png", fullPage: true })
  expect(executions[1].items.map((item) => item.id)).toEqual([users[1].id])
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied")
        },
      },
    })
  })
  if (!await page.getByRole("button", { name: "复制已加载行 TSV", exact: true }).isVisible()) await page.getByRole("button", { name: "导出", exact: true }).click()
  await page.getByRole("button", { name: "复制已加载行 TSV", exact: true }).click()
  await expect(page.getByText("复制失败，请检查浏览器剪贴板权限", { exact: true })).toBeVisible()
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出当前页 CSV", exact: true }).click()
  expect((await downloadPromise).suggestedFilename()).toBe("users.csv")
  expect(exports[0].selection.mode).toBe("page")
  expect(exports[0].selection.ids).toEqual(users.slice(10).map((user) => user.id))
  await page.keyboard.press("Escape")
  await page.getByRole("checkbox", { name: "全选当页数据" }).click()
  if (!await page.getByRole("button", { name: "选择全部匹配 12 条" }).isVisible()) await page.getByRole("button", { name: "批量操作", exact: true }).click()
  await page.getByRole("button", { name: "选择全部匹配 12 条" }).click()
  await page.keyboard.press("Escape")
  await page.getByPlaceholder("搜索用户名、姓名或邮箱").fill("changed")
  await expect(page.getByRole("button", { name: /^已选 / })).toHaveCount(0)
  await page.getByPlaceholder("搜索用户名、姓名或邮箱").fill("")
  await expect(page.getByRole("button", { name: /^已选 / })).toHaveCount(0)
  expect(errors).toEqual([])
})
