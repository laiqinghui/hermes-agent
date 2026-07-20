import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Window } from './Window'
import type { ComponentNode } from '../lib/types'

const node: ComponentNode = { id: 'w1', type: 'stat', props: { title: 'Speed' } }
const rect = { x: 10, y: 10, w: 30, h: 20, z: 1 }
const getContainer = () => ({ w: 1000, h: 500 })

function setup(over = {}) {
  const onDragMove = vi.fn(); const onResizeMove = vi.fn(); const onGestureStart = vi.fn()
  render(
    <Window node={node} rect={rect} getContainer={getContainer}
      onDragMove={onDragMove} onResizeMove={onResizeMove} onGestureStart={onGestureStart} {...over}>
      <div>body</div>
    </Window>,
  )
  return { onDragMove, onResizeMove, onGestureStart }
}

describe('Window', () => {
  it('renders the title in the header and positions from the rect', () => {
    setup()
    expect(screen.getByText('Speed')).toBeInTheDocument()
    expect(screen.getByTestId('window-w1')).toHaveStyle({ left: '10%', top: '10%', width: '30%', height: '20%' })
  })

  it('dragging the header reports a percent delta of the container', () => {
    const { onDragMove } = setup()
    const header = screen.getByTestId('window-header-w1')
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 50 }) // +100px/1000, +50px/500
    expect(onDragMove).toHaveBeenLastCalledWith(10, 10, false)
    fireEvent.pointerUp(window, { clientX: 100, clientY: 50 })
    expect(onDragMove).toHaveBeenLastCalledWith(10, 10, true) // commit
  })

  it('pointerdown on the header starts a gesture (bubbles to outer onGestureStart)', () => {
    const { onGestureStart } = setup()
    fireEvent.pointerDown(screen.getByTestId('window-header-w1'), { clientX: 0, clientY: 0 })
    expect(onGestureStart).toHaveBeenCalledTimes(1)
  })

  it('a resize handle starts a gesture explicitly (stopPropagation blocks bubbling)', () => {
    const { onGestureStart, onResizeMove } = setup()
    fireEvent.pointerDown(screen.getByTestId('resize-w1-se'), { clientX: 0, clientY: 0 })
    expect(onGestureStart).toHaveBeenCalledTimes(1)
    fireEvent.pointerMove(window, { clientX: 100, clientY: 50 })
    expect(onResizeMove).toHaveBeenLastCalledWith('se', 10, 10, false)
  })

  it('pointercancel commits and tears down the window listeners so a later move is ignored', () => {
    const { onDragMove } = setup()
    const header = screen.getByTestId('window-header-w1')
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 50 })
    expect(onDragMove).toHaveBeenLastCalledWith(10, 10, false)
    fireEvent.pointerCancel(window, { clientX: 100, clientY: 50 })
    expect(onDragMove).toHaveBeenLastCalledWith(10, 10, true) // finalized at cancel position, like commit
    const callsAfterCancel = onDragMove.mock.calls.length
    fireEvent.pointerMove(window, { clientX: 200, clientY: 150 })
    expect(onDragMove).toHaveBeenCalledTimes(callsAfterCancel) // listeners removed — no further calls
  })
})
