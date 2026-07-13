import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DataTableMolecule } from './DataTableMolecule'
import { HandlerProvider } from '../HandlerContext'
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
})
