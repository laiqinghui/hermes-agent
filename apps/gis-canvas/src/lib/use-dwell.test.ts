import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDwell } from './use-dwell'

afterEach(() => vi.useRealTimers())

describe('useDwell', () => {
  it('shows the first value immediately', () => {
    vi.useFakeTimers()
    const { result } = renderHook(({ v, k }) => useDwell(v, k, 1000), {
      initialProps: { v: 'a', k: 'a' },
    })
    expect(result.current).toBe('a')
  })

  it('holds the current value for minMs, then shows the latest (coalescing intermediates)', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v, k }) => useDwell(v, k, 1000), {
      initialProps: { v: 'a', k: 'a' },
    })
    // a rapid burst of changes within the dwell window
    rerender({ v: 'b', k: 'b' })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ v: 'c', k: 'c' })
    // still holding 'a' — the dwell has not elapsed
    expect(result.current).toBe('a')
    // once the dwell elapses it jumps straight to the LATEST ('c'), skipping 'b'
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe('c')
  })

  it('does not reschedule when the key is unchanged (value churn without a new key)', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v, k }) => useDwell(v, k, 1000), {
      initialProps: { v: 'a', k: 'same' },
    })
    rerender({ v: 'a2', k: 'same' })
    act(() => { vi.advanceTimersByTime(2000) })
    // key never changed → the held value stays the first one
    expect(result.current).toBe('a')
  })
})
