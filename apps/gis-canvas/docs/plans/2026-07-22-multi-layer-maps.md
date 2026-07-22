# Multi-Layer Maps (SP3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an `esri:map` render multiple layers correctly — rebuild layers when the set changes (root-cause fix for stale layers), give each layer a title + distinct color, and select across all layers with the geofence/click.

**Architecture:** Handles stay in `bindings.layers`; `props.layers: [{title, color?}]` (positional) supplies per-layer metadata, colors auto-assigned when omitted. The map molecule's one-shot `[node.id]` build effect is split into a view-ready effect + a `[ready, layersSig]`-keyed rebuild effect that clears old layers before adding new. Selection is refactored from a single source to one `SelectionContext` source per `data://` layer, unioned by the geofence and map-click.

**Tech Stack:** React 19, Vite 8, Vitest/jsdom (frontend); `@arcgis/core` + `@arcgis/map-components` 4.34; Python + pytest (plugin catalog).

**Spec:** `apps/gis-canvas/docs/2026-07-22-multi-layer-maps-design.md`

## Global Constraints

- **Branch:** all work on `gis/multi-layer-maps` (already created). Do not commit to `gis/main`.
- **Handles stay in `bindings.layers`** — the data plane requires it (`validator.py` `required_bindings: ["layers"]`); per-layer metadata goes in `props.layers`. No schema/validator change.
- **ESRI can't run in jsdom** — mock `loadEsri`/`layers`, use a fake `el.view`/`el.layer` where needed, extract pure logic. Full multi-layer highlight is confirmed at live-verify.
- **`resolveLayerColor` must never return empty** — fall back to a fixed hex palette when `getComputedStyle` yields nothing (jsdom / uncomputed styles), so ESRI always gets a concrete color.
- **1-layer behavior must equal today** — the union of one layer == the current single-source behavior.
- **Test commands:** FE `npm run --workspace @hermes/gis-canvas test`, typecheck `... typecheck`, build `... build`; backend `python -m pytest tests/plugins/gis_canvas -q` (`py -m pytest` if `python` missing). Run all commands from repo root `c:\workspace\analyst\hermes-agent`.

---

### Task 1: `resolveLayerColor` (distinct per-layer color)

**Files:**
- Create: `apps/gis-canvas/src/lib/esri/layer-color.ts`
- Test: `apps/gis-canvas/src/lib/esri/layer-color.test.ts`

**Interfaces:**
- Produces: `resolveLayerColor(index: number): string` — a concrete CSS color string (never empty). Consumed by `EsriMapMolecule` (Task 4).

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/esri/layer-color.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveLayerColor } from './layer-color'

describe('resolveLayerColor', () => {
  it('returns a non-empty color for any index (jsdom fallback palette)', () => {
    for (let i = 0; i < 8; i++) expect(resolveLayerColor(i)).toMatch(/\S/)
  })
  it('gives the first six indices distinct colors', () => {
    const colors = [0, 1, 2, 3, 4, 5].map(resolveLayerColor)
    expect(new Set(colors).size).toBe(6)
  })
  it('wraps every 6 (index 6 reuses index 0)', () => {
    expect(resolveLayerColor(6)).toBe(resolveLayerColor(0))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/layer-color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `layer-color.ts`**

Create `apps/gis-canvas/src/lib/esri/layer-color.ts`:
```ts
// Distinct color per layer index for multi-layer maps. Prefers the themed
// --color-cat-1..6 tokens (so map colors match the app palette); falls back to a
// fixed hex palette when getComputedStyle can't resolve them (jsdom, or an
// uncomputed style), so ESRI always receives a concrete color.
const FALLBACK = ['#3b6fe0', '#c2831a', '#c22e4c', '#6b4fcb', '#1f9e7a', '#b5490f']

export function resolveLayerColor(index: number): string {
  const slot = ((index % 6) + 6) % 6 // 0..5, safe for negatives
  const fallback = FALLBACK[slot]
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const token = getComputedStyle(document.documentElement).getPropertyValue(`--color-cat-${slot + 1}`).trim()
  return token || fallback
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/layer-color.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/layer-color.ts apps/gis-canvas/src/lib/esri/layer-color.test.ts
git commit -m "feat(gis-canvas): resolveLayerColor — distinct per-layer color with jsdom fallback"
```

---

### Task 2: per-layer `color` on the layer builders

**Files:**
- Modify: `apps/gis-canvas/src/lib/esri/layers.ts`
- Test: `apps/gis-canvas/src/lib/esri/layers.test.ts` (append)

**Interfaces:**
- Produces: `buildRowsLayer(source, esri, title?, render?, color?)` and `buildLayer(ref, esri, render?, color?)` — the `color` sets the simple-marker fill. Consumed by `EsriMapMolecule` (Task 4).

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/lib/esri/layers.test.ts`:
```ts
test('buildRowsLayer applies a per-layer color to the marker symbol', () => {
  const calls: any[] = []
  const esri = { FeatureLayer: class { constructor(o: any) { calls.push(o) } } }
  buildRowsLayer(
    { schema: [{ name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }], rows: [{ lng: -70, lat: 41 }] },
    esri as any, 'layer-a', 'points', '#123456'
  )
  expect(calls[0].renderer.symbol.color).toBe('#123456')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/layers.test.ts`
Expected: FAIL — the color arg is ignored; symbol color is the default `#e0685b`.

- [ ] **Step 3: Thread `color` through both builders**

In `apps/gis-canvas/src/lib/esri/layers.ts`, replace the `buildRowsLayer` signature line and its default-renderer branch. Change the signature to:
```ts
export function buildRowsLayer(
  source: MockSource,
  esri: { FeatureLayer: new (o: unknown) => unknown; HeatmapRenderer?: new (o: unknown) => unknown },
  title?: string,
  render: 'points' | 'heatmap' = 'points',
  color = '#e0685b'
): unknown {
```
and in the same function change the non-heatmap renderer branch (the `: { type: 'simple', symbol: {...} }` fallback) so the marker uses `color`:
```ts
      : {
          type: 'simple',
          symbol: { type: 'simple-marker', color, size: 8, outline: { color: '#fff', width: 1 } }
        }
```
Then change `buildLayer` to accept + forward `color`:
```ts
export function buildLayer(
  ref: string,
  esri: { FeatureLayer: new (o: unknown) => unknown; HeatmapRenderer?: new (o: unknown) => unknown },
  render: 'points' | 'heatmap' = 'points',
  color = '#e0685b'
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
  return buildRowsLayer(source, esri, parsed.name, render, color)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run --workspace @hermes/gis-canvas test -- src/lib/esri/layers.test.ts`
Expected: PASS (all, including the new color test).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/layers.ts apps/gis-canvas/src/lib/esri/layers.test.ts
git commit -m "feat(gis-canvas): per-layer color on buildRowsLayer/buildLayer"
```

---

### Task 3: `SelectionContext` multi-source hooks

**Files:**
- Modify: `apps/gis-canvas/src/components/SelectionContext.tsx`
- Test: `apps/gis-canvas/src/components/SelectionContext.test.tsx` (append)

**Interfaces:**
- Produces: `useSelectionActions(): { get(source): string[]; set(source, ids): void }` and `useSelectionState(): Record<string, string[]>`. Consumed by `EsriMapMolecule` (Task 5).

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/components/SelectionContext.test.tsx`:
```tsx
import { SelectionProvider, useSelectionActions, useSelectionState } from './SelectionContext'
import { render, screen, fireEvent } from '@testing-library/react'

function MultiProbe() {
  const actions = useSelectionActions()
  const state = useSelectionState()
  return (
    <div>
      <button onClick={() => { actions.set('data://a', ['1']); actions.set('data://b', ['2', '3']) }}>set-two</button>
      <span data-testid="sig">{Object.entries(state).map(([k, v]) => `${k}:${v.join(',')}`).join('|')}</span>
    </div>
  )
}

test('useSelectionActions writes multiple sources; useSelectionState reflects them', () => {
  render(
    <SelectionProvider nodesBySource={{}} onMirror={() => {}}>
      <MultiProbe />
    </SelectionProvider>
  )
  fireEvent.click(screen.getByText('set-two'))
  expect(screen.getByTestId('sig').textContent).toBe('data://a:1|data://b:2,3')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/SelectionContext.test.tsx`
Expected: FAIL — `useSelectionActions`/`useSelectionState` not exported.

- [ ] **Step 3: Add `state` to the context value + the two hooks**

In `apps/gis-canvas/src/components/SelectionContext.tsx`:

(a) extend the value interface and NOOP — replace:
```ts
interface SelectionContextValue {
  get: (source: string) => string[]
  set: (source: string, ids: string[]) => void
}
```
```ts
const NOOP: SelectionContextValue = { get: () => EMPTY, set: () => {} }
```
with:
```ts
interface SelectionContextValue {
  get: (source: string) => string[]
  set: (source: string, ids: string[]) => void
  state: Record<string, string[]>
}
```
```ts
const EMPTY_STATE: Record<string, string[]> = {}
const NOOP: SelectionContextValue = { get: () => EMPTY, set: () => {}, state: EMPTY_STATE }
```

(b) include `state` in the memoized value — replace `const value = useMemo(() => ({ get, set }), [get, set])` with:
```ts
  const value = useMemo(() => ({ get, set, state: selection }), [get, set, selection])
```

(c) append the two hooks at the end of the file:
```ts
/** Read/write selection for arbitrary sources (multi-layer maps). */
export function useSelectionActions(): Pick<SelectionContextValue, 'get' | 'set'> {
  const { get, set } = useContext(Ctx)
  return { get, set }
}

/** The full selection record; re-renders when any source's selection changes. */
export function useSelectionState(): Record<string, string[]> {
  return useContext(Ctx).state
}
```

- [ ] **Step 4: Run to verify it passes + full suite**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/SelectionContext.test.tsx`
Expected: PASS.
Then: `npm run --workspace @hermes/gis-canvas test` and `npm run --workspace @hermes/gis-canvas typecheck`
Expected: full suite green (existing `useLinkedSelection` tests unaffected); no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/SelectionContext.tsx apps/gis-canvas/src/components/SelectionContext.test.tsx
git commit -m "feat(gis-canvas): SelectionContext useSelectionActions/useSelectionState (multi-source)"
```

---

### Task 4: map — freshness rebuild + per-layer title/color

**Files:**
- Modify: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`
- Test: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx` (append)

**Interfaces:**
- Consumes: `resolveLayerColor` (Task 1); `buildRowsLayer(...,color?)`/`buildLayer(...,color?)` (Task 2).
- Produces: an `esri:map` that rebuilds its layers whenever `bindings.layers`/`props.layers`/`render` change, applying per-layer title + color. Single-source selection (first `data://` layer) is unchanged in this task.

Read the whole file first — this task rewrites the layer-build lifecycle.

- [ ] **Step 1: Write the failing tests**

Append to `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`:
```tsx
test('rebuilds layers when the layer set changes (removes old, adds new)', async () => {
  const added: any[] = []
  const removed: any[] = []
  const fakeView = {
    map: { add: (l: any) => added.push(l), removeMany: (ls: any[]) => removed.push(...ls) },
    popupEnabled: true
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
  const added: any[] = []
  const fakeView = { map: { add: (l: any) => added.push(l), removeMany: () => {} }, popupEnabled: true }
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
```
Then extend the file's existing `vi.mock('../../lib/esri/layers', …)` so `buildRowsLayer` records the color arg. Replace the current mock with:
```ts
const builtColors: string[] = []
vi.mock('../../lib/esri/layers', () => ({
  parseLayerRef: (r: string) => ({ kind: 'rows', name: r }),
  buildLayer: (r: string) => ({ r }),
  buildRowsLayer: (_s: any, _e: any, _t?: string, _r?: string, color = '#e0685b') => { builtColors.push(color); return { color } }
}))
```
(If the file already mocks `buildLayer` only, this widens it. Keep the other tests working — they don't assert on `buildRowsLayer`'s return beyond it being truthy.)

- [ ] **Step 2: Run to verify they fail**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriMapMolecule.test.tsx`
Expected: FAIL — no rebuild on change (removeMany never called; only the first layer builds), colors not applied.

- [ ] **Step 3: Split the build effect + add per-layer title/color**

In `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`:

(a) add imports:
```ts
import { resolveLayerColor } from '../../lib/esri/layer-color'
```

(b) add refs after the existing `dataRef` line:
```ts
  const addedLayersRef = useRef<unknown[]>([])
  const [buildTick, setBuildTick] = useState(0)
```

(c) compute a layer signature after `const render = …`:
```ts
  const layerMeta = (node.props?.layers as Array<{ title?: string; color?: string }> | undefined) ?? []
  const layersSig = JSON.stringify({ layers: layerRefs, meta: layerMeta, render })
```

(d) REPLACE the entire existing build effect (the `useEffect(() => { … }, [node.id])` block that attaches `arcgisViewReadyChange` and builds layers in `onReady`) with these TWO effects:
```ts
  // View-ready: flip `ready` once the arcgis-map view exists.
  useEffect(() => {
    const el = ref.current as HTMLElement | null
    if (!el) return
    void loadEsri()
    const onReady = () => setReady(true)
    el.addEventListener('arcgisViewReadyChange', onReady)
    return () => el.removeEventListener('arcgisViewReadyChange', onReady)
  }, [node.id])

  // Build (and rebuild) layers whenever the layer set changes. Clears the
  // previously-added layers first so a same-id rev change doesn't go stale/accumulate.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const el = ref.current as (HTMLElement & { view?: { map: { add(l: unknown): void; removeMany(ls: unknown[]): void }; popupEnabled?: boolean } }) | null
    const view = el?.view
    ;(async () => {
      const esri = await loadEsri()
      if (cancelled) return
      if (view && addedLayersRef.current.length) {
        view.map.removeMany(addedLayersRef.current)
        addedLayersRef.current = []
      }
      dataRef.current = null
      mapCtx.current = null
      for (let i = 0; i < layerRefs.length; i++) {
        const r = layerRefs[i]
        const meta = layerMeta[i] ?? {}
        const title = meta.title ?? (node.props?.title as string | undefined) ?? r
        const color = meta.color ?? resolveLayerColor(i)
        try {
          let layer: unknown
          if (isDataHandle(r)) {
            const page = await actions.fetchData(r, { pageSize: 5000 })
            if (cancelled) return
            if (r === source) {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const { latField, lngField } = detectGeoFields(page.schema as never)
              dataRef.current = { rows, idField, lngField: lngField ?? 'lng', latField: latField ?? 'lat' }
            }
            layer = buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, title, render, color)
            if (view && r === source) {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const keyByOid = new Map<number, string>()
              rows.forEach((row, idx) => keyByOid.set(idx + 1, String(row[idField])))
              mapCtx.current = { view, layer, idField, keyByOid }
            }
          } else {
            layer = buildLayer(r, esri, render, color)
          }
          if (view) { view.map.add(layer); addedLayersRef.current.push(layer) }
        } catch (e) { console.error('layer build failed', r, e) }
      }
      if (view) view.popupEnabled = false
      if (!cancelled) setBuildTick(t => t + 1)
    })().catch(() => {})
    return () => { cancelled = true }
  }, [ready, layersSig]) // eslint-disable-line react-hooks/exhaustive-deps
```

(e) re-attach the click + highlight effects after a rebuild: change the click effect's deps from `[ready]` to `[ready, buildTick]`, and the highlight effect's deps from `[selected, ready]` to `[selected, ready, buildTick]`.

- [ ] **Step 4: Run to verify the map tests pass**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriMapMolecule.test.tsx`
Expected: PASS (all, including rebuild + color; existing single-layer tests still green).

- [ ] **Step 5: Full FE suite + typecheck**

Run: `npm run --workspace @hermes/gis-canvas test`
Then: `npm run --workspace @hermes/gis-canvas typecheck`
Expected: green; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx
git commit -m "feat(gis-canvas): rebuild map layers on change + per-layer title/color"
```

---

### Task 5: map — union selection across all layers

**Files:**
- Modify: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`
- Test: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx` (append)

**Interfaces:**
- Consumes: `useSelectionActions`/`useSelectionState` (Task 3); the `layersRef`/build effect from Task 4.
- Produces: geofence + map-click select across every `data://` layer, each writing to its own selection source.

Read the whole file first.

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`:
```tsx
import { SelectionProvider, useSelectionState } from '../SelectionContext'

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
  const fakeView = { map: { add() {}, removeMany() {} }, popupEnabled: true }
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
```
Extend the file's `loadEsri` mock so `geometryEngine.contains` returns `p.x < 0` and `Point` stores `x` (as in the SP3 tests): ensure the mock returns `{ …, Point: class { constructor(o:any){ Object.assign(this,o) } }, geometryEngine: { contains: (_g:any,p:any)=> p.x < 0 }, webMercatorUtils: { webMercatorToGeographic: (g:any)=> g } }`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriMapMolecule.test.tsx`
Expected: FAIL — only `data://a` (the first layer) gets selected; `data://b` is empty.

- [ ] **Step 3: Refactor selection to all layers**

In `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`:

(a) swap imports — replace `import { useLinkedSelection } from '../SelectionContext'` with:
```ts
import { useSelectionActions, useSelectionState } from '../SelectionContext'
```

(b) replace the single-source selection refs (the `source`/`useLinkedSelection`/`selectedRef`/`setSelectedRef` block, lines ~30-36) with:
```ts
  const selActions = useSelectionActions()
  const selState = useSelectionState()
  const selActionsRef = useRef(selActions)
  useEffect(() => { selActionsRef.current = selActions }, [selActions])
  // The primary data layer still drives the map-click hitTest ctx (mapCtx).
  const source = layerRefs.find(isDataHandle) ?? ''
```

(c) add a `layersRef` alongside `dataRef` (keep `dataRef` for the primary; add the full list):
```ts
  const layersRef = useRef<Array<{ source: string; rows: Record<string, unknown>[]; idField: string; lngField: string; latField: string }>>([])
```
and in the build effect (Task 4), inside the `isDataHandle(r)` branch, after computing `dataRef` for the primary, push EVERY data layer's context. Right after the `layer = buildRowsLayer(...)` line, add:
```ts
            {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const { latField, lngField } = detectGeoFields(page.schema as never)
              layersRef.current.push({ source: r, rows, idField, lngField: lngField ?? 'lng', latField: latField ?? 'lat' })
            }
```
and reset it at the top of the build (where `dataRef.current = null`): add `layersRef.current = []`.

(d) replace the geofence `onCreate` selection write. Change the body that computes `keys` + `setSelectedRef.current(keys)` to union across all layers:
```ts
      const esri = await loadEsri()
      const geo = esri.webMercatorUtils.webMercatorToGeographic(graphic.geometry)
      const predicate = (lng: number, lat: number) =>
        esri.geometryEngine.contains(geo, new esri.Point({ x: lng, y: lat, spatialReference: { wkid: 4326 } }))
      for (const lc of layersRef.current) {
        const keys = containedKeys(lc.rows, lc.idField, lc.lngField, lc.latField, predicate)
        selActionsRef.current.set(lc.source, keys)
      }
      ;(el as unknown as { layer?: { remove(g: unknown): void } }).layer?.remove(graphic)
```
(remove the now-unused `data`/`dataRef` guard at the top of `onCreate`; guard instead on `!graphic?.geometry || !layersRef.current.length`.)

(e) map-click: write to the hit layer's source via `selActionsRef`. In the click handler, replace the `setSelectedRef.current(next)` tail with a per-source toggle:
```ts
      const key = ctx.keyByOid?.get(Number(oid))  // (already computed in the map step; keep the existing oid→key mapping)
      // toggle into the PRIMARY source's selection (mapCtx tracks the primary layer)
      const current = selActionsRef.current.get(source)
      const next = ids.reduce<string[]>((acc, id) => acc.includes(id) ? acc.filter(x => x !== id) : [...acc, id], current)
      selActionsRef.current.set(source, next)
```
(Map-click stays scoped to the primary layer's `mapCtx`; the geofence is the multi-layer path. This keeps click behavior identical to today.)

(f) highlight + count: drive them from `selState`. Change the highlight effect to read the primary layer's selection from `selState[source]` instead of the removed `selected`, and its deps to `[selState, ready, buildTick]`; compute `const selected = selState[source] ?? []` at the top of that effect and keep the rest. For the "N selected" overlay, replace `selected.length` with the union total:
```ts
  const selectedTotal = Object.values(selState).reduce((n, ids) => n + ids.length, 0)
  const selectionSummary = selectedTotal ? `${selectedTotal} selected` : undefined
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run --workspace @hermes/gis-canvas test -- src/components/molecules/EsriMapMolecule.test.tsx`
Expected: PASS (all, including the union test; the single-layer selection test still passes because one layer == today).

- [ ] **Step 5: Full FE suite + typecheck**

Run: `npm run --workspace @hermes/gis-canvas test`
Then: `npm run --workspace @hermes/gis-canvas typecheck`
Expected: green; no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx
git commit -m "feat(gis-canvas): union selection across all map layers (geofence)"
```

---

### Task 6: agent catalog + full verification

**Files:**
- Modify: `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`)

**Interfaces:**
- Consumes: nothing from other tasks (documentation).
- Produces: agent guidance for `props.layers` + a worked multi-layer example.

- [ ] **Step 1: Document `props.layers` + a worked example**

In `plugins/gis-canvas/tools_canvas.py`, in `_CATALOG_HELP`, find the `esri:map` sentence that begins `" (Phase 3 GIS) esri:map (bindings.layers = a layer handle or array of handles;`. At the end of that esri:map clause — right before `" esri:legend (bindings.mapRef"` — insert:
```python
    "For MULTIPLE layers, give each a name + optional color via props.layers "
    "(positional to bindings.layers): props.layers:[{title,color?}] — color is "
    "auto-assigned distinctly when omitted; ALSO author an esri:layer-list (not "
    "just a legend) so the user can distinguish/toggle them. "
```
Then, in the `RENDER_VIEW_SCHEMA` `description`, right after the existing Geospatial C2 example (it ends `"selects the contained rows in BOTH the map and the table."`), insert:
```python
        " Multi-layer example: {id:'m', type:'esri:map', layer:'base', "
        "props:{title:'WONDER VEGA trail', layers:[{title:'Dec 18'},{title:'Dec 23'},{title:'Dec 28'}]}, "
        "bindings:{layers:['data://<d18>','data://<d23>','data://<d28>']}} with an "
        "{id:'ll', type:'esri:layer-list', layer:'dock', edge:'right', bindings:{mapRef:'m'}} — "
        "each layer gets its own name + distinct color; a drawn geofence selects across all three."
```

- [ ] **Step 2: Verify the catalog string still parses (backend suite)**

Run: `python -m pytest tests/plugins/gis_canvas -q`
Expected: PASS (the suite imports `tools_canvas`; a broken string literal would fail collection).

- [ ] **Step 3: Full cross-stack verification**

Run each and confirm green:
```bash
npm run --workspace @hermes/gis-canvas test
npm run --workspace @hermes/gis-canvas typecheck
npm run --workspace @hermes/gis-canvas build
python -m pytest tests/plugins/gis_canvas -q
```
Expected: FE all pass; no type errors; production build succeeds; backend all pass.

- [ ] **Step 4: Commit**

```bash
git add plugins/gis-canvas/tools_canvas.py
git commit -m "docs(gis-canvas): document props.layers + multi-layer worked example"
```

---

## Manual live-verify (after implementation, gateway restarted on this branch)

- Author a map (same id across a couple of renders) with 3 `data://` layers + `props.layers` names + an `esri:layer-list` dock. Confirm: 3 distinctly-colored, named layers; the layer-list toggles each; re-rendering with a changed layer set rebuilds cleanly (no stale/duplicate layers, legend/layer-list reflect the current set).
- With `spatialFilter`, draw a geofence spanning points from more than one layer → confirm points from ALL enclosed layers highlight, and each layer's linked table highlights its own rows.

---

## Self-Review

**Spec coverage:**
- Per-layer title + auto-color (`props.layers`, `resolveLayerColor`, `buildRowsLayer color`): Tasks 1, 2, 4.
- Layer-freshness rebuild (split effects, clear+add, `layersSig`, `addedLayersRef`, `buildTick`): Task 4.
- Multi-layer union selection (`layersRef`, `useSelectionActions`/`useSelectionState`, geofence union, click, highlight/count): Tasks 3, 5.
- Agent guidance + worked example: Task 6.
- Backend = catalog text only (no schema/validator change): stated in Global Constraints + Task 6.
- Non-goals (time-slider, server spatial query, custom select toolbar, live-theme recolor) excluded.

**Placeholder scan:** none — every code/step is concrete.

**Type consistency:** `resolveLayerColor(index): string` identical in Task 1 + Task 4; `buildRowsLayer(source, esri, title?, render?, color?)` / `buildLayer(ref, esri, render?, color?)` consistent across Task 2 + Task 4; `useSelectionActions(): {get,set}` / `useSelectionState(): Record<string,string[]>` defined in Task 3 and used identically in Task 5; `layersRef` entry shape `{source, rows, idField, lngField, latField}` consistent between Task 4 (populate) and Task 5 (consume); `containedKeys(rows, idField, lngField, latField, contains)` used with the existing SP3 signature.
