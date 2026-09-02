import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WindowTaskbar } from './WindowTaskbar'
import type { ComponentNode } from '../lib/types'

const nodes: ComponentNode[] = [
  { id: 'tbl', type: 'data-table', props: { title: 'AIS points' } },
  { id: 'ts', type: 'esri:time-slider' },
]

describe('WindowTaskbar', () => {
  it('renders a chip per minimized window and restores on click', () => {
    const onRestore = vi.fn()
    render(<WindowTaskbar nodes={nodes} updated={new Set()} onRestore={onRestore} />)
    expect(screen.getByText('AIS points')).toBeInTheDocument()
    expect(screen.getByText('time slider')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('taskbar-chip-ts'))
    expect(onRestore).toHaveBeenCalledWith('ts')
  })

  it('badges only the chips the agent has revised', () => {
    render(<WindowTaskbar nodes={nodes} updated={new Set(['tbl'])} onRestore={() => {}} />)
    expect(screen.getByTestId('chip-badge-tbl')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-badge-ts')).toBeNull()
  })

  it('renders nothing when no window is minimized', () => {
    render(<WindowTaskbar nodes={[]} updated={new Set()} onRestore={() => {}} />)
    expect(screen.queryByTestId('window-taskbar')).toBeNull()
  })
})
