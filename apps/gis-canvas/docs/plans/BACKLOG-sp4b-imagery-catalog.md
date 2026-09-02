# BACKLOG — SP4b: imagery catalog, toggling, and time filtering

Follow-on to SP4a (`apps/gis-canvas/docs/2026-09-01-cog-imagery-design.md`, merged
`fd20a4ca8`). SP4a shipped the half the agent controls: a top-level `imagery` block, scenes
rendered as `ImageryTileLayer`s beneath the vector layers, and candidate footprints. SP4b is
the half the *analyst* controls.

Status: not specced. This is a TODO, not a plan — run `brainstorming` → `writing-plans` when
it comes up.

---

## 1. `esri:imagery-catalog` molecule

A dockable panel listing every scene in the `imagery` block, whether or not it is loaded.

- Reads `useImagery()`; no bindings except `mapRef`.
- Per row: title, sensor, acquisition datetime, cloud %, and whether it is currently displayed.
- Sorted by datetime, or by cloud when the user asks for the clearest.
- Needs the full registry-extension treatment — see `apps/gis-canvas/docs/registry-extension.md`
  (schema enum, `MOLECULE_TYPES`, validator `CATALOG` + `STATE_KEYS`, registry, `_CATALOG_HELP`,
  component, tests, awareness).

## 2. Click-to-toggle

Selecting a catalog row loads/unloads that scene's `ImageryTileLayer`.

- `ImageryContext` becomes writable: a visible-set (`string[]`) plus a toggle, mirroring how
  `SelectionContext` exposes `get`/`set`. Today it is read-only.
- `props.imagery.scenes` becomes the *initial* visible set rather than the only one.
- `EsriMapMolecule` subscribes and adds/removes layers, keeping the index-0..N-1 ordering
  invariant — vector evidence must never end up beneath the raster.
- Carry the visible set in the molecule's `state` so it survives a rev and the agent can see
  what the user is looking at (`STATE_KEYS` entry + `_fmt_state` in `awareness.py`).

## 3. Time-slider filtering

Scene datetimes drive visibility as the analyst scrubs.

- Subscribe to `view.timeExtent` via `reactiveUtils` and set each imagery layer's `visible`
  from whether its `datetime` falls inside the window. Chosen over `layer.timeInfo` because it
  is fully under our control and testable.
- The map already publishes a union time extent for tracks (`TimeExtentContext`); extend it to
  union scene datetimes so a linked `esri:time-slider` spans the imagery too.
- Watch the SP2 gotcha: a bare `arcgis-time-slider` does NOT derive an extent from
  client-synthesized layers — `fullTimeExtent` must be set explicitly.

---

## Deferred, with reasons

- **Per-scene opacity / swipe widget** — deferred by the user during SP4a brainstorming. Opacity
  is nearly free once the catalog exists (an `opacity` on the layer); swipe is a real widget.
- **SAR display — DROPPED for now (2026-09-01, user decision).** Earth Search publishes
  Sentinel-1 GRD as `s3://sentinel-s1-l1c/...` requester-pays URIs that no browser can fetch;
  the validator rejects non-http(s) urls and `_CATALOG_HELP` now tells the agent to author
  optical only. The `RasterStretchRenderer` path is built and tested and `sensor:'sar'` still
  validates, so this reverses the day a public HTTPS SAR COG source exists — or if someone
  builds a signing proxy in the BFF. Do not delete the renderer.
- **Antimeridian-crossing footprints** — `bboxToRings` returns null when `minLon > maxLon`.
  Conservative and correct until someone needs the Pacific.
- **Pixel-level interrogation** (identify//query on the raster) — imagery is backdrop, not
  evidence rows: it is not selectable and joins neither linked selection nor the ontology.

## Open question to settle first

Does the catalog list scenes the agent *found*, or scenes it *recommends*? SP4a assumes the
agent declares every candidate. If real STAC searches routinely return dozens, the panel needs
either agent-side pruning or client-side filtering, and that changes the molecule's shape.
Worth answering with a real search before speccing.
