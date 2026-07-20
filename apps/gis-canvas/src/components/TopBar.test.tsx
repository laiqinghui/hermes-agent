import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from './TopBar'

describe('TopBar', () => {
  it('shows Reset only when a layout override exists and calls back', () => {
    const onResetLayout = vi.fn()
    const { rerender } = render(<TopBar theme="dark" onToggleTheme={() => {}} connected isBusy={false}
      onLogout={() => {}} onResetLayout={onResetLayout} canReset={false} />)
    expect(screen.queryByTestId('reset-layout')).toBeNull()
    rerender(<TopBar theme="dark" onToggleTheme={() => {}} connected isBusy={false}
      onLogout={() => {}} onResetLayout={onResetLayout} canReset />)
    fireEvent.click(screen.getByTestId('reset-layout'))
    expect(onResetLayout).toHaveBeenCalled()
  })
})
