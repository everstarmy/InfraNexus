import { expect, it } from 'vitest'
import { applyQueryDraft } from './data-table-query-draft'
import { emptyQuery, type QueryField, type TableQuery } from './data-table-query'
const fields: QueryField[] = [{ key: 'n', label: '数量', type: 'number' }, { key: 'd', label: '日期', type: 'date' }]
it('normalizes numeric and zoned date drafts only on apply, without mutating the draft', () => {
  const draft: TableQuery = { ...emptyQuery(), filter: { logic: 'and', children: [
    { field: 'n', op: 'between', value: ['-1.5', '2e2'] },
    { field: 'd', op: 'eq', value: '2026-10-28T08:00:00+08:00' },
  ] } }
  expect(applyQueryDraft(draft, fields).filter.children).toEqual([
    { field: 'n', op: 'between', value: [-1.5, 200] },
    { field: 'd', op: 'eq', value: '2026-10-28T00:00:00.000Z' },
  ])
  expect(draft.filter.children[0]).toHaveProperty('value', ['-1.5', '2e2'])
})
it('rejects incomplete numbers and dates without a timezone', () => {
  for (const [field, value] of [['n', ''], ['n', '-'], ['d', '2026-10-28T08:00:00']]) {
    expect(() => applyQueryDraft({ ...emptyQuery(), filter: { logic: 'and', children: [{ field, op: 'eq', value }] } }, fields)).toThrow()
  }
})
