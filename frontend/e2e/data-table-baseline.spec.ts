import { expect, test } from '@playwright/test'
import { mountDataTable } from './fixtures/data-table/mount'

// M0 characterizes existing behavior; bounded vertical scrolling belongs to M1.
for (const width of [390, 1440]) {
  test(`synthetic short, wide and long-text tables at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => {
      // The login shell intentionally returns 401 for /auth/me.
      if (message.type() === 'error' && !message.text().includes('401 (Unauthorized)')) errors.push(message.text())
    })
    await page.setViewportSize({ width, height: 900 })
    await mountDataTable(page)
    await expect(page.getByRole('cell', { name: 'Alpha', exact: true })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Beta', exact: true })).toBeVisible()
    await mountDataTable(page, { scenario: 'wide' })
    const viewport = page.locator('[data-slot="data-table"] [data-slot="table-container"]')
    expect(await viewport.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
    await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth })
    expect(await viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    await expect(page.getByRole('columnheader', { name: '扩展字段 20', exact: true })).toBeInViewport()
    await mountDataTable(page, { scenario: 'long-text' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`m0-long-text-${width}.png`) })
    expect(errors).toEqual([])
  })
}

test('many rows paginate; empty and loading states remain distinct', async ({ page }) => {
  await mountDataTable(page, { scenario: 'many' })
  await expect(page.locator('tbody tr')).toHaveCount(10)
  await expect(page.getByText('第 1 / 12 页', { exact: true })).toBeVisible()
  const jump = page.getByRole('spinbutton', { name: '跳转页码' })
  await jump.fill('12')
  await jump.press('Enter')
  await expect(page.getByRole('cell', { name: '成员 120', exact: true })).toBeVisible()
  await mountDataTable(page, { scenario: 'empty' })
  await expect(page.getByText('夹具暂无数据', { exact: true })).toBeVisible()
  await expect(page.getByText('共 0 条记录', { exact: true })).toBeVisible()
  await mountDataTable(page, { scenario: 'loading' })
  await expect(page.getByRole('status', { name: '正在加载表格数据' })).toBeVisible()
  await expect(page.getByText('夹具暂无数据', { exact: true })).toHaveCount(0)
})

test('page-owned error retries without being presented as an empty table', async ({ page }) => {
  await mountDataTable(page, { scenario: 'error' })
  await expect(page.getByRole('alert')).toContainText('验收表格暂时无法加载')
  await expect(page.getByText('夹具暂无数据', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Alpha', exact: true })).toBeVisible()
})

test('tree rows expand and globally disabled selection cannot be activated', async ({ page }) => {
  await mountDataTable(page, { scenario: 'tree' })
  await expect(page.locator('tbody tr')).toHaveCount(4)
  const toggle = page.getByRole('button', { name: '展开根节点' })
  await toggle.click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await toggle.click()
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await mountDataTable(page, { scenario: 'no-permission' })
  const checkboxes = page.locator('[data-slot="data-table"]').getByRole('checkbox')
  await expect(checkboxes).toHaveCount(3)
  for (const checkbox of await checkboxes.all()) {
    await expect(checkbox).toBeDisabled()
    await expect(checkbox).not.toBeChecked()
  }
  for (const button of await page.getByRole('button', { name: '编辑', exact: true }).all()) {
    await expect(button).toBeDisabled()
  }
})
