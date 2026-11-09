import { expect, test } from '@playwright/test'

test('M2 PostgreSQL query spans pages and rejects forbidden fields', async ({ page, context }, info) => {
  await page.goto('/login')
  await page.getByLabel('用户名', { exact: true }).fill('admin')
  await page.getByLabel('登录密码', { exact: true }).fill('Smoke!Admin2468')
  await page.getByRole('button', { name: '登录控制台', exact: true }).click()
  await expect(page).not.toHaveURL(/\/login/)
  for (let index = 0; index < 12; index++) {
    const name = `m2-query-${String(index).padStart(2, '0')}`
    const created = await context.request.post('/api/v1/users', { headers: { Origin: String(info.project.use.baseURL) }, data: { username: name, nickname: name, email: `${name}@example.test`, password: 'Smoke!User2468', role_ids: [] } })
    expect(created.status()).toBe(200)
  }
  const query = { version: 1, search: '', filter: { logic: 'and', children: [{ field: 'username', op: 'contains', value: 'm2-query-' }, { logic: 'or', children: [{ field: 'built_in', op: 'eq', value: false }, { field: 'status', op: 'eq', value: 2 }] }] }, sorts: [{ field: 'status', desc: false }, { field: 'username', desc: false }] }
  const response = await context.request.get('/api/v1/users', { params: { query: JSON.stringify(query), page: 2, page_size: 10 } })
  expect(response.status()).toBe(200)
  const data = (await response.json()).data
  expect(data.total).toBe(12)
  expect(data.items.map((row: { username: string }) => row.username)).toEqual(['m2-query-10', 'm2-query-11'])
  const forbidden = await context.request.get('/api/v1/users', { params: { query: JSON.stringify({ ...query, filter: { logic: 'and', children: [{ field: 'password', op: 'eq', value: 'x' }] } }) } })
  expect(forbidden.status()).toBe(400)
  expect((await forbidden.json()).code).toBe(400001)
  await page.goto('/users')
  await page.getByRole('button', { name: '更多表格操作', exact: true }).click()
  await page.getByRole('button', { name: /^高级查询/ }).click()
  await page.getByRole('button', { name: '添加条件', exact: true }).click()
  await page.getByLabel('条件1值1', { exact: true }).fill('m2-query-')
  await page.getByRole('button', { name: '添加排序', exact: true }).click()
  await page.getByLabel('排序1字段', { exact: true }).selectOption('username')
  await page.getByRole('button', { name: '应用查询', exact: true }).click()
  await expect(page.getByText('共 12 条记录', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByText('m2-query-10', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('m2-real-query-page2.png') })
})
