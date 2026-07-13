import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'
import { HandlerProvider } from '../HandlerContext'
import type { CanvasActions } from '../../lib/handlers'

const built: string[] = []
vi.mock('../../lib/esri/loader', () => ({
  loadEsri: async () => ({ esriConfig: {}, FeatureLayer: class {}, reactiveUtils: { on: () => ({ remove() {} }) } })
}))
vi.mock('../../lib/esri/layers', () => ({
  parseLayerRef: (r: string) => ({ kind: 'rows', name: r }),
  buildLayer: (ref: string) => { built.push(ref); return { ref } }
}))

import { EsriMapMolecule } from './EsriMapMolecule'

const node: ComponentNode = {
  id: 'map1', type: 'esri:map', area: { col: 1, colSpan: 8, row: 1, rowSpan: 4 },
  props: { basemap: 'osm' }, bindings: { layers: ['mock://incidents', 'https://x/FeatureServer/0'] }
}

test('renders an arcgis-map element with a stable id and default basemap', async () => {
  const { container } = render(<EsriMapMolecule node={node} renderChild={() => null} />)
  await waitFor(() => expect(container.querySelector('#esri-map-map1')).toBeTruthy())
  expect(container.querySelector('arcgis-map')?.getAttribute('basemap')).toBe('osm')
})

test('builds a layer per bindings.layers entry once the view is ready', async () => {
  built.length = 0
  const el = render(<EsriMapMolecule node={node} renderChild={() => null} />).container.querySelector('arcgis-map')!
  // simulate the view-ready lifecycle event our molecule listens for
  el.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
  await waitFor(() => expect(built).toEqual(['mock://incidents', 'https://x/FeatureServer/0']))
})

describe('EsriMapMolecule', () => {
  it('shows a map skeleton until the view is ready', () => {
    const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData: vi.fn() }
    const mapNode: ComponentNode = {
      id: 'map', type: 'esri:map', area: { col: 1, colSpan: 8, row: 1, rowSpan: 4 },
      bindings: { layers: ['data://x'] }, props: {}
    }
    render(
      <HandlerProvider actions={actions}>
        <EsriMapMolecule node={mapNode} renderChild={() => null} />
      </HandlerProvider>
    )
    expect(screen.getByTestId('map-skeleton')).toBeInTheDocument()
  })
})
