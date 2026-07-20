import { describe, it, expect } from 'vitest'
import { snapTargets, snapDrag } from './window-snap'
import type { WindowRect } from './types'

const R = (x: number, y: number, w = 20, h = 20): WindowRect => ({ x, y, w, h, z: 1 })

describe('snapTargets', () => {
  it('emits neighbour edges/centres plus grid + canvas edges', () => {
    const t = snapTargets([R(40, 0)], 10)
    expect(t.xs).toContain(40)        // neighbour left
    expect(t.xs).toContain(60)        // neighbour right
    expect(t.xs).toContain(50)        // neighbour centre
    expect(t.xs).toContain(0)         // canvas edge
    expect(t.xs).toContain(100)
    expect(t.xs).toContain(10)        // grid line
  })
})

describe('snapDrag', () => {
  const targets = snapTargets([R(40, 0)], 10)
  it('snaps a near-left edge to the neighbour and reports a guide', () => {
    const res = snapDrag(R(41.5, 30), targets, 3)
    expect(res.rect.x).toBe(40)
    expect(res.guideX).toBe(40)
  })
  it('leaves rects outside the threshold untouched', () => {
    const res = snapDrag(R(55, 30), targets, 3)
    expect(res.rect.x).toBe(55)
    expect(res.guideX).toBeUndefined()
  })
})
