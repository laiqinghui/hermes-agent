# GIS Canvas UI Refinement — Workstream 1: Legibility & Resilience

**Design spec.** 2026-07-13. Frontend-only refinement of the Phase 6 redesign
(`apps/gis-canvas/`). This is **Workstream 1 of 2**; the deeper linked-selection
and agent-state work is deferred to Workstream 2 (see *Out of scope* below).

## Context

Phase 6 translated the Claude Design redesign into the app. Live testing against
the real BFF + Data Agent surfaced four issues. Root-cause investigation (see the
debugging pass that preceded this spec) resolved the map-load blocker and pinned
the rest:

- **Map wasn't plotting** — `loadEsri()` eagerly imported `arcgis-feature-table`,
  which pulls `@arcgis/core → @vaadin/grid → @polymer/polymer`; Vite 8's Rolldown
  dep-optimizer mis-emits Polymer's `dom-module.js` (`static import(...)` → browser
  "Unexpected token '('"), so `loadEsri()` rejected before adding any layer. Fixed
  during the debugging pass (lazy `loadFeatureTable()` + `optimizeDeps.exclude`).
  **Not part of this spec** beyond acknowledging the feature-table decision below.
- **Overlay off-center**, **content clipping**, **weak/absent generative feel**, and
  a **broken/empty ESRI feature-table** remain — this spec addresses them.

## Goals

Any agent-authored dashboard should: center its overlays correctly; never clip a
molecule's content regardless of the cell it's given; convey that the UI is being
generated live (skeleton → reveal), paced by each molecule's real readiness; and
never show a broken/empty panel.

## Non-goals (this workstream)

Linked map↔table selection, map-reposition-on-select, surfacing selection/size
context to the agent, and trimming the agent's component vocabulary — all Workstream 2.
No changes to the canvas schema, the plugin, the gateway, or the agent prompt.

## The five pieces

### 1. Overlay centering fix

**Root cause:** Tailwind v4 compiles `-translate-x-1/2` to the CSS **`translate`**
property (`translate: -50% …`), but the entrance keyframes also set the CSS
**`transform`** property with their own `translate(-50%, …)`. `translate` and
`transform` are independent and **compose** → −100% total, shifting the overlay a
full width to the left. Confirmed via computed-style probe (`translate` −50% +
`transform` matrix e=−280 on a 560px element).

**Fix:** in `src/index.css`, remove the `-50%` X from the three keyframes so they
animate only Y-offset + scale + opacity via `transform`; leave `-translate-x-1/2`
(the `translate` property) as the sole, persistent X-centering. They compose to
"centered + animated."

- `gc-dock-in`: `translate(-50%, 10px) scale(.96)` → `translateY(10px) scale(.96)` (and the `100%` frame likewise).
- `gc-panel-in`: `translate(-50%, 16px) scale(.97)` → `translateY(16px) scale(.97)`.
- `gc-toast-in`: `translate(-50%, -8px)` → `translateY(-8px)`.

No changes to `CommandDock.tsx` / `AgentPanel.tsx` / `BuildToast.tsx` markup.
**Files:** `src/index.css`.

### 2. Skeleton → reveal-on-ready

Each async molecule owns its loading state, shows a branded skeleton until its
**own** content is genuinely ready, then fades content in. This makes the map's
multi-second load legible instead of a blank frame inside a drawn container.

- **New atom** `src/components/atoms/Skeleton.tsx`: a shimmer block built from
  `--color-hairline` / `--color-surface(-raised)` tokens, respecting
  `prefers-reduced-motion` (static muted block when reduced). Props for shape
  (line / block / rows) and count.
- **DataTableMolecule**: while a `data://` source is loading (`fetched === null`),
  render skeleton header + N shimmer rows instead of an empty table.
- **EsriMapMolecule**: an absolutely-positioned skeleton overlay inside `EsriFrame`,
  removed (fade-out) once the view is ready **and** layers have been added. Track a
  `ready` state set in the existing `arcgisViewReadyChange` handler after the layer
  loop.
- **Stat/Card**: skeleton only when data-bound and pending (Stat currently reads a
  synchronous `props.value`, so typically no skeleton needed — include the hook only
  where a molecule actually awaits data).
- **Grid entrance:** keep the per-tile `gc-tile-enter` materialize (already fixed to
  survive re-renders via the `entering` set + `onAnimationEnd`); lengthen slightly
  and keep the small index stagger so the build reads deliberately rather than
  abruptly. Sequence per tile: materialize (with skeleton) → content ready → reveal.

**Files:** `src/components/atoms/Skeleton.tsx` (new), `DataTableMolecule.tsx`,
`EsriMapMolecule.tsx`, `CardMolecule.tsx`/`StatMolecule.tsx` (as needed),
`src/index.css` (shimmer keyframe + entrance timing).

### 3. Molecule container-resilience

Make each molecule root a container (`container-type: inline-size`, via Tailwind v4
`@container`) and drive type/layout off container size so content never clips at any
agent-chosen cell size.

- **StatMolecule** (the clipped "20"): value sizing via container-query steps +
  `clamp()`, `overflow-hidden`, ellipsis/line-clamp on value and label, vertical
  centering with a sane min-height. A long or large value in a short tile shrinks
  and/or truncates instead of overflowing.
- **DataTable / Card / Select**: header/density/padding adapt to width; the table
  keeps its internal scroll; controls wrap gracefully.

**Files:** the molecule components under `src/components/molecules/`, plus any
shared container utility in `src/index.css`.

### 4. Drop ESRI feature-table (alias to DataTable)

Remove `EsriFeatureTableMolecule` from `COMPONENT_REGISTRY`. Because a
`feature_table`/`esri-feature-table` node carries the same `data://` handle as a
data table, **alias that node type to `DataTableMolecule`**, adapting its binding
(`bindings.layer` → the DataTable's `source`; ignore `mapRef`). Result: the
redundant tile renders the actual rows instead of a broken/empty Polymer panel, and
no data is lost. If the binding can't be adapted, fall back to a quiet "unavailable"
tile rather than an error.

The `EsriFeatureTableMolecule.tsx` file and `loadFeatureTable()` may remain in the
tree (unused) for possible WS2 reconsideration, but are not registered.

**Files:** `src/components/registry.tsx` (registration + alias), possibly a small
binding-adapter helper.

### 5. Remove debug instrumentation

Strip the temporary `MAPDBG` / `DOCKDBG` / `ANIMDBG` `console.log`s and the temp
dynamic `import('../../lib/esri/graphics')` added during debugging.

**Files:** `EsriMapMolecule.tsx`, `CommandDock.tsx`, `CanvasGrid.tsx`.

## Testing

- **vitest** (keep existing 71 green):
  - `DataTableMolecule` renders `Skeleton` while a data source is pending, rows once
    resolved.
  - `EsriMapMolecule` shows the skeleton overlay before `ready`, hides it after.
  - Registry aliases `esri-feature-table` → DataTable and renders rows from the
    adapted binding; falls back gracefully when the binding is absent.
  - `Skeleton` respects `prefers-reduced-motion` (no shimmer animation class when
    reduced).
- **Visual** (running app, light + dark): overlay centering; the "20" (and other
  values) never clip at small/short cells; the map shows skeleton then reveals; the
  build feels deliberate.

## Out of scope → Workstream 2

Shared row identity across molecules bound to the same `data://` handle;
handle-keyed shared selection with bidirectional map↔table highlight and
map-reposition-on-row-select; surfacing rich selection context (what is selected) and
molecule size/spatial context into the canvas `state` the agent reads (extending the
plugin `STATE_KEYS`/validator); and trimming the agent's component vocabulary so it
stops emitting a separate ESRI feature-table. WS2 gets its own spec.
