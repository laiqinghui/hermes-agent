import { describe, it, expect } from 'vitest'
import { seedRects, minSizePct, MIN_SIZE_PX, RESERVE_PCT, applyDrag, applyResize, clampToBounds } from './window-layout'
import type { CanvasDoc } from './types'

const doc = (components: CanvasDoc['components']): CanvasDoc => ({
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 }, components,
})

describe('seedRects', () => {
  it('seeds a lone map as full-bleed at z 0', () => {
    const rects = seedRects(doc([{ id: 'm', type: 'esri:map', layer: 'base' }]))
    expect(rects.m).toEqual({ x: 0, y: 0, w: 100, h: 100, z: 0 })
  })

  it('seeds a right-docked legend as a right rail above z 0', () => {
    const rects = seedRects(doc([
      { id: 'm', type: 'esri:map', layer: 'base' },
      { id: 'lg', type: 'esri:legend', layer: 'dock', edge: 'right' },
    ]))
    expect(rects.lg.x + rects.lg.w).toBeCloseTo(100, 5) // pinned to right edge
    expect(rects.lg.y).toBe(0)
    expect(rects.lg.z).toBeGreaterThan(0)
  })

  it('reserves the attribution strip: a bottom dock stops short of the bottom', () => {
    const rects = seedRects(doc([
      { id: 'm', type: 'esri:map', layer: 'base' },
      { id: 'tb', type: 'data-table', layer: 'dock', edge: 'bottom' },
    ]))
    expect(rects.tb.y + rects.tb.h).toBeCloseTo(100 - RESERVE_PCT, 5)
  })

  it('seeds a float from its anchor + size', () => {
    const rects = seedRects(doc([
      { id: 'm', type: 'esri:map', layer: 'base' },
      { id: 'f', type: 'stat', layer: 'float', anchor: 'top-left', size: { w: 20, h: 15 } },
    ]))
    expect(rects.f.x).toBeGreaterThanOrEqual(0)
    expect(rects.f.y).toBeGreaterThanOrEqual(0)
    expect(rects.f.w).toBe(20)
    expect(rects.f.h).toBe(15)
  })

  it('exercises auto-shell inference: bare map + data-table infers base + bottom dock', () => {
    // BARE doc: no explicit layer/edge anywhere. applyAutoShell promotes map to base
    // and infers data-table as bottom dock via edgeForType fallback.
    const rects = seedRects(doc([
      { id: 'm', type: 'esri:map' },
      { id: 'tb', type: 'data-table' },
    ]))
    // Map promoted to base: full-bleed at z 0
    expect(rects.m).toEqual({ x: 0, y: 0, w: 100, h: 100, z: 0 })
    // Table inferred as bottom dock: respects attribution strip
    expect(rects.tb.y + rects.tb.h).toBeCloseTo(100 - RESERVE_PCT, 5)
    expect(rects.tb.z).toBeGreaterThan(0)
  })
})

describe('minSizePct', () => {
  it('converts per-type px minimums against the container', () => {
    expect(MIN_SIZE_PX['esri:map']).toEqual({ w: 280, h: 220 })
    const min = minSizePct('esri:map', { w: 1000, h: 800 })
    expect(min.w).toBeCloseTo(28, 5)
    expect(min.h).toBeCloseTo(27.5, 5)
  })
  it('falls back to the default minimum for unknown types', () => {
    const min = minSizePct('mystery', { w: 1000, h: 1000 })
    expect(min.w).toBeCloseTo(16, 5)
    expect(min.h).toBeCloseTo(10, 5)
  })
})

describe('applyDrag', () => {
  it('translates by a percent delta', () => {
    expect(applyDrag({ x: 10, y: 10, w: 20, h: 20, z: 1 }, 5, -3))
      .toEqual({ x: 15, y: 7, w: 20, h: 20, z: 1 })
  })
})

describe('applyResize', () => {
  const r = { x: 20, y: 20, w: 40, h: 40, z: 1 }
  const min = { w: 10, h: 10 }
  it('se handle grows width/height, keeps origin', () => {
    expect(applyResize(r, 'se', 5, 5, min)).toMatchObject({ x: 20, y: 20, w: 45, h: 45 })
  })
  it('nw handle moves origin and shrinks, clamped to min size', () => {
    expect(applyResize(r, 'nw', 100, 100, min)).toMatchObject({ w: 10, h: 10 })
  })
})

describe('clampToBounds', () => {
  it('keeps the top edge on-canvas so the header stays reachable', () => {
    expect(clampToBounds({ x: 10, y: -50, w: 20, h: 20, z: 1 }, 8).y).toBe(0)
  })
  it('allows partial off-right but keeps a visible margin', () => {
    const c = clampToBounds({ x: 130, y: 10, w: 20, h: 20, z: 1 }, 8)
    expect(c.x).toBe(92) // 100 - marginPct
  })
})
