# Geospatial C2 Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gaia-style geospatial C2 depth to the ESRI map — a sketch-driven geofence/radius/polygon spatial filter (via linked selection), an `esri:layer-list` molecule, a basemap toggle, and a heatmap renderer.

**Architecture:** Mixed attach model. `esri:layer-list` is a new molecule referencing the map by `bindings.mapRef` (like `esri:legend`). Sketch + basemap toggle + heatmap are props/behaviors on `esri:map` (they operate on its own view/layer). Drawing a geofence writes the contained features into the existing `SelectionContext` (client-side, over the loaded rows of the map's `data://` source), reusing the map-click selection path. The containment math is a pure, ESRI-free module; ESRI wiring is mocked in tests and confirmed at live-verify.

**Tech Stack:** React 19, Tailwind v4, Vite 8, Vitest/jsdom (frontend); `@arcgis/core` + `@arcgis/map-components` 4.34 (Calcite web components); Python + jsonschema + pytest (plugin backend).

**Spec:** `apps/gis-canvas/docs/2026-07-21-geospatial-c2-depth-design.md`

## Global Constraints

- **Branch:** all work on `gis/geospatial-c2-depth` (already created). Do not commit to `gis/main`.
- **Reuse existing patterns:** `EsriFrame` for chrome, the `loadEsri()` bag for ESRI modules, `SelectionContext`/`useLinkedSelection` for selection, `detectGeoFields` (`lib/esri/graphics.ts`) for lng/lat detection.
- **ESRI can't run in jsdom** — mock `loadEsri`/`layers` (as the existing `EsriMapMolecule.test`/`EsriWidgets.test` do), extract pure logic, and test wiring via simulated events. Exact ESRI event names and sketch tool attributes are confirmed at **live-verify**, not in jsdom.
- **Spatial-reference gotcha:** the rows-layer is WGS84 (wkid 4326); the view/sketch draw in Web Mercator (3857). ALWAYS project the drawn geometry with `webMercatorUtils.webMercatorToGeographic` before `geometryEngine.contains`, else every geofence returns zero matches.
- **Scope:** spatial filter operates on the map's `data://` source's loaded rows (≤5000), the same source used for map-click linked selection. No server-side spatial query; no time-slider.
- **5-place type sync** for the new `esri:layer-list` molecule: `schema/canvas.schema.json`, `src/lib/types.ts`, `plugins/gis-canvas/validator.py` (`CATALOG` + `STATE_KEYS`), `src/components/registry.tsx`, `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`). See `apps/gis-canvas/docs/registry-extension.md`.
- **Test commands:** FE `npm run --workspace @hermes/gis-canvas test`, typecheck `npm run --workspace @hermes/gis-canvas typecheck`, build `npm run --workspace @hermes/gis-canvas build`; backend `python -m pytest tests/plugins/gis_canvas -q` (use `py -m pytest` if `python` is missing). Run all `git`/`npm`/`python` from repo root `c:\workspace\analyst\hermes-agent`.

---

### Task 1: Pure spatial-containment core

**Files:**
- Create: `apps/gis-canvas/src/lib/esri/spatial.ts`
- Test: `apps/gis-canvas/src/lib/esri/spatial.test.ts`

**Interfaces:**
- Produces: `containedKeys(rows, idField, lngField, latField, contains): string[]` — consumed by `EsriMapMolecule` (Task 4). `contains: (lng: number, lat: number) => boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/esri/spatial.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { containedKeys } from './spatial'

const rows = [
  { id: 'a', lng: -70.1, lat: 41.3 },
  { id: 'b', lng: -70.2, lat: 41.4 },
  { id: 'c', lng: 10, lat: 50 }
]

describe('containedKeys', () => {
  it('returns the id-field keys of rows whose lng/lat satisfy the predicate', () => {
    const keys = containedKeys(rows, 'id', 'lng', 'lat', (lng) => lng < 0) // the two western points
    expect(keys).toEqual(['a', 'b'])
  })

  it('skips rows with non-finite coordinates', () => {
    const bad = [{ id: 'x', lng: 'nope', lat: 41 }, { id: 'y', lng: -70, lat: 41 }]
    expect(containedKeys(bad, 'id', 'lng', 'lat', () => true)).toEqual(['y'])
  })

  it('returns [] when nothing matches', () => {
    expect(containedKeys(rows, 'id', 'lng', 'lat', () => false)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/spatial.test.ts`
Expected: FAIL — `containedKeys` not found.

- [ ] **Step 3: Implement `spatial.ts`**

Create `apps/gis-canvas/src/lib/esri/spatial.ts`:
```ts
/**
 * Pure containment: the id-field keys of rows whose (lng,lat) satisfy `contains`.
 * ESRI-free — the caller supplies the geometry predicate (see EsriMapMolecule,
 * which builds it from geometryEngine.contains over a projected geometry).
 */
export function containedKeys(
  rows: Array<Record<string, unknown>>,
  idField: string,
  lngField: string,
  latField: string,
  contains: (lng: number, lat: number) => boolean
): string[] {
  const keys: string[] = []
  for (const row of rows) {
    const lng = Number(row[lngField])
    const lat = Number(row[latField])
    if (Number.isFinite(lng) && Number.isFinite(lat) && contains(lng, lat)) {
      keys.push(String(row[idField]))
    }
  }
  return keys
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/spatial.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/spatial.ts apps/gis-canvas/src/lib/esri/spatial.test.ts
git commit -m "feat(gis-canvas): pure containedKeys spatial-containment helper"
```

---

### Task 2: Loader additions + heatmap renderer

**Files:**
- Modify: `apps/gis-canvas/src/lib/esri/loader.ts`
- Modify: `apps/gis-canvas/src/lib/esri/layers.ts`
- Test: `apps/gis-canvas/src/lib/esri/layers.test.ts` (append)

**Interfaces:**
- Produces: extended `EsriBag` with `HeatmapRenderer`, `Point`, `geometryEngine`, `webMercatorUtils` — consumed by `EsriMapMolecule` (Task 4).
- Produces: `buildRowsLayer(source, esri, title?, render?)` and `buildLayer(ref, esri, render?)` with `render: 'points' | 'heatmap'` (default `'points'`) — consumed by `EsriMapMolecule` (Task 4).

- [ ] **Step 1: Write the failing test (heatmap renderer)**

Append to `apps/gis-canvas/src/lib/esri/layers.test.ts`:
```ts
test('buildRowsLayer uses a HeatmapRenderer when render=heatmap', () => {
  const calls: any[] = []
  class FeatureLayer { constructor(o: any) { calls.push(o) } }
  class HeatmapRenderer { type = 'heatmap'; constructor(_o: any) {} }
  const esri = { FeatureLayer, HeatmapRenderer }
  buildRowsLayer(
    { schema: [{ name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }], rows: [{ lng: -70, lat: 41 }] },
    esri as any,
    'incidents',
    'heatmap'
  )
  expect(calls[0].renderer).toBeInstanceOf(HeatmapRenderer)
})

test('buildRowsLayer keeps the simple marker renderer by default', () => {
  const calls: any[] = []
  const esri = { FeatureLayer: class { constructor(o: any) { calls.push(o) } } }
  buildRowsLayer(
    { schema: [{ name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }], rows: [{ lng: -70, lat: 41 }] },
    esri as any,
    'incidents'
  )
  expect(calls[0].renderer.type).toBe('simple')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/layers.test.ts`
Expected: FAIL — `render` arg not honored; renderer is always the simple marker.

- [ ] **Step 3: Add the `render` arg + HeatmapRenderer to `layers.ts`**

In `apps/gis-canvas/src/lib/esri/layers.ts`, replace the `buildRowsLayer` function with:
```ts
export function buildRowsLayer(
  source: MockSource,
  esri: { FeatureLayer: new (o: unknown) => unknown; HeatmapRenderer?: new (o: unknown) => unknown },
  title?: string,
  render: 'points' | 'heatmap' = 'points'
): unknown {
  const renderer =
    render === 'heatmap' && esri.HeatmapRenderer
      ? new esri.HeatmapRenderer({
          radius: 18,
          colorStops: [
            { ratio: 0, color: 'rgba(13,140,130,0)' },
            { ratio: 0.4, color: 'rgba(13,140,130,0.55)' },
            { ratio: 1, color: 'rgba(224,104,91,0.9)' }
          ]
        })
      : {
          type: 'simple',
          symbol: { type: 'simple-marker', color: '#e0685b', size: 8, outline: { color: '#fff', width: 1 } }
        }
  return new esri.FeatureLayer({
    source: graphicsFromMockSource(source),
    fields: fieldsFromSchema(source.schema),
    objectIdField: '__oid',
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer,
    popupTemplate: { title: 'Feature {__oid}', content: 'Row {__oid}' },
    title: title ?? 'layer'
  })
}
```
Then update `buildLayer` to forward `render` for rows sources — replace it with:
```ts
export function buildLayer(
  ref: string,
  esri: { FeatureLayer: new (o: unknown) => unknown; HeatmapRenderer?: new (o: unknown) => unknown },
  render: 'points' | 'heatmap' = 'points'
): unknown {
  const parsed = parseLayerRef(ref)
  if (parsed.kind === 'service') {
    return new esri.FeatureLayer({ url: parsed.url })
  }
  if (parsed.kind === 'handle') {
    throw new Error(`data:// layer must be fetched before building: ${ref}`)
  }
  const source = resolveMockSource(ref)
  if (!source) throw new Error(`unknown mock source: ${ref}`)
  return buildRowsLayer(source, esri, parsed.name, render)
}
```

- [ ] **Step 4: Run to verify the layers tests pass**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/layers.test.ts`
Expected: PASS (all, including the two new heatmap tests).

- [ ] **Step 5: Extend the loader bag**

In `apps/gis-canvas/src/lib/esri/loader.ts`, replace the `EsriBag` interface with:
```ts
export interface EsriBag {
  esriConfig: { apiKey?: string; assetsPath?: string }
  FeatureLayer: new (o: unknown) => unknown
  reactiveUtils: { on: (getter: () => unknown, event: string, cb: (e: unknown) => void) => { remove(): void } }
  HeatmapRenderer: new (o: unknown) => unknown
  Point: new (o: unknown) => unknown
  geometryEngine: { contains(container: unknown, inside: unknown): boolean }
  webMercatorUtils: { webMercatorToGeographic(geometry: unknown): unknown }
}
```
Then in `loadEsri()`, add the three web-component imports after the existing legend import, and extend the `Promise.all`:
```ts
    await import('@arcgis/map-components/components/arcgis-map')
    await import('@arcgis/map-components/components/arcgis-legend')
    await import('@arcgis/map-components/components/arcgis-layer-list')
    await import('@arcgis/map-components/components/arcgis-sketch')
    await import('@arcgis/map-components/components/arcgis-basemap-toggle')
    const [
      { default: esriConfig },
      { default: FeatureLayer },
      reactiveUtils,
      { default: HeatmapRenderer },
      { default: Point },
      geometryEngine,
      webMercatorUtils
    ] = await Promise.all([
      import('@arcgis/core/config.js'),
      import('@arcgis/core/layers/FeatureLayer.js'),
      import('@arcgis/core/core/reactiveUtils.js'),
      import('@arcgis/core/renderers/HeatmapRenderer.js'),
      import('@arcgis/core/geometry/Point.js'),
      import('@arcgis/core/geometry/geometryEngine.js'),
      import('@arcgis/core/geometry/support/webMercatorUtils.js')
    ])
```
and update the return line:
```ts
    return { esriConfig, FeatureLayer, reactiveUtils, HeatmapRenderer, Point, geometryEngine, webMercatorUtils } as unknown as EsriBag
```

- [ ] **Step 6: Typecheck + run the esri lib tests**

Run: `npm run --workspace @hermes/gis-canvas typecheck`
Then: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/`
Expected: no type errors; all esri lib tests pass. (The loader's dynamic imports aren't executed under jsdom — they're covered at build/live-verify.)

- [ ] **Step 7: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/loader.ts apps/gis-canvas/src/lib/esri/layers.ts apps/gis-canvas/src/lib/esri/layers.test.ts
git commit -m "feat(gis-canvas): load geometryEngine/webMercatorUtils/Point/HeatmapRenderer + sketch/layer-list/basemap-toggle; heatmap renderer"
```

---

### Task 3: `esri:layer-list` molecule + registry + types

**Files:**
- Create: `apps/gis-canvas/src/components/molecules/EsriLayerListMolecule.tsx`
- Modify: `apps/gis-canvas/src/components/registry.tsx`
- Modify: `apps/gis-canvas/src/lib/types.ts:5`
- Modify: `apps/gis-canvas/src/lib/types.test.ts`
- Test: `apps/gis-canvas/src/components/molecules/EsriLayerListMolecule.test.tsx`

**Interfaces:**
- Consumes: `EsriFrame` (`./EsriFrame`), `MoleculeProps` (`../registry`).
- Produces: `EsriLayerListMolecule` registered in `COMPONENT_REGISTRY` under `'esri:layer-list'`; renders `<arcgis-layer-list reference-element="#esri-map-<mapRef>">`.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/components/molecules/EsriLayerListMolecule.test.tsx`:
```tsx
import { render } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
vi.mock('../../lib/esri/loader', () => ({ loadEsri: async () => ({}) }))
import { EsriLayerListMolecule } from './EsriLayerListMolecule'
import { COMPONENT_REGISTRY } from '../registry'
import type { ComponentNode } from '../../lib/types'

test('layer-list points its reference-element at the mapRef map', () => {
  const node: ComponentNode = { id: 'll1', type: 'esri:layer-list', bindings: { mapRef: 'map1' } }
  const { container } = render(<EsriLayerListMolecule node={node} renderChild={() => null} />)
  expect(container.querySelector('arcgis-layer-list')?.getAttribute('reference-element')).toBe('#esri-map-map1')
})

test('esri:layer-list is registered', () => {
  expect(COMPONENT_REGISTRY['esri:layer-list']).toBeTruthy()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriLayerListMolecule.test.tsx`
Expected: FAIL — module not found / registry key undefined.

- [ ] **Step 3: Write the molecule**

Create `apps/gis-canvas/src/components/molecules/EsriLayerListMolecule.tsx`:
```tsx
import { EsriFrame } from './EsriFrame'
import type { MoleculeProps } from '../registry'

export function EsriLayerListMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  return (
    <EsriFrame title="Layers">
      {/* @ts-expect-error custom element */}
      <arcgis-layer-list {...(ref ? { 'reference-element': ref } : {})} style={{ display: 'block', width: '100%', height: '100%' }} />
    </EsriFrame>
  )
}
```

- [ ] **Step 4: Register it (lazy, like the other ESRI molecules)**

In `apps/gis-canvas/src/components/registry.tsx`, add a lazy wrapper next to the existing `EsriLegend` one:
```tsx
const EsriLayerListLazy = lazy(() => import('./molecules/EsriLayerListMolecule').then(m => ({ default: m.EsriLayerListMolecule })))
function EsriLayerList(props: MoleculeProps) {
  return (
    <Suspense fallback={<div className="p-2 text-xs text-neutral-400">Loading layers…</div>}>
      <EsriLayerListLazy {...props} />
    </Suspense>
  )
}
```
and add to `COMPONENT_REGISTRY` (after the `'esri:legend'` entry):
```tsx
  'esri:layer-list': EsriLayerList,
```

- [ ] **Step 5: Add to the TS molecule type list + its pinned test**

In `apps/gis-canvas/src/lib/types.ts:5`, add `'esri:layer-list'` to `MOLECULE_TYPES`:
```ts
export const MOLECULE_TYPES = ['card', 'stat', 'data-table', 'select', 'tabs', 'esri:map', 'esri:legend', 'esri:layer-list', 'esri:feature-table'] as const
```
Then update the pinned assertion in `apps/gis-canvas/src/lib/types.test.ts` to include `'esri:layer-list'` in the same position (search for the `MOLECULE_TYPES` literal array in that file and add `'esri:layer-list'` after `'esri:legend'`).

- [ ] **Step 6: Run to verify it passes + full FE suite**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriLayerListMolecule.test.tsx`
Expected: PASS (2 tests).
Then: `npm run --workspace @hermes/gis-canvas test` and `npm run --workspace @hermes/gis-canvas typecheck`
Expected: full suite green (including the updated `types.test.ts`); no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/EsriLayerListMolecule.tsx apps/gis-canvas/src/components/molecules/EsriLayerListMolecule.test.tsx apps/gis-canvas/src/components/registry.tsx apps/gis-canvas/src/lib/types.ts apps/gis-canvas/src/lib/types.test.ts
git commit -m "feat(gis-canvas): esri:layer-list molecule (referenced map layer control)"
```

---

### Task 4: `esri:map` spatial filter + basemap toggle + heatmap wiring

**Files:**
- Modify: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`
- Modify: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`

**Interfaces:**
- Consumes: `containedKeys` (`../../lib/esri/spatial`, Task 1); the extended `EsriBag` (`geometryEngine`, `webMercatorUtils`, `Point`) + `buildRowsLayer`/`buildLayer` `render` arg (Task 2); `detectGeoFields` (`../../lib/esri/graphics`); existing `useLinkedSelection`, `useCanvasActions`, `resolveIdField`.
- Produces: `esri:map` honoring `props.render`, `props.spatialFilter`, `props.basemapToggle` (+ `props.basemapAlt`). Drawing a geofence writes contained keys into the shared selection for the map's `data://` source.

- [ ] **Step 1: Write the failing tests**

Add to `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`. First, extend the existing `loadEsri` mock at the top of the file (replace the current `vi.mock('../../lib/esri/loader', …)` line) so the ESRI bag carries the geometry helpers:
```ts
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
```
Then append these tests:
```tsx
import { SelectionProvider } from '../SelectionContext'

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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriMapMolecule.test.tsx`
Expected: FAIL — no `arcgis-sketch`/`arcgis-basemap-toggle` rendered; no geofence selection.

- [ ] **Step 3: Add the props + a data ref + child widgets + the sketch effect**

Edit `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`:

(a) Update imports at the top — add:
```ts
import { detectGeoFields } from '../../lib/esri/graphics'
import { containedKeys } from '../../lib/esri/spatial'
```

(b) Widen the props read (replace the `props`/`basemap` lines):
```ts
  const props = (node.props ?? {}) as {
    basemap?: string; center?: [number, number]; zoom?: number
    render?: 'points' | 'heatmap'; spatialFilter?: boolean; basemapToggle?: boolean; basemapAlt?: string
  }
  const basemap = props.basemap ?? 'osm'
  const render = props.render === 'heatmap' ? 'heatmap' : 'points'
```

(c) Add a sketch element ref + a data ref next to the existing refs (after `const mapCtx = useRef(...)`):
```ts
  const sketchRef = useRef<HTMLElement | null>(null)
  // Rows for the spatial filter, populated even without a live view (jsdom-testable),
  // unlike mapCtx which needs the real view for highlight/goTo.
  const dataRef = useRef<{ rows: Record<string, unknown>[]; idField: string; lngField: string; latField: string } | null>(null)
```

(d) Thread `render` into layer building. In `onReady`, change the two build calls:
- `buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, layerTitle)` → add `, render` as the 4th arg.
- `layer = buildLayer(r, esri)` → `layer = buildLayer(r, esri, render)`.

(e) In `onReady`, populate `dataRef` for the data source — inside the `if (isDataHandle(r))` branch, right after `const page = await actions.fetchData(...)` and the `layerTitle` line, add (ungated on `view`, unlike the `mapCtx` block):
```ts
            if (r === source) {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const { latField, lngField } = detectGeoFields(page.schema as never)
              dataRef.current = { rows, idField, lngField: lngField ?? 'lng', latField: latField ?? 'lat' }
            }
```
(Leave the existing `if (view && r === source) { … mapCtx.current = … }` block as-is — it additionally sets the view/layer/keyByOid used for highlight when a real view exists.)

(f) Add the sketch-create effect after the existing selection-reaction effect:
```ts
  // Draw a geofence/radius/polygon → select the contained rows (client-side, over the
  // loaded data source rows). Reuses the shared selection, so a linked table highlights too.
  useEffect(() => {
    const el = sketchRef.current
    if (!ready || !props.spatialFilter || !el) return
    const onCreate = async (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { state?: string; graphic?: { geometry?: unknown } } | undefined
      const data = dataRef.current
      if (detail?.state !== 'complete' || !detail.graphic?.geometry || !data) return
      const esri = await loadEsri()
      // SR gotcha: the view/sketch draw in Web Mercator; project to geographic (4326)
      // to match the rows-layer points, else contains() matches nothing.
      const geo = esri.webMercatorUtils.webMercatorToGeographic(detail.graphic.geometry)
      const predicate = (lng: number, lat: number) =>
        esri.geometryEngine.contains(geo, new esri.Point({ x: lng, y: lat, spatialReference: { wkid: 4326 } }))
      const keys = containedKeys(data.rows, data.idField, data.lngField, data.latField, predicate)
      setSelectedRef.current(keys)
    }
    el.addEventListener('arcgisCreate', onCreate)
    return () => el.removeEventListener('arcgisCreate', onCreate)
  }, [ready, props.spatialFilter])
```

(g) Render the child widgets inside `<arcgis-map>`. Change the self-closing `<arcgis-map … />` to have children:
```tsx
      {/* @ts-expect-error — arcgis-map is a custom element (typed loosely for React) */}
      <arcgis-map
        ref={ref}
        id={`esri-map-${node.id}`}
        basemap={basemap}
        {...(center ? { center } : {})}
        {...(props.zoom != null ? { zoom: String(props.zoom) } : {})}
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        {props.spatialFilter ? (
          /* @ts-expect-error custom element */
          <arcgis-sketch ref={sketchRef} slot="top-right" creation-mode="single" />
        ) : null}
        {props.basemapToggle ? (
          /* @ts-expect-error custom element */
          <arcgis-basemap-toggle slot="bottom-right" next-basemap={props.basemapAlt ?? 'satellite'} />
        ) : null}
      </arcgis-map>
```

- [ ] **Step 4: Run to verify the map tests pass**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriMapMolecule.test.tsx`
Expected: PASS (all, including the two new tests).

- [ ] **Step 5: Verify the real sketch event name against the installed component**

The test simulates `arcgisCreate`; confirm that is the real event the installed component emits (jsdom can't). Run:
```bash
grep -rio "arcgisCreate\|onArcgisCreate\|arcgis-create" node_modules/@arcgis/map-components/dist/components/arcgis-sketch* 2>/dev/null | head
```
Expected: matches confirming the `arcgisCreate` event exists. If the installed 4.34 build uses a different event name (e.g. a differently-cased one), update BOTH the `addEventListener` in the molecule and the `dispatchEvent` in the test to match, then re-run Step 4. Record what you found in the task report.

- [ ] **Step 6: Full FE suite + typecheck**

Run: `npm run --workspace @hermes/gis-canvas test`
Then: `npm run --workspace @hermes/gis-canvas typecheck`
Expected: all green; no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx
git commit -m "feat(gis-canvas): esri:map sketch spatial-filter + basemap toggle + heatmap render"
```

---

### Task 5: Backend wiring (`esri:layer-list`) + agent catalog + full verification

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json:44`
- Modify: `plugins/gis-canvas/validator.py` (`CATALOG`, `STATE_KEYS`)
- Modify: `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`)
- Test: `tests/plugins/gis_canvas/test_validator.py` (append)

**Interfaces:**
- Consumes: `plugin.validator.validate_doc(doc) -> list[str]` (existing fixture/pattern).
- Produces: `esri:layer-list` accepted by schema + validator; agent catalog documents `esri:layer-list` + the new `esri:map` props with a worked example.

- [ ] **Step 1: Write the failing validator test**

Append to `tests/plugins/gis_canvas/test_validator.py`:
```python
def test_esri_layer_list_valid_doc_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append(
        {
            "id": "ll1",
            "type": "esri:layer-list",
            "area": {"col": 10, "colSpan": 3, "row": 1, "rowSpan": 3},
            "bindings": {"mapRef": "map1"},
        }
    )
    assert plugin.validator.validate_doc(doc) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k esri_layer_list`
Expected: FAIL — `esri:layer-list` not in the schema enum.

- [ ] **Step 3: Add `esri:layer-list` to the schema enum**

In `plugins/gis-canvas/schema/canvas.schema.json:44`, extend the `type` enum:
```json
        "type": { "enum": ["card", "stat", "data-table", "select", "tabs", "esri:map", "esri:legend", "esri:layer-list", "esri:feature-table"] },
```

- [ ] **Step 4: Add the `CATALOG` + `STATE_KEYS` entries**

In `plugins/gis-canvas/validator.py`, add to `CATALOG` (after the `esri:legend` entry):
```python
    "esri:layer-list": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": [],
    },
```
And add to `STATE_KEYS` (after the `esri:legend` entry):
```python
    "esri:layer-list": set(),
```

- [ ] **Step 5: Run to verify the validator test passes**

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q`
Expected: PASS (all, including the new test).

- [ ] **Step 6: Document the new capabilities + a worked example in `_CATALOG_HELP`**

In `plugins/gis-canvas/tools_canvas.py`, in the `_CATALOG_HELP` string, find the `esri:legend` sentence (it contains `"esri:legend (bindings.mapRef = the "`). Immediately after the `esri:feature-table` sentence that ends `"…for a spatial table of a layer."`, insert:
```python
    " esri:layer-list (bindings.mapRef = an esri:map id) shows that map's layers with "
    "visibility toggles; dock it like the legend. esri:map ALSO accepts props.spatialFilter:true "
    "(adds draw tools — draw a geofence/rectangle/circle/polygon to SELECT the features inside, "
    "highlighting them on the map and in any linked data-table), props.basemapToggle:true "
    "(+ optional props.basemapAlt, default 'satellite') for an in-map basemap switch, and "
    "props.render:'heatmap' to draw the primary data layer as a density surface instead of points."
```
Then, in the `RENDER_VIEW_SCHEMA` `description`, right after the existing GIS example line (it ends with `"bindings:{mapRef:'map1'}}."`), insert a worked C2 example:
```python
        " Geospatial C2 example (draw-to-select + layer control): {id:'map1', type:'esri:map', "
        "layer:'base', props:{title:'AIS positions', basemap:'osm', spatialFilter:true, "
        "basemapToggle:true}, bindings:{layers:['data://<handle>']}} with {id:'ll1', "
        "type:'esri:layer-list', layer:'dock', edge:'right', bindings:{mapRef:'map1'}}, a legend "
        "dock, and a data-table dock over the same handle — drawing a geofence selects the "
        "contained rows in BOTH the map and the table."
```

- [ ] **Step 7: Full cross-stack verification**

Run each and confirm green:
```bash
python -m pytest tests/plugins/gis_canvas -q
npm run --workspace @hermes/gis-canvas test
npm run --workspace @hermes/gis-canvas typecheck
npm run --workspace @hermes/gis-canvas build
```
Expected: backend all pass; FE all pass; no type errors; production build succeeds.

- [ ] **Step 8: Commit**

```bash
git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_validator.py
git commit -m "feat(gis-canvas): wire esri:layer-list + document spatialFilter/basemapToggle/heatmap (worked example)"
```

---

## Manual live-verify (after implementation, gateway restarted on this branch)

Automated tests mock ESRI; confirm the real behavior in the app:
- Author a map with `spatialFilter:true`, `basemapToggle:true`, an `esri:layer-list` dock, and a linked `data-table` dock. Draw a rectangle/polygon → the enclosed points highlight on the map AND the same rows highlight in the table; clearing the fence clears the selection. (This is the one place the SR-projection + `arcgisCreate` event wiring is truly exercised.)
- Toggle the basemap; switch `render:'heatmap'` and confirm a density surface; open the layer-list and toggle a layer.

---

## Self-Review

**Spec coverage:**
- Spatial filter (sketch → projected geometry → `containedKeys` → linked selection): Task 1 (pure core) + Task 4 (wiring, SR projection, dataRef).
- `esri:layer-list` molecule + 5-place sync: Task 3 (FE) + Task 5 (backend/schema/validator/catalog).
- Basemap toggle + heatmap: Task 2 (heatmap renderer) + Task 4 (basemap-toggle child, render threading).
- Loader additions (geometryEngine/webMercatorUtils/Point/HeatmapRenderer + 3 web components): Task 2.
- Agent guidance + worked example (the tabs lesson): Task 5 Step 6.
- SR-projection gotcha: Global Constraints + Task 4 Step 3(f) + live-verify.
- Non-goals (time-slider, server-side spatial query) excluded.

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `containedKeys(rows, idField, lngField, latField, contains)` identical in Task 1, its test, and Task 4's call; `buildRowsLayer(source, esri, title?, render?)` and `buildLayer(ref, esri, render?)` consistent across Task 2 and Task 4; `EsriBag` fields (`geometryEngine.contains`, `webMercatorUtils.webMercatorToGeographic`, `Point`, `HeatmapRenderer`) defined in Task 2 and used identically in Task 4's mock + molecule; `'esri:layer-list'` used identically across schema enum, `MOLECULE_TYPES`, registry, `CATALOG`/`STATE_KEYS`, and `_CATALOG_HELP`.
