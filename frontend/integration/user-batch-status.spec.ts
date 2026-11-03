import { expect, test } from '@playwright/test'

test('real batch status persists disable and enable through pagination actions', async ({ page, context }, info) => {
  await page.goto('/login')
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('登录密码', { exact: true }).fill('Smoke!Admin2468')
  await page.getByRole('button', { name: '登录控制台', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  const ids: string[] = []
  for (const name of ['batch-real-one', 'batch-real-two']) {
    const res = await context.request.post('/api/v1/users', { headers: { Origin: String(info.project.use.baseURL) }, data: { username: name, nickname: name, email: `${name}@example.test`, password: 'Smoke!User2468', role_ids: [] } })
    expect(res.status()).toBe(200)
    const user = (await res.json()).data
    ids.push(user.id)
    if (name.endsWith('two')) {
      const disabled = await context.request.patch(`/api/v1/users/${user.id}/status`, { headers: { Origin: String(info.project.use.baseURL) }, data: { status: 2, expected_revision: user.edit_revision } })
      expect(disabled.status()).toBe(200)
    }
  }
  await page.goto('/users')
  await page.getByPlaceholder('搜索用户名、姓名或邮箱').fill('batch-real-')
  await expect(page.locator('tbody tr')).toHaveCount(2)
  for (const [index, status] of [1, 2, 1, 1].entries()) {
    await page.getByRole('checkbox', { name: '全选当页数据', exact: true }).check()
    await page.getByRole('button', { name: '批量操作', exact: true }).click()
    const preview = page.waitForResponse(r => r.url().endsWith('/batch-status/preview'))
    await page.getByRole('button', { name: status === 2 ? '批量停用' : '批量启用', exact: true }).click()
    await expect(page.getByRole('alertdialog')).not.toContainText('已经是目标状态')
    await expect(page.getByRole('alertdialog')).not.toContainText('预检跳过')
    const execute = page.waitForResponse(r => r.url().endsWith('/batch-status'))
    await page.getByRole('button', { name: '确认执行', exact: true }).click()
    const previewResponse = await preview
    expect(previewResponse.status()).toBe(200)
    const response = await execute
    expect(response.status()).toBe(200)
    const result = (await response.json()).data
    expect(result.success).toBe(index === 0 ? 1 : index === 3 ? 0 : 2)
    expect(result.skipped).toBe(index === 0 ? 1 : index === 3 ? 2 : 0)
    expect(result.failed).toBe(0)
    expect(response.request().postDataJSON().items).toHaveLength(2)
    for (const id of ids) {
      const user = await context.request.get(`/api/v1/users/${id}`)
      expect((await user.json()).data.status).toBe(status)
    }
    await expect(page.getByRole('button', { name: '批量操作', exact: true })).toHaveCount(0)
  }
  await page.screenshot({ path: info.outputPath('real-batch-enabled.png') })
})
