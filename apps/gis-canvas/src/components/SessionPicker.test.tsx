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
    onOpenSession={onOpenSession} onClose={onClose}
    onRename={() => {}} onArchive={() => {}} onDelete={() => {}} {...over} />)
  return { onOpenSession, onClose }
}

describe('SessionPicker', () => {
  it('renders nothing when closed', () => {
    render(<SessionPicker open={false} rows={rows} canvasKeys={new Set()} busy={false}
      onOpenSession={() => {}} onClose={() => {}}
      onRename={() => {}} onArchive={() => {}} onDelete={() => {}} />)
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
      onOpenSession={() => {}} onClose={() => {}}
      onRename={() => {}} onArchive={() => {}} onDelete={() => {}} />)
    const row = screen.getByTestId('session-row-x')
    expect(row.querySelector('img')).toBeNull()
    expect(row).toHaveTextContent('<img src=x onerror=alert(1)>')
  })

  it('shows a loading state while rows are being fetched', () => {
    render(<SessionPicker open rows={[]} canvasKeys={new Set()} busy
      onOpenSession={() => {}} onClose={() => {}}
      onRename={() => {}} onArchive={() => {}} onDelete={() => {}} />)
    expect(screen.getByTestId('session-picker')).toHaveTextContent('Loading sessions')
  })

  it('shows an empty state when there are no sessions', () => {
    render(<SessionPicker open rows={[]} canvasKeys={new Set()} busy={false}
      onOpenSession={() => {}} onClose={() => {}}
      onRename={() => {}} onArchive={() => {}} onDelete={() => {}} />)
    expect(screen.getByTestId('session-picker')).toHaveTextContent('No sessions')
  })
})

function setupManage(over = {}) {
  const onRename = vi.fn(); const onArchive = vi.fn(); const onDelete = vi.fn()
  render(<SessionPicker open rows={rows} canvasKeys={new Set(['own1'])} busy={false}
    onOpenSession={() => {}} onClose={() => {}}
    onRename={onRename} onArchive={onArchive} onDelete={onDelete} {...over} />)
  return { onRename, onArchive, onDelete }
}

describe('SessionPicker management', () => {
  it('renames inline on Enter', () => {
    const { onRename } = setupManage()
    fireEvent.click(screen.getByTestId('rename-own1'))
    const input = screen.getByTestId('rename-input-own1')
    fireEvent.change(input, { target: { value: 'Renamed' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onRename).toHaveBeenCalledWith('own1', 'Renamed')
  })

  it('Escape cancels the rename even though it also blurs the input', () => {
    const { onRename } = setupManage()
    fireEvent.click(screen.getByTestId('rename-own1'))
    const input = screen.getByTestId('rename-input-own1')
    fireEvent.change(input, { target: { value: 'Discarded' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    fireEvent.blur(input)
    expect(onRename).not.toHaveBeenCalled()
    expect(screen.queryByTestId('rename-input-own1')).toBeNull()
  })

  it('commits on blur when the edit was not cancelled', () => {
    const { onRename } = setupManage()
    fireEvent.click(screen.getByTestId('rename-own1'))
    const input = screen.getByTestId('rename-input-own1')
    fireEvent.change(input, { target: { value: 'Committed' } })
    fireEvent.blur(input)
    expect(onRename).toHaveBeenCalledWith('own1', 'Committed')
  })

  it('archives in one click, no confirmation', () => {
    const { onArchive } = setupManage()
    fireEvent.click(screen.getByTestId('archive-tg1'))
    expect(onArchive).toHaveBeenCalledWith('tg1')
  })

  it('requires confirmation before deleting, and cancelling does nothing', () => {
    const { onDelete } = setupManage()
    fireEvent.click(screen.getByTestId('delete-tg1'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('cancel-delete'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('delete-tg1'))
    fireEvent.click(screen.getByTestId('confirm-delete'))
    expect(onDelete).toHaveBeenCalledWith('tg1')
  })

  it('marks the current session and forbids removing it', () => {
    setupManage({ currentId: 'own1' })
    expect(screen.getByTestId('current-own1')).toBeInTheDocument()
    expect(screen.getByTestId('archive-own1')).toBeDisabled()
    expect(screen.getByTestId('delete-own1')).toBeDisabled()
    // Renaming what you are looking at is fine.
    expect(screen.getByTestId('rename-own1')).not.toBeDisabled()
    // Other rows are unaffected.
    expect(screen.getByTestId('delete-tg1')).not.toBeDisabled()
  })

  it('renders a hostile title as text in the delete confirmation', () => {
    const hostile: SessionRow[] = [{ ...rows[0], id: 'x', title: '<img src=x onerror=alert(1)>' }]
    render(<SessionPicker open rows={hostile} canvasKeys={new Set()} busy={false}
      onOpenSession={() => {}} onClose={() => {}}
      onRename={() => {}} onArchive={() => {}} onDelete={() => {}} />)
    fireEvent.click(screen.getByTestId('delete-x'))
    const dialog = screen.getByTestId('confirm-delete').closest('div')!
    expect(dialog.querySelector('img')).toBeNull()
  })
})
