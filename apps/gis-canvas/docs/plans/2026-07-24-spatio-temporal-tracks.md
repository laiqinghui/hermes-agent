# Spatio-Temporal Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Agent render moving platforms (vessels/aircraft/satellites — anything with a timestamp + coordinates) as spatio-temporal tracks: a time-ordered path with heading, plus a play/scrub time control on the map.

**Architecture:** A "track" is a *derived view* over ordinary time-stamped geo rows. A pure module (`lib/esri/tracks.ts`) groups rows by a track-id, time-orders them, and emits per-group polyline vertices + point graphics (stamped with a normalized `__time` and a `heading`). A thin ESRI factory turns each group into two client-side FeatureLayers (a track line + heading-rotated, time-aware points). `esri:map` gains a `render:'track'` mode that builds this stack and shows a resolved-field-roles caption; a new dockable `esri:time-slider` molecule drives the temporal window.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), ESRI ArcGIS Maps SDK 4.34 (`@arcgis/core` + `@arcgis/map-components` web components), Python 3 + pytest + jsonschema (canvas validator/catalog).

## Global Constraints

- **Every geometry carries `spatialReference: { wkid: 4326 }`** — points *and* polyline vertices. Missing SR makes a client FeatureLayer's extent compute to `[0,0]` and it fails to render (SP3b gotcha).
- **Drop, never coerce, bad rows:** a row with a non-finite `lng`/`lat` is skipped; a row with an unparseable timestamp is skipped (never coerced to epoch 0 — that teleports the track to 1970).
- **`__oid` = original source row index + 1**, preserved through filtering, so a track point still aligns with `keyByOid` / linked-table selection.
- **Colors come from `resolveLayerColor(index)`** (`apps/gis-canvas/src/lib/esri/layer-color.ts`) — themed `--color-cat-1..6` with a fixed hex fallback; negative-safe.
- **Registry-extension rule:** a NEW molecule *type* must be added in FIVE places — JSON schema `type` enum (`plugins/gis-canvas/schema/canvas.schema.json`), TS mirror `MOLECULE_TYPES` (`apps/gis-canvas/src/lib/types.ts`), validator `CATALOG` **and** `STATE_KEYS` (`plugins/gis-canvas/validator.py`), and `COMPONENT_REGISTRY` (`apps/gis-canvas/src/components/registry.tsx`) — plus a `_CATALOG_HELP` entry. A new *render mode* (like `heatmap`, `spatialFilter`) needs only front-end handling + `_CATALOG_HELP` — **no** schema/types/validator change (the validator has no props allow-list).
- **Worked examples in `_CATALOG_HELP` beat prose** for agent selection (the `tabs`/geospatial lesson).
- **TDD, frequent commits.** DRY, YAGNI.

**Commands (run from repo root `c:\workspace\analyst\hermes-agent`):**
- Front-end, single file: `cd apps/gis-canvas && npx vitest run src/lib/esri/tracks.test.ts`
- Front-end, full suite: `cd apps/gis-canvas && npm test`
- Front-end typecheck: `cd apps/gis-canvas && npm run typecheck`
- Front-end production build: `cd apps/gis-canvas && npm run build`
- Python plugin tests: `python -m pytest tests/plugins/gis_canvas/ -q`

---

## File Structure

**New files**
- `apps/gis-canvas/src/lib/esri/tracks.ts` — pure track domain: field-role resolution, grouping/time-ordering, bearing derivation, time-extent. No ESRI imports.
- `apps/gis-canvas/src/lib/esri/tracks.test.ts` — unit tests for the pure module.
- `apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.tsx` — dockable time-slider molecule.
- `apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.test.tsx` — molecule test.

**Modified files**
- `apps/gis-canvas/src/lib/esri/graphics.ts` — add `'date'` to `EsriFieldSpec.type`.
- `apps/gis-canvas/src/lib/esri/layers.ts` — add `trackLayersFromGroups(...)` ESRI factory.
- `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx` — `render:'track'` branch + resolved-roles caption.
- `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx` — track-render tests.
- `apps/gis-canvas/src/lib/esri/loader.ts` — import `arcgis-time-slider`.
- `apps/gis-canvas/src/lib/types.ts` — `MOLECULE_TYPES` += `esri:time-slider`.
- `apps/gis-canvas/src/components/registry.tsx` — register `esri:time-slider`.
- `apps/gis-canvas/src/lib/mock-data.ts` — add `mock://vessel-track`.
- `plugins/gis-canvas/schema/canvas.schema.json` — `type` enum += `esri:time-slider`.
- `plugins/gis-canvas/validator.py` — `CATALOG` + `STATE_KEYS` += `esri:time-slider`.
- `plugins/gis-canvas/tools_canvas.py` — `_CATALOG_HELP` + `RENDER_VIEW_SCHEMA` guidance/example.
- `tests/plugins/gis_canvas/test_validator.py` — `esri:time-slider` validation test.
- `tests/plugins/gis_canvas/test_tools.py` — track-guidance test.

---

### Task 1: Track field-role resolution (pure)

**Files:**
- Create: `apps/gis-canvas/src/lib/esri/tracks.ts`
- Test: `apps/gis-canvas/src/lib/esri/tracks.test.ts`

**Interfaces:**
- Consumes: `detectGeoFields(schema)` and `type MockField` (from `../mock-data`) — existing.
- Produces:
  - `interface TrackFields { timeField?: string; trackIdField?: string; headingField?: string; latField?: string; lngField?: string }`
  - `interface TrackFieldOverrides { timeField?: string; trackIdField?: string; headingField?: string; latField?: string; lngField?: string }`
  - `resolveTrackFields(schema: MockField[], overrides?: TrackFieldOverrides): TrackFields`

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/esri/tracks.test.ts`:

```ts
import { resolveTrackFields } from './tracks'
import type { MockField } from '../mock-data'

const AIS: MockField[] = [
  { name: 'MMSI', type: 'string' },
  { name: 'BaseDateTime', type: 'string' },
  { name: 'LAT', type: 'number' },
  { name: 'LON', type: 'number' },
  { name: 'COG', type: 'number' }
]

describe('resolveTrackFields', () => {
  test('detects time / trackId / heading / lat / lng by alias', () => {
    expect(resolveTrackFields(AIS)).toEqual({
      timeField: 'BaseDateTime', trackIdField: 'MMSI', headingField: 'COG', latField: 'LAT', lngField: 'LON'
    })
  })

  test('explicit overrides win over alias detection', () => {
    const r = resolveTrackFields(AIS, { timeField: 'BaseDateTime', trackIdField: 'COG' })
    expect(r.trackIdField).toBe('COG')
    expect(r.timeField).toBe('BaseDateTime')
  })

  test('no time-like field leaves timeField undefined', () => {
    const r = resolveTrackFields([{ name: 'name', type: 'string' }, { name: 'lat', type: 'number' }, { name: 'lng', type: 'number' }])
    expect(r.timeField).toBeUndefined()
    expect(r.latField).toBe('lat')
    expect(r.lngField).toBe('lng')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/esri/tracks.test.ts`
Expected: FAIL — cannot find module `./tracks` / `resolveTrackFields` is not a function.

- [ ] **Step 3: Write minimal implementation**

Create `apps/gis-canvas/src/lib/esri/tracks.ts`:

```ts
import { detectGeoFields } from './graphics'
import type { MockField } from '../mock-data'

const TIME_ALIASES = ['timestamp', 'time', 'ts', 'basedatetime', 'datetime', 'reported_at', 'date']
const TRACKID_ALIASES = ['trackid', 'mmsi', 'imo', 'icao24', 'callsign', 'tailnumber', 'vessel_name', 'vessel', 'entity_id', 'id']
const HEADING_ALIASES = ['heading', 'course', 'cog', 'bearing']

export interface TrackFields {
  timeField?: string
  trackIdField?: string
  headingField?: string
  latField?: string
  lngField?: string
}

export interface TrackFieldOverrides {
  timeField?: string
  trackIdField?: string
  headingField?: string
  latField?: string
  lngField?: string
}

function detectByAlias(schema: MockField[], aliases: string[]): string | undefined {
  const byLower = new Map<string, string>()
  for (const f of schema) {
    if (!byLower.has(f.name.toLowerCase())) byLower.set(f.name.toLowerCase(), f.name)
  }
  for (const a of aliases) {
    const m = byLower.get(a)
    if (m !== undefined) return m
  }
  return undefined
}

/**
 * Resolve the field roles a track needs. Explicit overrides (Agent-declared)
 * always win; otherwise fall back to case-insensitive alias detection so a
 * plain data source still renders. lat/lng reuse detectGeoFields.
 */
export function resolveTrackFields(schema: MockField[], overrides: TrackFieldOverrides = {}): TrackFields {
  const geo = detectGeoFields(schema)
  return {
    timeField: overrides.timeField ?? detectByAlias(schema, TIME_ALIASES),
    trackIdField: overrides.trackIdField ?? detectByAlias(schema, TRACKID_ALIASES),
    headingField: overrides.headingField ?? detectByAlias(schema, HEADING_ALIASES),
    latField: overrides.latField ?? geo.latField,
    lngField: overrides.lngField ?? geo.lngField
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/esri/tracks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/tracks.ts apps/gis-canvas/src/lib/esri/tracks.test.ts
git commit -m "feat(gis-canvas): track field-role resolution (aliases + overrides)"
```

---

### Task 2: Track grouping, ordering, bearing & time-extent (pure)

**Files:**
- Modify: `apps/gis-canvas/src/lib/esri/tracks.ts`
- Test: `apps/gis-canvas/src/lib/esri/tracks.test.ts`

**Interfaces:**
- Consumes: `TrackFields` (Task 1); `type EsriGraphic` from `./graphics` (existing: `{ geometry: { type:'point'; x:number; y:number; spatialReference:{wkid:number} }; attributes: Record<string, string|number> }`).
- Produces:
  - `interface TrackGroup { trackId: string; colorIndex: number; points: EsriGraphic[]; path: Array<[number, number]> }`
  - `bearingBetween(lng1: number, lat1: number, lng2: number, lat2: number): number` — degrees 0–360.
  - `buildTrackGroups(rows: Array<Record<string, unknown>>, fields: TrackFields, baseColorIndex?: number): TrackGroup[]`
  - `timeExtentOf(groups: TrackGroup[]): { start: number; end: number } | null` — epoch-ms bounds.

Each `points` entry carries attributes `{ __oid, __time (epoch ms), heading (deg), ...rest }` where `rest` excludes the lat/lng/time source columns. Groups are ordered by first appearance in `rows`; `colorIndex = baseColorIndex + groupOrder`. A group's `path` has one `[lng,lat]` per point (length < 2 ⇒ caller draws no line).

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/lib/esri/tracks.test.ts`:

```ts
import { buildTrackGroups, bearingBetween, timeExtentOf } from './tracks'
import type { TrackFields } from './tracks'

const FIELDS: TrackFields = { timeField: 'ts', trackIdField: 'mmsi', headingField: 'cog', latField: 'lat', lngField: 'lng' }

describe('bearingBetween', () => {
  test('due north is ~0°, due east is ~90°', () => {
    expect(Math.round(bearingBetween(0, 0, 0, 1))).toBe(0)
    expect(Math.round(bearingBetween(0, 0, 1, 0))).toBe(90)
  })
})

describe('buildTrackGroups', () => {
  const rows = [
    { mmsi: 'A', ts: '2026-01-01T02:00Z', lat: 2, lng: 0, cog: 10 },
    { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 20 }, // earlier — must sort before the row above
    { mmsi: 'B', ts: '2026-01-01T00:30Z', lat: 5, lng: 5, cog: 33 }
  ]

  test('groups by trackId and time-orders each group ascending', () => {
    const g = buildTrackGroups(rows, FIELDS)
    expect(g.map(x => x.trackId)).toEqual(['A', 'B'])
    const a = g.find(x => x.trackId === 'A')!
    expect(a.points.map(p => p.attributes.__time)).toEqual([Date.parse('2026-01-01T00:00Z'), Date.parse('2026-01-01T02:00Z')])
    expect(a.path).toEqual([[0, 0], [0, 2]])
  })

  test('assigns colorIndex from baseColorIndex in group order', () => {
    const g = buildTrackGroups(rows, FIELDS, 3)
    expect(g.map(x => x.colorIndex)).toEqual([3, 4])
  })

  test('stamps SR on every point geometry and keeps __oid at the source row index', () => {
    const g = buildTrackGroups(rows, FIELDS)
    const a = g.find(x => x.trackId === 'A')!
    expect(a.points.every(p => p.geometry.spatialReference.wkid === 4326)).toBe(true)
    // source rows 0 and 1 are track A → __oid 1 and 2 (order by time, values preserved)
    expect(a.points.map(p => p.attributes.__oid).sort()).toEqual([1, 2])
  })

  test('drops rows with unparseable time and non-finite coords', () => {
    const bad = [
      { mmsi: 'A', ts: 'not-a-date', lat: 1, lng: 1, cog: 0 },
      { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: Number.NaN, lng: 1, cog: 0 },
      { mmsi: 'A', ts: '2026-01-01T01:00Z', lat: 1, lng: 1, cog: 0 }
    ]
    const g = buildTrackGroups(bad, FIELDS)
    expect(g).toHaveLength(1)
    expect(g[0].points).toHaveLength(1)
    expect(g[0].points[0].attributes.__oid).toBe(3) // third source row survived
  })

  test('derives heading from successive positions when no heading field', () => {
    const noHeadFields: TrackFields = { ...FIELDS, headingField: undefined }
    const g = buildTrackGroups(
      [
        { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0 },
        { mmsi: 'A', ts: '2026-01-01T01:00Z', lat: 0, lng: 1 } // moved due east
      ],
      noHeadFields
    )
    expect(Math.round(Number(g[0].points[0].attributes.heading))).toBe(90)
  })

  test('single observation yields a point but no line (path length < 2)', () => {
    const g = buildTrackGroups([{ mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 5 }], FIELDS)
    expect(g[0].points).toHaveLength(1)
    expect(g[0].path.length).toBeLessThan(2)
  })

  test('a single group when no trackId field', () => {
    const g = buildTrackGroups(
      [{ ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 5 }, { ts: '2026-01-01T01:00Z', lat: 1, lng: 1, cog: 5 }],
      { timeField: 'ts', headingField: 'cog', latField: 'lat', lngField: 'lng' }
    )
    expect(g).toHaveLength(1)
    expect(g[0].trackId).toBe('')
  })

  test('returns [] when no time field is resolved', () => {
    expect(buildTrackGroups(rows, { latField: 'lat', lngField: 'lng' })).toEqual([])
  })
})

describe('timeExtentOf', () => {
  test('returns min/max __time across all groups, or null when empty', () => {
    const g = buildTrackGroups(
      [
        { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 0 },
        { mmsi: 'B', ts: '2026-01-01T05:00Z', lat: 1, lng: 1, cog: 0 }
      ],
      FIELDS
    )
    expect(timeExtentOf(g)).toEqual({ start: Date.parse('2026-01-01T00:00Z'), end: Date.parse('2026-01-01T05:00Z') })
    expect(timeExtentOf([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/esri/tracks.test.ts`
Expected: FAIL — `buildTrackGroups` / `bearingBetween` / `timeExtentOf` are not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/gis-canvas/src/lib/esri/tracks.ts` (add `EsriGraphic` to the existing `./graphics` import):

```ts
import type { EsriGraphic } from './graphics'

export interface TrackGroup {
  trackId: string
  colorIndex: number
  points: EsriGraphic[]
  path: Array<[number, number]>
}

/** Initial great-circle bearing from point 1 to point 2, in degrees (0–360, 0 = north). */
export function bearingBetween(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const p1 = toRad(lat1)
  const p2 = toRad(lat2)
  const dl = toRad(lng2 - lng1)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

interface RawPoint { oid: number; t: number; x: number; y: number; heading?: number; rest: Record<string, string | number> }

/**
 * Group tabular rows into time-ordered tracks. Requires fields.timeField (else []).
 * Rows with an unparseable timestamp or a non-finite coordinate are dropped
 * (never coerced). Each point carries __oid (source row index + 1), __time
 * (epoch ms) and heading (field value, else derived bearing along the path).
 */
export function buildTrackGroups(
  rows: Array<Record<string, unknown>>,
  fields: TrackFields,
  baseColorIndex = 0
): TrackGroup[] {
  const { timeField, trackIdField, headingField } = fields
  if (!timeField) return []
  const latKey = fields.latField ?? 'lat'
  const lngKey = fields.lngField ?? 'lng'

  const groups = new Map<string, RawPoint[]>()
  rows.forEach((row, i) => {
    const t = Date.parse(String(row[timeField]))
    if (!Number.isFinite(t)) return
    const x = Number(row[lngKey])
    const y = Number(row[latKey])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const gid = trackIdField != null ? String(row[trackIdField]) : ''
    const rest: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(row)) {
      if (k === latKey || k === lngKey || k === timeField) continue
      if (typeof v === 'string' || typeof v === 'number') rest[k] = v
    }
    const h = headingField != null ? Number(row[headingField]) : Number.NaN
    const arr = groups.get(gid)
    const point: RawPoint = { oid: i + 1, t, x, y, heading: Number.isFinite(h) ? h : undefined, rest }
    if (arr) arr.push(point)
    else groups.set(gid, [point])
  })

  const out: TrackGroup[] = []
  let gi = 0
  for (const [trackId, raws] of groups) {
    raws.sort((a, b) => a.t - b.t)
    const points: EsriGraphic[] = raws.map((r, j) => {
      let heading = r.heading
      if (heading == null) {
        if (raws.length < 2) heading = 0
        else if (j < raws.length - 1) heading = bearingBetween(r.x, r.y, raws[j + 1].x, raws[j + 1].y)
        else heading = bearingBetween(raws[j - 1].x, raws[j - 1].y, r.x, r.y)
      }
      return {
        geometry: { type: 'point', x: r.x, y: r.y, spatialReference: { wkid: 4326 } },
        attributes: { __oid: r.oid, __time: r.t, heading, ...r.rest }
      }
    })
    out.push({ trackId, colorIndex: baseColorIndex + gi, points, path: raws.map(r => [r.x, r.y] as [number, number]) })
    gi++
  }
  return out
}

/** Epoch-ms [start,end] spanning every point across all groups; null if empty. */
export function timeExtentOf(groups: TrackGroup[]): { start: number; end: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const g of groups) {
    for (const p of g.points) {
      const t = Number(p.attributes.__time)
      if (t < min) min = t
      if (t > max) max = t
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { start: min, end: max } : null
}
```

Note: change the Task-1 import line `import { detectGeoFields } from './graphics'` to also carry the type: keep `import { detectGeoFields } from './graphics'` and add the separate `import type { EsriGraphic } from './graphics'` shown above (two import statements from the same module is fine).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/esri/tracks.test.ts`
Expected: PASS (all Task-1 + Task-2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/tracks.ts apps/gis-canvas/src/lib/esri/tracks.test.ts
git commit -m "feat(gis-canvas): pure track grouping, ordering, bearing & time-extent"
```

---

### Task 3: Track layer factory + `esri:map render:'track'` + roles caption

**Files:**
- Modify: `apps/gis-canvas/src/lib/esri/graphics.ts` (`EsriFieldSpec.type` += `'date'`)
- Modify: `apps/gis-canvas/src/lib/esri/layers.ts` (add `trackLayersFromGroups`)
- Modify: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`
- Test: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`

**Interfaces:**
- Consumes: `buildTrackGroups`, `resolveTrackFields`, `type TrackFields`, `type TrackGroup` (Tasks 1–2); `fieldsFromSchema` (existing, `graphics.ts`); `resolveLayerColor` (existing); `type MockField` (existing).
- Produces: `trackLayersFromGroups(groups: TrackGroup[], esri: { FeatureLayer: new (o: unknown) => unknown }, schema: MockField[], titlePrefix?: string): unknown[]` — two ESRI FeatureLayers per group (a `simple-line` track layer when `path.length >= 2`, and a heading-rotated, `timeInfo`-tagged point layer), colored `resolveLayerColor(group.colorIndex)`.

- [ ] **Step 1: Write the failing test**

First widen `EsriFieldSpec` so a `'date'` field typechecks. In `apps/gis-canvas/src/lib/esri/graphics.ts` change:

```ts
export interface EsriFieldSpec { name: string; alias: string; type: 'oid' | 'string' | 'double' | 'date' }
```

Then append these tests to `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`. They reuse the file's existing `vi.mock('../../lib/esri/loader', …)` and `vi.mock('../../lib/esri/layers', …)`. The layers mock must expose `trackLayersFromGroups`; extend the existing `vi.mock('../../lib/esri/layers', …)` factory (top of file) to add it — update that mock block to:

```ts
vi.mock('../../lib/esri/layers', () => ({
  parseLayerRef: (r: string) => ({ kind: 'rows', name: r }),
  buildLayer: (ref: string) => { built.push(ref); return { ref } },
  buildRowsLayer: (_s: any, _e: any, _t?: string, _r?: string, color = '#e0685b') => { builtColors.push(color); return { color } },
  // one fake ESRI layer per group point-set (line omitted for the single-point fakes here)
  trackLayersFromGroups: (groups: any[]) => groups.map((g: any) => ({ track: g.trackId, colorIndex: g.colorIndex }))
}))
```

New tests (append at end of the file — reuse the existing top-of-file imports for `EsriMapMolecule`, `render`, `waitFor`, `HandlerProvider`, `CanvasActions`, `ComponentNode`):

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EsriMapMolecule.test.tsx`
Expected: FAIL — molecule ignores `render:'track'` (no track layers added, no caption); `trackLayersFromGroups` unused.

- [ ] **Step 3: Write minimal implementation**

**(a)** Add the factory to `apps/gis-canvas/src/lib/esri/layers.ts`. Add imports at top:

```ts
import type { MockField } from '../mock-data'
import { resolveLayerColor } from './layer-color'
import type { TrackGroup } from './tracks'
```

Append:

```ts
/** Turn pure TrackGroups into ESRI client-side FeatureLayers: a track line
 * (when there are >=2 vertices) + a heading-rotated, time-aware point layer,
 * per group, each colored by its colorIndex. */
export function trackLayersFromGroups(
  groups: TrackGroup[],
  esri: { FeatureLayer: new (o: unknown) => unknown },
  schema: MockField[],
  titlePrefix?: string
): unknown[] {
  const out: unknown[] = []
  // point fields = the source (non-geo) fields + synthetic __time (date) + heading (double)
  const baseFields = fieldsFromSchema(schema)
  const hasHeading = baseFields.some(f => f.name === 'heading')
  const pointFields = [
    ...baseFields,
    { name: '__time', alias: '__time', type: 'date' as const },
    ...(hasHeading ? [] : [{ name: 'heading', alias: 'heading', type: 'double' as const }])
  ]

  for (const g of groups) {
    const color = resolveLayerColor(g.colorIndex)
    const name = g.trackId ? `${titlePrefix ?? 'track'} · ${g.trackId}` : (titlePrefix ?? 'track')

    if (g.path.length >= 2) {
      out.push(new esri.FeatureLayer({
        source: [{
          geometry: { type: 'polyline', paths: [g.path], spatialReference: { wkid: 4326 } },
          attributes: { __oid: 1 }
        }],
        fields: [{ name: '__oid', alias: '__oid', type: 'oid' }],
        objectIdField: '__oid',
        geometryType: 'polyline',
        spatialReference: { wkid: 4326 },
        renderer: { type: 'simple', symbol: { type: 'simple-line', color, width: 2 } },
        title: `${name} · line`
      }))
    }

    out.push(new esri.FeatureLayer({
      source: g.points,
      fields: pointFields,
      objectIdField: '__oid',
      geometryType: 'point',
      spatialReference: { wkid: 4326 },
      timeInfo: { startField: '__time' },
      renderer: {
        type: 'simple',
        symbol: { type: 'simple-marker', style: 'triangle', color, size: 10, outline: { color: '#fff', width: 1 } },
        visualVariables: [{ type: 'rotation', field: 'heading', rotationType: 'geographic' }]
      },
      title: name
    }))
  }
  return out
}
```

**(b)** Wire the molecule `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`:

Add imports:

```ts
import { buildLayer, buildRowsLayer, trackLayersFromGroups } from '../../lib/esri/layers'
import { resolveTrackFields, buildTrackGroups, type TrackFields } from '../../lib/esri/tracks'
```

Widen the props cast and the `render` derivation:

```ts
const props = (node.props ?? {}) as {
  basemap?: string; center?: [number, number]; zoom?: number
  render?: 'points' | 'heatmap' | 'track'; spatialFilter?: boolean; basemapToggle?: boolean; basemapAlt?: string
  timeField?: string; trackIdField?: string; headingField?: string; latField?: string; lngField?: string
}
const basemap = props.basemap ?? 'osm'
const render = props.render === 'heatmap' ? 'heatmap' : props.render === 'track' ? 'track' : 'points'
const baseRender = render === 'heatmap' ? 'heatmap' : 'points' // for the non-track layer builders
```

Add roles state near the other `useState` hooks:

```ts
const [roles, setRoles] = useState<TrackFields | null>(null)
```

In the rebuild effect, add `setRoles(null)` alongside the existing resets, and declare a track color counter before the layer loop:

```ts
      dataRef.current = null
      layersRef.current = []
      mapCtx.current = null
      setRoles(null)
      let trackColorBase = 0
```

Inside the `for` loop, as the FIRST statement in the `try` block, add the track branch:

```ts
        try {
          if (render === 'track' && isDataHandle(r)) {
            const page = await actions.fetchData(r, { pageSize: 5000 })
            if (cancelled) return
            const rows = page.rows as Record<string, unknown>[]
            const fields = resolveTrackFields(page.schema as never, {
              timeField: props.timeField, trackIdField: props.trackIdField, headingField: props.headingField,
              latField: props.latField, lngField: props.lngField
            })
            if (r === source) setRoles(fields)
            const groups = buildTrackGroups(rows, fields, trackColorBase)
            trackColorBase += groups.length
            const trackLayers = trackLayersFromGroups(groups, esri, page.schema as never, meta.title ?? title)
            if (view) for (const tl of trackLayers) { view.map.add(tl); addedLayersRef.current.push(tl) }
            continue
          }
          let layer: unknown
```

Then update the two non-track builder calls in that same loop to pass `baseRender` instead of `render`:

```ts
            layer = buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, title, baseRender, color)
```
and
```ts
            layer = buildLayer(r, esri, baseRender, color)
```

Finally, add the caption to the returned JSX, immediately after the `selectionSummary` block:

```tsx
      {render === 'track' && roles ? (
        <div className="absolute top-2 left-2 z-6 flex max-w-[90%] flex-wrap items-center gap-x-2 rounded-gc-sm border border-hairline bg-surface/80 px-2 py-1 font-mono text-[10px] text-tertiary backdrop-blur-sm">
          <span>◇ spatial {roles.latField ?? 'lat'}/{roles.lngField ?? 'lng'}</span>
          <span>◷ temporal {roles.timeField ?? '—'}</span>
          {roles.trackIdField ? <span>⛓ track {roles.trackIdField}</span> : null}
        </div>
      ) : null}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EsriMapMolecule.test.tsx src/lib/esri/tracks.test.ts`
Expected: PASS. Then typecheck: `cd apps/gis-canvas && npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/graphics.ts apps/gis-canvas/src/lib/esri/layers.ts apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx
git commit -m "feat(gis-canvas): esri:map render:'track' + track layer factory + roles caption"
```

---

### Task 4: `esri:time-slider` molecule + loader import + registry sync

**Files:**
- Create: `apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.tsx`
- Create: `apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.test.tsx`
- Modify: `apps/gis-canvas/src/lib/esri/loader.ts`
- Modify: `apps/gis-canvas/src/components/registry.tsx`
- Modify: `apps/gis-canvas/src/lib/types.ts`
- Modify: `plugins/gis-canvas/schema/canvas.schema.json`
- Modify: `plugins/gis-canvas/validator.py`
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: `loadEsri` (existing); `EsriFrame` (existing); `MoleculeProps` (existing). Binds `<arcgis-time-slider reference-element="#esri-map-<mapRef>">` (same id scheme as legend/layer-list).
- Produces: `esri:time-slider` as a valid molecule type end-to-end (schema + TS + validator + registry). Optional `props.stops` (a number → slider stop count).

- [ ] **Step 1: Write the failing tests**

Front-end — create `apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.test.tsx`:

```ts
import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'

vi.mock('../../lib/esri/loader', () => ({ loadEsri: async () => ({}) }))

import { EsriTimeSliderMolecule } from './EsriTimeSliderMolecule'

test('renders an arcgis-time-slider bound to the map via reference-element', () => {
  const node: ComponentNode = { id: 'ts1', type: 'esri:time-slider', bindings: { mapRef: 'map1' } }
  const { container } = render(<EsriTimeSliderMolecule node={node} renderChild={() => null} />)
  const el = container.querySelector('arcgis-time-slider')
  expect(el).toBeTruthy()
  expect(el?.getAttribute('reference-element')).toBe('#esri-map-map1')
})

test('omits reference-element when no mapRef is bound', () => {
  const node: ComponentNode = { id: 'ts2', type: 'esri:time-slider' }
  const { container } = render(<EsriTimeSliderMolecule node={node} renderChild={() => null} />)
  expect(container.querySelector('arcgis-time-slider')?.getAttribute('reference-element')).toBeNull()
})
```

Python — append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def test_esri_time_slider_valid_doc_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append(
        {
            "id": "ts1",
            "type": "esri:time-slider",
            "area": {"col": 1, "colSpan": 12, "row": 4, "rowSpan": 1},
            "bindings": {"mapRef": "map1"},
        }
    )
    assert plugin.validator.validate_doc(doc) == []


def test_esri_time_slider_state_keys_registered(plugin):
    assert "esri:time-slider" in plugin.validator.STATE_KEYS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EsriTimeSliderMolecule.test.tsx`
Expected: FAIL — module `./EsriTimeSliderMolecule` not found.

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k time_slider`
Expected: FAIL — `esri:time-slider` rejected by schema enum / missing from `STATE_KEYS`.

- [ ] **Step 3: Write the implementation**

**(a)** Create `apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { EsriFrame } from './EsriFrame'
import type { MoleculeProps } from '../registry'

export function EsriTimeSliderMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  const el = useRef<HTMLElement | null>(null)
  const stops = typeof node.props?.stops === 'number' ? node.props.stops : undefined

  // Ensure the arcgis-time-slider custom element is registered.
  useEffect(() => { void loadEsri() }, [])

  // `stops` is a property (object), not a plain attribute — set it on the element.
  useEffect(() => {
    if (el.current && stops != null) (el.current as unknown as { stops: unknown }).stops = { count: stops }
  }, [stops])

  return (
    <EsriFrame title="Timeline">
      {/* @ts-expect-error custom element */}
      <arcgis-time-slider
        ref={el}
        {...(ref ? { 'reference-element': ref } : {})}
        mode="time-window"
        play-rate="1000"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </EsriFrame>
  )
}
```

**(b)** `apps/gis-canvas/src/lib/esri/loader.ts` — add the web-component import inside `loadEsri`, alongside the other `@arcgis/map-components/components/*` imports (after the `arcgis-basemap-toggle` line):

```ts
    await import('@arcgis/map-components/components/arcgis-time-slider')
```

**(c)** `apps/gis-canvas/src/components/registry.tsx` — add the lazy wrapper (mirror `EsriLayerList`) and the registry entry:

```tsx
const EsriTimeSliderLazy = lazy(() => import('./molecules/EsriTimeSliderMolecule').then(m => ({ default: m.EsriTimeSliderMolecule })))
function EsriTimeSlider(props: MoleculeProps) {
  return (
    <Suspense fallback={<div className="p-2 text-xs text-neutral-400">Loading timeline…</div>}>
      <EsriTimeSliderLazy {...props} />
    </Suspense>
  )
}
```

and inside `COMPONENT_REGISTRY`, after the `'esri:layer-list'` line:

```tsx
  'esri:time-slider': EsriTimeSlider,
```

**(d)** `apps/gis-canvas/src/lib/types.ts` — add to `MOLECULE_TYPES`:

```ts
export const MOLECULE_TYPES = ['card', 'stat', 'data-table', 'select', 'tabs', 'esri:map', 'esri:legend', 'esri:layer-list', 'esri:time-slider', 'esri:feature-table'] as const
```

**(e)** `plugins/gis-canvas/schema/canvas.schema.json` — add `"esri:time-slider"` to the `type` enum (line 44):

```json
        "type": { "enum": ["card", "stat", "data-table", "select", "tabs", "esri:map", "esri:legend", "esri:layer-list", "esri:time-slider", "esri:feature-table"] },
```

**(f)** `plugins/gis-canvas/validator.py` — add a `CATALOG` entry (after `esri:layer-list`) and a `STATE_KEYS` entry:

```python
    "esri:time-slider": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": [],
    },
```

```python
    "esri:time-slider": set(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EsriTimeSliderMolecule.test.tsx`
Expected: PASS (2 tests).

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k time_slider`
Expected: PASS (2 tests).

Run typecheck: `cd apps/gis-canvas && npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.tsx apps/gis-canvas/src/components/molecules/EsriTimeSliderMolecule.test.tsx apps/gis-canvas/src/lib/esri/loader.ts apps/gis-canvas/src/components/registry.tsx apps/gis-canvas/src/lib/types.ts plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "feat(gis-canvas): esri:time-slider molecule + registry sync + loader import"
```

---

### Task 5: `mock://vessel-track` source + Agent guidance & worked example

**Files:**
- Modify: `apps/gis-canvas/src/lib/mock-data.ts`
- Modify: `plugins/gis-canvas/tools_canvas.py`
- Test: `tests/plugins/gis_canvas/test_tools.py`

**Interfaces:**
- Consumes: `resolveMockSource` (existing) — new `mock://vessel-track` handle resolves through it, so `render:'track'` works against a mock without Denodo.
- Produces: catalog guidance the Agent reads — the dimensional-classification rule, the `render:'track'` doc line, the `esri:time-slider` entry, and a worked spatio-temporal example.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/gis_canvas/test_tools.py`:

```python
def test_tool_guidance_documents_tracks(plugin):
    text = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"] + plugin.tools_canvas._CATALOG_HELP
    for kw in ("render:'track'", "esri:time-slider", "timeField", "trackIdField", "spatio-temporal"):
        assert kw in text, f"track guidance missing {kw!r}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/plugins/gis_canvas/test_tools.py -q -k tracks`
Expected: FAIL — guidance keywords absent.

- [ ] **Step 3: Write the implementation**

**(a)** `apps/gis-canvas/src/lib/mock-data.ts` — add a source inside `SOURCES` (after `mock://districts`). Two platforms, time-ordered, turning; a couple of same-second duplicate positions are fine (bearing falls back). Coordinates trace short courses near Singapore:

```ts
  'mock://vessel-track': {
    schema: [
      { name: 'mmsi', type: 'string' },
      { name: 'vessel_name', type: 'string' },
      { name: 'ts', type: 'string' },
      { name: 'lat', type: 'number' },
      { name: 'lng', type: 'number' },
      { name: 'cog', type: 'number' }
    ],
    rows: [
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T00:00:00Z', lat: 1.230, lng: 103.700, cog: 75 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T01:00:00Z', lat: 1.245, lng: 103.760, cog: 72 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T02:00:00Z', lat: 1.268, lng: 103.815, cog: 66 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T03:00:00Z', lat: 1.300, lng: 103.860, cog: 55 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T04:00:00Z', lat: 1.345, lng: 103.895, cog: 40 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T00:00:00Z', lat: 1.420, lng: 104.020, cog: 250 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T01:00:00Z', lat: 1.395, lng: 103.955, cog: 245 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T02:00:00Z', lat: 1.360, lng: 103.900, cog: 235 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T03:00:00Z', lat: 1.318, lng: 103.855, cog: 228 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T04:00:00Z', lat: 1.270, lng: 103.820, cog: 220 }
    ]
  },
```

**(b)** `plugins/gis-canvas/tools_canvas.py` — extend `_CATALOG_HELP`. Immediately after the existing sentence that ends `…density surface instead of points."` (the `props.render:'heatmap'` line, ~line 167), insert a new concatenated string segment:

```python
    " SPATIO-TEMPORAL (moving platforms — vessels/aircraft/satellites): first CLASSIFY the "
    "data's dimensions. Coordinates + a timestamp field + a question about movement/route/history "
    "over time => render a TRACK: props.render:'track' on esri:map draws time-ordered track lines + "
    "heading arrows + a slider-driven cursor, and REQUIRES a time field. Coordinates but no usable "
    "time => props.render:'points' (or 'heatmap'). A time field but NO coordinates => a chronological "
    "data-table (temporal charts are not yet available). ALWAYS declare the field roles you used as "
    "props: timeField, latField/lngField, trackIdField (groups many platforms in ONE source into "
    "separate colored tracks — e.g. MMSI/tail number/callsign), headingField (else heading is derived "
    "from successive positions); when omitted the client falls back to detecting them by name. For a "
    "track ALSO author an esri:time-slider (bindings.mapRef = the esri:map id; dockable like the "
    "legend, edge:'bottom'; optional props.stops number) so the user can play/scrub time. A "
    "'mock://vessel-track' dev source is available for spatio-temporal demos."
```

**(c)** `plugins/gis-canvas/tools_canvas.py` — add the worked example to `RENDER_VIEW_SCHEMA["description"]`. Immediately after the existing `Multi-layer example: …selects across all three."` block (~line 213), insert:

```python
        " Spatio-temporal track example (moving platform over time): {id:'trk', type:'esri:map', "
        "layer:'base', props:{title:'WONDER VEGA — track', basemap:'osm', render:'track', "
        "timeField:'BaseDateTime', trackIdField:'MMSI', headingField:'COG'}, "
        "bindings:{layers:['data://<vessel-positions>']}} (or bindings:{layers:['mock://vessel-track']} "
        "for a demo) WITH {id:'ts', type:'esri:time-slider', layer:'dock', edge:'bottom', "
        "bindings:{mapRef:'trk'}} and {id:'lg', type:'esri:legend', layer:'dock', edge:'right', "
        "bindings:{mapRef:'trk'}} — each MMSI becomes its own colored, time-ordered track; playing the "
        "time-slider sweeps the platforms along their courses."
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/plugins/gis_canvas/test_tools.py -q`
Expected: PASS (existing + the new `test_tool_guidance_documents_tracks`).

Add a quick front-end sanity check that the mock resolves — run the existing suite (the mock is data, not separately unit-tested here; Task 3's molecule already exercises the track path). Run: `cd apps/gis-canvas && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/mock-data.ts plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_tools.py
git commit -m "feat(gis-canvas): vessel-track mock + spatio-temporal agent guidance & example"
```

---

## Final Verification (after all tasks)

- [ ] **Full front-end suite:** `cd apps/gis-canvas && npm test` → all green (existing 256 + new track/time-slider tests).
- [ ] **Front-end typecheck + production build:** `cd apps/gis-canvas && npm run build` → succeeds (confirms the `arcgis-time-slider` import path resolves and there are no type errors).
- [ ] **Python plugin suite:** `python -m pytest tests/plugins/gis_canvas/ -q` → all green (existing 118 + new validator/tools tests).

## Deferred live-verify gate (per finishing-a-development-branch)

Client-side `FeatureLayer` + `timeInfo` + `<arcgis-time-slider>` on a **synthesized** (non-service) layer is only truly exercised by the real map: whether the time-window actually filters the observation points, whether the heading-rotated triangles render, and whether the slider derives/plays the extent. This is the merge gate — the same deferred-live-verify discipline as SP3/SP3b. Automated tests cover the pure track math, the molecule wiring (mocked ESRI), the roles caption, and the registry/guidance; they do **not** prove the live ESRI temporal behavior. Hold the merge decision for the user's live check.

---

## Self-Review

**Spec coverage:**
- `render:'track'` (line + points + heading + cursor) → Tasks 2 (geometry/heading), 3 (layer factory: line layer + rotated time-aware points; cursor = leading in-window point via `timeInfo`, realized by the time filter rather than a separate layer — noted as an implementation decision consistent with the spec's intent).
- `esri:time-slider` molecule → Task 4.
- Agent-declared dimensionality + visible roles caption → Task 3 (caption) + Task 5 (classification guidance).
- Field roles (time/trackId/heading + lat/lng) with alias-detection fallback → Task 1; overrides honored in Task 3 wiring.
- `trackId` grouping → Task 2; composes with multi-layer (per-source loop in Task 3, `trackColorBase` keeps colors distinct across sources).
- Pure `lib/esri/tracks.ts`, heavily unit-tested → Tasks 1–2.
- `mock://vessel-track` → Task 5. Registry 5-place sync → Task 4. Catalog worked example → Task 5.
- SP3b gotchas (SR on every vertex, non-finite skip, `__oid` alignment) → Global Constraints + Task 2 tests. Unparseable-time drop → Task 2. Single observation → no line → Task 2.
- Time engine `timeInfo:{startField:'__time'}` → Task 3 factory; extent derivation helper `timeExtentOf` → Task 2 (available for the slider; live wiring exercised at the deferred gate).

**Spec item intentionally narrowed (flagged for the executor & reviewers):** the spec's Section "Registry 5-place sync" lists a `validator.py` *props allow-list* for `render:'track'`. The validator has **no** allow-list mechanism today (heatmap/spatialFilter are free-form props). Inventing one only for track props would be inconsistent and out of scope; this plan therefore adds **no** validator change for `render:'track'` (only front-end handling + catalog help) and applies the full 5-place sync to the new `esri:time-slider` *type* (which genuinely needs it to avoid a `CATALOG` KeyError). This is a plan-vs-spec narrowing — if a reviewer or the user wants a real allow-list, that's a separate follow-up.

**Placeholder scan:** none — every code step carries complete code.

**Type consistency:** `TrackFields`/`TrackGroup`/`buildTrackGroups`/`resolveTrackFields`/`timeExtentOf`/`trackLayersFromGroups` names and signatures match across Tasks 1–4. `EsriFieldSpec.type` widened to include `'date'` before it is used by `trackLayersFromGroups`. `render` union `'points'|'heatmap'|'track'` with `baseRender` coercion so existing `buildRowsLayer`/`buildLayer` (`'points'|'heatmap'`) stay type-correct.
