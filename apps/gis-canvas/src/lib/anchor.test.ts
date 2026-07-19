import { describe, it, expect } from 'vitest'
import { defaultSize, zoneStyle, floatStyle } from './anchor'

describe('defaultSize', () => {
  it('gives per-anchor defaults', () => {
    expect(defaultSize('top-left')).toEqual({ w: 24, h: 40 })
    expect(defaultSize('left')).toEqual({ w: 24, h: 60 })
    expect(defaultSize('top')).toEqual({ w: 60, h: 22 })
    expect(defaultSize('bottom')).toEqual({ w: 92, h: 34 })
    expect(defaultSize('center')).toEqual({ w: 60, h: 60 })
  })
})

describe('zoneStyle', () => {
  it('pins corners and stacks them as a column', () => {
    const s = zoneStyle('top-left')
    expect(s.position).toBe('absolute')
    expect(s.top).toBeDefined()
    expect(s.left).toBeDefined()
    expect(s.flexDirection).toBe('column')
  })

  it('lays horizontal strips as a centered row', () => {
    const s = zoneStyle('bottom')
    expect(s.flexDirection).toBe('row')
    expect(s.justifyContent).toBe('center')
    expect(s.bottom).toBeDefined()
    expect(s.left).toBeDefined()
    expect(s.right).toBeDefined()
  })
})

describe('floatStyle', () => {
  it('uses the given size as a width/height percent', () => {
    const s = floatStyle('top-left', { w: 30, h: 50 })
    expect(s.width).toBe('30%')
    expect(s.maxHeight).toBe('50%')
    expect(s.overflow).toBe('auto')
  })

  it('falls back to the anchor default size when none given', () => {
    const s = floatStyle('bottom')
    expect(s.width).toBe('92%')
    expect(s.maxHeight).toBe('34%')
  })
})
