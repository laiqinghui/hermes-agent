import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLayoutStore } from './use-layout-store'

describe('useLayoutStore', () => {
  it('sets and reads an override', () => {
    const { result } = renderHook(() => useLayoutStore())
    act(() => result.current.set('a', { x: 1, y: 2, w: 3, h: 4, z: 1 }))
    expect(result.current.get('a')).toEqual({ x: 1, y: 2, w: 3, h: 4, z: 1 })
    expect(result.current.isEmpty).toBe(false)
  })

  it('prune drops overrides whose id is gone; reset clears all', () => {
    const { result } = renderHook(() => useLayoutStore())
    act(() => {
      result.current.set('a', { x: 0, y: 0, w: 10, h: 10, z: 1 })
      result.current.set('b', { x: 0, y: 0, w: 10, h: 10, z: 1 })
    })
    act(() => result.current.prune(['a']))
    expect(result.current.get('b')).toBeUndefined()
    act(() => result.current.reset())
    expect(result.current.isEmpty).toBe(true)
  })
})
