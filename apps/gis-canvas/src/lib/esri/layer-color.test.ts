import { describe, it, expect } from 'vitest'
import { resolveLayerColor } from './layer-color'

describe('resolveLayerColor', () => {
  it('returns a non-empty color for any index (jsdom fallback palette)', () => {
    for (let i = 0; i < 8; i++) expect(resolveLayerColor(i)).toMatch(/\S/)
  })
  it('gives the first six indices distinct colors', () => {
    const colors = [0, 1, 2, 3, 4, 5].map(resolveLayerColor)
    expect(new Set(colors).size).toBe(6)
  })
  it('wraps every 6 (index 6 reuses index 0)', () => {
    expect(resolveLayerColor(6)).toBe(resolveLayerColor(0))
  })
})
