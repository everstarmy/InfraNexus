import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDensity, viewportHeight } from './data-table-layout'

afterEach(() => vi.unstubAllGlobals())
describe('viewport configuration validation', () => {
  it('rejects inaccessible numeric bounds while preserving positive lengths', () => {
    for (const value of [0, -100, NaN, Infinity, -Infinity]) expect(viewportHeight(value)).toBeUndefined()
    expect(viewportHeight(300)).toBe('300px')
    expect(viewportHeight(0.5)).toBe('0.5px')
  })
  it('does not accept CSS reset keywords or zero lengths as height limits', () => {
    vi.stubGlobal('CSS', { supports: () => true })
    for (const value of ['', 'none', 'inherit', 'initial', 'auto', '0px', '0%', '0.00rem', '-20px', 'max-content']) {
      expect(viewportHeight(value)).toBeUndefined()
    }
  })
  it('uses the browser to validate expressions and safely handles non-browser rendering', () => {
    vi.stubGlobal('CSS', undefined)
    expect(viewportHeight('60svh')).toBeUndefined()
    vi.stubGlobal('CSS', { supports: (_property: string, value: string) => value === '60svh' })
    expect(viewportHeight(' 60svh ')).toBe('60svh')
    expect(viewportHeight('bad-value')).toBeUndefined()
  })
  it('only accepts supported persisted density values', () => {
    for (const value of ['compact', 'standard', 'comfortable']) expect(isDensity(value)).toBe(true)
    for (const value of [null, {}, [], true, 'dense', 1]) expect(isDensity(value)).toBe(false)
  })
})
