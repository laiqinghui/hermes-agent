import { describe, it, expect } from 'vitest'
import { applyAutoHero, anchorForType } from './auto-hero'
import type { CanvasDoc, ComponentNode } from './types'

const comp = (id: string, type: string, extra: Partial<ComponentNode> = {}): ComponentNode =>
  ({ id, type, ...extra })

const doc = (components: ComponentNode[]): CanvasDoc =>
  ({ canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 }, components })

describe('anchorForType', () => {
  it('maps known roles and falls back to bottom', () => {
    expect(anchorForType('stat')).toBe('top-left')
    expect(anchorForType('esri:legend')).toBe('top-right')
    expect(anchorForType('data-table')).toBe('bottom')
    expect(anchorForType('esri:feature-table')).toBe('bottom')
    expect(anchorForType('select')).toBe('top')
    expect(anchorForType('card')).toBe('top')
    expect(anchorForType('future:widget')).toBe('bottom')
  })
})

describe('applyAutoHero', () => {
  it('promotes a lone map to base and floats the rest, zoned + z-ordered', () => {
    const out = applyAutoHero(doc([
      comp('s1', 'stat'),
      comp('m1', 'esri:map'),
      comp('t1', 'data-table'),
    ]))
    const byId = Object.fromEntries(out.components.map(c => [c.id, c]))
    expect(byId.m1.layer).toBe('base')
    expect(byId.m1.anchor).toBeUndefined()
    expect(byId.s1.layer).toBe('float')
    expect(byId.s1.anchor).toBe('top-left')
    expect(byId.t1.layer).toBe('float')
    expect(byId.t1.anchor).toBe('bottom')
    // z preserves document order for stable tiling
    expect(byId.s1.z).toBe(0)
    expect(byId.t1.z).toBe(2)
  })

  it('place-all: two tables both float to bottom (nothing dropped)', () => {
    const out = applyAutoHero(doc([
      comp('m1', 'esri:map'),
      comp('t1', 'data-table'),
      comp('t2', 'data-table'),
    ]))
    const floats = out.components.filter(c => c.layer === 'float')
    expect(floats.map(c => c.id)).toEqual(['t1', 't2'])
    expect(floats.every(c => c.anchor === 'bottom')).toBe(true)
  })

  it('is a no-op when any component already sets a layer', () => {
    const input = doc([comp('m1', 'esri:map', { layer: 'base' }), comp('s1', 'stat')])
    expect(applyAutoHero(input)).toBe(input) // same reference — unchanged
  })

  it('is a no-op when there is not exactly one map', () => {
    const none = doc([comp('s1', 'stat'), comp('t1', 'data-table')])
    expect(applyAutoHero(none)).toBe(none)
    const two = doc([comp('m1', 'esri:map'), comp('m2', 'esri:map')])
    expect(applyAutoHero(two)).toBe(two)
  })
})
