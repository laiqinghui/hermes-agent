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
  it('renders esri:feature-table as a data table, not the native ESRI widget', async () => {
    const fetchData = vi.fn().mockResolvedValue(page)
    const actions: CanvasActions = { setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData }
    const Alias = COMPONENT_REGISTRY['esri:feature-table']
    const { container } = render(
      <HandlerProvider actions={actions}>
        <Alias node={{ id: 'ft0', type: 'esri:feature-table', bindings: { layer: 'data://ft0' } } as any} renderChild={() => null} />
      </HandlerProvider>
    )
    expect(container.querySelector('arcgis-feature-table')).toBeNull()
  })

  it('shows a quiet unavailable tile when an esri:feature-table node has no layer binding', () => {
    const actions: CanvasActions = { setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData: vi.fn() }
    const Alias = COMPONENT_REGISTRY['esri:feature-table']
    render(
      <HandlerProvider actions={actions}>
        <Alias node={{ id: 'ft-empty', type: 'esri:feature-table', bindings: {} } as any} renderChild={() => null} />
      </HandlerProvider>
    )
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument()
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
