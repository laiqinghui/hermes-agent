import { describe, it, expect } from 'vitest'
import { resolveIdField, collectNodesBySource } from './selection'
import type { CanvasDoc } from './types'

describe('resolveIdField', () => {
  it('uses the first schema column', () => {
    expect(resolveIdField([{ name: 'Timestamp' }, { name: 'Lat' }])).toBe('Timestamp')
  })
  it('falls back to "id" for an empty/missing schema', () => {
    expect(resolveIdField([])).toBe('id')
    expect(resolveIdField(undefined)).toBe('id')
  })
})

describe('collectNodesBySource', () => {
  it('maps each data source to the node ids bound to it (table source + map data-layers)', () => {
    const doc = {
      rev: 1,
      layout: { cols: 12, rowH: 8 },
      components: [
        { id: 'tbl', type: 'esri:data-table', bindings: { source: 'data://ab' } },
        { id: 'map', type: 'esri:map', bindings: { layers: ['data://ab', 'https://x/FeatureServer/0'] } },
        { id: 'stat', type: 'stat', bindings: { source: 'data://cd' } }
      ]
    } as unknown as CanvasDoc
    const m = collectNodesBySource(doc)
    expect(m['data://ab'].sort()).toEqual(['map', 'tbl'])
    expect(m['data://cd']).toEqual(['stat'])
    expect(m['https://x/FeatureServer/0']).toBeUndefined() // non-data layer ignored
  })
  it('returns {} for a null doc', () => { expect(collectNodesBySource(null)).toEqual({}) })
})
