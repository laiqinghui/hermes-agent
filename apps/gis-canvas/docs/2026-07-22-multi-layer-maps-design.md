# Multi-Layer Maps — SP3b (Geospatial C2 follow-up)

**Date:** 2026-07-22
**Status:** Design approved, pending spec review
**Scope:** `apps/gis-canvas` (frontend) + `plugins/gis-canvas` (agent catalog text only)
**Program:** Geospatial C2 depth follow-up. Builds on sub-project 3 (`gis/main` @ `68fc27ea1`):
`esri:map` with `spatialFilter`/`basemapToggle`/`render`, the `esri:layer-list` molecule,
`containedKeys`, and the linked-selection data plane.

## Context & root cause

Live-verify surfaced that a map with several `bindings.layers` renders them all identically —
same title, same red dot — so a legend or the shipped `esri:layer-list` can't name, color,
distinguish, or toggle them (e.g. 3 day-specific AIS layers look like one).

Investigating revealed a deeper root cause: the map's layer-building effect is keyed on
`[node.id]` and **only adds layers, never clears** ([EsriMapMolecule.tsx:44-84]). The map
renders via `<Molecule key={node.id}>` ([CanvasGrid.tsx:9]). So when the agent re-renders with
the **same map id** but different `bindings.layers`, the effect does not re-run — the new
layers are never built — while the *title* (a plain React prop) updates. That is exactly the
observed symptom: the header showed a new "AIS trail" title, but the legend/map still showed
the previous "Latest 20 AIS Positions" layer, and the "3 day-specific layers" the agent
reported adding were never actually built.

So the stale legend is not a legend bug — it is the map failing to rebuild its layers.

### Decisions taken during brainstorming

- **Per-layer metadata API:** `props.layers: [{title, color?}]`, positional to `bindings.layers`;
  colors **auto-assigned** (distinct) when omitted. Handles stay in `bindings.layers` (the data
  plane requires it — `validator.py` `required_bindings: ["layers"]`, and nothing reads the
  handles server-side).
- **Selection scope:** **union across all layers** — the geofence + map-click select across
  every `data://` layer, each writing to its own selection source so linked tables highlight
  per-layer.
- **Headline fix:** layer-freshness (rebuild layers when the set changes), alongside per-layer
  title/color and union selection.

## Goals

1. **Layer freshness:** the map rebuilds its layers when the layer set changes (clear old, add
   new) — not only on first mount — so same-id rev changes render correctly and the
   legend/`esri:layer-list` reflect the current layers.
2. **Per-layer title + color:** name and color each layer (auto-color when unspecified) so
   multiple layers are distinguishable and a legend/layer-list is meaningful.
3. **Multi-layer union selection:** the geofence and map-click select across all `data://`
   layers; each layer's linked `data-table` highlights its own contained rows.
4. **Agent guidance:** author `props.layers` + an `esri:layer-list` for multi-layer maps
   (worked example).

**Non-goals:** time-slider (still deferred); server-side spatial query; the deferred
"Select by rectangle/lasso" custom toolbar (SP3's transient-shape fix stands); recoloring
existing ESRI symbols on a live theme toggle (layers recolor on rev rebuild, not on toggle).

**Success criteria:**

1. Re-rendering a map (same id) with a different/expanded layer set rebuilds cleanly — no stale
   or accumulated layers; the legend/layer-list reflect the current layers.
2. Multiple layers show distinct auto-assigned colors and their `props.layers[i].title` names.
3. Drawing a geofence selects contained points across all data layers; each layer's linked
   table highlights accordingly.
4. `tsc --noEmit` + FE suite + Python plugin suite stay green, with new tests for color
   resolution, per-layer color in `buildRowsLayer`, layer-rebuild-on-change, and union selection.

---

## Section 1 — Layer model + auto-color

- `bindings.layers: string[]` unchanged (the layer handles).
- New `props.layers?: Array<{ title?: string; color?: string }>`, positional to `bindings.layers[i]`.
- Per layer *i*:
  - **title** = `props.layers[i]?.title ?? props.title ?? handle` (today's fallback preserved).
  - **color** = `props.layers[i]?.color ?? resolveLayerColor(i)`.
- **`resolveLayerColor(i)`** (new, `lib/esri/layer-color.ts`): maps index → a distinct color.
  Reads `--color-cat-((i mod 6)+1)` from `getComputedStyle(document.documentElement)`; when that
  is empty (jsdom, or an uncomputed style) it **falls back to a fixed 6-hex palette** so ESRI
  always receives a concrete color. Sequential-by-index (not title-hash) guarantees the first 6
  layers are visually distinct.
- **`buildRowsLayer(source, esri, title?, render?, color?)`** — the new `color` sets the
  simple-marker fill (default `#e0685b` when absent). Heatmap render mode is unaffected (density
  surface; primary layer only).

---

## Section 2 — Freshness: rebuild layers when the set changes

Today a single `[node.id]`-keyed effect fires once on `arcgisViewReadyChange` and only adds.
Split the concerns:

- **View-ready effect** (keyed `[node.id]`): sets a `ready` state when `arcgisViewReadyChange`
  fires (once).
- **Layer-build effect** (keyed `[ready, layersSig]`, where
  `layersSig = JSON.stringify({layers: layerRefs, meta: props.layers, render})`): when `ready`,
  it (a) removes the previously-added layers, tracked in `addedLayersRef`, via
  `view.map.removeMany`; (b) resets `dataRef`/`layersRef`/`mapCtx`; (c) rebuilds the current set
  (fetching each `data://` layer, applying per-layer title/color). The existing `cancelled` guard
  drops stale async writes when a rapid rev change supersedes an in-flight build; teardown removes
  listeners.

Basemap/center/zoom stay as `<arcgis-map>` attributes (React props) — they update without a
rebuild; only the layer set triggers a rebuild. The `arcgis-legend`/`esri:layer-list` reactively
reflect the map's current layers, so this fixes the stale-legend symptom at its root.

---

## Section 3 — Multi-layer union selection

Refactor the map's selection internals from single-source to per-layer.

**Layer contexts.** The rebuild effect populates `layersRef.current: LayerCtx[]`, one per
`data://` layer: `{ source, rows, idField, lngField, latField, layer, keyByOid }`. (Today only
the first handle became the source.) Each layer's handle is its own `SelectionContext` source, so
a `data-table` bound to any of them highlights independently — existing machinery.

**`SelectionContext` additions** (`SelectionContext.tsx`):
- `useSelectionActions()` → the raw `{ get(source), set(source, ids) }` for reading/writing
  arbitrary sources.
- `useSelectionState()` → the full `Record<source, string[]>` so the map re-highlights when any
  source's selection changes.

**Geofence (union).** On `arcgisCreate` complete: project the geometry once, then for each
`LayerCtx` run `containedKeys(ctx.rows, ctx.idField, ctx.lngField, ctx.latField, predicate)` and
`actions.set(ctx.source, keys)`. The drawn shape is removed (transient, unchanged from SP3).

**Map-click (union).** `hitTest` includes all data layers; for the hit graphic find its
`LayerCtx` (`graphic.layer === ctx.layer`), map `__oid → key` via that layer's `keyByOid`, and
toggle in that layer's source.

**Highlight reaction (multi-layer).** One effect keyed `[ready, selectionState]` iterates
`layersRef`: for each layer, query it for the features matching `selectionState[ctx.source]`,
`highlight()` on its layerView, and accumulate the union for one `goTo`. Highlight handles are
tracked in an array and torn down on each re-run. The "N selected" overlay shows the union total.

**Scope guard:** only `data://` layers (with fetched rows) are selectable sources; service-URL /
`mock://` layers are not, consistent with today. The 1-layer case behaves exactly as today.

---

## Section 4 — Agent guidance, backend, testing, risks

**Agent guidance (`_CATALOG_HELP`).** Document `props.layers: [{title, color?}]` (positional to
`bindings.layers`; color optional/auto) and add a nudge + worked example: for multiple layers,
name each via `props.layers` **and** author an `esri:layer-list` (not just a legend).

**Backend.** No schema or validator change (`props.layers` is under the freeform `props`;
`bindings.layers` unchanged). Backend touch = `_CATALOG_HELP` text only.

**Testing** (ESRI mocked; fakes for the view where needed):
- `resolveLayerColor(i)` — returns a non-empty color, wraps at 6, distinct for 0–5 (exercises the
  fallback palette under jsdom).
- `buildRowsLayer(color)` — extend `layers.test.ts`: a passed color sets the marker symbol color.
- **Freshness** — map test with a fake `el.view = { map: { add, removeMany } }`: render with
  layers A → ready → re-render with layers B → assert `removeMany` called with the old layers and
  B added (rebuild-on-change, no accumulation).
- **Union selection** — map with two `data://` layers in a `SelectionProvider`; fake
  `geometryEngine.contains`; dispatch `arcgisCreate` → assert both sources receive their contained
  keys (the selection write needs no live view).
- Existing single-layer tests stay green.

**Risks & mitigations:**
- **`getComputedStyle` can't resolve CSS vars in jsdom / uncomputed styles** → the fixed fallback
  hex palette; in a browser the themed token resolves. Theme toggle after build won't recolor
  existing ESRI symbols (they rebuild on rev) — acceptable.
- **Multi-layer hitTest/highlight** complexity → the refactor keeps 1-layer as the base case;
  full multi-layer highlight confirmed at live-verify (jsdom has no real view).
- **Per-layer fetch** (each `data://` layer, ≤5000 rows) — already today's behavior.
- **Rebuild races / listener leaks** → the `cancelled` guard drops superseded builds; teardown
  removes listeners and clears tracked layers.

## Out of scope / follow-ups

- Time-slider; server-side spatial query; the custom "Select by rectangle/lasso" toolbar.
- Live theme-toggle recolor of existing ESRI layer symbols.
- This completes the geospatial (cluster D) line for now; the remaining C2 program sub-projects
  are 1 (ontology-lite + `entity-detail`) and 2 (charts/timeline/KPI).
