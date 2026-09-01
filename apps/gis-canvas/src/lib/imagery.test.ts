import { describe, it, expect } from 'vitest'
import { resolveScenes, bboxToRings } from './imagery'
import type { Imagery, ImageryScene } from './types'

const scene = (id: string): ImageryScene => ({
  id, title: `scene ${id}`, url: `https://example.com/${id}.tif`,
  sensor: 'optical', datetime: '2025-12-05T03:36:14Z',
  bbox: [104.58, 1.72, 104.78, 1.94]
})

const IMAGERY: Imagery = { scenes: [scene('a'), scene('b')] }

describe('resolveScenes', () => {
  it('returns the named scenes in the order requested', () => {
    expect(resolveScenes(IMAGERY, ['b', 'a']).map(s => s.id)).toEqual(['b', 'a'])
  })

  it('drops ids with no matching scene rather than throwing', () => {
    expect(resolveScenes(IMAGERY, ['a', 'ghost']).map(s => s.id)).toEqual(['a'])
  })

  it('returns nothing when there is no imagery block', () => {
    expect(resolveScenes(undefined, ['a'])).toEqual([])
  })
})

describe('bboxToRings', () => {
  it('builds a closed clockwise ring from a WGS84 bbox', () => {
    expect(bboxToRings([104.58, 1.72, 104.78, 1.94])).toEqual([[
      [104.58, 1.72], [104.58, 1.94], [104.78, 1.94], [104.78, 1.72], [104.58, 1.72]
    ]])
  })

  it('rejects a non-finite coordinate — a NaN poisons the whole ESRI layer', () => {
    expect(bboxToRings([104.58, Number.NaN, 104.78, 1.94])).toBeNull()
  })

  it('rejects a reversed or degenerate bbox', () => {
    expect(bboxToRings([104.78, 1.72, 104.58, 1.94])).toBeNull()
    expect(bboxToRings([104.58, 1.72, 104.58, 1.94])).toBeNull()
  })

  it('rejects a bbox that is not four numbers', () => {
    expect(bboxToRings([104.58, 1.72, 104.78])).toBeNull()
  })
})
