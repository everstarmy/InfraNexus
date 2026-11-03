import { expect, it } from 'vitest'
import { resolveTablePageSize, tablePageSizes } from './table-page-size'
import { readTableUrl } from './table-url-state'
import { queryUrlPagination, emptyQuery } from '@/components/data-table/data-table-query'
import { decodeViews } from '@/components/data-table/data-table-views'
import { sanitizePreferences } from '@/components/data-table/data-table-preferences'

it('uses the same custom sizes for basic URL, query URL and saved views', () => {
  const policy = { pageSizeOptions: [15, 200], defaultPageSize: 15, maxPageSize: 200 }
  expect(readTableUrl(new URLSearchParams('pageSize=200'), { ...policy, facetKeys: [] }).pagination.pageSize).toBe(200)
  expect(queryUrlPagination(new URLSearchParams('users_pageSize=200'), 'users', policy).pageSize).toBe(200)
  const raw = JSON.stringify({ version: 1, views: [{ id: 'x', name: '视图', pageSize: 200, query: emptyQuery(), layout: sanitizePreferences(null, []) }] })
  expect(decodeViews(raw, [], policy).views[0].pageSize).toBe(200)
  let warnings = 0
  expect(decodeViews(raw, [], { ...policy, maxPageSize: 100 }, () => warnings++).views[0].pageSize).toBe(15)
  expect(warnings).toBe(1)
})
it('deduplicates and bounds choices; absent query sizes do not override a default view', () => {
  expect(tablePageSizes({ pageSizeOptions: [0, 15, 15, 200, Infinity], maxPageSize: 100 })).toEqual({ options: [15], fallback: 15 })
  expect(resolveTablePageSize(200)).toBe(10)
  expect(queryUrlPagination(new URLSearchParams(), 'users').pageSize).toBeUndefined()
  expect(queryUrlPagination(new URLSearchParams('users_pageSize=bad'), 'users').pageSize).toBe(10)
})
