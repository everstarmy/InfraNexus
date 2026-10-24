import { expect, test } from '@playwright/test'

test('background identity refresh preserves drafts, deduplicates triggers and handles permission changes', async ({ page }) => {
  await page.clock.install()
  let permissions = ['org', 'users', 'users:create', 'users:delete']
  let failure = false
  let reads = 0
  let release: (() => void) | undefined
  let hold = false
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    const json = (data: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ data, code: status * 1000, message: 'test', request_id: 'identity-refresh' }) })
    if (path.endsWith('/auth/me')) {
      reads++
      if (hold) await new Promise<void>(resolve => { release = resolve })
      if (failure) return json(null, 500)
      return json({ id: 'identity-user', username: 'reviewer', nickname: 'Reviewer', auth_type: 'local', status: 1, is_admin: false, roles: [], permissions, preferences: {} })
    }
    if (path.endsWith('/users/stats')) return json({ total: 0, active: 0, disabled: 0, local: 0, directory: 0, unassigned: 0, by_domain: [] })
    if (path.endsWith('/options/departments')) return json({ items: [], revision: 1 })
    if (path.endsWith('/options/roles')) return json([])
    if (path.endsWith('/users')) return json({ items: [], total: 0, page: 1, page_size: 10 })
    return json([])
  })
  await page.goto('/users')
  await page.getByRole('button', { name: '新建用户', exact: true }).first().click()
  const username = page.getByRole('dialog').getByLabel('用户名', { exact: true })
  await username.fill('draft-kept')
  const before = reads
  await page.clock.fastForward(6000)
  failure = true
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => reads).toBe(before + 1)
  await expect(username).toHaveValue('draft-kept')
  failure = false
  hold = true
  await page.clock.fastForward(6000)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('infranexus:permissions-stale'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => reads).toBe(before + 2)
  permissions = ['org', 'users', 'users:create']
  hold = false
  release?.()
  await expect(username).toHaveValue('draft-kept')
  await page.clock.fastForward(6000)
  permissions = ['org', 'users']
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: '新建用户', exact: true })).toHaveCount(0)
  await expect(username).toHaveValue('draft-kept')
  // A late background response must not restore an identity cleared meanwhile.
  hold = true
  await page.clock.fastForward(6000)
  const beforeLate = reads
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect.poll(() => reads).toBe(beforeLate + 1)
  await page.evaluate(() => window.dispatchEvent(new Event('infranexus:unauthorized')))
  await expect(page).toHaveURL(/\/login/)
  hold = false
  release?.()
  await page.clock.fastForward(100)
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('button', { name: '登录控制台', exact: true })).toBeVisible()
})
