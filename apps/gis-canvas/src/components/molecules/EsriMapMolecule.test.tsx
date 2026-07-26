import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'
import { HandlerProvider } from '../HandlerContext'
import { SelectionProvider, useLinkedSelection, useSelectionState, useSelectionActions } from '../SelectionContext'
import type { CanvasActions } from '../../lib/handlers'

const built: string[] = []
const builtColors: string[] = []
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
  buildLayer: (ref: string) => { built.push(ref); return { ref } },
  buildRowsLayer: (_s: any, _e: any, _t?: string, _r?: string, color = '#e0685b') => { builtColors.push(color); return { color } },
  // one fake ESRI layer per group point-set (line omitted for the single-point fakes here)
  trackLayersFromGroups: (groups: any[]) => groups.map((g: any) => ({ track: g.trackId, colorIndex: g.colorIndex }))
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
  it('shows the selected count from the shared selection for its data source', async () => {
    const fetchData = vi.fn().mockResolvedValue({
      ok: true, total: 1, page: 0, pageSize: 5000,
      schema: [{ name: 'id', type: 'string' }, { name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }],
      rows: [{ id: 'a', lng: -70, lat: 41 }]
    })
    const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
    const mapNode: ComponentNode = { id: 'm', type: 'esri:map', bindings: { layers: ['data://x'] }, props: {} }
    const fakeView = { map: { add() {}, removeMany() {} }, popupEnabled: true, on: () => ({ remove() {} }) }
    const { container } = render(
      <SelectionProvider nodesBySource={{ 'data://x': ['m'] }} onMirror={() => {}}>
        <HandlerProvider actions={actions}>
          <Selector source="data://x" />
          <EsriMapMolecule node={mapNode} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    )
    const mapEl = container.querySelector('arcgis-map') as any
    mapEl.view = fakeView
    mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
    await waitFor(() => expect(fetchData).toHaveBeenCalled())
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('select-2'))
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument()
  })
})

function UnrelatedSelector({ source }: { source: string }) {
  const actions = useSelectionActions()
  return <button onClick={() => actions.set(source, ['x', 'y'])}>select-unrelated-2</button>
}

describe('EsriMapMolecule selection scoping', () => {
  it('does not inflate the selected count from an unrelated source', async () => {
    const fetchData = vi.fn().mockResolvedValue({
      ok: true, total: 1, page: 0, pageSize: 5000,
      schema: [{ name: 'id', type: 'string' }, { name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }],
      rows: [{ id: 'a', lng: -70, lat: 41 }]
    })
    const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
    const mapNode: ComponentNode = { id: 'ms2', type: 'esri:map', bindings: { layers: ['data://a'] }, props: {} }
    const fakeView = { map: { add() {}, removeMany() {} }, popupEnabled: true, on: () => ({ remove() {} }) }
    const { container } = render(
      <SelectionProvider nodesBySource={{ 'data://a': ['ms2'] }} onMirror={() => {}}>
        <HandlerProvider actions={actions}>
          <UnrelatedSelector source="data://other" />
          <EsriMapMolecule node={mapNode} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    )
    const mapEl = container.querySelector('arcgis-map') as any
    mapEl.view = fakeView
    mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
    await waitFor(() => expect(fetchData).toHaveBeenCalled())

    fireEvent.click(screen.getByText('select-unrelated-2'))

    // an unrelated source's selection must not surface as this map's badge
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument()
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

test('a geofence selects contained rows across ALL data layers', async () => {
  function SelSig() {
    const s = useSelectionState()
    return <span data-testid="sel">{Object.entries(s).map(([k, v]) => `${k}=${v.join(',')}`).sort().join('|')}</span>
  }
  const pageFor = (ids: Array<{ id: string; lng: number; lat: number }>) => ({
    ok: true, total: ids.length, page: 0, pageSize: 5000,
    schema: [{ name: 'id', type: 'string' }, { name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }],
    rows: ids
  })
  const fetchData = vi.fn().mockImplementation((h: string) =>
    Promise.resolve(h === 'data://a'
      ? pageFor([{ id: 'a1', lng: -70, lat: 41 }, { id: 'a2', lng: 5, lat: 40 }])
      : pageFor([{ id: 'b1', lng: -71, lat: 42 }])))
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  const node: ComponentNode = { id: 'mu', type: 'esri:map', bindings: { layers: ['data://a', 'data://b'] }, props: { spatialFilter: true } }
  const fakeView = { map: { add() {}, removeMany() {} }, popupEnabled: true, on: () => ({ remove() {} }) }
  const { container } = render(
    <SelectionProvider nodesBySource={{ 'data://a': ['mu'], 'data://b': ['mu'] }} onMirror={() => {}}>
      <HandlerProvider actions={actions}>
        <SelSig />
        <EsriMapMolecule node={node} renderChild={() => null} />
      </HandlerProvider>
    </SelectionProvider>
  )
  const mapEl = container.querySelector('arcgis-map') as any
  mapEl.view = fakeView
  mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
  await waitFor(() => expect(fetchData).toHaveBeenCalledTimes(2))
  const sketch = container.querySelector('arcgis-sketch') as any
  sketch.layer = { remove() {} }
  // fake contains = western hemisphere (lng < 0): a1 and b1 in, a2 out
  sketch.dispatchEvent(new CustomEvent('arcgisCreate', { detail: { state: 'complete', graphic: { geometry: {} } } }))
  await waitFor(() => expect(screen.getByTestId('sel').textContent).toBe('data://a=a1|data://b=b1'))
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
  const sketch = container.querySelector('arcgis-sketch')! as HTMLElement & { layer?: { remove: (g: unknown) => void } }
  const removeSpy = vi.fn()
  sketch.layer = { remove: removeSpy }
  const graphic = { geometry: {} }
  sketch.dispatchEvent(new CustomEvent('arcgisCreate', { detail: { state: 'complete', graphic } }))
  // a,b are lng<0 → contained; c is not
  await waitFor(() => expect(container.textContent).toMatch(/2 selected/i))
  expect(removeSpy).toHaveBeenCalledWith(graphic) // drawn shape removed (transient)
})

test('rebuilds layers when the layer set changes (removes old, adds new)', async () => {
  const added: any[] = []
  const removed: any[] = []
  const fakeView = {
    map: { add: (l: any) => added.push(l), removeMany: (ls: any[]) => removed.push(...ls) },
    popupEnabled: true,
    // click-selection effect (unrelated to this test) re-attaches after every rebuild
    // (buildTick dep) — stub `.on` so it doesn't throw when it registers the listener.
    on: () => ({ remove() {} })
  }
  const fetchData = vi.fn().mockResolvedValue({
    ok: true, total: 1, page: 0, pageSize: 5000,
    schema: [{ name: 'id', type: 'string' }, { name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }],
    rows: [{ id: 'a', lng: -70, lat: 41 }]
  })
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  const nodeA: ComponentNode = { id: 'mm', type: 'esri:map', bindings: { layers: ['data://a'] }, props: {} }
  const nodeB: ComponentNode = { id: 'mm', type: 'esri:map', bindings: { layers: ['data://a', 'data://b'] }, props: {} }

  const { container, rerender } = render(
    <HandlerProvider actions={actions}><EsriMapMolecule node={nodeA} renderChild={() => null} /></HandlerProvider>
  )
  const mapEl = container.querySelector('arcgis-map') as any
  mapEl.view = fakeView
  mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
  await waitFor(() => expect(added.length).toBe(1)) // layer A built

  const beforeRemoved = removed.length
  rerender(<HandlerProvider actions={actions}><EsriMapMolecule node={nodeB} renderChild={() => null} /></HandlerProvider>)
  // layer set changed → old cleared, new set (2) added
  await waitFor(() => expect(removed.length).toBeGreaterThan(beforeRemoved))
  await waitFor(() => expect(added.length).toBe(3)) // 1 (A) + 2 (A,B rebuilt)
})

test('applies a distinct color per layer', async () => {
  builtColors.length = 0
  const added: any[] = []
  const fakeView = {
    map: { add: (l: any) => added.push(l), removeMany: () => {} },
    popupEnabled: true,
    on: () => ({ remove() {} })
  }
  // capture the color passed to buildRowsLayer via the layers mock
  const fetchData = vi.fn().mockResolvedValue({
    ok: true, total: 1, page: 0, pageSize: 5000,
    schema: [{ name: 'id', type: 'string' }, { name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }],
    rows: [{ id: 'a', lng: -70, lat: 41 }]
  })
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  const node: ComponentNode = {
    id: 'mc', type: 'esri:map', bindings: { layers: ['data://a', 'data://b'] },
    props: { layers: [{ title: 'Alpha' }, { title: 'Bravo' }] }
  }
  const { container } = render(
    <HandlerProvider actions={actions}><EsriMapMolecule node={node} renderChild={() => null} /></HandlerProvider>
  )
  const mapEl = container.querySelector('arcgis-map') as any
  mapEl.view = fakeView
  mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
  await waitFor(() => expect(added.length).toBe(2))
  // the two layers were built with different colors (see the buildRowsLayer mock in this file)
  expect(builtColors.length).toBe(2)
  expect(builtColors[0]).not.toBe(builtColors[1])
})

test('render:track builds track layers per group and shows the resolved-roles caption', async () => {
  const added: any[] = []
  const fakeView = { map: { add: (l: any) => added.push(l), removeMany: () => {} }, popupEnabled: true, on: () => ({ remove() {} }) }
  const fetchData = vi.fn().mockResolvedValue({
    ok: true, total: 3, page: 0, pageSize: 5000,
    schema: [
      { name: 'mmsi', type: 'string' }, { name: 'ts', type: 'string' },
      { name: 'lat', type: 'number' }, { name: 'lng', type: 'number' }, { name: 'cog', type: 'number' }
    ],
    rows: [
      { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 10 },
      { mmsi: 'A', ts: '2026-01-01T01:00Z', lat: 1, lng: 1, cog: 20 },
      { mmsi: 'B', ts: '2026-01-01T00:00Z', lat: 5, lng: 5, cog: 30 }
    ]
  })
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  const node: ComponentNode = { id: 'trk', type: 'esri:map', bindings: { layers: ['data://v'] }, props: { render: 'track' } }
  const { container } = render(
    <HandlerProvider actions={actions}><EsriMapMolecule node={node} renderChild={() => null} /></HandlerProvider>
  )
  const mapEl = container.querySelector('arcgis-map') as any
  mapEl.view = fakeView
  mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
  await waitFor(() => expect(fetchData).toHaveBeenCalled())
  // two groups (A, B) → the fake factory returns one layer per group
  await waitFor(() => expect(added.length).toBe(2))
  // resolved-roles caption auto-detected from the AIS-ish schema
  expect(container.textContent).toMatch(/temporal ts/i)
  expect(container.textContent).toMatch(/track mmsi/i)
})

test('render:track honours explicit field overrides in the caption', async () => {
  const fakeView = { map: { add: () => {}, removeMany: () => {} }, popupEnabled: true, on: () => ({ remove() {} }) }
  const fetchData = vi.fn().mockResolvedValue({
    ok: true, total: 1, page: 0, pageSize: 5000,
    schema: [{ name: 'name', type: 'string' }, { name: 'when', type: 'string' }, { name: 'y', type: 'number' }, { name: 'x', type: 'number' }],
    rows: [{ name: 'A', when: '2026-01-01T00:00Z', y: 0, x: 0 }]
  })
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  const node: ComponentNode = {
    id: 'trk2', type: 'esri:map', bindings: { layers: ['data://v'] },
    props: { render: 'track', timeField: 'when', trackIdField: 'name', latField: 'y', lngField: 'x' }
  }
  const { container } = render(
    <HandlerProvider actions={actions}><EsriMapMolecule node={node} renderChild={() => null} /></HandlerProvider>
  )
  const mapEl = container.querySelector('arcgis-map') as any
  mapEl.view = fakeView
  mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
  await waitFor(() => expect(fetchData).toHaveBeenCalled())
  await waitFor(() => expect(container.textContent).toMatch(/temporal when/i))
  expect(container.textContent).toMatch(/track name/i)
})
