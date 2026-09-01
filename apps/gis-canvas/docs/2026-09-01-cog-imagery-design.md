# SP4a — COG imagery on the GIS canvas (design)

Date: 2026-09-01
Status: approved, not yet implemented
Sub-project: SP4a, first of a two-part split. SP4b — the imagery catalog molecule,
click-to-toggle, and time-slider filtering — will be specced separately once SP4a lands.

## Problem

The shadow-fleet AIS-gap workflow (`shadow-fleet-ais-gap-analysis`) ends by recommending
satellite tasking windows over a vessel's dark period. The `stac-satellite-image-discovery`
skill then turns those windows into concrete STAC items and COG asset URLs. Today that is
where the workflow stops: the canvas can plot AIS points and tracks, but it has no way to
show the imagery that would corroborate them. `esri:map` builds only `FeatureLayer`s — from
`mock://` rows, fetched `data://` pages, or a FeatureServer URL. There is no raster path.

The analyst therefore reads a list of URLs and leaves the canvas to look at them.

## Goal

An agent that has just run STAC discovery can declare what it found and hero its best pick
as an imagery layer on the same map that carries the AIS evidence, with candidate footprints
visible so coverage can be judged against the gap position.

## Non-goals for SP4a

- The candidate-browser molecule and click-to-load (SP4b).
- Time-slider filtering of imagery (SP4b).
- Per-scene opacity or a swipe widget (deferred by the user).
- Footprints that cross the antimeridian.
- Downloading or reprojecting imagery server-side. COGs stream to the browser by HTTP range
  request, directly from the provider.

## Verified constraints

Measured against the Earth Search example URL from the STAC skill
(`https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/.../TCI.tif`) on
2026-09-01:

- `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: HEAD, GET`.
- `Accept-Ranges: bytes`; a `Range: bytes=0-1023` request returns `206 Partial Content`.
- `Content-Type: image/tiff; application=geotiff; profile=cloud-optimized`, 173 MB.

So no proxy is required for this provider: the browser can stream the COG directly. Other
providers (requester-pays buckets, signed URLs, Planet/Maxar) may not be so cooperative,
which is why load failure must be a visible, first-class outcome (see Error handling).

## Open risk, resolved before anything else is built

The ArcGIS
[ImageryTileLayer reference](https://developers.arcgis.com/javascript/latest/references/core/layers/ImageryTileLayer/)
does **not** state whether a COG whose spatial reference differs from the view's is
reprojected on the fly. Sentinel-2 TCI assets are UTM (48N for the Singapore Strait);
our maps are Web Mercator with an OSM basemap. Secondary sources say it "should" work.
That is not good enough to build on.

**Step 0 is a throwaway spike** (see Implementation order). If reprojection does not happen,
SP4a's shape changes materially — the fallback is a georeferenced `MediaLayer` over the STAC
`rendered_preview`/`thumbnail` asset, which is lower fidelity and needs its own extent
handling — and we revisit this spec before continuing.

### Spike result — 2026-09-01: RESOLVED, reprojection works

Ran against the real Sentinel-2 scene `S2C_T48NVH_20251205T033614_L2A` (2.65% cloud, the
lowest-cloud scene over the AOI in the target window) on an OSM Web Mercator basemap:

- The COG renders **correctly aligned** with the basemap coastline over the Singapore Strait.
- View SR and layer SR differ — `ImageryTileLayer` reprojects on the fly. No view SR change,
  no `MediaLayer` fallback needed. The design proceeds as written.
- A percent-clip `RasterStretchRenderer` on a single-band COG shows visible structure, so the
  SAR rendering path is sound.

### Sentinel-1 is not browser-readable from Earth Search

Discovered during the spike and **not** a blocker for SP4a, but it constrains the workflow:
Earth Search returns Sentinel-1 GRD assets as `s3://sentinel-s1-l1c/...` URIs — an S3 URI
rather than an HTTPS href, on a **requester-pays** bucket with no anonymous read. A browser
cannot fetch them at all.

The SAR *code path* is therefore verified with Sentinel-2's `B08` (NIR), a single-band 16-bit
COG on the same public bucket that needs the identical stretch. Displaying real SAR will need
either a different provider (one publishing HTTPS COG hrefs) or a server-side proxy that signs
requester-pays reads. That is a follow-on decision, not SP4a work — but it means the
shadow-fleet workflow's *primary* sensor recommendation cannot yet be displayed from this
catalog, and the `imagery` block's `sensor:'sar'` path will initially be exercised only by
scenes from other providers.

This is precisely the case the "Load failure" error handling exists for: an `s3://` url is
rejected by the validator at author time, and a CORS-less or 403 https url surfaces a visible
load error rather than an empty map.

## Architecture

### The `imagery` doc block

A new optional top-level key on the canvas document, a sibling of `layout`, `components`,
and `ontology`. It holds everything STAC discovery found, whether or not it is displayed:

```js
imagery: {
  scenes: [{
    id: 's1',                                   // author-chosen; referenced by esri:map
    title: 'S2C 2025-12-05 — Singapore Strait', // shown in layer-list / legend / popups
    url: 'https://…/S2C_T48NVH_…_L2A/TCI.tif',  // the COG asset href
    sensor: 'optical',                          // 'optical' | 'sar' — REQUIRED
    datetime: '2025-12-05T03:36:14Z',           // RFC 3339 acquisition time
    bbox: [104.58, 1.72, 104.78, 1.94],         // WGS84 [minLon, minLat, maxLon, maxLat]
    collection: 'sentinel-2-c1-l2a',            // optional
    cloud: 2.65,                                // optional, eo:cloud_cover
    bandIds: [0, 1, 2]                          // optional override
  }]
}
```

This mirrors `ontology`: one agent-declared block, consumed by molecules through a provider,
distinct from the components that display it. It is the only model in which "discovered" and
"displayed" are separate states, which the SP4b catalog requires.

`id`, `title`, `url`, `sensor`, `datetime`, and `bbox` are required; the rest are optional.

**Why `sensor` is required rather than detected.** SP2 taught that letting the agent supply
field names invites invented ones, so track field roles are auto-detected and agent overrides
are validated against the schema. This is the mirror case, and the opposite answer is right:
the agent always knows the sensor from the STAC collection it searched, the value cannot be
recovered from the URL reliably, and getting it wrong renders a black rectangle rather than
an obvious error. So the agent must state it and the validator enforces the enum.

### Declaring what is displayed

`esri:map` gains one prop:

```js
props: { imagery: { scenes: ['s1'], footprints: true } }
```

`scenes` lists the scene ids loaded on arrival — the agent's top pick(s). `footprints`
(default `false`) draws every scene in the block as an outline polygon. A scene id here with
no matching scene in the `imagery` block is a validator error.

### Modules

Following the existing pure/ESRI split (`lib/esri/tracks.ts` pure, `lib/esri/layers.ts`
ESRI-constructing):

- **`src/lib/imagery.ts`** — pure. Scene lookup/normalization, `bboxToRings`, and resolving
  `props.imagery.scenes` against the block. No ESRI import, unit-testable directly.
- **`src/lib/esri/imagery.ts`** — `buildImageryLayer(scene, esri)` and
  `buildFootprintLayer(scenes, esri)`. Takes the loaded ESRI bag as a parameter, exactly as
  `buildRowsLayer` does, so tests pass a fake bag.
- **`src/components/ImageryContext.tsx`** — provider feeding `doc.imagery` to molecules,
  mirroring `OntologyContext`. Mounted in `App.tsx` alongside `OntologyProvider`. In SP4a it
  is read-only; SP4b adds the visible-set toggle.

### Renderers

- **Optical**: `bandIds: [0, 1, 2]` (or the scene's override), no renderer. A TCI/visual
  asset is already 8-bit RGB and needs no stretch. ArcGIS `bandIds` are **0-based** indices
  into the raster's bands — the SDK's COG sample uses `[3, 2, 1]` only because its source is
  an 8-band Landsat MS scene, not because the values are 1-based.
- **SAR**: a `RasterStretchRenderer` with `stretchType: 'percent-clip'` and `dra: true`.
  A Sentinel-1 VV/VH GRD COG is single-band and high-dynamic-range; without this it paints
  black, and SAR is the *primary* sensor the shadow-fleet skill recommends for confirming
  presence during AIS silence.

### Loading

A new lazy `loadImagery()` in `src/lib/esri/loader.ts`, returning
`{ ImageryTileLayer, RasterStretchRenderer }`, mirroring the existing `loadFeatureTable()`
precedent. Raster support pulls decoder WASM that no non-imagery canvas should pay for, so it
stays out of the main `loadEsri()` bag.

### Map integration

Inside `EsriMapMolecule`'s existing build effect, after the vector layers are added:

- Imagery layers are added at **map index 0** — beneath the AIS points/tracks, above the
  basemap. Vector evidence must never sit under the raster. Since the vector layers are
  already on the map at this point, inserting at 0 pushes them up; adding N scenes in order
  means each successive `add(layer, i)` for `i` in `0..N-1` leaves the scenes in declaration
  order at the bottom of the operational stack.
- The footprint layer is added at index N — above the imagery, below the data layers.
- Both are pushed to `addedLayersRef`, so the existing rebuild-on-rev teardown
  (`view.map.removeMany`) clears them. This is the SP3b staleness fix; imagery inherits it.
- Because they are real layers on the map, `esri:layer-list` and `esri:legend` pick them up
  with no extra work.

## Data flow

```
shadow-fleet skill (Denodo)      →  AIS gaps + tasking windows + AOI bbox
stac-satellite-image-discovery   →  ranked STAC items + COG asset URLs
agent render_view                →  doc.imagery.scenes[]  +  map props.imagery.scenes[]
ImageryProvider (App.tsx)        →  EsriMapMolecule
  buildImageryLayer  (map index 0)     ← ImageryTileLayer, streams COG by range request
  buildFootprintLayer                  ← client-side polygon FeatureLayer from bboxes
```

## Error handling

- **Load failure** — CORS-less provider, requester-pays bucket, expired signed URL, 404, or a
  file that is not a valid COG. `layer.load()` rejects; the rejection is caught per scene and
  pushed to the molecule's existing `layerErrors` state, which renders as visible text. An
  absent imagery layer must never be indistinguishable from one that has simply not painted
  yet — the same reasoning behind the expired-handle errors (SP3b) and the "no track data"
  note (SP2). One scene failing must not prevent the others from rendering.
- **Author-time errors**, caught by the validator and returned to the agent for retry:
  non-`http(s)` url; `sensor` outside the enum; `bbox` not four finite numbers with
  `minLon < maxLon` and `minLat < maxLat`; a `props.imagery.scenes` id not present in the
  block; duplicate scene ids.
- **Non-finite bbox coordinates** are skipped when building footprints. SP3b: a NaN
  coordinate poisons an entire ESRI layer.

## Contract surface

Per `apps/gis-canvas/docs/registry-extension.md`. SP4a adds no molecule type, so the
`MOLECULE_TYPES`/registry/component steps do not apply; the rest do:

1. **Schema** — `imagery` block in `plugins/gis-canvas/schema/canvas.schema.json` (the root
   object is `additionalProperties: false`, so this is required for any doc to validate).
2. **TS mirror** — `Imagery`/`ImageryScene` types and `CanvasDoc.imagery` in
   `apps/gis-canvas/src/lib/types.ts`.
3. **Validator** — the author-time rules above, in `plugins/gis-canvas/validator.py`.
4. **Agent catalog** — an `_CATALOG_HELP` entry in `plugins/gis-canvas/tools_canvas.py`
   teaching: declare every discovered scene in `imagery`, hero the top pick via
   `props.imagery.scenes`, set `footprints:true` when there are candidates worth comparing,
   and always state `sensor`.

## Testing

- **Pure lib** (`src/lib/imagery.test.ts`): scene resolution against the block, unknown-id
  handling, `bboxToRings` winding and ordering, non-finite coordinate rejection.
- **Molecule** (`EsriMapMolecule.test.tsx`, mocked ESRI bag): an optical scene builds an
  `ImageryTileLayer` with the right url and `bandIds`; a SAR scene builds one with a
  percent-clip `RasterStretchRenderer`; both are added at index 0; `footprints:true` builds a
  polygon layer with one graphic per scene; a rejected `load()` surfaces an error string and
  does not suppress the sibling scene.
- **Python**: validator accept/reject tests for each author-time rule, plus a `render_view`
  acceptance test carrying an `imagery` block.
- **Live verify**, via `apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md`: a real Sentinel-2
  TCI and a real Sentinel-1 GRD VV scene over the Singapore Strait AOI, on the same map as the
  AIS points — confirming alignment, SAR visibility, layer ordering, and layer-list entries.

## Implementation order

0. **Spike (throwaway)** — load the Sentinel-2 UTM 48N `TCI.tif` on an OSM Web Mercator
   basemap; confirm it lands over the Singapore Strait. Load one Sentinel-1 GRD VV with the
   percent-clip stretch; confirm it is not black. **Gate: if reprojection does not happen,
   stop and revise this spec** — the `MediaLayer`/`rendered_preview` fallback is a different
   design.
1. Schema + types + validator + validator tests.
2. `lib/imagery.ts` + tests.
3. `loadImagery()` + `lib/esri/imagery.ts`.
4. `ImageryContext` + `App.tsx` mount.
5. `EsriMapMolecule` integration (layer ordering, teardown, error surfacing) + tests.
6. `_CATALOG_HELP` + `render_view` acceptance test.
7. Gateway restart, live verify per the runbook.

## Consequences

- The canvas gains a raster path. `parseLayerRef`/`bindings.layers` stay vector-only; imagery
  is a separate axis, which keeps `props.layers[]` positional metadata from being overloaded.
- SP4b becomes small: a molecule reading `ImageryContext`, a visible-set toggle written back
  through it, and a `view.timeExtent` subscription driving per-scene visibility.
- Imagery layers are not selectable and participate in neither linked selection nor the
  ontology. They are backdrop, not evidence rows. That is intentional and worth revisiting
  only if pixel-level interrogation is ever asked for.
