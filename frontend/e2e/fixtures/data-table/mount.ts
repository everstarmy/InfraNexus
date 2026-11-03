import { expect, type Page } from '@playwright/test'
import type { FixtureOptions } from './data'

/** Each mount navigates anew, disposing the preceding app/root and event listeners. */
export async function mountDataTable(page: Page, options: FixtureOptions = {}) {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/v1/auth/setup') return route.fulfill({
      json: { code: 200000, data: { initialized: true } },
    })
    if (path === '/api/v1/auth/me') return route.fulfill({
      status: 401, json: { code: 401001, message: 'Fixture signed out', data: null },
    })
    if (path === '/api/v1/auth/domains') return route.fulfill({ json: { code: 200000, data: [] } })
    // Fail closed: an unexpected call must never reach a real backend.
    return route.fulfill({ status: 501, json: { code: 501001, message: 'Unconfigured fixture endpoint' } })
  })
  await page.goto('/login')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page).toHaveTitle(/InfraNexus/)
  await expect(page.getByRole('button', { name: '登录控制台', exact: true })).toBeVisible()
  await page.evaluate(async options => {
    const fixturePath = '/e2e/fixtures/data-table/render.ts'
    const { renderFixture } = await import(fixturePath)
    // Leave the app root mounted but hidden so React continues owning its DOM.
    const app = document.getElementById('root')
    if (app) app.hidden = true
    const container = document.createElement('main')
    container.dataset.testid = 'data-table-fixture'
    container.style.padding = '16px'
    document.body.append(container)
    renderFixture(container, options)
  }, options)
  const host = page.getByTestId('data-table-fixture')
  if (options.scenario === 'error') await expect(host.getByRole('alert')).toBeVisible()
  else if (options.scenario === 'loading') await expect(host.getByRole('status')).toBeVisible()
  else await expect(host.getByRole('columnheader', { name: /^名称(?: |$)/ })).toBeVisible()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
}
