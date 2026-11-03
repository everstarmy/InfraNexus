import { expect, test, type Page } from '@playwright/test'
import { mountDataTable } from './fixtures/data-table/mount'

const viewport = (page: Page) => page.locator('[data-slot="table-container"]').filter({ visible: true })
const top = (page: Page) => viewport(page).evaluate(el => el.scrollTop)
async function scroll(page: Page, top = 450, left = 0) {
  await viewport(page).evaluate((el, point) => { el.scrollTo(point.left, point.top) }, { top, left })
  await expect.poll(() => viewport(page).evaluate(el => el.scrollTop)).toBeGreaterThan(0)
}

test('bounded viewport keeps grouped headers and pagination outside scrolling', async ({ page }, info) => {
  await mountDataTable(page, { scenario: 'many', pageSize: 100, grouped: true, viewport: { mode: 'max-height', maxHeight: 300 } })
  await expect(viewport(page)).toHaveCount(1)
  expect(await viewport(page).evaluate(el => el.clientHeight)).toBeLessThanOrEqual(300)
  const header = page.locator('thead')
  const before = await header.boundingBox()
  const pagination = page.locator('[data-slot="data-table-pagination"]')
  const bottom = await pagination.boundingBox()
  await scroll(page)
  expect(Math.abs((await header.boundingBox())!.y - before!.y)).toBeLessThanOrEqual(1)
  expect(Math.abs((await pagination.boundingBox())!.y - bottom!.y)).toBeLessThanOrEqual(1)
  await expect(page.getByRole('columnheader', { name: '分组表头' })).toBeInViewport()
  await page.screenshot({ path: info.outputPath('m1-grouped-scroll.png') })
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect.poll(() => top(page)).toBe(0)
})

test('short, empty, loading and invalid heights have usable bounds', async ({ page }) => {
  for (const scenario of ['short', 'empty', 'loading'] as const) {
    await mountDataTable(page, { scenario, viewport: { mode: 'max-height', maxHeight: 200 } })
    expect(await viewport(page).evaluate(el => el.clientHeight)).toBeLessThanOrEqual(200)
    await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeVisible()
  }
  await mountDataTable(page, { viewport: { mode: 'max-height', maxHeight: 500 } })
  expect(await viewport(page).evaluate(el => el.clientHeight)).toBeLessThan(200)
  for (const maxHeight of [-1, 'invalid-length', '-20px', '0px', 'calc(1px - 10px)']) {
    await mountDataTable(page, { scenario: 'many', pageSize: 100, viewport: { mode: 'max-height', maxHeight } })
    expect(await viewport(page).evaluate(el => el.clientHeight)).toBeGreaterThan(500)
  }
})

test('fill uses remaining height and horizontal controls track pinned columns', async ({ page }, info) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await mountDataTable(page, { scenario: 'wide', rowCount: 100, pageSize: 100, pinned: true, parentHeight: 700, viewport: { mode: 'fill' } })
  const height = await page.locator('[data-slot="data-table"]').evaluate(el => el.getBoundingClientRect().height)
  expect(height).toBeLessThanOrEqual(700)
  expect(height).toBeGreaterThan(690)
  expect(await viewport(page).evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await expect(page.getByRole('button', { name: '向左滚动表格' })).toHaveCount(0)
  await expect(page.locator('[data-slot="scroll-edge-left"]')).toHaveCSS('opacity', '0')
  await expect(page.locator('[data-slot="scroll-edge-right"]')).toHaveCSS('opacity', '0')
  await viewport(page).evaluate(el => { el.scrollLeft = 200 })
  await expect.poll(() => viewport(page).evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await scroll(page, 400, 600)
  const geometry = await viewport(page).evaluate(el => {
    const heads = el.querySelectorAll('thead th')
    const edgeLeft = el.parentElement!.querySelector('[data-slot="scroll-edge-left"]')!.getBoundingClientRect()
    const edgeRight = el.parentElement!.querySelector('[data-slot="scroll-edge-right"]')!.getBoundingClientRect()
    return { left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
      pinnedLeft: heads[0].getBoundingClientRect().left, pinnedLeftInner: heads[0].getBoundingClientRect().right,
      pinnedRightInner: heads[heads.length - 1].getBoundingClientRect().left, pinnedRight: heads[heads.length - 1].getBoundingClientRect().right,
      edgeLeft: edgeLeft.left, edgeRight: edgeRight.right }
  })
  expect(Math.abs(geometry.left - geometry.pinnedLeft)).toBeLessThan(2)
  expect(Math.abs(geometry.right - geometry.pinnedRight)).toBeLessThan(2)
  expect(Math.abs(geometry.pinnedLeftInner - geometry.edgeLeft)).toBeLessThan(2)
  expect(Math.abs(geometry.pinnedRightInner - geometry.edgeRight)).toBeLessThan(2)
  await expect(page.locator('[data-slot="scroll-edge-left"]')).toHaveCSS('opacity', '0')
  await expect(page.locator('[data-slot="scroll-edge-right"]')).toHaveCSS('opacity', '0')
  await viewport(page).evaluate(el => { el.scrollLeft = el.scrollWidth })
  await expect(page.getByRole('button', { name: '向右滚动表格' })).toHaveCount(0)
  await expect(page.locator('[data-slot="scroll-edge-right"]')).toHaveCSS('opacity', '0')
  await page.screenshot({ path: info.outputPath('m1-fill-pinned.png') })
})

test('refresh and remount retain position; committed query and view changes reset it', async ({ page }) => {
  await mountDataTable(page, { scenario: 'many', pageSize: 100, interactive: true, viewport: { mode: 'max-height', maxHeight: 250, restoreKey: 'reviewer:scroll-test' } })
  await scroll(page)
  const previous = await top(page)
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await expect.poll(() => top(page)).toBe(previous)
  await page.getByRole('button', { name: '插入首行' }).click()
  await expect.poll(() => top(page)).toBeGreaterThan(previous)
  const anchored = await top(page)
  await page.getByRole('button', { name: '挂载切换' }).click()
  await page.getByRole('button', { name: '返回加载中' }).click()
  await page.getByRole('button', { name: '数据就绪' }).click()
  await expect.poll(() => top(page)).toBe(anchored)
  await page.getByRole('button', { name: '开始异步查询' }).click()
  await expect.poll(() => top(page)).toBe(anchored)
  await page.getByRole('button', { name: '完成异步查询' }).click()
  await expect.poll(() => top(page)).toBe(0)
  await scroll(page)
  await page.getByRole('button', { name: '切换视图' }).click()
  await expect.poll(() => top(page)).toBe(0)
})

test('fullscreen preserves state and nested menus handle Escape before the dialog', async ({ page }) => {
  await mountDataTable(page, { scenario: 'many', pageSize: 100, controls: true, preference: true, viewport: { mode: 'max-height', maxHeight: 280 } })
  await scroll(page, 500)
  await page.getByRole('button', { name: '全屏查看表格' }).click()
  await expect(page.getByRole('dialog', { name: '全屏表格' })).toBeVisible()
  await expect.poll(() => top(page)).toBe(500)
  await page.getByRole('button', { name: '表格密度' }).click()
  await page.getByRole('menuitemradio', { name: '紧凑', exact: true }).click()
  await expect(page.locator('[data-slot="data-table"]')).toHaveAttribute('data-density', 'compact')
  await page.getByRole('button', { name: '表格密度' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '全屏表格' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '全屏表格' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '全屏查看表格' })).toBeFocused()
  await mountDataTable(page, { controls: true, preference: true })
  await expect(page.locator('[data-slot="data-table"]')).toHaveAttribute('data-density', 'compact')
})

for (const mode of ['truncate', 'clamp', 'wrap'] as const) {
  test(`text ${mode} respects its column and exposes readable full text`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await mountDataTable(page, { scenario: 'long-text', text: { mode, lines: 2, label: '说明全文' } })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (mode !== 'wrap') {
      const trigger = page.getByRole('button', { name: '查看说明全文', exact: true }).first()
      await trigger.focus()
      await trigger.press('Enter')
      await expect(page.locator('[data-slot="popover-content"]')).toContainText('用于验证长文本边界与可读性的说明。')
      await page.keyboard.press('Escape')
      await expect(trigger).toBeFocused()
    } else {
      expect(await page.locator('tbody tr').first().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(100)
    }
  })
}

for (const width of [375, 390, 768, 1440, 1920]) {
  test(`responsive viewport at ${width}px supports dark mode and zoom`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await mountDataTable(page, { scenario: 'many', pageSize: 50, controls: true, viewport: { mode: 'max-height', maxHeight: 300, mobileContent: true } })
    const bounded = width >= 768
    expect(await viewport(page).evaluate(el => el.clientHeight <= 300)).toBe(bounded)
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.getByRole('button', { name: '表格密度' }).click()
    await page.getByRole('menuitemradio', { name: '宽松', exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCount(0)
    await page.evaluate(() => { document.documentElement.style.zoom = '2' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: '表格设置', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`m1-dark-zoom-${width}.png`) })
  })
}

test('small fill containers keep scrolling and pagination reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 })
  await mountDataTable(page, { scenario: 'many', pageSize: 50, parentHeight: 180, controls: true, viewport: { mode: 'fill' } })
  expect(await viewport(page).evaluate(el => el.clientHeight)).toBeGreaterThanOrEqual(96)
  await scroll(page)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect.poll(() => top(page)).toBe(0)
})

test('pinned columns survive resizing, hiding and dark horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await mountDataTable(page, { scenario: 'wide', rowCount: 100, pageSize: 100, pinned: true, viewport: { mode: 'max-height', maxHeight: 300 } })
  const resize = page.getByRole('separator', { name: '调整name列宽' })
  const oldWidth = Number(await resize.getAttribute('aria-valuenow'))
  await resize.focus()
  await resize.press('ArrowRight')
  expect(Number(await resize.getAttribute('aria-valuenow'))).toBeGreaterThan(oldWidth)
  await page.getByRole('button', { name: '表格设置' }).click()
  await page.getByRole('checkbox', { name: '显示extra-1', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('columnheader', { name: /^扩展字段 1(?: |$)/ })).toHaveCount(0)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await scroll(page, 450, 800)
  expect(await viewport(page).evaluate(el => Math.abs(el.querySelector('thead th')!.getBoundingClientRect().left - el.getBoundingClientRect().left))).toBeLessThan(2)
  await viewport(page).evaluate(el => { el.scrollLeft = 0 })
  await expect(page.getByRole('button', { name: '向左滚动表格' })).toHaveCount(0)
})

test.describe('touch controls', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
  test('full text and density remain usable with a coarse pointer', async ({ page }) => {
    await mountDataTable(page, { scenario: 'long-text', controls: true, text: { mode: 'clamp', lines: 2 } })
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
    const trigger = page.getByRole('button', { name: '查看完整内容' }).first()
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await trigger.tap()
    await expect(page.locator('[data-slot="popover-content"]')).toContainText('用于验证长文本边界与可读性的说明。')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '表格密度' }).tap()
    await page.getByRole('menuitemradio', { name: '紧凑', exact: true }).tap()
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  })
})

for (const direction of ['ltr', 'rtl'] as const) {
  test(`scroll shadows fade smoothly and respect ${direction} endpoints`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await mountDataTable(page, { scenario: 'wide', rowCount: 100, pageSize: 100, pinned: true, parentHeight: 700, viewport: { mode: 'fill' } })
    await page.evaluate(dir => { document.documentElement.dir = dir }, direction)
    const start = page.locator('[data-slot="scroll-edge-left"]')
    const end = page.locator('[data-slot="scroll-edge-right"]')
    await expect(start).toHaveCSS('opacity', '0')
    await expect(end).toHaveCSS('opacity', '0')
    // Collect real rendered opacity through the whole idle transition, rather
    // than merely asserting that a class or timeout exists.
    const samples = await viewport(page).evaluate(async (el, dir) => {
      const shadow = el.parentElement!.querySelector('[data-slot="scroll-edge-left"]')!
      const samples: number[] = []
      el.scrollLeft = dir === 'rtl' ? -200 : 200
      const began = performance.now()
      await new Promise<void>(resolve => {
        const sample = () => {
          samples.push(Number(getComputedStyle(shadow).opacity))
          if (performance.now() - began > 700) resolve()
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      return samples
    }, direction)
    const peak = samples.indexOf(1)
    expect(peak).toBeGreaterThanOrEqual(0)
    expect(samples.slice(peak + 1).some(value => value > 0 && value < 1)).toBe(true)
    await expect(start).toHaveCSS('opacity', '0')
    await expect(end).toHaveCSS('opacity', '0')
    // Vertical scrolling alone must not light up the boundaries.
    await scroll(page, 300, direction === 'rtl' ? -200 : 200)
    await expect(start).toHaveClass(/opacity-0/)
    await expect(end).toHaveClass(/opacity-0/)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await viewport(page).evaluate((el, dir) => { el.scrollLeft = dir === 'rtl' ? -el.scrollWidth : el.scrollWidth }, direction)
    await expect(start).toHaveCSS('opacity', '1')
    await expect(end).toHaveCSS('opacity', '0')
    await page.screenshot({ path: info.outputPath(`scroll-shadow-${direction}.png`) })
    await viewport(page).evaluate(el => { el.scrollLeft = 0 })
    await expect(start).toHaveCSS('opacity', '0')
    await expect(end).toHaveCSS('opacity', '1')
    await expect(end).toHaveCSS('opacity', '0')
  })
}

for (const direction of ['ltr', 'rtl'] as const) {
  for (const pinned of [false, true]) {
    test(`${direction} ${pinned ? 'action-only' : 'unpinned'} table has no shadow on unpinned edges`, async ({ page }, info) => {
      await page.setViewportSize({ width: 768, height: 800 })
      await mountDataTable(page, { scenario: 'wide', rowCount: 30, pageSize: 30, pinned, stickyOnly: true, viewport: { mode: 'max-height', maxHeight: 300 } })
      await page.evaluate(dir => { document.documentElement.dir = dir; document.documentElement.classList.add('dark') }, direction)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await viewport(page).evaluate((el, dir) => { el.scrollLeft = dir === 'rtl' ? -200 : 200 }, direction)
      await expect.poll(() => viewport(page).evaluate(el => Math.abs(el.scrollLeft))).toBe(200)
      const start = page.locator('[data-slot="scroll-edge-left"]')
      const end = page.locator('[data-slot="scroll-edge-right"]')
      await expect(start).toHaveCSS('opacity', '0')
      await expect(end).toHaveCSS('opacity', pinned ? '1' : '0')
      const layer = page.locator('[data-slot="scroll-edge-layer"]')
      await expect(layer).toHaveCSS('overflow', 'hidden')
      const radius = await viewport(page).evaluate(el => getComputedStyle(el).borderTopLeftRadius)
      await expect(layer).toHaveCSS('border-top-left-radius', radius)
      await expect(layer).toHaveCSS('border-top-right-radius', radius)
      await page.screenshot({ path: info.outputPath(`unpinned-edge-${direction}-${pinned}.png`) })
    })
  }
}

for (const controls of [{ density: true, fullscreen: false }, { density: false, fullscreen: true }, { density: false, fullscreen: false }]) {
  test(`toolbar independently shows layout controls ${JSON.stringify(controls)}`, async ({ page }) => {
    await mountDataTable(page, { controls, hideViewOptions: true })
    const header = page.locator('[data-slot="data-table-header"]')
    await expect(page.getByRole('button', { name: '表格设置', exact: true })).toHaveCount(0)
    await expect(header.getByRole('button', { name: '表格密度' })).toHaveCount(controls.density ? 1 : 0)
    await expect(header.getByRole('button', { name: '全屏查看表格' })).toHaveCount(controls.fullscreen ? 1 : 0)
    if (controls.fullscreen) {
      await header.getByRole('button', { name: '全屏查看表格' }).click()
      await page.getByRole('button', { name: '退出全屏表格' }).click()
      await expect(page.getByRole('dialog', { name: '全屏表格' })).toHaveCount(0)
    }
  })
}

test('built-in tool icons form a connected group only with multiple buttons', async ({ page }, info) => {
  await mountDataTable(page, { controls: true })
  const group = page.getByRole('group', { name: '表格工具', exact: true })
  await expect(group.getByRole('button')).toHaveCount(4)
  const boxes = await group.getByRole('button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect()
    return { left: rect.left, right: rect.right, text: button.textContent }
  }))
  for (let i = 1; i < boxes.length; i++) expect(Math.abs(boxes[i].left - boxes[i - 1].right)).toBeLessThanOrEqual(1)
  expect(boxes.every(box => box.text === '')).toBe(true)
  await group.getByRole('button', { name: '表格设置', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '搜索列' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: info.outputPath('toolbar-button-group.png') })
  await mountDataTable(page, { hideViewOptions: true })
  await expect(page.getByRole('group', { name: '表格工具', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeVisible()
})

for (const direction of ['ltr', 'rtl'] as const) {
  test(`resize handle stays active and grows toward the ${direction} column end`, async ({ page }) => {
    await mountDataTable(page, { pinned: true })
    await page.evaluate(dir => { document.documentElement.dir = dir }, direction)
    const handle = page.getByRole('separator', { name: '调整name列宽' })
    const initial = Number(await handle.getAttribute('aria-valuenow'))
    const box = (await handle.boundingBox())!
    const head = (await handle.locator('..').boundingBox())!
    expect(Math.abs(direction === 'rtl' ? box.x - head.x : box.x + box.width - head.x - head.width)).toBeLessThan(2)
    await handle.press(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
    await expect(handle).toHaveAttribute('aria-valuenow', String(initial + 12))
    const next = (await handle.boundingBox())!
    await page.mouse.move(next.x + next.width / 2, next.y + next.height / 2)
    await page.mouse.down()
    await page.mouse.move(next.x + (direction === 'rtl' ? -40 : 40), next.y + next.height / 2)
    await expect(handle).toHaveClass(/\bbg-primary\b/)
    await page.mouse.up()
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(initial + 30)
  })
}
