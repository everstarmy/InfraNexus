import { expect, test } from "@playwright/test"
import { mountDataTable } from "./fixtures/data-table/mount"

test("table updates preserve input and open row menu identity; inline controls isolate row clicks", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await mountDataTable(page, { stabilityProbe: true, interactive: true, details: true })
  const host = page.getByTestId("data-table-fixture")
  const row = page.locator('tr[data-row-id="row-1"]')
  const input = row.getByRole("textbox", { name: "草稿 row-1" })
  await input.fill("未提交草稿")
  await input.evaluate((el) => {
    el.dataset.identity = "original"
  })
  await row.getByRole("checkbox").check()
  await expect(input).toHaveValue("未提交草稿")
  await expect(input).toHaveAttribute("data-identity", "original")
  await row.getByRole("button", { name: "展开行详情" }).click()
  const detailID = await row
    .getByRole("button", { name: "收起行详情" })
    .getAttribute("aria-controls")
  expect(detailID).toBeTruthy()
  await expect(page.locator(`[id="${detailID}"]`)).toContainText("详情 Alpha")
  await row.getByRole("button", { name: "更多行操作" }).click()
  const menu = page.getByRole("menu")
  await menu.evaluate((el) => {
    el.dataset.identity = "open"
  })
  // Programmatic host refresh does not send an outside pointer event to dismiss the menu.
  await page
    .getByRole("button", { name: "刷新", exact: true })
    .evaluate((el: HTMLButtonElement) => el.click())
  await expect(menu).toHaveAttribute("data-identity", "open")
  await expect(input).toHaveValue("未提交草稿")
  await expect(input).toHaveAttribute("data-identity", "original")
  await expect(page.locator(`[id="${detailID}"]`)).toContainText("详情 Alpha")
  await page.getByRole("menuitem", { name: "探针操作" }).click()
  await expect(host).toHaveAttribute("data-action", "yes")
  expect(await host.getAttribute("data-row-clicks")).toBeNull()
  await input.focus()
  await input.press("Enter")
  await expect(input).toBeFocused()
  expect(await host.getAttribute("data-row-clicks")).toBeNull()
  await row
    .locator("td")
    .filter({ hasText: /^Alpha$/ })
    .click()
  await expect(host).toHaveAttribute("data-row-clicks", "1")
  expect(errors).toEqual([])
})

for (const detail of [true, false])
  test(`virtual fallback keeps page data and pagination (${detail ? "details/group" : "mobile content"})`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await mountDataTable(page, {
      virtualized: true,
      details: detail,
      rowCount: 120,
      pageSize: 50,
      viewport: { mode: "max-height", maxHeight: 320, mobileContent: !detail },
    })
    await expect(
      page.getByText(
        detail
          ? "虚拟滚动未启用：行详情或行分组请使用分页模式"
          : "虚拟滚动未启用：需要固定高度视口，并关闭 mobileContent",
      ),
    ).toBeVisible()
    await expect(page.locator("table")).not.toHaveAttribute("data-virtualized")
    await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(50)
    await page.getByRole("button", { name: "下一页", exact: true }).click()
    await expect(page.locator("tbody tr[data-row-id]").first()).toHaveAttribute(
      "data-row-id",
      "row-51",
    )
    await page.getByRole("button", { name: "末页", exact: true }).click()
    await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(20)
    await expect(page.locator("tbody tr[data-row-id]").last()).toHaveAttribute(
      "data-row-id",
      "row-120",
    )
    expect(errors).toEqual([])
  })
