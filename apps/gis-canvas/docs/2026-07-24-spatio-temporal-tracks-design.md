# Spatio-Temporal Tracks — Design (SP2, geospatial-temporal core)

**Status:** Approved (brainstorm complete, 2026-07-24)
**Branch:** `gis/spatio-temporal-tracks` (base `gis/main` @ `0064557d6`)
**Program:** GIS Canvas C2 registry — this is the temporal-geospatial core of cluster B ("charts / timeline / KPI"). Builds on sub-project 3 / 3b (esri:map, multi-layer, per-layer color, spatialFilter, layer-list, linked selection).

## Goal

Give the Agent the guidance and front-end tooling to render **moving platforms** (vessels, aircraft, satellites — anything with a timestamp + coordinates) as **spatio-temporal tracks**: a time-ordered path with heading and a play/scrub time control, so an analyst reads *where a platform was, which way it was heading, and how it moved over time*. Generic across platform types; not vessel-specific.

## Scope

**In scope**
- A `render:'track'` mode on `esri:map` producing time-ordered track geometry.
- A new dockable `esri:time-slider` molecule (play/pause/scrub the map's time window).
- Agent-declared dimensionality: the Agent classifies a source as dual (spatio-temporal), spatial-only, or temporal-only, declares the field roles it used, and those roles are shown on the canvas.
- Catalog guidance + a worked spatio-temporal example.
- A `mock://vessel-track` source (AIS-shaped) for demo/test without Denodo.

**Explicitly out of scope (deferred, YAGNI)**
- Smooth requestAnimationFrame marker interpolation (the parked fork — TimeSlider stepped motion ships first; interpolation only if live-verify shows it's insufficient).
- Temporal-only, non-spatial charts / KPI cards / timeline charts (the rest of cluster B — a later SP).
- Server-side time queries (the loaded page, ≤5000 rows, is filtered client-side).
- Per-track on-map highlight/click beyond the primary layer (inherits SP3b's accepted limitation).

## Architecture

A "track" is a **derived view over ordinary time-stamped geo rows** — the Agent flags a source as temporal and declares field roles; the front-end synthesizes all geometry. Two additions, both following existing codebase patterns exactly (`props.render` enum; dockable `mapRef` widget molecule; 5-place registry sync; client-side layer building from tabular rows).

### 1. `render:'track'` mode on `esri:map`

A third render alongside `'points'` / `'heatmap'`. When set, for **each data layer**, and for **each `trackId` group within that layer**, the map builds a small stack of client-side layers from the rows:

- **Polyline** — positions in time order (the path). Not time-filtered (full path stays as context).
- **Observation points** — time-aware (respond to the slider window).
- **Heading arrows** — rotated marker symbols; rotation from the heading field, else derived from the bearing between successive positions. Not time-filtered.
- **Cursor** — the leading (max-`__time`) in-window observation per track, styled larger in the track color; follows the slider.

Multi-layer + per-layer color already exist, so N platforms-from-one-source (via `trackId`) and N sources both work, each track auto-colored via `resolveLayerColor(groupIndex)`.

### 2. `esri:time-slider` molecule

Dockable, `bindings.mapRef` → the map's id; mirrors `esri:legend` / `esri:layer-list` one-for-one. Wraps `<arcgis-time-slider>` (added to the ESRI loader bag), binds `reference-element` to the map, derives the full time extent from the union of the map's track layers, sets `view.timeExtent` + the slider's `fullTimeExtent`, and provides play/pause/scrub. Animating it **is** the movement animation — observation points + cursor sweep through time while the full path persists.

## Data model & track-building

Three roles beyond lat/lng, each **Agent-declared (authoritative) with client alias-detection as fallback**:

| Role | Auto-detect aliases (case-insensitive) | Override prop | Required? |
|---|---|---|---|
| **time** (ordering) | `timestamp, time, ts, basedatetime, datetime, reported_at, date` | `props.timeField` | **Yes** — no usable time ⇒ not a track; molecule falls back to plain points and the catalog tells the Agent to supply `timeField` |
| **trackId** (grouping) | `trackid, mmsi, imo, icao24, callsign, tailnumber, vessel_name, vessel, entity_id, id` | `props.trackIdField` | No — absent ⇒ one track for the whole layer |
| **heading** (arrow rotation) | `heading, course, cog, bearing` | `props.headingField` | No — absent ⇒ derived from bearing between successive positions |

Spatial roles reuse the existing `detectGeoFields` (`lat`/`lng` aliases) with new `props.latField` / `props.lngField` overrides for explicit Agent declaration.

### Build pipeline — `lib/esri/tracks.ts` (pure, jsdom-testable)

1. Group rows by `trackId` (or a single group when absent).
2. Sort each group by parsed `time` ascending (`Date.parse`). Stamp a normalized `__time` epoch-millis attribute on each point so `timeInfo` never depends on ESRI parsing arbitrary date formats.
3. **Drop** rows with unparseable time (not coerced to epoch 0 — that would teleport a track to 1970) and rows with non-finite coords (SP3b discipline).
4. Emit per group: an ordered **polyline** graphic; **point** graphics carrying `__time` + a `heading` attribute (field value or derived bearing); the group color.
5. Every geometry — points **and** polyline vertices — carries `spatialReference:{wkid:4326}` (SP3b gotcha). `__oid` stays aligned to the source row index so clicking a track point still highlights the linked table row.

**Edge cases (decided):**
- A single observation ⇒ point only, no line.
- Unparseable timestamps ⇒ that row dropped.

## Agent-declared dimensionality

The Agent owns the semantic decision (it understands schema semantics; alias-matching only guesses) and states it. Client detection remains as a safe fallback.

| Case | Signal | Agent renders |
|---|---|---|
| **Dual (spatio-temporal)** | coords **and** a time field **and** movement intent | `esri:map render:'track'` + `esri:time-slider` |
| **Spatial-only** | coords, no usable time (or a snapshot) | `esri:map render:'points'`/`'heatmap'` (today's behavior) |
| **Temporal-only** | time field, **no** coords | out of this SP's map scope → chronological `data-table` for now (timeline charts are the deferred charts SP); the Agent still declares the temporal field |

**Declared roles are made visible on the canvas.** The `esri:map` frame renders a small resolved-roles caption, e.g.:

> `◇ spatial LAT/LON · ◷ temporal BaseDateTime · ⛓ track MMSI`

so an analyst can audit the Agent's field mapping at a glance and a wrong mapping is obvious rather than silently mis-rendered.

## Time engine

- **Time-aware layers:** each track's point layer gets `timeInfo:{ startField:'__time' }`. Polyline + heading layers are not time-filtered.
- **`esri:time-slider`:** on mount derives the full extent (min→max `__time` across the map's track layers), sets `view.timeExtent` + the slider `fullTimeExtent`. Stops/interval default to the data's natural cadence, capped so we never emit thousands of stops; overridable via `props.stops`.
- **Cursor:** react to `view.timeExtent` changes (via `reactiveUtils`, already in the loader bag) and re-query each track layer for its max-`__time` in-window feature — no bespoke animation loop; it follows the slider.
- **Freshness:** the slider re-derives its extent on the same `[ready, layersSig]` rebuild signal the map uses (SP3b fix), so changing data re-fits the range instead of going stale.

## Agent guidance (`_CATALOG_HELP` in `plugins/gis-canvas/tools_canvas.py`)

Worked examples beat prose for agent selection (the `tabs` / geospatial lesson). Four additions:

1. **Dimensional-classification rule** (short prose): coords + time + movement intent → track; coords, no time → points/heatmap; time, no coords → chronological data-table (temporal charts not yet available). Always declare `timeField`, `latField`/`lngField`, `trackIdField`, `headingField`.
2. **`render:'track'` doc line** on the `esri:map` render enum: draws time-ordered track lines + heading arrows + slider-driven cursor; requires a time field; group platforms with `trackIdField`; author an `esri:time-slider` alongside.
3. **Worked spatio-temporal example** (the flagship, replacing the old three-day-layers framing), verbatim:

```
{id:'trk', type:'esri:map', layer:'base',
 props:{title:'WONDER VEGA — track', basemap:'osm', render:'track',
        timeField:'BaseDateTime', trackIdField:'MMSI', headingField:'COG'},
 bindings:{layers:'data://vessel-positions'}},
{id:'ts', type:'esri:time-slider', layer:'dock', edge:'bottom',
 bindings:{mapRef:'trk'}},
{id:'lg', type:'esri:legend', layer:'dock', edge:'right',
 bindings:{mapRef:'trk'}}
```

4. **`esri:time-slider` catalog entry** — one line in the molecule list, same shape as `esri:layer-list` (`bindings.mapRef`, dockable, `props.stops?`).

The Agent reasons: *classify dimensions → pick render → declare fields → author map + time-slider + legend*, and can surface the classification in its narration.

## Registry 5-place sync

- **`render:'track'`** → schema render enum; `validator.py` props allow-list (`timeField/latField/lngField/trackIdField/headingField/stops`); catalog help.
- **`esri:time-slider`** → schema molecule enum; `types.ts` `MOLECULE_TYPES`; `validator.py` `CATALOG`; `registry.tsx` (lazy, like layer-list); catalog help.

## Mock data

`mock://vessel-track` in `mock-data.ts`, AIS-shaped: `mmsi, vessel_name, ts` (ISO), `lat, lng, cog`, across 2–3 platforms × several time-ordered pings with realistic heading changes — enough to show distinct colored tracks, turning arrows, and the cursor sweep on play.

## Testing (TDD)

- **`lib/esri/tracks.ts` (pure):** grouping by trackId; ascending time sort; unparseable-time drop; single-observation → no line; derived-bearing when no heading field; `__time` epoch stamping; SR on every vertex; non-finite skip; `__oid` alignment.
- **Field detection:** time/heading/trackId alias tables + explicit-override precedence.
- **Molecules (mocked-ESRI, like existing map tests):** `esri:time-slider` renders + binds `reference-element`; `esri:map render:'track'` builds the expected layer stack and the resolved-roles caption.
- Full FE suite + plugin suite + production build stay green.

## Live-verify gate (deferred, per finishing-a-development-branch)

Client-side `FeatureLayer` + `timeInfo` + `TimeSlider` on a **synthesized** (non-service) layer — whether in-window filtering and the cursor requery behave — is only truly exercised by the real map. Same deferred-gate discipline as SP3/SP3b: merge decision waits on the user's live check.

## Risks

- **TimeSlider × synthesized FeatureLayer** (above) — primary risk; the live-verify gate covers it.
- **Cursor requery cost** — one small query per `timeExtent` change per track; capped stops keep this bounded.
- **Heading-from-bearing** for near-duplicate consecutive points (a stationary platform) — bearing undefined; fall back to the previous known heading / 0.
