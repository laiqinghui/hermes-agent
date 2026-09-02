import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SessionPicker } from './SessionPicker'
import type { SessionRow } from '../lib/sessions'

const rows: SessionRow[] = [
  { id: 'own1', source: 'dashboard', title: 'Shadow fleet', preview: 'find gaps', message_count: 12, started_at: 1, last_active: 9 },
  { id: 'tg1', source: 'telegram', title: '', preview: 'what is the ETA', message_count: 4, started_at: 2, last_active: 8 },
]

function setup(over = {}) {
  const onOpenSession = vi.fn(); const onClose = vi.fn()
  render(<SessionPicker open rows={rows} canvasKeys={new Set(['own1'])} busy={false}
    onOpenSession={onOpenSession} onClose={onClose} {...over} />)
  return { onOpenSession, onClose }
}

describe('SessionPicker', () => {
  it('renders nothing when closed', () => {
    render(<SessionPicker open={false} rows={rows} canvasKeys={new Set()} busy={false}
      onOpenSession={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId('session-picker')).toBeNull()
  })

  it('shows a row per session with its source', () => {
    setup()
    expect(screen.getByText('Shadow fleet')).toBeInTheDocument()
    expect(screen.getByTestId('session-row-tg1')).toHaveTextContent('telegram')
  })

  it('falls back to the preview when a session has no title', () => {
    setup()
    expect(screen.getByText('what is the ETA')).toBeInTheDocument()
  })

  it('marks sessions that already have a stored canvas', () => {
    setup()
    expect(screen.getByTestId('session-badge-own1')).toHaveTextContent('Canvas')
    expect(screen.getByTestId('session-badge-tg1')).toHaveTextContent('Transcript')
  })

  it('reports whether the opened row has a canvas', () => {
    const { onOpenSession } = setup()
    fireEvent.click(screen.getByTestId('session-row-own1'))
    expect(onOpenSession).toHaveBeenCalledWith(rows[0], true)
    fireEvent.click(screen.getByTestId('session-row-tg1'))
    expect(onOpenSession).toHaveBeenLastCalledWith(rows[1], false)
  })

  it('filters as you search, over title and preview', () => {
    setup()
    fireEvent.change(screen.getByTestId('session-search'), { target: { value: 'eta' } })
    expect(screen.queryByTestId('session-row-own1')).toBeNull()
    expect(screen.getByTestId('session-row-tg1')).toBeInTheDocument()
  })

  it('renders a hostile title as text, never as markup', () => {
    const hostile: SessionRow[] = [{ ...rows[0], id: 'x', title: '<img src=x onerror=alert(1)>' }]
    render(<SessionPicker open rows={hostile} canvasKeys={new Set()} busy={false}
      onOpenSession={() => {}} onClose={() => {}} />)
    const row = screen.getByTestId('session-row-x')
    expect(row.querySelector('img')).toBeNull()
    expect(row).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('shows a loading state while rows are being fetched', () => {
    render(<SessionPicker open rows={[]} canvasKeys={new Set()} busy
      onOpenSession={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('session-picker')).toHaveTextContent('Loading sessions')
  })

  it('shows an empty state when there are no sessions', () => {
    render(<SessionPicker open rows={[]} canvasKeys={new Set()} busy={false}
      onOpenSession={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('session-picker')).toHaveTextContent('No sessions')
  })
})
