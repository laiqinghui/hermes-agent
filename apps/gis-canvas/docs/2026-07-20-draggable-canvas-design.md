# Draggable / Resizable Canvas — Design

**Date:** 2026-07-20
**Status:** Approved (brainstorming) — ready for implementation plan
**Branch:** `gis/draggable-canvas`

## Goal

Let the user freely **drag and resize every molecule on the Situation Canvas — including the
map** — while the agent keeps authoring *content*. The agent's arrangement becomes a starting
point; the user owns final spatial coherence.

## Decisions (from brainstorming)

1. **Layout model: Hybrid free + magnetic.** Windows move/resize freely and rest anywhere
   (overlap allowed), but edges magnetically snap to a grid and to neighbouring window edges,
   with alignment guides. Snapping is suppressible with **Alt**.
2. **User vs agent: Sticky overrides (user wins).** Once the user moves/resizes a molecule,
   that geometry sticks across agent re-renders. Untouched molecules re-flow with the agent;
   newly added molecules are seeded into open space. A **Reset layout** control reverts to the
   agent's arrangement.
3. **Map default: full-bleed on first render, then draggable.** Seed geometry reproduces
   today's C2 shell (full-bleed map, glass panels over it); every molecule is simply movable
   from there.
4. **Persistence: session-ephemeral, client-only.** Overrides live in a React context above the
   doc, survive agent re-renders, and are cleared on reload or Reset. The agent never reads
   them. (Future extension: persist to `localStorage` keyed by canvas identity — out of scope.)

## Architecture — Override Layer (Approach ①)

The agent-authored `CanvasDoc` is unchanged and remains the source of *content*. Layout becomes
a two-part composition:

```
seed geometry   =  applyAutoShell(doc) + anchor.ts, converted to WindowRect per molecule
final geometry  =  overrides.get(id)  ??  seed(id)
```

- **`applyAutoShell` + `anchor.ts` stay as the initial-placement brain.** Their base/dock/float
  output is converted into seed rectangles (map = full-bleed; docked = its rail slot; float =
  its anchor point). First render is pixel-identical to the current shell.
- **Overrides** are a `Map<molecule-id, WindowRect>` held in a `LayoutProvider` context (mirrors
  the existing `SelectionProvider` from linked-selection). Because it lives above the doc, a new
  agent render does not reset touched molecules.
- **One free-window renderer** (`FreeCanvas`) replaces the base/dock/float branching for the
  shell case. The flat `GridLayer` fallback (no `base` molecule) is unchanged.

### Geometry & units

`WindowRect = { x, y, w, h, z }`, all of `x/y/w/h` as **percentages of the canvas box** (`z` is
an integer). Percent keeps layout stable when the browser window resizes. Drag/resize math runs
in **px** against the live container rect and is converted to % on commit.

### Seeding rules (base/dock/float → WindowRect%)

| Source layer | Seed rect (%) |
|---|---|
| `base` (map) | `{ x:0, y:0, w:100, h:100, z:0 }` |
| `dock` left / right | full-height rail slot at the edge, width = dock size `w` |
| `dock` top / bottom | full-width rail slot (inset by adjacent vertical rails), height = dock size `h` |
| `float` (9 anchors) | anchor point + `FLOAT_DEFAULTS`/authored `size`, z above map |

Seed geometry keeps today's `ATTRIB` (~22px) gap so the map's attribution shows on first render.
Once the map is dragged/resized into a window, its attribution rides inside its own frame and the
global reservation no longer applies.

## Interaction

- **Drag** — a slim header bar on each `.gc-hud` window (title + move cursor). The **map gets
  this header too**, so its body keeps ESRI pan/zoom; dragging is header-only. Never drag from a
  molecule body (tables scroll, maps pan).
- **Resize** — edge + corner handles that appear on hover.
- **Click-to-front** — focusing a window bumps its `z` to `maxZ + 1`.
- **Reset layout** — a control in the top bar clears all overrides.

## Hybrid snapping

While dragging or resizing, candidate snap lines are computed from:

1. a fixed **grid** cadence (column/row lines),
2. **neighbour windows'** edges and centres,
3. the **canvas edges**.

If a moving edge is within a threshold (~8px) of a candidate, it snaps and a guide line renders.
Holding **Alt** disables snapping for fine placement. Snap targets are recomputed per drag frame
against current geometry.

## Edge cases / 2nd-order details

- **Min size (per type, px):** map 280×220, table 260×160, legend 180×120, card 160×100,
  stat 120×64, default 160×100. Enforced during resize (converted to % against current
  container).
- **Bounds:** a window cannot be dragged mostly off-canvas — its header and a ~32px margin
  always remain in view, so no window is ever lost.
- **New agent panels while overrides exist:** seeded at their auto-shell spot; if that overlaps
  an existing window, nudged to the nearest open space via a simple scan (not full bin-packing).
- **Overlap & z-order:** overlap is allowed by design; stacking is resolved by click-to-front.
- **Removed molecules:** when the agent drops a molecule, its override entry is pruned so the map
  doesn't leak stale geometry.
- **Reset layout:** clears every override; canvas snaps back to pure auto-shell.

## Code shape

| File | Responsibility |
|---|---|
| `src/lib/types.ts` | add `WindowRect`; override-map type |
| `src/lib/overrides.ts` (new) | override store + `apply` / `set` / `clear` / prune helpers |
| `src/lib/geometry.ts` (new) | seed conversion, snapping math, min-size table, bounds clamp |
| `src/components/LayoutProvider.tsx` (new) | context holding the ephemeral override map |
| `src/components/FreeCanvas.tsx` (new) | absolute free-window renderer (seed ∘ override) |
| `src/components/Window.tsx` (new) | draggable/resizable wrapper: header drag bar + resize handles |
| `src/components/CanvasGrid.tsx` | render `FreeCanvas` for the shell case; `GridLayer` fallback unchanged |
| top bar (App) | Reset layout button |

`applyAutoShell` / `anchor.ts` gain a seed-conversion export but keep their current behaviour;
`ShellLayers` is superseded by `FreeCanvas` for the interactive path.

## Testing

- **geometry:** base/dock/float → seed rect for each layer/edge/anchor; ATTRIB gap preserved.
- **snapping:** snaps within threshold to grid / neighbour edge / canvas edge; produces a guide;
  Alt suppresses; no snap outside threshold.
- **min / bounds:** resize clamps to per-type min; drag clamps so header stays on-canvas.
- **override stickiness across re-render:** touched id keeps override, untouched id re-flows to
  new seed, newly added id gets placed, removed id is pruned.
- **z:** click-to-front yields `maxZ + 1`.
- **fallback:** no-`base` doc still renders the flat grid unchanged.

## Non-goals

- Persisting layout across reloads (localStorage) — future extension.
- The agent reading or reacting to user geometry.
- Full gap-packing / auto-tiling of new panels (nearest-open-space nudge only).
- Multi-select / group drag.
