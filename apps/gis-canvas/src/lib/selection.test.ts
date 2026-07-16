import { describe, it, expect } from 'vitest'
import { resolveIdField, collectNodesBySource } from './selection'
import type { CanvasDoc } from './types'

describe('resolveIdField', () => {
  it('uses the first schema column when no rows are given', () => {
    expect(resolveIdField([{ name: 'Timestamp' }, { name: 'Lat' }])).toBe('Timestamp')
  })
  it('picks the first column with distinct values across the rows', () => {
    const schema = [{ name: 'Vessel' }, { name: 'Timestamp' }]
    const rows = [
      { Vessel: 'GREY LADY', Timestamp: 't1' },
      { Vessel: 'GREY LADY', Timestamp: 't2' } // Vessel is constant, Timestamp distinct
    ]
    expect(resolveIdField(schema, rows)).toBe('Timestamp')
  })
  it('falls back to the first column when no column is distinct', () => {
    const schema = [{ name: 'a' }, { name: 'b' }]
    const rows = [{ a: '1', b: 'x' }, { a: '1', b: 'x' }]
    expect(resolveIdField(schema, rows)).toBe('a')
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
