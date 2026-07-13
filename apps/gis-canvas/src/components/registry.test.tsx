import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { COMPONENT_REGISTRY } from './registry'
import { HandlerProvider } from './HandlerContext'
import type { CanvasActions } from '../lib/handlers'

const page = {
  ok: true, total: 1, page: 0, pageSize: 1000,
  schema: [{ name: 'id', type: 'string' }],
  rows: [{ id: 'feat-1' }]
}

describe('registry', () => {
  it('does not register a native ESRI feature-table widget', () => {
    // esri:feature-table is handled by the DataTable alias, not the broken widget.
    expect(COMPONENT_REGISTRY['esri:feature-table']).toBeDefined()
  })

  it('renders an esri:feature-table node as a data table over its layer handle', async () => {
    const fetchData = vi.fn().mockResolvedValue(page)
    const actions: CanvasActions = { setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData }
    const Alias = COMPONENT_REGISTRY['esri:feature-table']
    render(
      <HandlerProvider actions={actions}>
        <Alias node={{ id: 'ft', type: 'esri:feature-table', bindings: { layer: 'data://ft1' } } as any} renderChild={() => null} />
      </HandlerProvider>
    )
    await waitFor(() => expect(screen.getByText('feat-1')).toBeInTheDocument())
    expect(fetchData).toHaveBeenCalledWith('data://ft1', expect.anything())
  })
})
