import { describe, it, expect } from 'vitest'
import { defaultSize, defaultDockSize, railStyle, floatStyle } from './anchor'

describe('defaultDockSize', () => {
  it('per-edge thickness defaults', () => {
    expect(defaultDockSize('left')).toEqual({ w: 26, h: 100 })
    expect(defaultDockSize('bottom')).toEqual({ w: 100, h: 34 })
    expect(defaultDockSize('top')).toEqual({ w: 100, h: 10 })
  })
})

describe('railStyle', () => {
  it('left rail fills height above the attribution strip, definite width', () => {
    const s = railStyle('left')
    expect(s.position).toBe('absolute')
    expect(s.top).toBe(0); expect(s.bottom).toBe(22); expect(s.left).toBe(0)
    expect(s.width).toBe('26%'); expect(s.flexDirection).toBe('column')
  })
  it('bottom rail sits above the attribution strip, inset by vertical rails', () => {
    const s = railStyle('bottom', undefined, { left: '26%', right: '0' })
    expect(s.bottom).toBe(22); expect(s.left).toBe('26%'); expect(s.right).toBe('0')
    expect(s.height).toBe('34%'); expect(s.flexDirection).toBe('row')
  })
})

describe('floatStyle', () => {
  it('positions at the anchor with definite % size', () => {
    const s = floatStyle('top-left', { w: 30, h: 50 })
    expect(s.position).toBe('absolute'); expect(s.top).toBe(12); expect(s.left).toBe(12)
    expect(s.width).toBe('30%'); expect(s.maxHeight).toBe('50%')
  })
  it('falls back to anchor default size', () => {
    const s = floatStyle('bottom')
    expect(s.width).toBe('60%'); expect(s.maxHeight).toBe('22%')
  })
})

describe('defaultSize', () => {
  it('float anchor defaults preserved', () => {
    expect(defaultSize('top-left')).toEqual({ w: 24, h: 40 })
  })
})
