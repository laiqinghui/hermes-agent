# GIS Canvas — The Thought Canvas

**Design spec.** 2026-07-17. Evolve the GIS/Situation Canvas from a surface where the agent paints
only the *final* result of a query into the agent's **thought canvas** — a generative UI where the
agent's reasoning stream and each execution step's output are visualized *as they happen*, and where a
map result becomes the full-bleed center stage of a Command-and-Control view with other molecules
stacked on top.

The canvas is the first-class citizen of the UI. The docked chat was step one; this makes the canvas
carry the agent's cognition, so the dock is minimized most of the time and used mainly for input.

## Core principle: two planes, one canvas

The canvas gains a **cognition plane** layered over the existing **result plane**:

- **Cognition plane** — *ephemeral, client-owned.* Projected **deterministically** from the gateway
  event stream that already flows (`reasoning.available` + `tool.start`/`tool.complete`). No backend
  changes and **no extra agent tool calls**: the agent does not author its own thought visuals.
- **Result plane** — *persistent, agent-owned.* The declarative `CanvasDoc` authored via `render_view`.
  The agent's generative effort stays here.

This is the **Hybrid** authorship model (chosen over full agent-authored cognition): the cognition
visuals are deterministic and identical every turn (a virtue for an operator UI), cost zero tokens and
zero latency, and — crucially — the character-by-character thought churn is *inherently* a client
animation over the reasoning token stream, not something the agent can emit via `render_view`.

### Why client-owned cognition needs no per-step registration

Every tool step arrives in the *same* shape regardless of which tool it is —
`lib/activity.ts::activityItemFromEvent` already maps any event to
`{ name, context, args, result, summary, durationS }`, and `lib/summarize-value.ts` + `lib/humanize.ts`
already render *arbitrary* tool payloads (`RowCount: 20`, `Schema: 6 items`). Richer visuals come from a
small, stable set of **shape detectors** (keyed on the *data shape* of the result, exactly like the
existing `detectGeoFields()` / `resolveIdField()`), never a registry of tool names. A brand-new tool
the agent gains tomorrow projects as a generic step molecule with **zero new code**; if its result
*is* rows or geo-rows it automatically gets the richer treatment.

## Current state (what exists today)

- **One-shot rendering.** The agent calls `render_view` (usually once, at the end) with a full
  `CanvasDoc`. `plugins/gis-canvas/tools_canvas.py` validates + stores it; the frontend recognizes the
  update by the `{gis_canvas:true}` envelope on `tool.complete`.
- **Flat grid, no stacking.** `components/CanvasGrid.tsx` renders a single CSS grid; every top-level
  component has an `area {col,colSpan,row,rowSpan}`. **There is no z-stacking / layering model.**
- **The thinking data already flows.** `tui_gateway/server.py` emits `reasoning.available` events
  *interleaved* with `tool.start`/`tool.complete`; `lib/activity.ts` already builds a chronological
  `timeline`. Reasoning is captured per-turn but `components/TurnView.tsx` collapses it into one top
  "Thinking (N)" disclosure *above* the trace, so the "why" is not shown between steps.
- **Static dock.** `components/CommandDock.tsx` shows only the last message; no live step ticker.
- **Fixed molecule registry.** `card, stat, data-table, select, esri:map/legend/feature-table`
  (`components/registry.tsx`), falling back to `UnknownTile`. No cognition molecules.

## Goal

1. Show the agent's reasoning **between** each execution step (Gap #1).
2. Visualize the thinking stream and each step's output on the **canvas itself** as UI molecules,
   center-stage, while the agent works.
3. Keep the **dock minimized** most of the time; when busy it shows the current execution step with a
   left→right sweep animation.
4. When the result involves a **map**, make it the full-bleed center stage of a Command-and-Control
   view, with other molecules stacked on top.
5. Do the above with a **robust stacking primitive**, since none exists today.

Non-goals: agent-authored cognition visuals; reconstructing tool nesting (not derivable from the
stream — only `subagent.*` carries `parent_id`); backend changes to the event stream.

---

## Section 2 — Cognition plane (client-projected, frontend-only)

A new overlay rendered above the result plane, driven entirely by the derived activity for the
**current (busy) turn**. No schema change, no new events.

**Presentation: Narration Spotlight (revised 2026-07-17 after live visual verify).** The first cut
rendered *every* completed step as a molecule in a centered column. Live, a single turn produced 25+
steps (a `data_query` 401 sent the agent into a raw `execute_code`/PKCE fallback — a separate backend
fault, see §Out-of-scope), so the column overflowed the viewport, buried the thinking card off-screen,
and the per-step summaries ("19 fields", raw JSON) gave no sense of *what happened*. The revised design
below is **bounded at any scale** and **narrative**. (Superseded: the stacked shape-detector molecule
grid.)

While busy the plane renders exactly **three bounded, centered elements** — never an accumulating stack:

- **Thinking star (top)** — the `ThinkingMolecule` glass card typing the agent's *current* reasoning
  character-by-character (client typewriter over the latest `reasoning.available`; the agent never calls
  a tool for this). If no reasoning has arrived yet, a subtle `◆ Working…` placeholder so thinking still
  leads.
- **Current-step card (middle)** — **one** card showing the *active* step (the last `running` step, else
  the most recent), narrated as a human sentence with a status glyph and a live left→right sweep. It
  **updates in place** as the agent advances — it never accumulates.
- **Breadcrumb rail (bottom)** — completed steps as compact pills (`✓`/`✕` + short label) in a **single
  non-wrapping row**, bounded: the most recent ~5 on the right, older collapsed into a `+N earlier` chip
  on the left (`overflow:hidden`).

Because the plane is bounded to ~3 compact elements it stays centered and cannot push the thinking card
off-screen — the failure observed live.

- **`narrateStep(step)` — meaningful step content.** A new `lib/narrate.ts` turns `name + args + result`
  into a human sentence + outcome, replacing structural summaries. A small table of known verbs with a
  **generic fallback** (so novel tools still read sensibly, no per-tool registration):

  | tool | narration |
  |---|---|
  | `skill_view` | `Read skill · <skill>` |
  | `data_query` | `Queried <table> · 20 rows` / `· ✕ 401` |
  | `search_files` | `Searched files · 50 matches` |
  | `read_file` | `Read <basename>` |
  | `execute_code` / `terminal` | `Ran <lang>` / `Ran <cmd>` |
  | `render_view` | `Rendered the canvas` |
  | *unknown* | `humanizeLabel(name)` · rows/error tail when present |

  The *outcome* (ok / error / row-count) reuses the existing `describeStep` shape detection
  (`lib/cognition.ts`); the *verb/object* comes from `name`+`args`. `describeStep`'s role narrows to
  supplying that outcome badge — it no longer drives layout.
- **Lifecycle (fade-out).** Cognition is the *process*; the result plane is the *destination*. When the
  turn's final `message.complete` / result `render_view` lands, the thinking + step molecules
  **gracefully dissolve**, and the busy ribbon **collapses to a thin status strip** (e.g. "Idle · last:
  render_view · 20 rows plotted"). The full trail remains recallable through the **existing Inspector**
  (`components/AgentTimeline.tsx`) — no new persistent trail on-canvas.
- **Interleave fix (Gap #1).** `components/TurnView.tsx` re-projects each turn so reasoning is shown
  **between** the steps it triggered — the Hermes main-UI "Thinking → step → Thinking → step" cadence.
  The ordering is already present in the chronological `timeline`; today's flat "Thinking (N)"
  disclosure is replaced by interleaved reasoning headers ahead of each step. `lib/derive-heading.ts`
  supplies the short headings.

Centering: the spotlight is centered on the grid to hold attention, per the C2 intent.

## Section 3 — Dock ticker

`components/CommandDock.tsx` gains a **live mode**, consuming `derived.isBusy` and `trace.at(-1)`
(both already computed in `App.tsx`):

- **Busy + minimized** → shows the current step (humanized name + context + elapsed, e.g.
  "Data Query · retrieving latest 20 rows · 31.3s") with a **left→right sweep** across the pill to
  signal progress.
- **Idle** → today's prompt pill ("Ask the agent to build a dashboard…").

`components/BuildToast.tsx` (already fed by `trace.at(-1)`) is reconciled with this so progress is shown
in one place, not two.

## Section 4 — Result plane: the `layer` + `anchor` stacking primitive

A new, content-driven layering model that powers the C2 map-hero and **collapses to today's flat grid
when unused** (zero regression).

### Schema additions (`ComponentNode`)

- `layer?: 'base' | 'float'` — omitted ⇒ grid (today's behavior).
- `anchor?: 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'`
  — placement for `float` components.
- `size?: { w: number; h: number }` — float panel size as a percentage of the canvas (0–100 each);
  omitted ⇒ a sensible default per anchor (e.g. corner panels ~22%×auto, bottom strip ~full-width×20%).
- `z?: number` — stack order among floats.

`area` remains valid and is the default for grid components. Mirror the additions in
`plugins/gis-canvas/schema/canvas.schema.json`, `plugins/gis-canvas/validator.py`, and
`apps/gis-canvas/src/lib/types.ts`.

**Validator becomes layer-mode-aware** (today `validator.py` *requires* `area` on every top-level
component — that rule must fork on `layer`):

- grid component (no `layer`) → keeps today's `area`-required + `col+span ≤ cols` rules.
- `base` → requires neither `area` nor `anchor`; **at most one `base` per doc**.
- `float` → requires `anchor`; any `area` is ignored (not an error).

### Rendering (`components/CanvasGrid.tsx`)

Split into two layers:

- **base layer** — the single `base` component rendered full-bleed (`absolute inset-0`), `z-0`. A map
  here finally gets real height without an explicit `rowSpan`.
- **float layer** — `float` components absolutely positioned by `anchor` + `size`, stacked by `z`,
  `z-10`, styled as **glass HUD panels** reusing the existing cognition tokens (`backdrop-blur`,
  `border-hairline`, `shadow-gc-overlay`).
- **grid layer** — when **no** component is `base`, render exactly today's CSS grid over all
  components. The entrance animation and `mergeOverrides` path are preserved.

**Z-order handoff:** base (`z-0`) < floats (`z-10`) < cognition plane (`z-20`, Phase A). The cognition
overlay already fades on final result, so the map reveals underneath it naturally — no extra handoff work.

### Auto-hero promotion (robustness — chosen; zone-tiled, revised 2026-07-19)

Phase C (which teaches the agent to author a clean single map+table with explicit `layer`s) ships
*after* B, so during B the agent still emits **flat, sometimes-redundant** grids (live: it authored two
duplicate tables). Auto-hero is therefore what makes the C2 view happen at all before C, and it must
handle messy docs.

A guarded **pure client-side transform** run on the doc before render (does not mutate stored server
state). If the doc contains **exactly one** `esri:map` **and no** component sets `layer`:

- map → `base`.
- **every** other top-level molecule → `float` (**place-all** — nothing dropped), assigned to a zone by
  role and **tiled within the zone** when multiple: stats/telemetry → `top-left` (stack down), legend →
  `top-right`, tables/timeline/other → `bottom` (tile across), `select`/`card` → `top`.
- On any inconsistency (0 or >1 `esri:map`, or an explicit `layer` already present) → returns the doc
  **unchanged** (flat grid / agent-controlled).

So the Command-and-Control view happens **even without agent cooperation** and **faithful to everything
the agent authored** (redundancy stays visible until Phase C fixes authoring); the agent can still set
`layer`/`anchor` explicitly for finer control. This honors the Hybrid philosophy: the core UX never
depends on agent discipline.

(Rejected alternatives: *type-slotted first-wins* — drop extra same-role molecules from the hero,
divert to the Inspector — masks the over-composition but hides agent output; *conservative promotion* —
only hero a clean doc — leaves today's common (messy) case with no C2 view until Phase C.)

## Section 5 — Agent result-composition guidance (repo-tracked)

Edits to `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP` / `RENDER_VIEW_SCHEMA` description) — the
agent guides the *result* plane only, never cognition:

- **`render_view` always required.** Even a text/summary answer ends with a result molecule (a `card`
  or `stat`), so the canvas is never empty — the thought canvas is always the output surface.
- **Hero rule.** "If the result includes geospatial rows, render an `esri:map` as `layer:'base'` and
  place stats/legend/table as anchored `float` panels."
- **Anti-redundancy.** "Author at most one table and/or one map per dataset; do not create redundant
  components showing the same source." Fixes the over-composition flagged in
  `2026-07-17-denodo-skill-tuning-brief.md`.

(The `denodo-data-agent` skill's `data_query`-over-`execute_code` tuning is tracked separately in that
brief and is out of scope here.)

---

## Component / responsibility map

| Unit | Responsibility | Change |
|---|---|---|
| `lib/activity.ts` | derive turns/timeline (has ordering already) | consume for interleave + cognition |
| `lib/cognition.ts` *(new)* | shape-detect a step `result` → outcome (ok/error/rows) for the narration badge | new |
| `lib/narrate.ts` *(new, rework)* | `name`+`args`+`result` → human sentence + outcome (`narrateStep`) | new |
| `components/CognitionPlane.tsx` *(new; reworked to Spotlight)* | thinking star + one current-step card + bounded breadcrumb rail for the busy turn; fade-out | new |
| `components/ThinkingMolecule.tsx` *(new)* | typewriter over current reasoning | new |
| `components/CanvasGrid.tsx` | base/float/grid layering + auto-hero transform | modify |
| `components/CommandDock.tsx` | live step ticker with L→R sweep | modify |
| `components/TurnView.tsx` | interleave reasoning between steps | modify |
| `lib/types.ts` + schema + `validator.py` | `layer`/`anchor`/`size`/`z` | modify |
| `plugins/gis-canvas/tools_canvas.py` | render_view-always + hero + anti-redundancy guidance | modify |

## Data flow

1. User prompt → gateway streams `reasoning.available` + `tool.start/complete` (unchanged).
2. `App.tsx` logs activity → `deriveActivity` → `{turns, timeline, trace, isBusy}` (unchanged).
3. **Cognition plane (Spotlight)** renders from the busy turn: thinking star (latest reasoning) + one
   current-step card (`narrateStep` of the active step) + a bounded breadcrumb rail of completed steps;
   dock ticker reads `isBusy` + `trace.at(-1)`.
4. Agent's final `render_view` → `{gis_canvas:true}` doc on `tool.complete` → `use-canvas-doc` →
   `mergeOverrides` → **auto-hero transform** → `CanvasGrid` renders base/float/grid.
5. Final result → cognition plane fades → status strip; trail stays in Inspector.

## Error handling

- Cognition is best-effort: if `narrateStep`/`describeStep` throws for a step it falls back to
  `humanizeLabel(name)` (never breaks the canvas).
- Auto-hero transform is a guarded pure function; on any inconsistency it returns the doc unchanged
  (falls back to grid).
- Schema validation rejects malformed `layer`/`anchor` with actionable errors, same contract as today.

## Testing

- **Cognition:** `describeStep` shape unit tests (outcome + fallback); `narrateStep` unit tests (known
  verbs + generic fallback); `CognitionPlane` renders thinking star + one current-step card + bounded
  rail (never a per-step stack); interleave ordering test in `TurnView`; fade-out lifecycle on final
  result.
- **Dock:** busy → ticker with current step; idle → prompt pill.
- **Stacking:** `layer/anchor` validation (one base max, float requires anchor); grid unchanged when no
  base (regression); auto-hero promotes a lone `esri:map`; explicit layers respected over auto-hero.
- **Guidance:** covered by live verification (agent authors a hero map + single table for a geo prompt).

## Phasing (each independently shippable)

- **Phase A — Cognition plane** (frontend-only): interleave fix, thinking molecule, step molecules,
  dock ticker, fade lifecycle. Highest value, no schema change, lowest risk. **Shipped**, then
  **reworked to the Narration Spotlight** (bounded current-step card + breadcrumb rail + `narrateStep`)
  after live visual verify showed the stacked-molecule approach cluttered and buried the thinking card.
- **Phase B — Stacking primitive** (schema + validator + grid + glass HUD + auto-hero): the C2
  map-hero.
- **Phase C — Agent composition guidance** (tool-description edits): steers the result plane.

## Decisions locked during brainstorming

- **Hybrid authorship** (client cognition, agent result) over full agent-authored cognition.
- **`layer` + `anchor`** unified primitive over a `hero` flag or a dual `layout.mode`.
- **Fade-out** post-turn lifecycle (trail via Inspector) over a persistent on-canvas trail.
- **Auto-hero promotion** so map-center-stage works without agent cooperation.
- **Auto-hero is zone-tiled place-all** (revised 2026-07-19): every non-map molecule floats into a
  role zone, tiling when multiple, nothing dropped — over type-slotted-first-wins or conservative
  promotion, so today's messy docs still get the C2 view and all agent output stays visible.
- **A → B → C phasing** over a single big-bang change.
- **Cognition = Narration Spotlight** (revised after live verify): thinking star + one in-place
  current-step card + a bounded breadcrumb rail, with `narrateStep` human sentences — over the original
  stacked shape-detector molecule grid (which cluttered and buried the thinking card at real step counts).
