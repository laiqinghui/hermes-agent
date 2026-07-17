import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ThinkingMolecule } from './ThinkingMolecule'

afterEach(() => vi.useRealTimers())

describe('ThinkingMolecule', () => {
  it('types the text out character by character up to the full string', () => {
    vi.useFakeTimers()
    render(<ThinkingMolecule text="hello" speedMs={1} />)
    const el = screen.getByTestId('thinking-molecule')
    // starts (near) empty
    expect(el.textContent ?? '').not.toContain('hello')
    // advance past 5 chars worth of ticks
    act(() => { vi.advanceTimersByTime(20) })
    expect(el.textContent).toContain('hello')
  })

  it('restarts typing when the text prop changes', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ThinkingMolecule text="aaaa" speedMs={1} />)
    act(() => { vi.advanceTimersByTime(20) })
    rerender(<ThinkingMolecule text="bbbb" speedMs={1} />)
    const el = screen.getByTestId('thinking-molecule')
    expect(el.textContent).not.toContain('bbbb')
    act(() => { vi.advanceTimersByTime(20) })
    expect(el.textContent).toContain('bbbb')
  })
})
