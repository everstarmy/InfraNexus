import { expect, it } from 'vitest'
import { canonicalSnapshot } from './data-table-view-identity'
it('compares object maps independently of insertion order but preserves sort priority', () => {
  expect(canonicalSnapshot({ layout: { a: 1, b: 2 }, sorts: ['a', 'b'] })).toBe(canonicalSnapshot({ sorts: ['a', 'b'], layout: { b: 2, a: 1 } }))
  expect(canonicalSnapshot({ sorts: ['a', 'b'] })).not.toBe(canonicalSnapshot({ sorts: ['b', 'a'] }))
})
