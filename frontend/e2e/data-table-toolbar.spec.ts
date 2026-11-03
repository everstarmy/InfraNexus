import { expect, test } from "@playwright/test"
import { mountDataTable as mountTable } from "./fixtures/data-table/mount"

for (const width of [390, 1440]) {
  test(`toolbar separates header and search slots at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: 900 })
    await mountTable(page, { slots: true })
    const header = page.locator('[data-slot="data-table-header"]')
    const search = page.locator('[data-slot="data-table-search"]')
    await expect(header.getByRole("heading", { name: "验收表格" })).toBeVisible()
    await expect(header.getByRole("button", { name: "刷新" })).toBeVisible()
    const titleBox = (await header.getByRole("heading").boundingBox())!
    const refreshBox = (await header.getByRole("button", { name: "刷新" }).boundingBox())!
    expect(
      Math.abs(titleBox.y + titleBox.height / 2 - refreshBox.y - refreshBox.height / 2),
    ).toBeLessThan(3)
    const a = (await header.boundingBox())!
    const b = (await search.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
    await expect(search.getByRole("button", { name: "前置筛选" })).toBeVisible()
    await expect(search.getByRole("button", { name: "后置筛选" })).toBeVisible()
    await page.keyboard.press("/")
    const input = search.getByRole("textbox")
    await expect(input).toBeFocused()
    await input.fill("Alpha")
    await expect(page.getByRole("cell", { name: "Beta", exact: true })).toHaveCount(0)
    await input.press("Escape")
    await expect(page.getByRole("cell", { name: "Beta", exact: true })).toBeVisible()
    await header.getByRole("button", { name: "刷新" }).click()
    await expect(page.locator('[data-refreshed="yes"]')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.locator("vite-error-overlay")).toHaveCount(0)
    expect(errors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`infranexus-toolbar-v2-${width}.png`) })
  })
}

test("toolbar hides built-ins independently and removes empty rows", async ({ page }) => {
  await mountTable(page, { hideSearch: true, hideRefresh: true, legacy: true })
  await expect(page.getByRole("heading", { name: "验收表格" })).toBeVisible()
  await expect(page.getByRole("button", { name: "刷新" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "表格设置" })).toBeVisible()
  await expect(page.locator('[data-slot="data-table-search"]')).toHaveCount(0)
  await mountTable(page, { hideSearch: true, hideViewOptions: true, slots: true })
  await expect(page.getByRole("button", { name: "刷新" })).toBeVisible()
  await expect(page.getByRole("button", { name: "表格设置" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "前置筛选" })).toBeVisible()
  await mountTable(page, {
    hideSearch: true,
    hideRefresh: true,
    hideViewOptions: true,
    title: false,
  })
  await expect(page.locator('[data-slot="data-table-header"]')).toHaveCount(0)
  await expect(page.locator('[data-slot="data-table-search"]')).toHaveCount(0)
})
