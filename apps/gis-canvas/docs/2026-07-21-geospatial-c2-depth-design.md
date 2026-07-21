# Geospatial C2 Depth — Sub-project 3 (Cluster D)

**Date:** 2026-07-21
**Status:** Design approved, pending spec review
**Scope:** `apps/gis-canvas` (frontend) + `plugins/gis-canvas` (agent-facing tools/validation)
**Program:** C2/Gotham molecule-registry program, sub-project 3 of 3. Builds on the
shipped Foundation (`gis/main` @ `de6017ca7`): registry-extension convention,
gc-/Calcite theming, `tabs` molecule.

## Context

Cluster D deepens the existing ESRI map with Palantir-Gaia-style Command-and-Control
capabilities. The current geospatial surface:

- **`esri:map`** renders `<arcgis-map>`; on view-ready it builds layers from
  `bindings.layers` (`data://` handle → `fetchData` → client-side `FeatureLayer`
  with point geometry synthesized from lng/lat; `mock://`; or a service URL).
  Map **click = linked selection** (hitTest → `__oid` → shared row key via
  `keyByOid`/`idField`); reacts to shared selection with highlight + `goTo`.
  Popup disabled.
- **`esri:legend`** — separate molecule referencing the map via `bindings.mapRef`
  → `<arcgis-legend reference-element="#esri-map-<id>">`. The established pattern
  for a map-attached control.
- **`esri:feature-table`** — rendered as a `data-table` over the layer handle
  (the native ESRI feature-table pulls the Vaadin/Polymer subtree Vite mis-bundles).
- `loadEsri()` lazy-loads `arcgis-map` + `arcgis-legend` web components + core
  (`FeatureLayer`, `esriConfig`, `reactiveUtils`). Theming = Calcite CSS vars +
  `calcite-mode-dark`. Data plane = client-side rows + `SelectionContext` keyed by
  the `data://` handle.

### Decisions taken during brainstorming

- **Scope (of five candidate capabilities):** sketch-driven spatial filter
  (flagship) + `layer-list` + basemap toggle + heatmap. **Time-slider deferred**
  (it needs time-aware-layer / `timeInfo` plumbing).
- **Attach model — mixed:** `layer-list` is a separate dockable molecule
  (`esri:layer-list{mapRef}`, extends the legend pattern); sketch + basemap toggle
  + heatmap are **props/behaviors on `esri:map`** (they operate on its own
  view/layer, keeping the interaction loop local).
- **Draw behavior:** the drawn geofence/radius/polygon is a **bulk spatial
  SELECTION** written into the existing `SelectionContext` (client-side, no agent
  turn) — matches "who's within 5km", highlights on the map AND any linked table.

## Goals

Add four geospatial C2 capabilities:

1. **Spatial filter (flagship):** draw a geofence/radius/polygon → select all of the
   map layer's features inside → linked selection highlights them on the map and in
   any bound `data-table`/molecule.
2. **`esri:layer-list`** molecule — per-layer visibility control, dockable.
3. **Basemap toggle** — in-view map/imagery switch.
4. **Heatmap** — density-surface renderer for the map's primary rows-layer.

**Non-goals:** time-slider (deferred); server-side spatial query against Denodo
(a future agent-handoff — the filter operates on the loaded client page, ≤5000 rows);
sketch editing/measurement workflows beyond geofence drawing.

**Success criteria:**

1. Drawing a geofence selects the contained features; they highlight on the map and
   in a linked `data-table`. Clearing the fence clears that selection.
2. `esri:layer-list` renders against a referenced map and toggles layer visibility.
3. `props.basemapToggle` switches basemaps; `props.render:'heatmap'` renders a
   density surface.
4. The agent reliably authors these (documented + worked example in `_CATALOG_HELP`).
5. `tsc --noEmit` + full FE suite + Python plugin suite stay green, with new tests
   covering the pure spatial-select logic, the sketch wiring, the layer-list
   molecule, the basemap-toggle child, the heatmap renderer, and validator acceptance.

---

## Section 1 — Surface + the flagship spatial-filter interaction

### Surface (mixed model)

- **`esri:map` new props** (freeform props object — no schema change):
  - `spatialFilter: boolean` — enable draw tools + spatial-selection behavior.
  - `basemapToggle: boolean` (+ optional `basemapAlt: string`, default `'satellite'`).
  - `render: 'points' | 'heatmap'` (default `'points'`).
- **New molecule `esri:layer-list`** — `bindings.mapRef` → `<arcgis-layer-list
  reference-element="#esri-map-<id>">`, framed by `EsriFrame`, dockable like `esri:legend`.

### Flagship: sketch → spatial selection

When `props.spatialFilter` is set, `EsriMapMolecule` renders a sketch child of the map:
```html
<arcgis-sketch slot="top-right" creation-mode="single"> <!-- geofence tools only -->
```
configured to expose the geofence create tools (rectangle, circle, polygon) and hide
point/polyline + selection/lasso tools. On sketch **create-complete**:

1. Read the drawn `geometry`. **Project it to geographic (WGS84)** via
   `webMercatorUtils.webMercatorToGeographic` so it shares the SR of the rows-layer
   points (see Risks — the view draws in Web Mercator, the rows are 4326). For a
   circle/radius, the drawn circle is already a geometry; if a center+radius path is
   used, `geometryEngine.geodesicBuffer` produces the polygon.
2. Run the **pure** `containedKeys(rows, idField, predicate)` over the map's loaded
   rows, where `predicate = (lng, lat) => geometryEngine.contains(geoGeometry,
   point(lng, lat))`. The ESRI-specific point-build + `contains` call is a thin
   adapter; the containment loop is a pure, ESRI-free module for unit testing.
3. Write the matched row keys into `SelectionContext` (**replace**, not add) via the
   map's existing `useLinkedSelection(source)` setter → the existing selection effect
   highlights them and `goTo`s; any linked `data-table` bound to the same `data://`
   source highlights the same rows. No agent turn.

The **drawn fence stays visible** on the sketch layer. Starting a new draw (or the
sketch delete tool) clears the prior fence; when the fence is cleared with no active
selection source, the shared selection for that source is reset. A geofence is
mechanically just a bulk multi-select, reusing the entire map-click selection path.

**Why local to the map:** `esri:map` owns the view, the loaded rows, `keyByOid`/
`idField`, and the selection write, so sketch→query→select needs no cross-molecule
ref reaching.

---

## Section 2 — layer-list molecule, basemap toggle, heatmap

### `esri:layer-list` (new molecule)

Mirrors `esri:legend`:
```tsx
export function EsriLayerListMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  return (
    <EsriFrame title="Layers">
      {/* @ts-expect-error custom element */}
      <arcgis-layer-list {...(ref ? { 'reference-element': ref } : {})}
        style={{ display: 'block', width: '100%', height: '100%' }} />
    </EsriFrame>
  )
}
```
Auto-populates from the referenced map's layers with visibility toggles. No data
binding, no own state. Web-component import added to `loadEsri()`. Dockable
(agent docks `edge:'right'` like the legend).

### Basemap toggle (`props.basemapToggle`)

`esri:map` renders a slotted child when set:
```html
<arcgis-basemap-toggle slot="bottom-right" next-basemap={props.basemapAlt ?? 'satellite'} />
```
Flips between `props.basemap` (default `osm`) and the alternate. No new molecule/state.

### Heatmap (`props.render`)

A renderer swap, not a widget. `buildRowsLayer` gains an optional `render` arg; when
`'heatmap'` it builds a `HeatmapRenderer` (`@arcgis/core/renderers/HeatmapRenderer.js`,
added to the loader) on an accent-tuned color ramp instead of the simple marker.
Applies to the primary `data://`/`mock://` rows-layer only (service-URL layers keep
their own renderer). Click-selection and sketch spatial-selection still work.

### Theming

Free — all are Calcite web components covered by `calcite-mode-dark` + Calcite CSS
vars; `EsriFrame` wraps the layer-list in gc- chrome exactly like the legend.

---

## Section 3 — Loader, registry wiring, testing, agent guidance

### Loader additions (`loadEsri`)

Import the `arcgis-layer-list`, `arcgis-sketch`, `arcgis-basemap-toggle` web
components; add to the core bag: `HeatmapRenderer`, `geometryEngine`,
`webMercatorUtils`. None pull the Vaadin/Polymer chain; feature-table stays
separately lazy-loaded.

### Registry-extension (the Foundation convention) — `esri:layer-list`

5-place sync: `schema/canvas.schema.json` `type` enum, `src/lib/types.ts`
`MOLECULE_TYPES`, `plugins/gis-canvas/validator.py` `CATALOG`
(`container:false`, `slots:set()`, `required_props:[]`, `required_bindings:[]` —
`mapRef` recommended, degrades gracefully like `esri:legend`; no `STATE_KEYS`
entry), `src/components/registry.tsx` (lazy-wrapped like the other ESRI molecules),
and `tools_canvas.py` `_CATALOG_HELP`. The new `esri:map` props need **no** schema
change (freeform props) and **no** new `STATE_KEYS` (spatial selection writes the
same shared selection as click).

### Testing (mock `loadEsri`/`layers`, test wiring + pure logic)

- **`containedKeys(rows, idField, predicate)`** — pure module, unit-tested with a
  plain predicate (e.g. `lng > 0`). The heart of the spatial filter.
- **SR projection** — a test asserting a known lng/lat falls inside a known drawn box
  after the Web-Mercator→geographic projection step (guards the zero-match gotcha).
- **Sketch wiring** — simulate the sketch create-complete event with a fake
  `geometryEngine.contains` → assert matched keys land in `SelectionContext`.
- **`esri:layer-list`** — renders `<arcgis-layer-list>` with the right
  `reference-element` + `EsriFrame` title (mirror the legend test).
- **basemap toggle** — `esri:map` renders `<arcgis-basemap-toggle next-basemap=…>`
  when `props.basemapToggle`.
- **heatmap** — `buildRowsLayer(..., render:'heatmap')` builds a `HeatmapRenderer`
  (assert via a fake esri bag).
- **Validator** — an `esri:layer-list` doc passes.

### Agent guidance (`_CATALOG_HELP`) — apply the Foundation lesson

Document `esri:layer-list` + the new `esri:map` props **and add a worked C2 example**
(a base map with `spatialFilter:true, basemapToggle:true`, an `esri:layer-list`
docked right, legend + table docks). Examples drive agent selection far more than
prose — the lesson from the `tabs` sub-project.

---

## Risks & mitigations

- **Spatial-reference mismatch (the real gotcha):** rows-layer is WGS84 (4326), the
  view/sketch draws in Web Mercator (3857). `geometryEngine.contains` needs a common
  SR, so the design projects the drawn geometry to geographic
  (`webMercatorUtils.webMercatorToGeographic`) before containment; otherwise every
  geofence returns zero matches. First-class implementation step + a dedicated test.
- **Radius:** circle draws as a true geometry; `geodesicBuffer` available if a
  center+radius path is needed. Rectangle/polygon are polygons directly.
- **Client-page bound:** the filter operates on the loaded rows (≤5000). A true
  server-side spatial query (agent-handoff to Denodo) is deferred, stated out of scope.
- **ESRI-in-jsdom untestability:** mitigated by mocking `loadEsri` and extracting the
  pure `containedKeys` logic, exactly as the existing `EsriMapMolecule.test` does.
- **Sketch tool set:** configure the sketch to expose only geofence create tools
  (rectangle/circle/polygon), hiding point/polyline/lasso/selection tools.

## Out of scope / follow-ups

- **Time-slider** (cluster D's fifth capability) — needs a date-field →
  `timeInfo` step to make client rows time-aware; its own follow-up spec.
- Server-side spatial query (agent-handoff) for datasets larger than the loaded page.
- This completes the C2/Gotham program's cluster D; clusters 1 (ontology-lite +
  `entity-detail`) and 2 (charts/timeline/KPI) remain as separate sub-projects.
