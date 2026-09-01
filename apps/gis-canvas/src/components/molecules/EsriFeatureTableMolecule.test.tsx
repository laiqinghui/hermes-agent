import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { HandlerProvider } from '../HandlerContext'
import type { CanvasActions } from '../../lib/handlers'
import type { ComponentNode } from '../../lib/types'

vi.mock('../../lib/esri/loader', () => ({
  loadEsri: async () => ({ FeatureLayer: class {} }),
  loadFeatureTable: async () => ({})
}))
vi.mock('../../lib/esri/layers', () => ({
  buildLayer: (ref: string) => ({ ref }),
  buildRowsLayer: () => ({})
}))

import { EsriFeatureTableMolecule } from './EsriFeatureTableMolecule'

const renderWith = (fetchData: CanvasActions['fetchData']) => {
  const actions: CanvasActions = { setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData }
  const node: ComponentNode = { id: 'ft1', type: 'esri:feature-table', bindings: { layer: 'data://gone' } }
  return render(
    <HandlerProvider actions={actions}>
      <EsriFeatureTableMolecule node={node} renderChild={() => null} />
    </HandlerProvider>
  )
}

describe('EsriFeatureTableMolecule', () => {
  it('surfaces an expired handle instead of an empty table', async () => {
    const fetchData = vi.fn().mockResolvedValue({
      ok: false, expired: true, rows: [], schema: [], total: 0, page: 0, pageSize: 100,
      errors: ["handle 'data://gone' expired and its cached rows were dropped; re-run the query to repopulate it"]
    })
    renderWith(fetchData)
    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument())
  })

  it('renders the table element normally for a usable page', async () => {
    const fetchData = vi.fn().mockResolvedValue({
      ok: true, rows: [{ id: 'a' }], schema: [{ name: 'id', type: 'string' }], total: 1, page: 0, pageSize: 100
    })
    const { container } = renderWith(fetchData)
    await waitFor(() => expect(fetchData).toHaveBeenCalled())
    expect(container.querySelector('arcgis-feature-table')).toBeTruthy()
    expect(screen.queryByText(/expired/i)).not.toBeInTheDocument()
  })
})
