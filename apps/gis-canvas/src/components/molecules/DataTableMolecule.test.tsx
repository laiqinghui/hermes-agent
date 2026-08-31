import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { DataTableMolecule } from './DataTableMolecule'
import { HandlerProvider } from '../HandlerContext'
import { SelectionProvider } from '../SelectionContext'
import type { CanvasActions } from '../../lib/handlers'

const page = {
  ok: true, total: 1, page: 0, pageSize: 100,
  schema: [{ name: 'id', type: 'string' }, { name: 'sev', type: 'string' }],
  rows: [{ id: 'x1', sev: 'high' }]
}

function renderWith(node: any, fetchData: CanvasActions['fetchData']) {
  const actions: CanvasActions = {
    setLocalState: () => {},
    reportInteraction: vi.fn(),
    sendPrompt: () => {},
    fetchData
  }
  return render(
    <HandlerProvider actions={actions}>
      <DataTableMolecule node={node} renderChild={() => null} />
    </HandlerProvider>
  )
}

describe('DataTableMolecule data:// handle', () => {
  it('pulls rows from the data plane for a data:// source', async () => {
    const fetchData = vi.fn().mockResolvedValue(page)
    renderWith({ id: 't1', type: 'data-table', bindings: { source: 'data://ab12' } }, fetchData)
    await waitFor(() => expect(screen.getByText('x1')).toBeInTheDocument())
    expect(fetchData).toHaveBeenCalledWith('data://ab12', expect.anything())
  })

  it('still resolves mock:// sources locally (back-compat)', async () => {
    const fetchData = vi.fn()
    renderWith({ id: 't2', type: 'data-table', bindings: { source: 'mock://incidents' } }, fetchData)
    await waitFor(() => expect(screen.getByText('f_82')).toBeInTheDocument())
    expect(fetchData).not.toHaveBeenCalled()
  })

  it('shows a skeleton (not an error) while a data:// handle is pending', () => {
    const fetchData = vi.fn(() => new Promise<never>(() => {})) // never resolves
    renderWith({ id: 't3', type: 'data-table', bindings: { source: 'data://pending' } }, fetchData as any)
    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
    expect(screen.queryByText(/Unknown data source/)).not.toBeInTheDocument()
  })

  // An expired handle used to render as a plain empty table, which reads as "the query
  // legitimately found nothing" and hid a recoverable cache problem behind a real-looking result.
  it('surfaces an expired handle instead of rendering a silent empty table', async () => {
    const fetchData = vi.fn().mockResolvedValue({
      ok: false, expired: true, rows: [], schema: [], total: 0, page: 0, pageSize: 100,
      errors: ["handle 'data://gone' expired and its cached rows were dropped; re-run the query to repopulate it"]
    })
    renderWith({ id: 't4', type: 'data-table', bindings: { source: 'data://gone' } }, fetchData)
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument())
    expect(screen.queryByText('0 rows')).not.toBeInTheDocument()
  })

  it('surfaces a failed fetch that is not an expiry', async () => {
    const fetchData = vi.fn().mockResolvedValue({
      ok: false, expired: false, rows: [], schema: [], total: 0, page: 0, pageSize: 100,
      errors: ["unknown handle 'data://nope'"]
    })
    renderWith({ id: 't5', type: 'data-table', bindings: { source: 'data://nope' } }, fetchData)
    await waitFor(() => expect(screen.getByText(/unknown handle/i)).toBeInTheDocument())
  })

  it('still renders a genuinely empty result as an empty table, not an error', async () => {
    const fetchData = vi.fn().mockResolvedValue({
      ok: true, rows: [], schema: [{ name: 'id', type: 'string' }], total: 0, page: 0, pageSize: 100
    })
    renderWith({ id: 't6', type: 'data-table', bindings: { source: 'data://empty' } }, fetchData)
    await waitFor(() => expect(screen.getByText('0 rows')).toBeInTheDocument())
  })
})

describe('DataTableMolecule linked selection', () => {
  it('toggling a row sets the shared selection (mirrored to the node)', async () => {
    const onMirror = vi.fn()
    const fetchData = vi.fn().mockResolvedValue(page)
    render(
      <SelectionProvider nodesBySource={{ 'data://ab12': ['t1'] }} onMirror={onMirror}>
        <HandlerProvider actions={{ setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData }}>
          <DataTableMolecule node={{ id: 't1', type: 'data-table', bindings: { source: 'data://ab12' } } as any} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    )
    await waitFor(() => expect(screen.getByText('x1')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('select x1'))
    expect(onMirror).toHaveBeenCalledWith('t1', ['x1'])
    expect((screen.getByLabelText('select x1') as HTMLInputElement).checked).toBe(true)
  })
})
