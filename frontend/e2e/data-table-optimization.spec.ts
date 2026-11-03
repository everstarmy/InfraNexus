import { expect, test } from '@playwright/test'
import { mountDataTable } from './fixtures/data-table/mount'

test('compatibility action pin shares offsets with other end pins', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await mountDataTable(page, { scenario: 'wide', pinned: true, pinConflict: true, viewport: { mode: 'max-height', maxHeight: 300 } })
  const viewport = page.locator('[data-slot="table-container"]')
  await viewport.evaluate(el => { el.scrollLeft = 600 })
  const action = await page.getByRole('columnheader', { name: '操作', exact: true }).boundingBox()
  const other = await page.getByRole('columnheader', { name: /^扩展字段 20/ }).boundingBox()
  expect(other!.x + other!.width).toBeLessThanOrEqual(action!.x + 1)
  expect(Math.abs(other!.x + other!.width - action!.x)).toBeLessThan(2)
})

test('advanced empty results reset once and preserve sort order', async ({ page }) => {
  await mountDataTable(page, { scenario: 'empty', advanced: true })
  await expect(page.getByText('未找到符合条件的结果')).toBeVisible()
  await page.getByRole('button', { name: '重置筛选', exact: true }).last().click()
  const host = page.getByTestId('data-table-fixture')
  await expect(host).toHaveAttribute('data-resets', '1')
  const query = JSON.parse((await host.getAttribute('data-query'))!)
  expect(query.filter.children).toEqual([])
  expect(query.sorts).toEqual([{ field: 'name', desc: false }])
  await expect(page.getByText('夹具暂无数据')).toBeVisible()
})

test('date draft preserves typing and normalizes only on apply', async ({ page }) => {
  await mountDataTable(page, { advanced: true })
  await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: '高级查询' }).click()
  const input = page.getByRole('textbox', { name: '条件1值1' })
  await input.fill('2026-10-29T09:30:00')
  await page.getByRole('button', { name: '应用查询' }).click()
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('2026-10-29T09:30:00')
  await input.fill('2026-10-29T09:30:00+08:00')
  await expect(input).toHaveValue('2026-10-29T09:30:00+08:00')
  await page.getByRole('button', { name: '应用查询' }).click()
  const query = JSON.parse((await page.getByTestId('data-table-fixture').getAttribute('data-query'))!)
  expect(query.filter.children[0].value).toBe('2026-10-29T01:30:00.000Z')
})

test('header direction preserves other sorts and appends through the shared query', async ({ page }) => {
  await mountDataTable(page, { advanced: true })
  await page.getByRole('columnheader', { name: /说明/ }).getByRole('button').click()
  await page.getByRole('menuitem', { name: '追加升序排序' }).click()
  await page.getByRole('columnheader', { name: /名称/ }).getByRole('button').click()
  await page.getByRole('menuitem', { name: '降序排列', exact: true }).click()
  const query = JSON.parse((await page.getByTestId('data-table-fixture').getAttribute('data-query'))!)
  expect(query.sorts).toEqual([{ field: 'name', desc: true }, { field: 'description', desc: false }])
  await page.getByRole('button', { name: '更多表格操作' }).click()
  await expect(page.getByLabel('当前排序')).toContainText('2. 说明 · 升序')
  await page.getByRole('button', { name: '清除排序', exact: true }).click()
  expect(JSON.parse((await page.getByTestId('data-table-fixture').getAttribute('data-query'))!).sorts).toEqual([])
})

test('external dates work without a date column and reset with filters', async ({ page }) => {
  await mountDataTable(page, { externalDate: true })
  await expect(page.getByRole('button', { name: /受控日期/ }).first()).toBeVisible()
  await page.getByRole('button', { name: '重置筛选', exact: true }).click()
  await expect(page.getByTestId('data-table-fixture')).toHaveAttribute('data-date', 'cleared')
})

 test('custom page sizes honor the configured maximum', async ({ page }) => {
  await mountDataTable(page, { rowCount: 210, pageSize: 15, pageSizeOptions: [15, 200, 500], maxPageSize: 200 })
  await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(15)
  await page.getByRole('button', { name: '15 条/页', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '500 条/页', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: '200 条/页', exact: true }).click()
  await expect(page.locator('tbody tr[data-row-id]')).toHaveCount(200)
})

 test('short scalar text stays selectable without a full-text trigger', async ({ page }) => {
  await mountDataTable(page, { text: { mode: 'truncate', label: '说明全文' }, textValue: '简短内容' })
  await expect(page.getByText('简短内容').first()).toBeVisible()
  await expect(page.getByRole('button', { name: '查看说明全文' })).toHaveCount(0)
})

test('loading skeleton preserves visible column boundaries', async ({ page }) => {
  await mountDataTable(page, { scenario: 'wide', pinned: true, interactive: true, details: true })
  const widths = () => page.getByTestId('data-table-fixture').locator('thead tr').last().locator('th').evaluateAll(cells => cells.map(cell => Math.round(cell.getBoundingClientRect().width)))
  const before = await widths()
  await page.getByRole('button', { name: '返回加载中' }).click()
  await expect(page.getByRole('status', { name: '正在加载表格数据' })).toBeVisible()
  expect(await widths()).toEqual(before)
  const skeleton = page.getByRole('status', { name: '正在加载表格数据' })
  const firstHead = skeleton.locator('th').first()
  expect(await firstHead.evaluate(el => getComputedStyle(el).paddingLeft)).toBe('4px')
  expect(await skeleton.locator('th').last().evaluate(el => getComputedStyle(el).zIndex)).toBe('20')
  expect(await skeleton.locator('tbody tr').first().locator('td').last().evaluate(el => getComputedStyle(el).zIndex)).toBe('10')
  await expect(skeleton.locator('[data-slot="skeleton"]').first()).toHaveClass(/skeleton-shimmer/)
  await page.getByRole('button', { name: '数据就绪' }).click()
  expect(await widths()).toEqual(before)
})

test('details remain inside the horizontal viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 })
  await mountDataTable(page, { scenario: 'wide', details: true, viewport: { mode: 'max-height', maxHeight: 400 } })
  await page.getByRole('button', { name: '展开行详情' }).first().click()
  const viewport = page.locator('[data-slot="table-container"]')
  await viewport.evaluate(el => { el.scrollLeft = 600 })
  const detail = page.getByText('详情 Alpha', { exact: true })
  await expect(detail).toBeInViewport()
  const bounds = (await viewport.boundingBox())!
  const box = (await detail.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1)
  expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
})

 test('enum checklists preserve distinct numeric and string values', async ({ page }) => {
  await mountDataTable(page, { advanced: true })
  await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: '高级查询' }).click()
  await page.getByLabel('条件1字段', { exact: true }).selectOption('kind')
  await page.getByLabel('条件1操作', { exact: true }).selectOption('in')
  await page.getByRole('button', { name: /条件1值/ }).click()
  await page.getByPlaceholder('搜索条件1值...').fill('文字')
  await page.getByRole('button', { name: '文字一', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '应用查询' }).click()
  const query = JSON.parse((await page.getByTestId('data-table-fixture').getAttribute('data-query'))!)
  expect(query.filter.children[0].value).toEqual([1, '1'])
})

 test('dragging clipped text does not open its full-text popover', async ({ page }) => {
  await mountDataTable(page, { scenario: 'long-text', text: { mode: 'truncate', label: '说明全文' } })
  const trigger = page.getByRole('button', { name: '查看说明全文' }).first()
  const box = (await trigger.boundingBox())!
  await page.mouse.move(box.x + 3, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(100, box.width - 4), box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  expect(await page.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0)
  await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0)
})

 test('action-only pinning hides data pin controls and ignores old data pins', async ({ page }) => {
  await mountDataTable(page, { scenario: 'wide', pinned: true, stickyOnly: true })
  await expect(page.locator('thead th').first()).toContainText('名称')
  await page.getByRole('button', { name: '表格设置' }).click()
  await expect(page.getByRole('group', { name: /固定位置/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /固定左侧|固定右侧/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(await page.getByRole('columnheader', { name: '操作', exact: true }).evaluate(el => getComputedStyle(el).position)).toBe('sticky')
})

test('right-only pinned action column does not cause horizontal overflow on wide viewports', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await mountDataTable(page, { scenario: 'long-text', pinned: true, stickyOnly: true })
  const viewport = page.locator('[data-slot="table-container"]')
  const metrics = await viewport.evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
})

for (const field of ['kind', 'flag']) test(`nullable ${field} restores a typed comparison value`, async ({ page }) => {
  await mountDataTable(page, { advanced: true })
  await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: '高级查询' }).click()
  await page.getByLabel('条件1字段', { exact: true }).selectOption(field)
  await page.getByLabel('条件1操作', { exact: true }).selectOption('empty')
  await page.getByLabel('条件1操作', { exact: true }).selectOption('eq')
  await page.getByRole('button', { name: '应用查询' }).click()
  const query = JSON.parse((await page.getByTestId('data-table-fixture').getAttribute('data-query'))!)
  expect(query.filter.children[0].value).toBe(field === 'kind' ? 1 : true)
})

test('empty sorting offers no redundant append action', async ({ page }) => {
  await mountDataTable(page, { advanced: true })
  await page.getByRole('button', { name: '更多表格操作' }).click()
  await page.getByRole('button', { name: '清除排序', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('columnheader', { name: /说明/ }).getByRole('button').click()
  await expect(page.getByRole('menuitem', { name: '升序排列', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '追加升序排序' })).toHaveCount(0)
})
