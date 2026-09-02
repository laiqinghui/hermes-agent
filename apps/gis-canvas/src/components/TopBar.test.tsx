import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from './TopBar'

const base = {
  theme: 'dark' as const, onToggleTheme: () => {}, connected: true, isBusy: false,
  onLogout: () => {}, onResetLayout: () => {}, canReset: false,
  onFocusMap: () => {}, canFocus: false, isFocused: false,
}

describe('TopBar', () => {
  it('shows Reset only when a layout override exists and calls back', () => {
    const onResetLayout = vi.fn()
    const { rerender } = render(<TopBar {...base} onResetLayout={onResetLayout} />)
    expect(screen.queryByTestId('reset-layout')).toBeNull()
    rerender(<TopBar {...base} onResetLayout={onResetLayout} canReset />)
    fireEvent.click(screen.getByTestId('reset-layout'))
    expect(onResetLayout).toHaveBeenCalled()
  })

  it('shows Focus map only when there is something to minimize and calls back', () => {
    const onFocusMap = vi.fn()
    const { rerender } = render(<TopBar {...base} onFocusMap={onFocusMap} />)
    expect(screen.queryByTestId('focus-map')).toBeNull()
    rerender(<TopBar {...base} onFocusMap={onFocusMap} canFocus />)
    fireEvent.click(screen.getByTestId('focus-map'))
    expect(onFocusMap).toHaveBeenCalled()
  })

  it('flips its label once everything is minimized', () => {
    const { rerender } = render(<TopBar {...base} canFocus />)
    expect(screen.getByTestId('focus-map')).toHaveTextContent('Focus map')
    rerender(<TopBar {...base} canFocus isFocused />)
    expect(screen.getByTestId('focus-map')).toHaveTextContent('Show all')
  })
})
