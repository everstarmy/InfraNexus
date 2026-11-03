import { expect, test } from '@playwright/test'
import { mountDataTable } from './fixtures/data-table/mount'

for (const width of [390, 768, 1440, 1920]) {
  test(`M6 populated table themes, keyboard and CSS 200% at ${width}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setViewportSize({ width, height: 1000 })
    await mountDataTable(page, { scenario: 'wide', rowCount: 100, pageSize: 50, pinned: true, controls: true, viewport: { mode: 'max-height', maxHeight: '50svh' } })
    for (const dark of [false, true]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
      for (const zoom of ['1', '2']) {
        await page.evaluate(zoom => { document.documentElement.style.zoom = zoom }, zoom)
        const viewport = page.getByRole('region', { name: '表格数据' })
        await expect(viewport).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
        await viewport.focus()
        await viewport.press('PageDown')
        await expect(viewport).toBeFocused()
      }
    }
    expect(errors).toEqual([])
    if (width === 1440) await page.screenshot({ path: '/tmp/infranexus-table-m6.png', animations: 'disabled' })
  })
}

test('M6 unavailable preference storage preserves usable legacy table', async ({ page }) => {
  await page.addInitScript(() => {
    const read = Storage.prototype.getItem
    const write = Storage.prototype.setItem
    Storage.prototype.getItem = function(key) {
      if (key.startsWith('infranexus:table:')) throw new DOMException('Unavailable', 'SecurityError')
      return read.call(this, key)
    }
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('infranexus:table:')) throw new DOMException('Unavailable', 'QuotaExceededError')
      return write.call(this, key, value)
    }
  })
  await mountDataTable(page, { legacy: true, preference: true, controls: true, rowCount: 20, pageSize: 10 })
  await expect(page.getByRole('heading', { name: '验收表格' })).toBeVisible()
  await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(10)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.locator('tbody tr[data-row-id]').first()).toHaveAttribute('data-row-id', 'row-11')
})
