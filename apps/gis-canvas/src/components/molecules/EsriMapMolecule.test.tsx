import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'
import { HandlerProvider } from '../HandlerContext'
import { SelectionProvider, useLinkedSelection } from '../SelectionContext'
import type { CanvasActions } from '../../lib/handlers'

const built: string[] = []
vi.mock('../../lib/esri/loader', () => ({
  loadEsri: async () => ({
    esriConfig: {},
    FeatureLayer: class {},
    reactiveUtils: { on: () => ({ remove() {} }) },
    HeatmapRenderer: class { constructor(_o: any) {} },
    Point: class { constructor(o: any) { Object.assign(this, o) } },
    // contains: "inside" = western hemisphere (lng < 0), for the geofence test below
    geometryEngine: { contains: (_geom: any, p: any) => (p as any).x < 0 },
    webMercatorUtils: { webMercatorToGeographic: (g: any) => g }
  })
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

function Selector({ source }: { source: string }) {
  const [, setSel] = useLinkedSelection(source)
  return <button onClick={() => setSel(['a', 'b'])}>select-2</button>
}

describe('EsriMapMolecule linked selection', () => {
  it('shows the selected count from the shared selection for its data source', () => {
    const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData: vi.fn() }
    const mapNode: ComponentNode = { id: 'm', type: 'esri:map', bindings: { layers: ['data://x'] }, props: {} }
    render(
      <SelectionProvider nodesBySource={{ 'data://x': ['m'] }} onMirror={() => {}}>
        <HandlerProvider actions={actions}>
          <Selector source="data://x" />
          <EsriMapMolecule node={mapNode} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    )
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('select-2'))
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument()
  })
})

test('renders the sketch + basemap-toggle children when the props are set', async () => {
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData: vi.fn() }
  const mapNode: ComponentNode = {
    id: 'mx', type: 'esri:map',
    bindings: { layers: ['data://x'] },
    props: { spatialFilter: true, basemapToggle: true, basemapAlt: 'hybrid' }
  }
  const { container } = render(
    <HandlerProvider actions={actions}>
      <EsriMapMolecule node={mapNode} renderChild={() => null} />
    </HandlerProvider>
  )
  expect(container.querySelector('arcgis-sketch')).toBeTruthy()
  const toggle = container.querySelector('arcgis-basemap-toggle')
  expect(toggle?.getAttribute('next-basemap')).toBe('hybrid')
})

test('a completed sketch selects the contained rows via linked selection', async () => {
  const page = {
    ok: true, total: 3, page: 0, pageSize: 5000,
    schema: [{ name: 'id', type: 'string' }, { name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }],
    rows: [
      { id: 'a', lng: -70.1, lat: 41.3 },
      { id: 'b', lng: -70.2, lat: 41.4 },
      { id: 'c', lng: 12.0, lat: 50.0 }
    ]
  }
  const fetchData = vi.fn().mockResolvedValue(page)
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  const mapNode: ComponentNode = { id: 'ms', type: 'esri:map', bindings: { layers: ['data://x'] }, props: { spatialFilter: true } }
  const { container } = render(
    <SelectionProvider nodesBySource={{ 'data://x': ['ms'] }} onMirror={() => {}}>
      <HandlerProvider actions={actions}>
        <EsriMapMolecule node={mapNode} renderChild={() => null} />
      </HandlerProvider>
    </SelectionProvider>
  )
  const mapEl = container.querySelector('arcgis-map')!
  mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
  // wait for fetchData + dataRef population
  await waitFor(() => expect(fetchData).toHaveBeenCalled())
  const sketch = container.querySelector('arcgis-sketch')!
  sketch.dispatchEvent(new CustomEvent('arcgisCreate', { detail: { state: 'complete', graphic: { geometry: {} } } }))
  // a,b are lng<0 → contained; c is not
  await waitFor(() => expect(container.textContent).toMatch(/2 selected/i))
})
