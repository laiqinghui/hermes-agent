# GIS Canvas — Phase 3: ESRI GIS Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the map to the canvas — an `esri:map` molecule (ArcGIS Maps SDK web components) that plots layers from both `DataHandle` kinds (client-side mock geo rows + a public FeatureServer URL), plus `esri:legend` and `esri:feature-table` (map-linked selection), Calcite-themed to match shadcn — and fold in the §18 review-polish backlog.

**Architecture:** ESRI ships declarative web components (`@arcgis/map-components`); the map molecule renders `<arcgis-map>` and, on view-ready, imperatively adds `FeatureLayer`s built from the node's `bindings.layers` (a `mock://…` handle → a client-side point FeatureLayer from mock rows+coords; an `https://…` URL → `new FeatureLayer({url})`). Keyless OpenStreetMap basemap by default; premium `arcgis/*` basemaps when `VITE_ARCGIS_API_KEY` is set. All ESRI imports are lazy (`@arcgis/core` is multi-MB). Map view state (selection/extent) flows into `component.state` via the existing interaction channel. Pure logic (graphics-from-rows, handle parsing) is unit-tested; the map itself is verified live in the browser (jsdom can't render WebGL).

**Tech Stack:** `@arcgis/map-components`, `@arcgis/core`, `@esri/calcite-components` (frontend, lazy); React 19 + Vite + vitest; Python + jsonschema (backend plugin: schema/catalog/validation).

**Spec:** `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` — §9 (GIS layer), §18 (backlog).

## Global Constraints

- ALL code stays in `apps/gis-canvas/` and `plugins/gis-canvas/`; backend tests in `tests/plugins/gis_canvas/`. No core edits (Phase 2's one fenced `@method` already covers the inbound path; interactions reuse it). Never `git add -A` (foreign `web/` changes exist).
- Commit messages start `gis:` and end with the trailer in Task 1. Branch `gis/main`.
- Backend tests: `.venv/bin/pytest tests/plugins/gis_canvas`. Frontend: `npm run -w @hermes/gis-canvas test|build` from repo root.
- Frontend ESRI deps pinned in `apps/gis-canvas/package.json` (never root): `@arcgis/core@^4.34.0`, `@arcgis/map-components@^4.34.0`, `@esri/calcite-components@^3.4.0`. (Use the versions `npm install` resolves within these ranges; record the resolved versions in the task report.)
- **Basemap:** default keyless `basemap:"osm"`; if `import.meta.env.VITE_ARCGIS_API_KEY` is set, `esriConfig.apiKey = <key>` and default basemap becomes `"arcgis/navigation"`. Never hard-code a key.
- **Catalog additions (this phase):** `esri:map`, `esri:legend`, `esri:feature-table`. Namespacing: `esri:` prefix = ArcGIS-backed (bare = shadcn family), per spec §5.
- **Layer handle grammar (bindings):** a layer reference string is either `mock://<name>` (client-side rows path — resolved via `resolveMockSource`) or an `http(s)://…/FeatureServer/<n>` URL (service path). The map molecule dispatches on the prefix.
- **ESRI molecules are verified by:** (a) pure-helper unit tests (no ESRI import), (b) light molecule tests with the ESRI loader mocked, (c) the live browser e2e (Task 9). Do NOT attempt to unit-test real map rendering in jsdom.
- Verified ArcGIS facts (context7): per-component import `@arcgis/map-components/components/arcgis-map` (+ `arcgis-legend`, `arcgis-feature-table`); CSS `@import "@esri/calcite-components/main.css"; @import "@arcgis/map-components/main.css";`; `await el.viewOnReady()` then `el.view` / `el.map.add(layer)`; client-side `new FeatureLayer({ source: graphics, fields, objectIdField, geometryType:"point", spatialReference:{wkid:4326}, renderer, popupTemplate })`; `<arcgis-feature-table reference-element="#sel">`; Calcite theming via `--calcite-color-brand` (+ `body.calcite-mode-dark`).

## File Structure

```
plugins/gis-canvas/
  schema/canvas.schema.json   # + esri:* in type enum; + per-kind handler if/then (§18.1)
  validator.py                # + CATALOG/STATE_KEYS for esri:*; handler-kind note
  tools_canvas.py             # _CATALOG_HELP: teach esri:map/legend/feature-table + layer handles
tests/plugins/gis_canvas/
  test_validator.py           # + esri:* validation, handler per-kind validation

apps/gis-canvas/
  package.json                # + @arcgis/core, @arcgis/map-components, @esri/calcite-components
  src/index.css               # + calcite/map-components CSS + Calcite→shadcn token bridge
  src/lib/types.ts            # + esri:* in MOLECULE_TYPES (+ §18.3/§18.4 comments)
  src/lib/mock-data.ts        # + lat/lon on incidents; + PUBLIC_FEATURESERVER constant
  src/lib/esri/graphics.ts    # CREATE pure: graphicsFromMockSource(), fieldsFromSchema()
  src/lib/esri/graphics.test.ts
  src/lib/esri/layers.ts      # CREATE: parseLayerRef(); buildLayer() (uses lazy-loaded esri mods)
  src/lib/esri/layers.test.ts
  src/lib/esri/loader.ts      # CREATE: loadEsri() dynamic import seam (mockable)
  src/components/molecules/EsriMapMolecule.tsx       # CREATE
  src/components/molecules/EsriLegendMolecule.tsx    # CREATE
  src/components/molecules/EsriFeatureTableMolecule.tsx  # CREATE
  src/components/molecules/EsriMapMolecule.test.tsx  # light (loader mocked)
  src/components/registry.tsx # + esri:* (lazy)
  src/lib/handlers.ts         # §18: implement/guard 'open' kind reserve; reactive comment
```

---

### Task 1: Backend — catalog/schema/STATE_KEYS for `esri:*`

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json` (type enum)
- Modify: `plugins/gis-canvas/validator.py` (CATALOG + STATE_KEYS)
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Produces: catalog entries `esri:map` (leaf; required bindings `layers`), `esri:legend` (leaf; no required), `esri:feature-table` (leaf; required bindings `layer`); `STATE_KEYS` gains `esri:map`→`{selection, extent}`, `esri:feature-table`→`{selection}`, `esri:legend`→`set()`.

- [ ] **Step 1: Failing tests**

Append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def test_esri_map_valid_with_layers_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "area": {"col": 1, "colSpan": 8, "row": 2, "rowSpan": 4},
        "bindings": {"layers": "mock://incidents"},   # single handle (string) OK
        "props": {"basemap": "osm"},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_esri_map_valid_with_layers_array(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "area": {"col": 1, "colSpan": 8, "row": 2, "rowSpan": 4},
        "bindings": {"layers": ["mock://incidents", "https://x/FeatureServer/0"]},  # array of handles OK
    })
    assert plugin.validator.validate_doc(doc) == []


def test_esri_map_requires_layers_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "area": {"col": 1, "colSpan": 8, "row": 2, "rowSpan": 4},
    })
    assert any("bindings.layers" in e for e in plugin.validator.validate_doc(doc))


def test_esri_feature_table_requires_layer_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "ft1", "type": "esri:feature-table",
        "area": {"col": 9, "colSpan": 4, "row": 2, "rowSpan": 4},
    })
    assert any("bindings.layer" in e for e in plugin.validator.validate_doc(doc))


def test_esri_state_keys(plugin):
    assert plugin.validator.STATE_KEYS["esri:map"] >= {"selection", "extent"}
    assert "selection" in plugin.validator.STATE_KEYS["esri:feature-table"]
```

- [ ] **Step 2: Run — expect FAIL** (`esri:map` not in enum).
Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_validator.py -k esri -v`

- [ ] **Step 3: Schema enum + bindings relaxation** — in `canvas.schema.json`, extend the `type` enum AND relax `bindings` to allow a handle value to be a string OR an array of strings (so `esri:map` can bind multiple `layers`). In `$defs.componentNode.properties`:
```json
"type": { "enum": ["card", "stat", "data-table", "select", "esri:map", "esri:legend", "esri:feature-table"] },
"bindings": {
  "type": "object",
  "additionalProperties": {
    "anyOf": [ { "type": "string" }, { "type": "array", "items": { "type": "string" } } ]
  }
},
```
(This preserves Phase-1/2 string bindings like `data-table.bindings.source` — `anyOf` still accepts strings.)

- [ ] **Step 4: CATALOG + STATE_KEYS** — in `validator.py`, add to `CATALOG` (before its closing `}`):
```python
    "esri:map": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": ["layers"],
    },
    "esri:legend": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": [],
    },
    "esri:feature-table": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": ["layer"],
    },
```
and extend `STATE_KEYS`:
```python
    "esri:map": {"selection", "extent"},
    "esri:legend": set(),
    "esri:feature-table": {"selection"},
```

- [ ] **Step 5: Run — expect PASS** (`.venv/bin/pytest tests/plugins/gis_canvas/test_validator.py -v`), then full suite `.venv/bin/pytest tests/plugins/gis_canvas -q`.

- [ ] **Step 6: Commit**
```bash
git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "gis: add esri:map/legend/feature-table to catalog + STATE_KEYS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend — §18.1 per-kind handler schema validation

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json` (handlers `additionalProperties` → per-kind `allOf`/`if/then`)
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Produces: `validate_doc` now rejects a handler missing its kind-required field (`reactive`→`controls`, `set`→`target`+`key`, `agent`→`prompt`, `open`→`overlay`).

- [ ] **Step 1: Failing tests**
```python
def test_reactive_handler_requires_controls(plugin):
    doc = _minimal_doc()
    doc["components"][0]["handlers"] = {"onChange": {"kind": "reactive"}}  # missing controls
    assert any("controls" in e for e in plugin.validator.validate_doc(doc))


def test_agent_handler_requires_prompt(plugin):
    doc = _minimal_doc()
    doc["components"][0]["handlers"] = {"onClick": {"kind": "agent"}}  # missing prompt
    assert any("prompt" in e for e in plugin.validator.validate_doc(doc))


def test_wellformed_reactive_handler_passes(plugin):
    doc = _minimal_doc()
    doc["components"][0]["handlers"] = {"onChange": {"kind": "reactive", "controls": "tbl1.filter.severity"}}
    assert plugin.validator.validate_doc(doc) == []
```

- [ ] **Step 2: Run — expect FAIL** (currently only `kind` required).

- [ ] **Step 3: Schema** — replace the `handlers` property's value-schema in `$defs.componentNode.properties.handlers.additionalProperties` with kind-conditional requirements:
```json
"handlers": {
  "type": "object",
  "additionalProperties": {
    "type": "object",
    "required": ["kind"],
    "properties": {
      "kind": { "enum": ["set", "reactive", "open", "agent"] },
      "target": { "type": "string" }, "key": { "type": "string" }, "value": {},
      "controls": { "type": "string" }, "overlay": { "type": "string" }, "prompt": { "type": "string" }
    },
    "allOf": [
      { "if": { "properties": { "kind": { "const": "reactive" } } }, "then": { "required": ["controls"] } },
      { "if": { "properties": { "kind": { "const": "set" } } },      "then": { "required": ["target", "key"] } },
      { "if": { "properties": { "kind": { "const": "agent" } } },    "then": { "required": ["prompt"] } },
      { "if": { "properties": { "kind": { "const": "open" } } },     "then": { "required": ["overlay"] } }
    ]
  }
}
```

- [ ] **Step 4: Run — expect PASS** (validator file + full plugin suite green).

- [ ] **Step 5: Commit**
```bash
git add plugins/gis-canvas/schema/canvas.schema.json tests/plugins/gis_canvas/test_validator.py
git commit -m "gis: validate handler per-kind required fields (§18.1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Backend — teach `esri:*` + layers in tool descriptions

**Files:**
- Modify: `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`, and add an esri example to `RENDER_VIEW_SCHEMA.description`)
- Test: `tests/plugins/gis_canvas/test_registration.py`

**Interfaces:**
- Produces: `RENDER_VIEW_SCHEMA["description"]` mentions `esri:map`, `esri:legend`, `esri:feature-table`, `layers`, `mock://`, and FeatureServer.

- [ ] **Step 1: Failing test** — append to `test_registration.py`:
```python
def test_tool_descriptions_teach_esri(plugin):
    d = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"]
    for kw in ("esri:map", "esri:legend", "esri:feature-table", "layers", "mock://", "FeatureServer"):
        assert kw in d
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Extend `_CATALOG_HELP`** — append to the existing `_CATALOG_HELP` string in `tools_canvas.py`:
```python
    " (Phase 3 GIS) esri:map (bindings.layers = a layer handle or array of handles; each handle is "
    "either 'mock://<name>' for client-side data or a public ArcGIS FeatureServer URL like "
    "'https://services.arcgis.com/.../FeatureServer/0'; optional props.basemap default 'osm', "
    "props.center [lng,lat], props.zoom; state.selection/extent). esri:legend (bindings.mapRef = the "
    "esri:map component id it describes). esri:feature-table (bindings.layer = a layer handle; "
    "optional bindings.mapRef = an esri:map id to highlight selected rows on that map; state.selection). "
    "Plot geospatial data on esri:map; use esri:feature-table for a spatial table of a layer."
```
Add an esri example to `RENDER_VIEW_SCHEMA.description` (append):
```python
        " GIS example: {id:'map1', type:'esri:map', area:{col:1,colSpan:8,row:2,rowSpan:4}, "
        "props:{basemap:'osm'}, bindings:{layers:['mock://incidents']}} with a companion "
        "{id:'lg1', type:'esri:legend', area:{...}, bindings:{mapRef:'map1'}}."
```

- [ ] **Step 4: Run — expect PASS** (registration file + full plugin suite green).

- [ ] **Step 5: Commit**
```bash
git add plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_registration.py
git commit -m "gis: teach esri:map/legend/feature-table + layer handles in tool descriptions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — ESRI deps, CSS, Calcite→shadcn theming

**Files:**
- Modify: `apps/gis-canvas/package.json` (deps), `apps/gis-canvas/src/index.css` (imports + tokens)
- Test: none (config/CSS); verified by `build` + the Task 9 e2e.

**Interfaces:**
- Produces: ESRI packages installed; `index.css` imports Calcite + map-components CSS and bridges Calcite vars to shadcn tokens.

- [ ] **Step 1: Add deps** to `apps/gis-canvas/package.json` `dependencies`:
```json
    "@arcgis/core": "^4.34.0",
    "@arcgis/map-components": "^4.34.0",
    "@esri/calcite-components": "^3.4.0",
```

- [ ] **Step 2: Install** — from repo root: `npm install`. Record the resolved versions in your report. Expected: succeeds, lockfile updated.

- [ ] **Step 3: CSS imports + token bridge** — prepend to `apps/gis-canvas/src/index.css` (before the existing `@import "tailwindcss";` — Calcite/ESRI CSS first so Tailwind utilities win specificity where they overlap):
```css
@import "@esri/calcite-components/main.css";
@import "@arcgis/map-components/main.css";

/* Calcite → shadcn token bridge (spec §9). Neutral shadcn-ish palette. */
:root {
  --calcite-color-brand: #4f8cff;
  --calcite-color-brand-hover: #3f7ae6;
  --calcite-color-brand-press: #356bd0;
  --calcite-border-radius: 8px;
}
.calcite-mode-dark, :root.dark {
  --calcite-color-brand: #7fb0ff;
  --calcite-color-brand-hover: #6a9ef0;
  --calcite-color-brand-press: #5a8fe0;
}
```

- [ ] **Step 4: Verify build**
Run: `npm run -w @hermes/gis-canvas build`
Expected: typecheck + vite build succeed (ESRI is only imported lazily later, so this just proves deps/CSS resolve). If vite complains about CSS `@import` ordering, keep the ESRI imports at the very top of the file.

- [ ] **Step 5: Commit**
```bash
git add apps/gis-canvas/package.json apps/gis-canvas/src/index.css package-lock.json
git commit -m "gis: add ESRI SDK deps + Calcite CSS + Calcite→shadcn token bridge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — mock geo data + pure graphics/layer helpers

**Files:**
- Modify: `apps/gis-canvas/src/lib/mock-data.ts` (add `lng`/`lat` to incidents; export `PUBLIC_FEATURESERVER`)
- Create: `apps/gis-canvas/src/lib/esri/graphics.ts`, `apps/gis-canvas/src/lib/esri/layers.ts`
- Test: `apps/gis-canvas/src/lib/esri/graphics.test.ts`, `apps/gis-canvas/src/lib/esri/layers.test.ts`

**Interfaces:**
- Produces:
  - `mock-data.ts`: incidents rows gain numeric `lng`,`lat`; `export const PUBLIC_FEATURESERVER = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Major_Cities/FeatureServer/0"` (public sample, keyless).
  - `graphics.ts`: `fieldsFromSchema(schema) → EsriFieldSpec[]`; `graphicsFromMockSource(source) → EsriGraphic[]` (each `{geometry:{type:"point",x:lng,y:lat}, attributes:{...row, __oid:i+1}}`); types `EsriGraphic`, `EsriFieldSpec`.
  - `layers.ts`: `parseLayerRef(ref: string) → {kind:"rows", name:string} | {kind:"service", url:string}`; `buildLayer(ref, esri)` where `esri` is the loaded module bag (`{FeatureLayer}`) — returns a `FeatureLayer` (service: `new esri.FeatureLayer({url})`; rows: client-side from `graphicsFromMockSource`). `layers.ts` imports NO esri package (takes `esri` as a param) so it's unit-testable with a fake.

- [ ] **Step 1: Failing tests** — `graphics.test.ts`:
```ts
import { graphicsFromMockSource, fieldsFromSchema } from './graphics'
import { resolveMockSource } from '../mock-data'

test('builds point graphics with oid + attributes from a geo mock source', () => {
  const g = graphicsFromMockSource(resolveMockSource('mock://incidents')!)
  expect(g.length).toBeGreaterThanOrEqual(8)
  expect(g[0].geometry.type).toBe('point')
  expect(typeof g[0].geometry.x).toBe('number')
  expect(g[0].attributes.__oid).toBe(1)
  expect(g[0].attributes.severity).toBeDefined()
})

test('fieldsFromSchema includes an oid field', () => {
  const f = fieldsFromSchema(resolveMockSource('mock://incidents')!.schema)
  expect(f.find(x => x.type === 'oid')?.name).toBe('__oid')
})
```
`layers.test.ts`:
```ts
import { parseLayerRef, buildLayer } from './layers'

test('parseLayerRef distinguishes rows vs service', () => {
  expect(parseLayerRef('mock://incidents')).toEqual({ kind: 'rows', name: 'incidents' })
  expect(parseLayerRef('https://x/FeatureServer/0')).toEqual({ kind: 'service', url: 'https://x/FeatureServer/0' })
})

test('buildLayer(service) constructs FeatureLayer from url via the injected esri bag', () => {
  const calls: any[] = []
  const esri = { FeatureLayer: class { constructor(o: any) { calls.push(o) } } }
  buildLayer('https://x/FeatureServer/0', esri as any)
  expect(calls[0].url).toBe('https://x/FeatureServer/0')
})

test('buildLayer(rows) constructs a client-side FeatureLayer with source graphics', () => {
  const calls: any[] = []
  const esri = { FeatureLayer: class { constructor(o: any) { calls.push(o) } } }
  buildLayer('mock://incidents', esri as any)
  expect(Array.isArray(calls[0].source)).toBe(true)
  expect(calls[0].objectIdField).toBe('__oid')
  expect(calls[0].geometryType).toBe('point')
})
```

- [ ] **Step 2: Run — expect FAIL** (`npm run -w @hermes/gis-canvas test -- esri/`).

- [ ] **Step 3: Add coords to mock incidents** — in `mock-data.ts`, add `lng`/`lat` to each incidents row and to its schema (as `number`). Use plausible clustered coords, e.g. Downtown ≈ `[-122.676, 45.523]`, Riverside ≈ `[-122.66, 45.50]`, Midtown ≈ `[-122.64, 45.53]` (Portland-ish). Also add:
```ts
export const PUBLIC_FEATURESERVER =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Major_Cities/FeatureServer/0'
```
Add `{ name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }` to the incidents schema and `lng`/`lat` values to every incidents row.

- [ ] **Step 4: Implement `graphics.ts`**
```ts
import type { MockSource, MockField } from '../mock-data'

export interface EsriFieldSpec { name: string; alias: string; type: 'oid' | 'string' | 'double' }
export interface EsriGraphic {
  geometry: { type: 'point'; x: number; y: number }
  attributes: Record<string, string | number>
}

const OID = '__oid'

export function fieldsFromSchema(schema: MockField[]): EsriFieldSpec[] {
  const fields: EsriFieldSpec[] = [{ name: OID, alias: OID, type: 'oid' }]
  for (const f of schema) {
    if (f.name === 'lng' || f.name === 'lat') continue // geometry, not attributes
    fields.push({ name: f.name, alias: f.name, type: f.type === 'number' ? 'double' : 'string' })
  }
  return fields
}

/** Build ESRI-shaped point graphics from a geo mock source (rows with lng/lat). */
export function graphicsFromMockSource(source: MockSource): EsriGraphic[] {
  return source.rows.map((row, i) => {
    const { lng, lat, ...rest } = row as Record<string, string | number>
    return {
      geometry: { type: 'point', x: Number(lng), y: Number(lat) },
      attributes: { [OID]: i + 1, ...rest }
    }
  })
}
```

- [ ] **Step 5: Implement `layers.ts`**
```ts
import { resolveMockSource } from '../mock-data'
import { graphicsFromMockSource, fieldsFromSchema } from './graphics'

export type LayerRef =
  | { kind: 'rows'; name: string }
  | { kind: 'service'; url: string }

export function parseLayerRef(ref: string): LayerRef {
  if (ref.startsWith('mock://')) return { kind: 'rows', name: ref.slice('mock://'.length) }
  return { kind: 'service', url: ref }
}

/** `esri` is the lazily-loaded module bag: { FeatureLayer }. Returns a FeatureLayer instance. */
export function buildLayer(ref: string, esri: { FeatureLayer: new (o: unknown) => unknown }): unknown {
  const parsed = parseLayerRef(ref)
  if (parsed.kind === 'service') {
    return new esri.FeatureLayer({ url: parsed.url })
  }
  const source = resolveMockSource(ref)
  if (!source) throw new Error(`unknown mock source: ${ref}`)
  return new esri.FeatureLayer({
    source: graphicsFromMockSource(source),
    fields: fieldsFromSchema(source.schema),
    objectIdField: '__oid',
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: { type: 'simple-marker', color: '#e0685b', size: 8, outline: { color: '#fff', width: 1 } }
    },
    popupTemplate: { title: 'Incident {__oid}', content: 'Severity: {severity} — {district}' },
    title: parsed.name
  })
}
```

- [ ] **Step 6: Run — expect PASS** (`npm run -w @hermes/gis-canvas test -- esri/`), then full suite + build.

- [ ] **Step 7: Commit**
```bash
git add apps/gis-canvas/src/lib/mock-data.ts apps/gis-canvas/src/lib/esri/graphics.ts apps/gis-canvas/src/lib/esri/graphics.test.ts apps/gis-canvas/src/lib/esri/layers.ts apps/gis-canvas/src/lib/esri/layers.test.ts apps/gis-canvas/src/lib/mock-data.test.ts
git commit -m "gis: mock geo data + pure ESRI graphics/layer builders (both handle kinds)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
> Note: if `mock-data.test.ts` asserts the incidents schema field list, update it to include `lng`/`lat` in the same commit.

---

### Task 6: Frontend — ESRI loader seam + `EsriMapMolecule`

**Files:**
- Create: `apps/gis-canvas/src/lib/esri/loader.ts`, `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`, `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`
- Modify: `apps/gis-canvas/src/lib/types.ts` (add `esri:map` to MOLECULE_TYPES), `apps/gis-canvas/src/components/registry.tsx` (register, lazy)

**Interfaces:**
- Consumes: `buildLayer` (Task 5), `useCanvasActions` (`reportInteraction`).
- Produces: `loadEsri(): Promise<EsriBag>` (dynamic imports `@arcgis/core/config`, `@arcgis/core/layers/FeatureLayer`, `@arcgis/core/core/reactiveUtils`, and side-effect-imports `@arcgis/map-components/components/arcgis-map`); `EsriBag = { esriConfig, FeatureLayer, reactiveUtils }`. `EsriMapMolecule` renders `<arcgis-map id={`esri-map-${node.id}`}>` and on ready adds layers from `bindings.layers`; DOM id `esri-map-<node.id>` (consumed by legend/feature-table). Registered under key `esri:map`.

- [ ] **Step 1: Loader seam** — `loader.ts`:
```ts
export interface EsriBag {
  esriConfig: { apiKey?: string }
  FeatureLayer: new (o: unknown) => unknown
  reactiveUtils: { on: (getter: () => unknown, event: string, cb: (e: unknown) => void) => { remove(): void } }
}

let cached: Promise<EsriBag> | null = null

/** Lazy-load ESRI (multi-MB). Cached so multiple maps share one import. */
export function loadEsri(): Promise<EsriBag> {
  if (cached) return cached
  cached = (async () => {
    await import('@arcgis/map-components/components/arcgis-map')
    await import('@arcgis/map-components/components/arcgis-legend')
    await import('@arcgis/map-components/components/arcgis-feature-table')
    const [{ default: esriConfig }, { default: FeatureLayer }, reactiveUtils] = await Promise.all([
      import('@arcgis/core/config.js'),
      import('@arcgis/core/layers/FeatureLayer.js'),
      import('@arcgis/core/core/reactiveUtils.js')
    ])
    const key = (import.meta.env as Record<string, string | undefined>).VITE_ARCGIS_API_KEY
    if (key) esriConfig.apiKey = key
    return { esriConfig, FeatureLayer, reactiveUtils } as unknown as EsriBag
  })()
  return cached
}
```

- [ ] **Step 2: Failing test** — `EsriMapMolecule.test.tsx` (loader mocked; asserts our wiring, not real rendering):
```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'

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
```

- [ ] **Step 3: Run — expect FAIL** (no module).

- [ ] **Step 4: Implement `EsriMapMolecule.tsx`**
```tsx
import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer } from '../../lib/esri/layers'
import { useCanvasActions } from '../HandlerContext'
import type { MoleculeProps } from '../registry'

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  return typeof v === 'string' ? [v] : []
}

export function EsriMapMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const ref = useRef<HTMLElement | null>(null)
  const layerRefs = asArray(node.bindings?.layers)
  const props = (node.props ?? {}) as { basemap?: string; center?: [number, number]; zoom?: number }
  const basemap = props.basemap ?? 'osm'

  useEffect(() => {
    let cancelled = false
    let clickHandle: { remove(): void } | null = null
    const el = ref.current as (HTMLElement & Record<string, any>) | null
    if (!el) return

    const onReady = async () => {
      const esri = await loadEsri()
      if (cancelled) return
      const view = el.view
      for (const r of layerRefs) {
        try { view.map.add(buildLayer(r, esri)) } catch (e) { console.error('layer build failed', r, e) }
      }
      // selection: click → hitTest → write objectIds to state.selection (reactive interaction)
      clickHandle = esri.reactiveUtils.on(() => el, 'arcgisViewClick', async (event: any) => {
        const hit = await el.hitTest(event)
        const ids = (hit?.results ?? [])
          .map((r: any) => r?.graphic?.attributes?.__oid ?? r?.graphic?.getObjectId?.())
          .filter((x: unknown) => x != null)
        actions.reportInteraction(node.id, { selection: ids })
      })
    }

    el.addEventListener('arcgisViewReadyChange', onReady)
    return () => {
      cancelled = true
      el.removeEventListener('arcgisViewReadyChange', onReady)
      clickHandle?.remove()
    }
    // node.id/layers are stable for a given rendered node; actions is stable (useMemo in App)
  }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const center = props.center ? `${props.center[0]}, ${props.center[1]}` : undefined
  return (
    // @ts-expect-error — arcgis-map is a custom element (typed loosely for React)
    <arcgis-map
      ref={ref}
      id={`esri-map-${node.id}`}
      basemap={basemap}
      {...(center ? { center } : {})}
      {...(props.zoom != null ? { zoom: String(props.zoom) } : {})}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}
```
> Note on the loader race: in production `arcgisViewReadyChange` fires only after the `arcgis-map` custom element is defined, which requires `loadEsri()` to have run. Register the molecule so it triggers `loadEsri()` on mount even before ready — add, at the top of the effect (before `addEventListener`): `void loadEsri()`. (The test dispatches the event manually, so it also exercises the handler path.)

- [ ] **Step 5: types + registry** — `types.ts`: add `'esri:map'` (and `'esri:legend'`, `'esri:feature-table'` for Task 7) to `MOLECULE_TYPES`. `registry.tsx`: register lazily so ESRI isn't in the main bundle:
```tsx
import { lazy, Suspense } from 'react'
const EsriMapLazy = lazy(() => import('./molecules/EsriMapMolecule').then(m => ({ default: m.EsriMapMolecule })))
function EsriMap(props: MoleculeProps) {
  return <Suspense fallback={<div className="p-2 text-xs text-neutral-400">Loading map…</div>}><EsriMapLazy {...props} /></Suspense>
}
```
and add `'esri:map': EsriMap` to `COMPONENT_REGISTRY`.

- [ ] **Step 6: Run — expect PASS** (`npm run -w @hermes/gis-canvas test -- EsriMap`), then full suite + build. If the custom-element JSX trips strict TS beyond the single `@ts-expect-error`, add a minimal ambient declaration in `src/vite-env.d.ts` for `arcgis-map`/`arcgis-legend`/`arcgis-feature-table` as `any` intrinsic elements rather than sprinkling ignores.

- [ ] **Step 7: Commit**
```bash
git add apps/gis-canvas/src/lib/esri/loader.ts apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx apps/gis-canvas/src/lib/types.ts apps/gis-canvas/src/components/registry.tsx apps/gis-canvas/src/vite-env.d.ts
git commit -m "gis: EsriMapMolecule (lazy ESRI, layers from both handle kinds, click→selection)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend — `EsriLegendMolecule` + `EsriFeatureTableMolecule`

**Files:**
- Create: `EsriLegendMolecule.tsx`, `EsriFeatureTableMolecule.tsx` (+ a shared light test `EsriWidgets.test.tsx`)
- Modify: `registry.tsx` (register both, lazy)

**Interfaces:**
- Produces: `esri:legend` renders `<arcgis-legend reference-element="#esri-map-<mapRef>">`; `esri:feature-table` renders `<arcgis-feature-table reference-element="#esri-map-<mapRef>">` and sets its `.layer` from `bindings.layer` after `loadEsri()`. Both registered lazily.

- [ ] **Step 1: Failing test** — `EsriWidgets.test.tsx`:
```tsx
import { render } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../lib/esri/loader', () => ({ loadEsri: async () => ({ esriConfig: {}, FeatureLayer: class {}, reactiveUtils: { on: () => ({ remove() {} }) } }) }))
vi.mock('../../lib/esri/layers', () => ({ parseLayerRef: (r: string) => ({ kind: 'rows', name: r }), buildLayer: (r: string) => ({ r }) }))
import { EsriLegendMolecule } from './EsriLegendMolecule'
import type { ComponentNode } from '../../lib/types'

test('legend points its reference-element at the mapRef map', () => {
  const node: ComponentNode = { id: 'lg1', type: 'esri:legend', bindings: { mapRef: 'map1' } }
  const { container } = render(<EsriLegendMolecule node={node} renderChild={() => null} />)
  expect(container.querySelector('arcgis-legend')?.getAttribute('reference-element')).toBe('#esri-map-map1')
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `EsriLegendMolecule.tsx`**
```tsx
import type { MoleculeProps } from '../registry'

export function EsriLegendMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  return (
    // @ts-expect-error custom element
    <arcgis-legend {...(ref ? { 'reference-element': ref } : {})} style={{ display: 'block', width: '100%', height: '100%' }} />
  )
}
```

- [ ] **Step 4: Implement `EsriFeatureTableMolecule.tsx`**
```tsx
import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer } from '../../lib/esri/layers'
import { useCanvasActions } from '../HandlerContext'
import type { MoleculeProps } from '../registry'

export function EsriFeatureTableMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const ref = useRef<HTMLElement | null>(null)
  const layerHandle = node.bindings?.layer as string | undefined
  const mapRef = node.bindings?.mapRef as string | undefined

  useEffect(() => {
    let cancelled = false
    const el = ref.current as (HTMLElement & Record<string, any>) | null
    if (!el || !layerHandle) return
    ;(async () => {
      const esri = await loadEsri()
      if (cancelled) return
      try { el.layer = buildLayer(layerHandle, esri) } catch (e) { console.error('feature-table layer failed', e) }
    })()
    const onSel = (e: any) => {
      const ids = (e?.detail?.added ?? []).map((f: any) => f?.attributes?.__oid ?? f?.getObjectId?.()).filter((x: unknown) => x != null)
      if (ids.length) actions.reportInteraction(node.id, { selection: ids })
    }
    el.addEventListener('arcgisSelectionChange', onSel)
    return () => { cancelled = true; el.removeEventListener('arcgisSelectionChange', onSel) }
  }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refEl = mapRef ? `#esri-map-${mapRef}` : undefined
  return (
    // @ts-expect-error custom element
    <arcgis-feature-table ref={ref} {...(refEl ? { 'reference-element': refEl } : {})} style={{ display: 'block', width: '100%', height: '100%' }} />
  )
}
```

- [ ] **Step 5: Register (lazy) in `registry.tsx`** — same `lazy`+`Suspense` pattern as Task 6 for `esri:legend` and `esri:feature-table`; add both to `COMPONENT_REGISTRY`.

- [ ] **Step 6: Run — expect PASS** (test file + full suite + build).

- [ ] **Step 7: Commit**
```bash
git add apps/gis-canvas/src/components/molecules/EsriLegendMolecule.tsx apps/gis-canvas/src/components/molecules/EsriFeatureTableMolecule.tsx apps/gis-canvas/src/components/molecules/EsriWidgets.test.tsx apps/gis-canvas/src/components/registry.tsx
git commit -m "gis: EsriLegend + EsriFeatureTable molecules (map-linked via reference-element)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — §18.2/§18.3/§18.4 polish

**Files:**
- Modify: `apps/gis-canvas/src/lib/handlers.ts` (§18.2 `open` reserved), `apps/gis-canvas/src/lib/use-canvas-doc.ts` + `apps/gis-canvas/src/App.tsx` (§18.3 rev-divergence comment), `apps/gis-canvas/src/lib/merge.ts` (§18.4 shared-state comment)
- Test: `apps/gis-canvas/src/lib/handlers.test.ts` (add an `open` case)

**Interfaces:**
- Produces: `runHandler` handles `open` explicitly (no-op with a clear reserved comment until Phase overlays land) rather than falling through; clarifying comments added at the three sites.

- [ ] **Step 1: Failing test** — append to `handlers.test.ts`:
```ts
test('open handler is a safe no-op (reserved for overlays) and does not touch actions', () => {
  const calls: string[] = []
  const actions = {
    setLocalState: () => calls.push('local'),
    reportInteraction: () => calls.push('report'),
    sendPrompt: () => calls.push('prompt')
  }
  runHandler({ kind: 'open', overlay: 'dlg1' } as any, node, actions as any, { value: undefined })
  expect(calls).toEqual([])
})
```
(If `node` isn't in scope in that test file, reuse the existing `node` fixture defined at the top of `handlers.test.ts`.)

- [ ] **Step 2: Run — expect FAIL or a TS error** (the `Handler` union has no `open` member).

- [ ] **Step 3: Implement** — in `types.ts` add the `open` member to the `Handler` union: `| { kind: 'open'; overlay: string }`. In `handlers.ts` add an explicit case to the `switch`:
```ts
    case 'open':
      // Reserved for the overlay layer (Phase 3+ overlays). No runtime effect yet;
      // schema permits it (validated to require `overlay`). Implement when overlays land.
      return
```
§18.3 comment — add at `use-canvas-doc.ts` (where `doc` updates only on `tool.complete`) and at `App.tsx`'s `useEffect(() => { setOverrides({}) }, [doc?.rev])`:
```ts
// NOTE: client doc.rev advances only on agent tool.complete renders, NOT on canvas.interaction
// (interactions bump the SERVER rev but emit no event). This is intentional: the override-reset
// below keys on doc.rev so optimistic interaction overlays survive until a real agent re-render.
```
§18.4 comment — at `merge.ts` `const next = { ...node }`:
```ts
// Shallow spread: an un-overridden node shares the server doc's `state` object by reference.
// Safe today (nothing mutates node.state in place). If a molecule ever does, clone state here.
```

- [ ] **Step 4: Run — expect PASS** (handlers test + full suite + build).

- [ ] **Step 5: Commit**
```bash
git add apps/gis-canvas/src/lib/handlers.ts apps/gis-canvas/src/lib/types.ts apps/gis-canvas/src/lib/handlers.test.ts apps/gis-canvas/src/lib/use-canvas-doc.ts apps/gis-canvas/src/App.tsx apps/gis-canvas/src/lib/merge.ts
git commit -m "gis: §18 polish — open handler reserved + rev-divergence/merge comments

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Live e2e (browser) + docs

**Files:**
- Modify: `apps/gis-canvas/README.md`, `plugins/gis-canvas/README.md` (Phase 3 status)
- No code (fixes discovered here belong to the owning task's file)

- [ ] **Step 1: Full offline verification**
Run: `.venv/bin/pytest tests/plugins/gis_canvas -q` (all green) and `npm run -w @hermes/gis-canvas test && npm run -w @hermes/gis-canvas build` (all green; build includes the ESRI lazy chunk).

- [ ] **Step 2: Restart the gateway** (plugin Python changed — schema/catalog/tool-desc):
```bash
kill "$(lsof -tiTCP:9119 -sTCP:LISTEN)" 2>/dev/null
HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119 &
```
Wait for `HERMES_DASHBOARD_READY`. `hermes plugins list` shows `gis-canvas` enabled.

- [ ] **Step 3: Start the frontend**
```bash
cd apps/gis-canvas && VITE_HERMES_TOKEN=dev-gis-local npx vite --port 5174 --host 127.0.0.1 &
```
(No `VITE_ARCGIS_API_KEY` → keyless OSM basemap.)

- [ ] **Step 4: Browser test (Playwright, reuse the Phase-2 harness pattern in the scratchpad).** Script: load app → wait `● connected` → prompt: `Plot the incidents on a map (esri:map bound to mock://incidents) with a legend, and add a feature-table for the same layer.` → wait for an `arcgis-map` element to appear and for its `.view` to be ready (poll `document.querySelector('arcgis-map')?.view` truthy, up to 120s — the ESRI chunk downloads on first load) → assert an `arcgis-map` and `arcgis-legend` are present, and the map canvas (`canvas` element inside `arcgis-map`) exists. Then a second prompt exercising the service path: `Add a layer from https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Major_Cities/FeatureServer/0 to the map.` → assert no console errors and the map still renders. Screenshot `scratchpad/phase3-map.png`.
Expected: map renders with OSM basemap + incident points; legend shows; no console errors. (Selection→awareness is covered by the Phase-2 mechanism and the pure-helper tests; a click-hitTest assertion in headless WebGL is flaky, so verify selection manually / via the doc file if desired: after a map click, `~/.hermes/gis_canvas/<stored_session_id>.json` shows `map1.state.selection`.)
Troubleshooting: if the map is blank, check the browser console for CSP/asset errors — ensure `@arcgis/map-components/main.css` + `@esri/calcite-components/main.css` are imported (Task 4) and that no CSP meta blocks `https://basemaps.arcgis.com` / `https://*.openstreetmap.org` / workers/wasm. For vite dev this is open by default.

- [ ] **Step 5: Update READMEs** — set status to "Phase 3 (ESRI GIS layer) implemented" in both; note keyless-OSM default + optional `VITE_ARCGIS_API_KEY`, and the new `esri:map`/`esri:legend`/`esri:feature-table` catalog entries.

- [ ] **Step 6: Commit + push**
```bash
git add apps/gis-canvas/README.md plugins/gis-canvas/README.md
git commit -m "gis: Phase 3 complete — ESRI map/legend/feature-table verified live

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin gis/main
```

---

## Out of scope for Phase 3 (later)

- Data broker / `DataSource` / `canvas.data_fetch` / real A2A Enterprise Data Agent (Phase 4) — Phase 3 uses mock geo rows + a public sample FeatureServer only.
- Overlays layer (dialog/sheet/popover) + the `open` handler runtime (reserved this phase).
- 3D `SceneView`, editing, advanced spatial analysis, drawing/sketch.
- Premium basemap polish / enterprise auth token proxying (only the optional `VITE_ARCGIS_API_KEY` passthrough is wired now).
