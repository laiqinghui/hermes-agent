# SP4a — COG Imagery on the GIS Canvas: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent that has run STAC discovery declare the satellite scenes it found and render its best pick as a Cloud Optimized GeoTIFF layer on the same `esri:map` that carries the AIS evidence, with candidate footprints drawn for coverage comparison.

**Architecture:** A new optional top-level `imagery` block on the canvas document holds every discovered scene (a sibling of `ontology`, fed to molecules by an `ImageryProvider`). `esri:map` gains `props.imagery: {scenes:[ids], footprints:bool}` naming which scenes load on arrival. Scenes become ArcGIS `ImageryTileLayer`s added at the bottom of the operational layer stack; optical assets render as RGB, SAR gets a percent-clip `RasterStretchRenderer` without which a single-band VV COG paints black.

**Tech Stack:** React 19 + TypeScript + Vite (`apps/gis-canvas`), `@arcgis/core` 4.34 + `@arcgis/map-components`, Vitest + Testing Library (frontend), Python + jsonschema + pytest (`plugins/gis-canvas`).

**Spec:** `apps/gis-canvas/docs/2026-09-01-cog-imagery-design.md` (commit `8bb9dbb9d`)

## Global Constraints

- Repo: `C:\workspace\analyst\hermes-agent`. Branch: `gis/main`. Commit as you go; do not push.
- **The Bash tool's cwd resets between calls.** Every command below is written to be run from the repo root; `cd` explicitly in the same call when needed.
- **Frontend tests run from the repo root with the workspace flag:** `npm test --workspace @hermes/gis-canvas`. Running `vitest` from the repo root fails with `document is not defined`; running `npm run dev` inside `apps/gis-canvas` fails with `vite: not recognized` (the binary is hoisted to the root `node_modules/.bin` by npm workspaces).
- **Python plugin changes require a gateway restart to take effect.** The gateway runs from the repo via an editable install and Python does not hot-reload. Restart recipe is in `apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md` §"Restarting the gateway". Vite HMR *does* pick up frontend edits live.
- `bbox` is always WGS84 `[minLon, minLat, maxLon, maxLat]` — lon first. This is STAC's order and ESRI's `[xmin, ymin, xmax, ymax]` order; never `[lat, lon]`.
- ArcGIS `bandIds` are **0-based** indices into the raster's bands.
- Every ESRI graphic geometry MUST carry an explicit `spatialReference` and MUST NOT contain non-finite coordinates. A missing SR yields a `[0,0]` extent and nothing renders; a single `NaN` poisons the entire layer. (Both were live-verified failures in SP3b.)
- Imagery layers are **not** selectable and participate in neither linked selection nor the ontology. They are backdrop, not evidence rows.
- Existing test counts before this work: 298 frontend, 127 plugin. Both suites must still pass at every commit.

---

## File Structure

**Create:**
- `apps/gis-canvas/spike-cog.html` — Task 0 only, deleted at the end of Task 0.
- `apps/gis-canvas/src/lib/imagery.ts` — pure scene resolution + bbox geometry. No ESRI import.
- `apps/gis-canvas/src/lib/imagery.test.ts`
- `apps/gis-canvas/src/lib/esri/imagery.ts` — ESRI layer construction from scenes.
- `apps/gis-canvas/src/lib/esri/imagery.test.ts`
- `apps/gis-canvas/src/components/ImageryContext.tsx` — provider, mirrors `OntologyContext.tsx`.

**Modify:**
- `plugins/gis-canvas/schema/canvas.schema.json` — `imagery` root property + `imageryScene` `$def`.
- `plugins/gis-canvas/validator.py` — cross-checks the schema can't express.
- `plugins/gis-canvas/tools_canvas.py` — `_CATALOG_HELP` agent guidance.
- `apps/gis-canvas/src/lib/types.ts` — `ImageryScene`, `Imagery`, `CanvasDoc.imagery`.
- `apps/gis-canvas/src/lib/esri/loader.ts` — lazy `loadImagery()`.
- `apps/gis-canvas/src/App.tsx` — mount `ImageryProvider`.
- `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx` — build/teardown imagery layers.

**Test:**
- `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`
- `tests/plugins/gis_canvas/test_validator.py`
- `tests/plugins/gis_canvas/test_tools.py`

---

## Task 0: Reprojection spike (GATE — throwaway)

The ArcGIS docs never state whether a COG in a spatial reference other than the view's is reprojected on the fly. Sentinel-2 TCI assets are UTM (48N over the Singapore Strait); our maps are Web Mercator with an OSM basemap. **If this does not work, stop and revise the spec** — the fallback is a georeferenced `MediaLayer` over the STAC `rendered_preview`, which is a different design.

**Files:**
- Create: `apps/gis-canvas/spike-cog.html` (deleted in Step 6)

**Interfaces:**
- Consumes: nothing.
- Produces: a yes/no answer on reprojection, plus one verified single-band COG URL that Task 3's SAR path can be sanity-checked against.

- [ ] **Step 1: Find a single-band COG URL to test the stretch path against**

Sentinel-1 GRD assets are often on requester-pays buckets that a browser cannot read. Try S1 first; if its assets are inaccessible, Sentinel-2's `nir` (B08) band is a 16-bit single-band COG on the same public bucket and exercises the identical code path.

Run from the repo root:

```bash
curl -s -X POST https://earth-search.aws.element84.com/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"collections":["sentinel-1-grd"],"bbox":[104.58,1.72,104.78,1.94],"datetime":"2025-11-02T00:00:00Z/2025-12-08T00:00:00Z","limit":3}' \
  | python -c "import json,sys; d=json.load(sys.stdin); [print(f['id'], f['properties']['datetime'], {k: v['href'] for k, v in f['assets'].items() if k in ('vv','vh')}) for f in d.get('features',[])]"
```

Then check whether the chosen href is browser-readable (this is exactly the check that decides the fallback):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: http://localhost:5174' -H 'Range: bytes=0-1023' '<VV_HREF>'
```

Expected: `206`. If it returns `403` or `401` (requester-pays / signed-URL bucket), record that in the notes and instead run the same search against `"collections":["sentinel-2-c1-l2a"]` and use the `nir` asset href as the single-band test subject.

- [ ] **Step 2: Write the spike page**

Vite serves any `.html` at the app root as an entry point. Create `apps/gis-canvas/spike-cog.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>COG reprojection spike</title>
    <link rel="stylesheet" href="https://js.arcgis.com/4.34/@arcgis/core/assets/esri/themes/light/main.css" />
    <style>
      html, body, #v { margin: 0; padding: 0; height: 100%; width: 100%; }
      #log { position: absolute; z-index: 99; top: 0; left: 0; background: #fff; font: 12px monospace; padding: 6px; max-width: 60vw; }
    </style>
  </head>
  <body>
    <div id="log"></div>
    <div id="v"></div>
    <script type="module">
      import esriConfig from '@arcgis/core/config.js'
      import Map from '@arcgis/core/Map.js'
      import MapView from '@arcgis/core/views/MapView.js'
      import ImageryTileLayer from '@arcgis/core/layers/ImageryTileLayer.js'
      import RasterStretchRenderer from '@arcgis/core/renderers/RasterStretchRenderer.js'

      // Same gotcha as src/lib/esri/loader.ts: the npm package's default assetsPath
      // is not served by our dev server, so workers/WASM fail to parse.
      esriConfig.assetsPath = 'https://js.arcgis.com/4.34/@arcgis/core/assets'

      const log = m => { document.getElementById('log').innerHTML += m + '<br>' }

      const OPTICAL = 'https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/sentinel-2-c1-l2a/48/N/VH/2025/12/S2C_T48NVH_20251205T033614_L2A/TCI.tif'
      const SINGLE_BAND = 'PASTE_FROM_STEP_1'

      const optical = new ImageryTileLayer({ url: OPTICAL, bandIds: [0, 1, 2], title: 'optical' })
      const sar = new ImageryTileLayer({
        url: SINGLE_BAND,
        bandIds: [0],
        title: 'single-band + stretch',
        visible: false,
        renderer: new RasterStretchRenderer({ stretchType: 'percent-clip', minPercent: 0.5, maxPercent: 0.5, dra: true })
      })

      const map = new Map({ basemap: 'osm', layers: [optical, sar] })
      const view = new MapView({ container: 'v', map, center: [104.69, 1.83], zoom: 10 })

      view.when(() => log('view SR: ' + view.spatialReference.wkid))
      optical.load().then(() => {
        log('optical SR: ' + optical.spatialReference?.wkid)
        log('optical extent: ' + JSON.stringify(optical.fullExtent?.toJSON?.()?.spatialReference))
      }).catch(e => log('OPTICAL LOAD FAIL: ' + e.message))
      sar.load()
        .then(() => log('single-band SR: ' + sar.spatialReference?.wkid))
        .catch(e => log('SINGLE-BAND LOAD FAIL: ' + e.message))

      window.toggle = () => { sar.visible = !sar.visible; optical.visible = !optical.visible }
    </script>
  </body>
</html>
```

- [ ] **Step 3: Run the dev server and open the spike**

```bash
cd /c/workspace/analyst/hermes-agent && npm run dev --workspace @hermes/gis-canvas
```

Open `http://localhost:5174/spike-cog.html`.

- [ ] **Step 4: Record the three answers**

1. **Does the imagery land in the right place?** The optical scene must sit over the Singapore Strait, aligned with the OSM coastline — not off the coast of Africa, not absent. Zoom out to confirm it is not somewhere else entirely.
2. **What are the spatial references?** The log should show a view WKID of `102100`/`3857` and an optical layer WKID of `32648` (UTM 48N) — different values with correct alignment is exactly the proof we need.
3. **Does the stretch work?** Run `toggle()` in the browser console. The single-band layer must show visible structure, not a uniform black rectangle.

- [ ] **Step 5: GATE**

If (1) or (2) fails — imagery misplaced, or the layer refuses to load because of an SR mismatch — **stop here.** Report the finding and revise `apps/gis-canvas/docs/2026-09-01-cog-imagery-design.md` before starting Task 1. Do not proceed on the assumption that a later task will fix it.

If (3) fails but (1) and (2) pass, continue — the stretch parameters are tunable in Task 3 and are not a design-level risk.

- [ ] **Step 6: Delete the spike and record the result**

```bash
cd /c/workspace/analyst/hermes-agent && rm apps/gis-canvas/spike-cog.html && git status --porcelain
```

Expected: `spike-cog.html` does not appear (it was never committed). Append the three answers to the spec's "Open risk" section, then:

```bash
cd /c/workspace/analyst/hermes-agent && git add apps/gis-canvas/docs/2026-09-01-cog-imagery-design.md && git commit -m "docs(gis-canvas): record SP4a reprojection spike result"
```

---

## Task 1: Document contract — schema, types, validator

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json`
- Modify: `plugins/gis-canvas/validator.py` (append before the closing `return errors`, ~line 249)
- Modify: `apps/gis-canvas/src/lib/types.ts:60` (after the `Ontology` type)
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: nothing.
- Produces: TypeScript `ImageryScene` (`{id, title, url, sensor:'optical'|'sar', datetime, bbox:[number,number,number,number], collection?, cloud?, bandIds?}`), `Imagery` (`{scenes: ImageryScene[]}`), and `CanvasDoc.imagery?: Imagery`. Every later task imports these from `../lib/types` / `./types`.

- [ ] **Step 1: Write the failing validator tests**

Append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def _imagery_doc():
    doc = _minimal_doc()
    doc["imagery"] = {
        "scenes": [
            {
                "id": "s1",
                "title": "S2C 2025-12-05",
                "url": "https://example.com/TCI.tif",
                "sensor": "optical",
                "datetime": "2025-12-05T03:36:14Z",
                "bbox": [104.58, 1.72, 104.78, 1.94],
                "collection": "sentinel-2-c1-l2a",
                "cloud": 2.65,
            }
        ]
    }
    doc["components"].append(
        {
            "id": "map1",
            "type": "esri:map",
            "area": {"col": 4, "colSpan": 8, "row": 1, "rowSpan": 4},
            "props": {"imagery": {"scenes": ["s1"], "footprints": True}},
            "bindings": {"layers": ["mock://incidents"]},
        }
    )
    return doc


def test_valid_imagery_doc_passes(plugin):
    assert plugin.validator.validate_doc(_imagery_doc()) == []


def test_imagery_scene_requires_sensor(plugin):
    doc = _imagery_doc()
    del doc["imagery"]["scenes"][0]["sensor"]
    errors = plugin.validator.validate_doc(doc)
    assert errors and any("sensor" in e for e in errors)


def test_imagery_scene_rejects_unknown_sensor(plugin):
    doc = _imagery_doc()
    doc["imagery"]["scenes"][0]["sensor"] = "lidar"
    errors = plugin.validator.validate_doc(doc)
    assert errors and any("sensor" in e for e in errors)


def test_imagery_scene_rejects_non_http_url(plugin):
    doc = _imagery_doc()
    doc["imagery"]["scenes"][0]["url"] = "s3://bucket/TCI.tif"
    errors = plugin.validator.validate_doc(doc)
    assert errors and any("url" in e for e in errors)


def test_imagery_scene_rejects_reversed_bbox(plugin):
    doc = _imagery_doc()
    doc["imagery"]["scenes"][0]["bbox"] = [104.78, 1.94, 104.58, 1.72]
    errors = plugin.validator.validate_doc(doc)
    assert any("bbox" in e for e in errors)


def test_imagery_rejects_duplicate_scene_ids(plugin):
    doc = _imagery_doc()
    doc["imagery"]["scenes"].append(dict(doc["imagery"]["scenes"][0]))
    errors = plugin.validator.validate_doc(doc)
    assert any("duplicate scene id" in e for e in errors)


def test_map_imagery_ref_must_name_a_declared_scene(plugin):
    doc = _imagery_doc()
    doc["components"][1]["props"]["imagery"]["scenes"] = ["ghost"]
    errors = plugin.validator.validate_doc(doc)
    assert any("undeclared scene 'ghost'" in e for e in errors)
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/workspace/analyst/hermes-agent && python -m pytest tests/plugins/gis_canvas/test_validator.py -k imagery -v
```

Expected: FAIL. `test_valid_imagery_doc_passes` fails with a schema error about the root's `additionalProperties` rejecting `imagery` — the root object is `"additionalProperties": false`, so an undeclared block is rejected outright.

- [ ] **Step 3: Add the schema block**

In `plugins/gis-canvas/schema/canvas.schema.json`, add to the root `properties` object immediately after the `"ontology"` entry (~line 28):

```json
    "imagery": {
      "type": "object",
      "required": ["scenes"],
      "additionalProperties": false,
      "properties": {
        "scenes": { "type": "array", "items": { "$ref": "#/$defs/imageryScene" } }
      }
    }
```

And add to `$defs`, as a sibling of `entityType`:

```json
    "imageryScene": {
      "type": "object",
      "required": ["id", "title", "url", "sensor", "datetime", "bbox"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "title": { "type": "string", "minLength": 1 },
        "url": { "type": "string", "pattern": "^https?://" },
        "sensor": { "enum": ["optical", "sar"] },
        "datetime": { "type": "string", "minLength": 1 },
        "bbox": { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4 },
        "collection": { "type": "string" },
        "cloud": { "type": "number" },
        "bandIds": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
      }
    },
```

Note: `componentNode.props` is `{"type": "object"}` (free-form) in this schema, so `props.imagery` needs no schema change — it is checked in `validator.py` instead.

- [ ] **Step 4: Add the validator cross-checks**

In `plugins/gis-canvas/validator.py`, insert immediately before the final `return errors` (after the ontology cross-check block, ~line 249):

```python
    # Imagery cross-checks. Per-scene field presence/types are enforced by the JSON
    # schema; these catch what it can't express — duplicate ids, bbox ordering, and
    # a map heroing a scene that was never declared.
    scenes = (doc.get("imagery") or {}).get("scenes") or []
    scene_ids: set[str] = set()
    for scene in scenes:
        sid = scene.get("id")
        if sid in scene_ids:
            errors.append(f"imagery: duplicate scene id '{sid}'")
        scene_ids.add(sid)
        bbox = scene.get("bbox") or []
        if len(bbox) == 4:
            min_lon, min_lat, max_lon, max_lat = bbox
            if not (min_lon < max_lon and min_lat < max_lat):
                errors.append(
                    f"imagery scene '{sid}': bbox must be WGS84 "
                    f"[minLon, minLat, maxLon, maxLat] with minLon < maxLon and "
                    f"minLat < maxLat, got {bbox}"
                )

    def check_imagery_refs(node: dict) -> None:
        if node.get("type") == "esri:map":
            refs = ((node.get("props") or {}).get("imagery") or {}).get("scenes") or []
            for ref in refs:
                if ref not in scene_ids:
                    errors.append(
                        f"'{node['id']}' (esri:map): props.imagery.scenes references "
                        f"undeclared scene '{ref}' — declare it in the top-level "
                        f"`imagery` block"
                    )
        for kid in node.get("children") or []:
            check_imagery_refs(kid)
        for slot_kids in (node.get("slots") or {}).values():
            for kid in slot_kids:
                check_imagery_refs(kid)

    for comp in doc.get("components", []):
        check_imagery_refs(comp)
    for overlay in doc.get("overlays", []):
        check_imagery_refs(overlay)

    return errors
```

Delete the pre-existing bare `return errors` line that this replaces — there must be exactly one.

- [ ] **Step 5: Run the validator tests**

```bash
cd /c/workspace/analyst/hermes-agent && python -m pytest tests/plugins/gis_canvas/test_validator.py -v
```

Expected: PASS, all of them (the seven new ones plus every pre-existing test).

- [ ] **Step 6: Add the TypeScript mirror**

In `apps/gis-canvas/src/lib/types.ts`, after `export type Ontology = Record<string, EntityType>` (line 60):

```ts
/** One STAC-discovered satellite scene. Mirrors $defs/imageryScene in
 * plugins/gis-canvas/schema/canvas.schema.json — keep the two in sync. */
export interface ImageryScene {
  id: string
  title: string
  url: string
  /** REQUIRED: a single-band SAR COG needs a stretch renderer or it paints black,
   * and that is not reliably recoverable from the URL. The agent always knows it
   * from the STAC collection it searched. */
  sensor: 'optical' | 'sar'
  datetime: string
  /** WGS84 [minLon, minLat, maxLon, maxLat] — STAC's order, lon first. */
  bbox: [number, number, number, number]
  collection?: string
  cloud?: number
  /** 0-based band indices. Defaults: [0,1,2] optical, [0] SAR. */
  bandIds?: number[]
}

export interface Imagery { scenes: ImageryScene[] }
```

And add to the `CanvasDoc` interface, after `ontology?: Ontology`:

```ts
  imagery?: Imagery
```

- [ ] **Step 7: Typecheck and run the full suites**

```bash
cd /c/workspace/analyst/hermes-agent && npm run build --workspace @hermes/gis-canvas && npm test --workspace @hermes/gis-canvas
```

Expected: build succeeds; 298 frontend tests pass (no new ones yet).

```bash
cd /c/workspace/analyst/hermes-agent && python -m pytest tests/plugins/gis_canvas -q
```

Expected: 134 passed (127 + 7 new).

- [ ] **Step 8: Commit**

```bash
cd /c/workspace/analyst/hermes-agent && git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py apps/gis-canvas/src/lib/types.ts tests/plugins/gis_canvas/test_validator.py && git commit -m "feat(gis-canvas): imagery doc block — schema, types, validator"
```

---

## Task 2: Pure imagery lib

**Files:**
- Create: `apps/gis-canvas/src/lib/imagery.ts`
- Test: `apps/gis-canvas/src/lib/imagery.test.ts`

**Interfaces:**
- Consumes: `Imagery`, `ImageryScene` from `./types` (Task 1).
- Produces:
  - `resolveScenes(imagery: Imagery | undefined, ids: string[]): ImageryScene[]`
  - `bboxToRings(bbox: number[]): number[][][] | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/gis-canvas/src/lib/imagery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveScenes, bboxToRings } from './imagery'
import type { Imagery, ImageryScene } from './types'

const scene = (id: string): ImageryScene => ({
  id, title: `scene ${id}`, url: `https://example.com/${id}.tif`,
  sensor: 'optical', datetime: '2025-12-05T03:36:14Z',
  bbox: [104.58, 1.72, 104.78, 1.94]
})

const IMAGERY: Imagery = { scenes: [scene('a'), scene('b')] }

describe('resolveScenes', () => {
  it('returns the named scenes in the order requested', () => {
    expect(resolveScenes(IMAGERY, ['b', 'a']).map(s => s.id)).toEqual(['b', 'a'])
  })

  it('drops ids with no matching scene rather than throwing', () => {
    expect(resolveScenes(IMAGERY, ['a', 'ghost']).map(s => s.id)).toEqual(['a'])
  })

  it('returns nothing when there is no imagery block', () => {
    expect(resolveScenes(undefined, ['a'])).toEqual([])
  })
})

describe('bboxToRings', () => {
  it('builds a closed clockwise ring from a WGS84 bbox', () => {
    expect(bboxToRings([104.58, 1.72, 104.78, 1.94])).toEqual([[
      [104.58, 1.72], [104.58, 1.94], [104.78, 1.94], [104.78, 1.72], [104.58, 1.72]
    ]])
  })

  it('rejects a non-finite coordinate — a NaN poisons the whole ESRI layer', () => {
    expect(bboxToRings([104.58, Number.NaN, 104.78, 1.94])).toBeNull()
  })

  it('rejects a reversed or degenerate bbox', () => {
    expect(bboxToRings([104.78, 1.72, 104.58, 1.94])).toBeNull()
    expect(bboxToRings([104.58, 1.72, 104.58, 1.94])).toBeNull()
  })

  it('rejects a bbox that is not four numbers', () => {
    expect(bboxToRings([104.58, 1.72, 104.78])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/workspace/analyst/hermes-agent && npm test --workspace @hermes/gis-canvas -- src/lib/imagery.test.ts
```

Expected: FAIL — cannot resolve `./imagery`.

- [ ] **Step 3: Write the implementation**

Create `apps/gis-canvas/src/lib/imagery.ts`:

```ts
import type { Imagery, ImageryScene } from './types'

/** Resolve the scene ids a map heroes (props.imagery.scenes) against the doc's
 * `imagery` block, preserving the requested order. Unknown ids are dropped: the
 * validator rejects them at author time, so reaching one here means a stale
 * client, which should degrade rather than throw. */
export function resolveScenes(imagery: Imagery | undefined, ids: string[]): ImageryScene[] {
  const byId = new Map((imagery?.scenes ?? []).map(s => [s.id, s]))
  return ids
    .map(id => byId.get(id))
    .filter((s): s is ImageryScene => s != null)
}

/** WGS84 bbox -> a single closed clockwise polygon ring (ESRI's outer-ring winding).
 * Returns null for anything unusable — a non-finite coordinate poisons an entire
 * ESRI layer, so a bad footprint must be dropped, not drawn. */
export function bboxToRings(bbox: number[]): number[][][] | null {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null
  const [minLon, minLat, maxLon, maxLat] = bbox
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null
  if (!(minLon < maxLon) || !(minLat < maxLat)) return null
  return [[
    [minLon, minLat], [minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]
  ]]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /c/workspace/analyst/hermes-agent && npm test --workspace @hermes/gis-canvas -- src/lib/imagery.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd /c/workspace/analyst/hermes-agent && git add apps/gis-canvas/src/lib/imagery.ts apps/gis-canvas/src/lib/imagery.test.ts && git commit -m "feat(gis-canvas): pure imagery lib — scene resolution + bbox rings"
```

---

## Task 3: ESRI imagery layer builders

**Files:**
- Create: `apps/gis-canvas/src/lib/esri/imagery.ts`
- Create: `apps/gis-canvas/src/lib/esri/imagery.test.ts`
- Modify: `apps/gis-canvas/src/lib/esri/loader.ts` (append after `loadFeatureTable`)

**Interfaces:**
- Consumes: `bboxToRings` from `../imagery` (Task 2); `ImageryScene` from `../types` (Task 1).
- Produces:
  - `ImageryBag` — `{ ImageryTileLayer: new (o: unknown) => unknown; RasterStretchRenderer: new (o: unknown) => unknown }`
  - `buildImageryLayer(scene: ImageryScene, esri: ImageryBag): unknown`
  - `buildFootprintLayer(scenes: ImageryScene[], esri: { FeatureLayer: new (o: unknown) => unknown }, title?: string): unknown | null`
  - `loadImagery(): Promise<ImageryBag>` from `./loader`

- [ ] **Step 1: Write the failing tests**

Create `apps/gis-canvas/src/lib/esri/imagery.test.ts`. Like `layers.test.ts`, this passes a fake ESRI bag rather than importing `@arcgis/core`:

```ts
import { describe, it, expect } from 'vitest'
import { buildImageryLayer, buildFootprintLayer, type ImageryBag } from './imagery'
import type { ImageryScene } from '../types'

class FakeLayer { constructor(public opts: any) {} }
class FakeRenderer { constructor(public opts: any) {} }

const bag = () => ({ ImageryTileLayer: FakeLayer, RasterStretchRenderer: FakeRenderer } as unknown as ImageryBag)
const fl = () => ({ FeatureLayer: FakeLayer })

const optical: ImageryScene = {
  id: 'o1', title: 'S2C 2025-12-05', url: 'https://example.com/TCI.tif',
  sensor: 'optical', datetime: '2025-12-05T03:36:14Z', bbox: [104.58, 1.72, 104.78, 1.94]
}
const sar: ImageryScene = {
  id: 's1', title: 'S1A 2025-12-03', url: 'https://example.com/vv.tif',
  sensor: 'sar', datetime: '2025-12-03T22:11:00Z', bbox: [104.5, 1.7, 104.9, 2.0]
}

describe('buildImageryLayer', () => {
  it('builds an RGB layer for optical with no renderer', () => {
    const layer = buildImageryLayer(optical, bag()) as FakeLayer
    expect(layer.opts.url).toBe('https://example.com/TCI.tif')
    expect(layer.opts.bandIds).toEqual([0, 1, 2])
    expect(layer.opts.title).toBe('S2C 2025-12-05')
    expect(layer.opts.renderer).toBeUndefined()
  })

  it('builds a single-band percent-clip stretch for SAR — without it a VV COG paints black', () => {
    const layer = buildImageryLayer(sar, bag()) as FakeLayer
    expect(layer.opts.bandIds).toEqual([0])
    expect(layer.opts.renderer).toBeInstanceOf(FakeRenderer)
    expect(layer.opts.renderer.opts.stretchType).toBe('percent-clip')
    expect(layer.opts.renderer.opts.dra).toBe(true)
  })

  it('honours an explicit bandIds override on either sensor', () => {
    const layer = buildImageryLayer({ ...optical, bandIds: [3, 2, 1] }, bag()) as FakeLayer
    expect(layer.opts.bandIds).toEqual([3, 2, 1])
  })
})

describe('buildFootprintLayer', () => {
  it('builds one polygon graphic per scene, each carrying an explicit spatialReference', () => {
    const layer = buildFootprintLayer([optical, sar], fl()) as FakeLayer
    expect(layer.opts.source).toHaveLength(2)
    expect(layer.opts.geometryType).toBe('polygon')
    // SP3b: a geometry without an explicit SR yields a [0,0] extent and renders nothing.
    expect(layer.opts.source[0].geometry.spatialReference).toEqual({ wkid: 4326 })
    expect(layer.opts.source[0].attributes.scene_id).toBe('o1')
    expect(layer.opts.source[0].attributes.__oid).toBe(1)
    expect(layer.opts.source[1].attributes.__oid).toBe(2)
  })

  it('skips scenes with an unusable bbox instead of poisoning the layer', () => {
    const bad = { ...sar, bbox: [Number.NaN, 1.7, 104.9, 2.0] as [number, number, number, number] }
    const layer = buildFootprintLayer([optical, bad], fl()) as FakeLayer
    expect(layer.opts.source).toHaveLength(1)
    expect(layer.opts.source[0].attributes.scene_id).toBe('o1')
  })

  it('returns null when nothing is drawable, so the caller adds no empty layer', () => {
    expect(buildFootprintLayer([], fl())).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/workspace/analyst/hermes-agent && npm test --workspace @hermes/gis-canvas -- src/lib/esri/imagery.test.ts
```

Expected: FAIL — cannot resolve `./imagery`.

- [ ] **Step 3: Write the builders**

Create `apps/gis-canvas/src/lib/esri/imagery.ts`:

```ts
import type { ImageryScene } from '../types'
import { bboxToRings } from '../imagery'

/** The lazily-loaded raster module bag (see loadImagery in ./loader). */
export interface ImageryBag {
  ImageryTileLayer: new (o: unknown) => unknown
  RasterStretchRenderer: new (o: unknown) => unknown
}

const DEFAULT_RGB_BANDS = [0, 1, 2]
const DEFAULT_SAR_BANDS = [0]

/** One ImageryTileLayer per scene, streaming the COG by HTTP range request.
 *
 * Optical visual/TCI assets are already 8-bit RGB and need no stretch. SAR is
 * single-band and high-dynamic-range: without a percent-clip stretch it paints a
 * uniform black rectangle — and SAR is the primary sensor the shadow-fleet
 * workflow recommends for confirming presence during AIS silence. */
export function buildImageryLayer(scene: ImageryScene, esri: ImageryBag): unknown {
  if (scene.sensor === 'sar') {
    return new esri.ImageryTileLayer({
      url: scene.url,
      title: scene.title,
      bandIds: scene.bandIds ?? DEFAULT_SAR_BANDS,
      renderer: new esri.RasterStretchRenderer({
        stretchType: 'percent-clip',
        minPercent: 0.5,
        maxPercent: 0.5,
        dra: true
      })
    })
  }
  return new esri.ImageryTileLayer({
    url: scene.url,
    title: scene.title,
    bandIds: scene.bandIds ?? DEFAULT_RGB_BANDS
  })
}

/** A single client-side polygon layer outlining every candidate scene's bbox, so
 * coverage can be judged against the target before pulling a 170MB COG. Returns
 * null when nothing is drawable — the caller must not add an empty layer. */
export function buildFootprintLayer(
  scenes: ImageryScene[],
  esri: { FeatureLayer: new (o: unknown) => unknown },
  title = 'Imagery footprints'
): unknown | null {
  const graphics = scenes
    .map(scene => ({ scene, rings: bboxToRings(scene.bbox) }))
    .filter((g): g is { scene: ImageryScene; rings: number[][][] } => g.rings != null)
    .map((g, i) => ({
      // SP3b: geometry MUST carry an explicit spatialReference, else the layer
      // gets a [0,0] extent and never renders.
      geometry: { type: 'polygon', rings: g.rings, spatialReference: { wkid: 4326 } },
      attributes: {
        __oid: i + 1,
        scene_id: g.scene.id,
        title: g.scene.title,
        datetime: g.scene.datetime,
        sensor: g.scene.sensor
      }
    }))
  if (!graphics.length) return null
  return new esri.FeatureLayer({
    source: graphics,
    fields: [
      { name: '__oid', alias: '__oid', type: 'oid' },
      { name: 'scene_id', alias: 'Scene', type: 'string' },
      { name: 'title', alias: 'Title', type: 'string' },
      { name: 'datetime', alias: 'Acquired', type: 'string' },
      { name: 'sensor', alias: 'Sensor', type: 'string' }
    ],
    objectIdField: '__oid',
    geometryType: 'polygon',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: { color: '#e0b45b', width: 1.5 }
      }
    },
    popupTemplate: { title: '{title}', content: '{sensor} — {datetime}' },
    title
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /c/workspace/analyst/hermes-agent && npm test --workspace @hermes/gis-canvas -- src/lib/esri/imagery.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Add the lazy loader**

Append to `apps/gis-canvas/src/lib/esri/loader.ts`, after `loadFeatureTable`:

```ts
let imageryCached: Promise<ImageryBag> | null = null

/** Lazy-load the raster modules for COG imagery. Kept out of the main loadEsri()
 * bag for the same reason as loadFeatureTable: raster support pulls decoder WASM
 * that no non-imagery canvas should pay for. */
export function loadImagery(): Promise<ImageryBag> {
  if (imageryCached) return imageryCached
  imageryCached = (async () => {
    const [{ default: ImageryTileLayer }, { default: RasterStretchRenderer }] = await Promise.all([
      import('@arcgis/core/layers/ImageryTileLayer.js'),
      import('@arcgis/core/renderers/RasterStretchRenderer.js')
    ])
    return { ImageryTileLayer, RasterStretchRenderer } as unknown as ImageryBag
  })()
  return imageryCached
}
```

And add the type import at the top of `loader.ts` (`imagery.ts` does not import `loader.ts`, so there is no cycle):

```ts
import type { ImageryBag } from './imagery'
```

- [ ] **Step 6: Typecheck and run the full frontend suite**

```bash
cd /c/workspace/analyst/hermes-agent && npm run build --workspace @hermes/gis-canvas && npm test --workspace @hermes/gis-canvas
```

Expected: build succeeds; 312 tests pass (298 + 8 from Task 2 + 6 from this task).

- [ ] **Step 7: Commit**

```bash
cd /c/workspace/analyst/hermes-agent && git add apps/gis-canvas/src/lib/esri/imagery.ts apps/gis-canvas/src/lib/esri/imagery.test.ts apps/gis-canvas/src/lib/esri/loader.ts && git commit -m "feat(gis-canvas): ImageryTileLayer + footprint builders, lazy loadImagery()"
```

---

## Task 4: ImageryContext provider

**Files:**
- Create: `apps/gis-canvas/src/components/ImageryContext.tsx`
- Modify: `apps/gis-canvas/src/App.tsx:22` (import) and `:189` (mount)

**Interfaces:**
- Consumes: `Imagery` from `../lib/types` (Task 1).
- Produces: `ImageryProvider({ imagery?: Imagery; children: ReactNode })` and `useImagery(): Imagery | undefined`. Task 5's molecule calls `useImagery()`; Task 5's tests wrap in `ImageryProvider`.

- [ ] **Step 1: Write the provider**

This mirrors `OntologyContext.tsx` exactly — same shape, same read-only semantics. It has no behaviour of its own to test in isolation; Task 5's molecule tests exercise it end to end.

Create `apps/gis-canvas/src/components/ImageryContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Imagery } from '../lib/types'

const Ctx = createContext<Imagery | undefined>(undefined)

/** Feeds the canvas doc's top-level `imagery` (every STAC-discovered scene, whether
 * or not it is displayed) to imagery-aware molecules. Read-only in SP4a; SP4b adds
 * the visible-set toggle the catalog molecule writes through. */
export function ImageryProvider({ imagery, children }: { imagery?: Imagery; children: ReactNode }) {
  return <Ctx.Provider value={imagery}>{children}</Ctx.Provider>
}

export function useImagery(): Imagery | undefined {
  return useContext(Ctx)
}
```

- [ ] **Step 2: Mount it in App.tsx**

Add the import next to the `OntologyProvider` import (line 22):

```tsx
import { ImageryProvider } from './components/ImageryContext'
```

Then wrap, immediately inside `OntologyProvider` (line 189-195). The full replacement block:

```tsx
              <OntologyProvider ontology={mergedDoc.ontology}>
                <ImageryProvider imagery={mergedDoc.imagery}>
                  <HandlerProvider actions={actions}>
                    <LayoutProvider store={layout}>
                      <CanvasGrid doc={mergedDoc} />
                    </LayoutProvider>
                  </HandlerProvider>
                </ImageryProvider>
              </OntologyProvider>
```

- [ ] **Step 3: Typecheck and run the suite**

```bash
cd /c/workspace/analyst/hermes-agent && npm run build --workspace @hermes/gis-canvas && npm test --workspace @hermes/gis-canvas
```

Expected: build succeeds; 312 tests still pass.

- [ ] **Step 4: Commit**

```bash
cd /c/workspace/analyst/hermes-agent && git add apps/gis-canvas/src/components/ImageryContext.tsx apps/gis-canvas/src/App.tsx && git commit -m "feat(gis-canvas): ImageryProvider wired into the canvas tree"
```

---

## Task 5: Render imagery on esri:map

**Files:**
- Modify: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`
- Test: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`

**Interfaces:**
- Consumes: `useImagery` (Task 4), `resolveScenes` (Task 2), `buildImageryLayer` / `buildFootprintLayer` (Task 3), `loadImagery` (Task 3).
- Produces: rendered imagery on the map. Nothing downstream imports from here.

**Key constraint:** imagery is added to the map at index 0 (and the footprint layer at index N) so it sits at the bottom of the operational stack. The vector layers are already on the map by this point; inserting at 0 pushes them up. AIS evidence must never end up beneath the raster.

- [ ] **Step 1: Extend the existing loader mock in the test file**

The test file's `vi.mock('../../lib/esri/loader', ...)` factory currently exports only `loadEsri`. Vitest module mocks replace the whole module, so `loadImagery` must be added or the molecule's import is `undefined`. Update the factory at `EsriMapMolecule.test.tsx:11-22` to add one line before the closing brace:

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
  }),
  loadImagery: async () => ({ ImageryTileLayer: class {}, RasterStretchRenderer: class {} })
}))
```

- [ ] **Step 2: Write the failing tests**

Append to `apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx`. Add these two imports at the top of the file, next to the other context imports:

```ts
import { ImageryProvider } from '../ImageryContext'
import type { Imagery } from '../../lib/types'
```

Add a mock for the imagery builders, next to the existing `vi.mock('../../lib/esri/layers', ...)`:

```ts
const builtImagery: Array<{ id: string; sensor: string }> = []
const builtFootprints: string[][] = []
vi.mock('../../lib/esri/imagery', () => ({
  buildImageryLayer: (scene: any) => { builtImagery.push({ id: scene.id, sensor: scene.sensor }); return { imagery: scene.id } },
  buildFootprintLayer: (scenes: any[]) => {
    if (!scenes.length) return null
    builtFootprints.push(scenes.map(s => s.id))
    return { footprints: true }
  }
}))
```

Then the tests:

```ts
describe('EsriMapMolecule imagery', () => {
  const IMAGERY: Imagery = {
    scenes: [
      { id: 'o1', title: 'S2C', url: 'https://x/TCI.tif', sensor: 'optical', datetime: '2025-12-05T03:36:14Z', bbox: [104.58, 1.72, 104.78, 1.94] },
      { id: 's1', title: 'S1A', url: 'https://x/vv.tif', sensor: 'sar', datetime: '2025-12-03T22:11:00Z', bbox: [104.5, 1.7, 104.9, 2.0] }
    ]
  }

  const mount = (props: Record<string, unknown>, imagery: Imagery | undefined = IMAGERY) => {
    const mapNode: ComponentNode = { id: 'm', type: 'esri:map', bindings: { layers: ['mock://incidents'] }, props }
    const added: Array<[unknown, number | undefined]> = []
    const fakeView = {
      map: { add: (l: unknown, i?: number) => { added.push([l, i]) }, removeMany() {} },
      popupEnabled: true,
      on: () => ({ remove() {} })
    }
    const { container } = render(
      <ImageryProvider imagery={imagery}>
        <EsriMapMolecule node={mapNode} renderChild={() => null} />
      </ImageryProvider>
    )
    const mapEl = container.querySelector('arcgis-map') as any
    mapEl.view = fakeView
    mapEl.dispatchEvent(new CustomEvent('arcgisViewReadyChange'))
    return { added, container }
  }

  it('builds only the scenes the map heroes, not the whole catalog', async () => {
    builtImagery.length = 0
    mount({ imagery: { scenes: ['s1'] } })
    await waitFor(() => expect(builtImagery).toEqual([{ id: 's1', sensor: 'sar' }]))
  })

  it('adds imagery beneath the vector layers — AIS evidence must never sit under raster', async () => {
    builtImagery.length = 0
    const { added } = mount({ imagery: { scenes: ['o1', 's1'] } })
    await waitFor(() => expect(builtImagery).toHaveLength(2))
    const imageryAdds = added.filter(([l]) => (l as any).imagery)
    expect(imageryAdds.map(([, i]) => i)).toEqual([0, 1])
  })

  it('draws footprints for every candidate, above the imagery and below the data', async () => {
    builtFootprints.length = 0
    const { added } = mount({ imagery: { scenes: ['o1'], footprints: true } })
    await waitFor(() => expect(builtFootprints).toEqual([['o1', 's1']]))
    const fpAdd = added.find(([l]) => (l as any).footprints)
    expect(fpAdd?.[1]).toBe(1) // one imagery scene occupies index 0
  })

  it('builds no imagery when the map declares none', async () => {
    builtImagery.length = 0
    builtFootprints.length = 0
    mount({})
    await waitFor(() => expect(document.querySelector('arcgis-map')).toBeTruthy())
    expect(builtImagery).toEqual([])
    expect(builtFootprints).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /c/workspace/analyst/hermes-agent && npm test --workspace @hermes/gis-canvas -- src/components/molecules/EsriMapMolecule.test.tsx -t imagery
```

Expected: FAIL — `builtImagery` stays empty; the molecule never calls the builders.

- [ ] **Step 4: Read the imagery props and context in the molecule**

In `EsriMapMolecule.tsx`, add the imports:

```ts
import { loadEsri, loadImagery } from '../../lib/esri/loader'
import { buildImageryLayer, buildFootprintLayer } from '../../lib/esri/imagery'
import { resolveScenes } from '../../lib/imagery'
import { useImagery } from '../ImageryContext'
```

(The first line replaces the existing `import { loadEsri } from '../../lib/esri/loader'`.)

Then, immediately after the existing `const layerMeta = ...` / `layersSig` lines (~line 60), replace the `layersSig` definition with:

```ts
  const layerMeta = (node.props?.layers as Array<{ title?: string; color?: string }> | undefined) ?? []
  const imagery = useImagery()
  const imageryProps = (node.props?.imagery ?? {}) as { scenes?: string[]; footprints?: boolean }
  const imageryIds = Array.isArray(imageryProps.scenes) ? imageryProps.scenes : []
  const footprints = imageryProps.footprints === true
  const layersSig = JSON.stringify({
    layers: layerRefs, meta: layerMeta, render,
    imageryIds, footprints, catalog: (imagery?.scenes ?? []).map(s => s.id)
  })
```

- [ ] **Step 5: Build the imagery layers**

In the same file, inside the build effect's async IIFE, insert this block **after** the closing brace of the `if (!cancelled) { ... }` block and before `})().catch(() => {})` (~line 172):

```ts
      // Imagery LAST, deliberately: the failure path appends to layerErrors with a
      // functional update, and running after setLayerErrors(layerErrs) above means a
      // fast rejection can't be clobbered by it.
      if (cancelled) return
      const scenes = resolveScenes(imagery, imageryIds)
      if (!scenes.length && !footprints) return
      try {
        const ib = await loadImagery()
        if (cancelled) return
        scenes.forEach((scene, i) => {
          try {
            const layer = buildImageryLayer(scene, ib)
            // Index 0..N-1: imagery sits at the BOTTOM of the operational stack.
            // The vector layers are already added, so inserting low pushes them up —
            // AIS evidence must never end up beneath the raster.
            if (view) { view.map.add(layer, i); addedLayersRef.current.push(layer) }
            // A COG that can't be fetched — CORS-less host, requester-pays bucket,
            // expired signed URL, 404 — must SAY so. An absent raster is otherwise
            // indistinguishable from one that simply hasn't painted yet.
            void (layer as { load?: () => Promise<unknown> }).load?.()?.catch(() => {
              if (cancelled) return
              setLayerErrors(prev => [...prev, `imagery '${scene.title}' failed to load — check the asset URL is public, CORS-enabled, and a valid COG`])
            })
          } catch (e) { console.error('imagery layer build failed', scene.id, e) }
        })
        if (footprints) {
          const fp = buildFootprintLayer(imagery?.scenes ?? [], esri)
          if (fp && view) { view.map.add(fp, scenes.length); addedLayersRef.current.push(fp) }
        }
      } catch (e) { console.error('imagery load failed', e) }
```

Both the scene layers and the footprint layer are pushed to `addedLayersRef`, so the existing `view.map.removeMany(addedLayersRef.current)` teardown at the top of the effect clears them on every rebuild. That is the SP3b staleness fix; imagery inherits it for free.

Note `view.map.add` is typed as `add(l: unknown): void` on the element's inline type at the top of the effect. Widen it to `add(l: unknown, index?: number): void` in that type annotation.

- [ ] **Step 6: Run the imagery tests**

```bash
cd /c/workspace/analyst/hermes-agent && npm test --workspace @hermes/gis-canvas -- src/components/molecules/EsriMapMolecule.test.tsx -t imagery
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Run the full frontend suite and typecheck**

```bash
cd /c/workspace/analyst/hermes-agent && npm run build --workspace @hermes/gis-canvas && npm test --workspace @hermes/gis-canvas
```

Expected: build succeeds; 316 tests pass (312 + 4). If any pre-existing map test now fails, the likely cause is the loader mock in Step 1 — confirm `loadImagery` was *added* to the factory rather than replacing `loadEsri`.

- [ ] **Step 8: Commit**

```bash
cd /c/workspace/analyst/hermes-agent && git add apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx apps/gis-canvas/src/components/molecules/EsriMapMolecule.test.tsx && git commit -m "feat(gis-canvas): render COG imagery + footprints on esri:map"
```

---

## Task 6: Agent guidance

Nothing above is reachable until the agent knows the `imagery` block exists — `_CATALOG_HELP` is the only description of the canvas contract the agent ever sees.

**Files:**
- Modify: `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`, after the spatio-temporal block ~line 193)
- Test: `tests/plugins/gis_canvas/test_tools.py`

**Interfaces:**
- Consumes: the validator rules from Task 1.
- Produces: agent-visible documentation. Nothing imports from here.

- [ ] **Step 1: Write the failing acceptance test**

Append to `tests/plugins/gis_canvas/test_tools.py`:

```python
def test_render_view_accepts_imagery_block(plugin):
    spec = {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "imagery": {
            "scenes": [
                {
                    "id": "s2",
                    "title": "S2C 2025-12-05 — Singapore Strait",
                    "url": "https://example.com/TCI.tif",
                    "sensor": "optical",
                    "datetime": "2025-12-05T03:36:14Z",
                    "bbox": [104.58, 1.72, 104.78, 1.94],
                    "collection": "sentinel-2-c1-l2a",
                    "cloud": 2.65,
                }
            ]
        },
        "components": [
            {
                "id": "map1",
                "type": "esri:map",
                "layer": "base",
                "props": {"title": "AIS gap", "imagery": {"scenes": ["s2"], "footprints": True}},
                "bindings": {"layers": ["mock://incidents"]},
            }
        ],
    }
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is True, out.get("errors")
    assert out["doc"]["imagery"]["scenes"][0]["sensor"] == "optical"


def test_catalog_help_documents_imagery(plugin):
    # The agent only knows what _CATALOG_HELP tells it; an undocumented block is
    # dead code no matter how well the client renders it.
    help_text = plugin.tools_canvas._CATALOG_HELP
    assert "imagery" in help_text
    assert "sensor" in help_text
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/workspace/analyst/hermes-agent && python -m pytest tests/plugins/gis_canvas/test_tools.py -k imagery -v
```

Expected: `test_render_view_accepts_imagery_block` PASSES already (Task 1 made the doc valid); `test_catalog_help_documents_imagery` FAILS on the missing text. Both are worth keeping — the first is the end-to-end guard on the tool path.

- [ ] **Step 3: Add the agent guidance**

In `plugins/gis-canvas/tools_canvas.py`, insert into `_CATALOG_HELP` after the spatio-temporal paragraph (the one ending `...OMIT the field props and they are auto-detected."`, ~line 193):

```python
    " SATELLITE IMAGERY (COG): when you have discovered satellite scenes (e.g. via a "
    "STAC search) and the user needs to SEE the imagery, declare a top-level `imagery` "
    "block (a sibling of `layout`/`components`): imagery:{scenes:[{id:'s2', "
    "title:'S2C 2025-12-05 — Singapore Strait', url:'<COG asset href>', "
    "sensor:'optical'|'sar', datetime:'2025-12-05T03:36:14Z', "
    "bbox:[minLon,minLat,maxLon,maxLat], collection:'sentinel-2-c1-l2a', cloud:2.65}]}. "
    "Declare EVERY candidate you found, then hero your best pick(s) on the map with "
    "props.imagery:{scenes:['s2'], footprints:true} — only the ids you list there are "
    "loaded; footprints:true outlines ALL declared scenes so the user can compare "
    "coverage before loading a large scene. `url` MUST be a direct http(s) COG asset "
    "href (a 'visual'/TCI true-colour asset for optical, a vv/vh measurement band for "
    "SAR) — NOT a STAC item or collection link. `sensor` is REQUIRED and must be "
    "correct: a SAR scene marked 'optical' renders as a BLACK RECTANGLE because it "
    "needs a contrast stretch. `bbox` is WGS84 lon-first [minLon,minLat,maxLon,maxLat]. "
    "Imagery is a BACKDROP: it is not selectable and carries no rows — keep the AIS/"
    "vector layers in bindings.layers as the evidence, with imagery underneath. ALSO "
    "author an esri:layer-list so the user can toggle scenes on and off."
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /c/workspace/analyst/hermes-agent && python -m pytest tests/plugins/gis_canvas -q
```

Expected: 136 passed (134 + 2).

- [ ] **Step 5: Commit**

```bash
cd /c/workspace/analyst/hermes-agent && git add plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_tools.py && git commit -m "feat(gis-canvas): teach the agent to declare and hero COG imagery"
```

---

## Task 7: Live verification

Passing tests prove the wiring; only a real COG over a real basemap proves the feature. Everything under `plugins/gis-canvas/` needs a gateway restart to load.

**Files:**
- Modify: `apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md` (add an imagery section)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a verified feature and a reproducible demo path.

- [ ] **Step 1: Restart the gateway and bring up the stack**

Follow `apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md` §2 and §"Restarting the gateway". The gateway MUST be launched from PowerShell — setting the env vars in bash does not propagate `GIS_BFF_PROXY_SECRET` and the BFF then 403s every proxy call. Note that `taskkill /T` kills the whole process tree including any TUI sessions running under the gateway.

- [ ] **Step 2: Restore the demo fixture and run the demo turn**

```bash
cd /c/workspace/analyst/hermes-agent && python scripts/gis_canvas_demo.py
```

Paste the printed prompt at `http://localhost:5174`, then follow it with a second turn asking the agent to add the satellite imagery it would task for the top-ranked gap — supplying the verified COG URL(s) from Task 0, Step 1 so this turn needs no live STAC call.

- [ ] **Step 3: Verify the six properties**

1. The optical scene renders **over the Singapore Strait**, aligned with the basemap coastline.
2. The AIS points/track are drawn **on top of** the imagery, not hidden beneath it.
3. `esri:layer-list` shows each scene by its `title`, and its toggle hides/shows the raster.
4. `footprints: true` outlines every declared candidate, including ones not loaded.
5. A SAR scene shows visible structure, not a black rectangle. (If Task 0 found S1 assets unreadable, verify with the single-band Sentinel-2 substitute and note the limitation.)
6. A deliberately broken URL surfaces the `layer-errors` overlay rather than failing silently. Test by editing one scene's `url` to `https://example.com/nope.tif` in a follow-up turn.

- [ ] **Step 4: Document the demo path**

Add a section to `apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md` recording the verified COG URLs, the second-turn prompt, and any provider gotchas found in Task 0 (requester-pays buckets, etc.). Add a Troubleshooting row: `Imagery layer absent, no error` → the scene id in `props.imagery.scenes` matched nothing in the `imagery` block, or the gateway is running pre-change plugin code.

- [ ] **Step 5: Commit**

```bash
cd /c/workspace/analyst/hermes-agent && git add apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md && git commit -m "docs(gis-canvas): runbook — COG imagery live-verify path"
```

- [ ] **Step 6: Final check**

```bash
cd /c/workspace/analyst/hermes-agent && npm test --workspace @hermes/gis-canvas && python -m pytest tests/plugins/gis_canvas -q && git log --oneline -8
```

Expected: 316 frontend, 136 plugin, and a clean linear history of the seven commits above.

---

## Deferred to SP4b

Do not build these here: the `esri:imagery-catalog` molecule, click-to-toggle via a writable `ImageryContext`, and time-slider filtering of imagery (a `view.timeExtent` subscription driving per-scene `visible`). Per-scene opacity and swipe were deferred by the user. Antimeridian-crossing footprints are out of scope — `bboxToRings` returns `null` for a bbox whose `minLon > maxLon`, which is the correct conservative behaviour until someone needs it.
