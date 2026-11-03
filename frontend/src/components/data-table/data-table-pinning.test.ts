import { describe, expect, it } from 'vitest'
import { normalizeColumnPinning } from './data-table-pinning'

describe('shared action pin model', () => {
  it('places the compatibility action after other end pins without duplicates or conflicts', () => {
    const saved = { start: ['select', 'actions', 'status'], end: ['actions', 'status', 'status'] }
    expect(normalizeColumnPinning(saved, true)).toEqual({ start: ['select'], end: ['status', 'actions'] })
    expect(saved.start).toEqual(['select', 'actions', 'status'])
  })
  it('preserves explicit action position when compatibility pinning is disabled', () => {
    expect(normalizeColumnPinning({ end: ['actions', 'status'] }, false)).toEqual({ start: [], end: ['actions', 'status'] })
  })
})
