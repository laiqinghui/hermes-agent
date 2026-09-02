import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWindowStateStore } from './use-window-state'

describe('useWindowStateStore', () => {
  it('defaults to open and toggles shade back and forth', () => {
    const { result } = renderHook(() => useWindowStateStore())
    expect(result.current.get('a')).toBe('open')
    expect(result.current.isEmpty).toBe(true)
    act(() => result.current.toggleShade('a'))
    expect(result.current.get('a')).toBe('shaded')
    expect(result.current.isEmpty).toBe(false)
    act(() => result.current.toggleShade('a'))
    expect(result.current.get('a')).toBe('open')
    expect(result.current.isEmpty).toBe(true)
  })

  it('minimizes and restores, and lists minimized ids', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.minimize('a'))
    expect(result.current.get('a')).toBe('minimized')
    expect(result.current.minimizedIds).toEqual(['a'])
    act(() => result.current.restore('a'))
    expect(result.current.get('a')).toBe('open')
    expect(result.current.minimizedIds).toEqual([])
  })

  it('markUpdated flags a window and restore clears the flag', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.minimize('a'); result.current.markUpdated('a') })
    expect(result.current.updated.has('a')).toBe(true)
    act(() => result.current.restore('a'))
    expect(result.current.updated.has('a')).toBe(false)
  })

  it('sync prunes states and updated flags for molecules that are gone', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.minimize('a'); result.current.markUpdated('a'); result.current.toggleShade('b') })
    act(() => result.current.sync(['b']))
    expect(result.current.get('a')).toBe('open')
    expect(result.current.updated.has('a')).toBe(false)
    expect(result.current.get('b')).toBe('shaded')
  })

  it('sync with an unchanged id list keeps the same state reference (React bailout)', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.minimize('a'))
    const before = result.current.states
    act(() => result.current.sync(['a', 'b']))
    act(() => result.current.sync(['a', 'b']))
    expect(result.current.states).toBe(before)
  })

  it('toggleFocus minimizes every candidate, then restores them all', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.sync(['a', 'b']))
    expect(result.current.canFocus).toBe(true)
    expect(result.current.isFocused).toBe(false)
    act(() => result.current.toggleFocus())
    expect(result.current.get('a')).toBe('minimized')
    expect(result.current.get('b')).toBe('minimized')
    expect(result.current.isFocused).toBe(true)
    act(() => result.current.toggleFocus())
    expect(result.current.get('a')).toBe('open')
    expect(result.current.get('b')).toBe('open')
    expect(result.current.isFocused).toBe(false)
  })

  it('toggleFocus also swallows shaded windows and only acts on candidates', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.sync(['a']); result.current.toggleShade('a') })
    act(() => result.current.toggleFocus())
    expect(result.current.get('a')).toBe('minimized')
    expect(result.current.get('map')).toBe('open')
  })

  it('isFocused goes false when a new candidate appears while focused', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.sync(['a']))
    act(() => result.current.toggleFocus())
    expect(result.current.isFocused).toBe(true)
    act(() => result.current.sync(['a', 'b']))
    expect(result.current.isFocused).toBe(false)
  })

  it('reset clears states and update flags', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.minimize('a'); result.current.markUpdated('a'); result.current.toggleShade('b') })
    act(() => result.current.reset())
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.updated.size).toBe(0)
  })

  it('canFocus is false with no candidates', () => {
    const { result } = renderHook(() => useWindowStateStore())
    expect(result.current.canFocus).toBe(false)
    expect(result.current.isFocused).toBe(false)
  })
})
