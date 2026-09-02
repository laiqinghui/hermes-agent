# Window minimize — declutter the Situation Canvas

**Date:** 2026-09-02
**Status:** approved design, ready for planning
**Continues:** `2026-07-20-draggable-canvas-design.md` (free-window override layer)

## Problem

Every molecule on the Situation Canvas is a free-floating window (see the draggable-canvas
design). As an investigation runs, the agent keeps adding panels — tabs, tables, timelines,
notes — and they stack over the map until the hero view is unusable. Today the only remedies
are dragging panels off to the side or `Reset layout`, which throws away all the user's
placement work.

Users need to temporarily set a panel aside without losing it and without losing its layout.

## Goals

- Get any non-hero window out of the way in one click, reversibly.
- Give a one-click path from "fully cluttered" to "just the map".
- Never hide the hero (the base-layer map).
- Never lose molecule state (fetched rows, published time extent) when a window is set aside.
- Never let the agent's live revisions undo the user's decluttering.

## Non-goals

- Persisting window state across sessions or reloads (ephemeral, like layout overrides).
- Minimize in the no-base `GridLayer` fallback path (it renders no windows at all).
- Keyboard shortcuts.
- Any backend, plugin, or tool-description change. This is SPA-only; no gateway restart
  is needed to verify.

## Two ways to set a window aside

Per user decision, both are offered, as two distinct controls in the window header:

| Control | Result | Use |
|---|---|---|
| chevron | **shaded** — collapses to its header bar, in place | glance away briefly; keeps spatial memory |
| minimize | **minimized** — leaves the canvas for the taskbar | real decluttering |

A window is in exactly one of three states: `open` (default), `shaded`, `minimized`.

## Architecture

### State model

A second ephemeral store, parallel to `useLayoutStore` — geometry and visibility are separate
concerns and must not be conflated (a minimized window keeps its rect untouched, which is what
makes restore land it exactly where it was).

`src/lib/use-window-state.ts`:

```ts
export type WindowState = 'open' | 'shaded' | 'minimized'

export interface WindowStateStore {
  states: Record<string, WindowState>   // absent id = 'open'
  updated: Set<string>                  // minimized ids the agent has revised since
  get: (id: string) => WindowState
  toggleShade: (id: string) => void
  minimize: (id: string) => void
  restore: (id: string) => void         // -> 'open', clears the updated flag
  markUpdated: (id: string) => void
  sync: (minimizableIds: string[]) => void
  toggleFocus: () => void
  reset: () => void
  minimizedIds: string[]
  isFocused: boolean
  isEmpty: boolean
}
```

`sync(ids)` does double duty, deliberately kept as one call so the two lists can never drift:
it prunes entries for molecules the agent removed, and it records the current candidate set
that `toggleFocus` operates on. `FreeCanvas` calls it from the same effect that calls
`store.prune`, passing only ids where `canMinimize` is true.

**Lifecycle — identical to the layout store:** session-ephemeral, never persisted, never sent
to the gateway, and **not** reset on `doc.rev`. Entries are cleared only by `sync` (the molecule
is gone) or `reset` (the user asked). Minimizing is a user decision that outlives revisions.

The store is hoisted in `App` (so `TopBar` can reach it, and so it survives `CanvasGrid`
remounts) and distributed by `WindowStateProvider`, a new file mirroring `LayoutProvider`
in shape and in its NOOP default.

### Update badge

Pure, separately-testable helpers in `src/lib/window-state.ts`:

```ts
export function signatures(doc: CanvasDoc): Record<string, string>  // id -> JSON.stringify(node)
export function changedIds(prev: Record<string, string>, next: Record<string, string>): string[]
```

`FreeCanvas` holds the previous signatures in a ref. On each doc change it diffs, and calls
`markUpdated(id)` for any changed id that is currently **minimized**. The chip then shows an
accent dot. Restoring the window clears the flag.

Canvas docs are small, LLM-authored structures, so a per-node `JSON.stringify` per revision is
not a meaningful cost, and it is immune to the object-identity churn of the merge layer.

### Hero exemption

`canMinimize(node) === (node.layer !== 'base')`.

Enforced in **two** places on purpose, mirroring the existing "base never gets front-z" rule in
`beginGesture`:

1. `Window` renders neither control when `canMinimize` is false.
2. `FreeCanvas` filters base out of the ids passed to `sync`, so `toggleFocus` structurally
   cannot hide the map even if called with a corrupt state.

If a base window somehow carried a non-`open` state, it renders `open` regardless.

### Rendering

`Window` gains four props — `state`, `canMinimize`, `onToggleShade`, `onMinimize` — and renders
three ways:

- **open** — exactly as today.
- **shaded** — positioned at `rect.x/y/w` with auto height (header only); content region and the
  eight resize handles are not rendered; the header remains draggable.
- **minimized** — the outer element carries the `hidden` attribute.

**Minimized windows stay mounted.** This is a load-bearing decision, not an optimization:
`DataTableMolecule` and `EntityDetailMolecule` fetch from the broker on mount, so unmounting
would cost a live Denodo round-trip on every restore; and `EsriTimeSliderMolecule` publishes the
shared time extent through `TimeExtentContext`, so unmounting it would silently reset the map's
time filter. `hidden` keeps React mounted while removing the window from layout and from hit
testing. The map is never minimized, so no ESRI map component is ever placed in a
`display: none` subtree.

### Taskbar

New `src/components/WindowTaskbar.tsx`, rendered inside `FreeCanvas`, only when something is
minimized. Absolutely positioned at `bottom: RESERVE_PCT%` — reusing the existing constant that
seed rects already use to clear the Esri attribution strip, so the taskbar never covers required
attribution. It sits above the windows and the snap guides in z-order.

Each chip shows the molecule's title (the same `humanTitle` derivation the window header uses)
plus an accent dot when the id is in `updated`. Clicking a chip restores the window; because the
layout override was never touched, it returns to its exact prior rect and z.

### Bulk controls in `TopBar`

`Focus map` is added next to `Reset layout`, shown when there is at least one candidate.
It toggles: minimize every candidate — shaded ones included — or restore them all.

`isFocused` is **derived**, not a stored flag: it is true when every candidate is currently
minimized. So if the user manually restores one window while focused, the button reverts to
"minimize everything" rather than getting stuck in a restore state.

`Reset layout` is the "put everything back" button and now also restores and unshades every
window; `canReset` becomes `!layout.isEmpty || !windows.isEmpty`.

## Files

**New**
- `src/lib/window-state.ts` — pure `signatures` / `changedIds`
- `src/lib/use-window-state.ts` — the store
- `src/components/WindowStateProvider.tsx`
- `src/components/WindowTaskbar.tsx`

**Changed**
- `src/components/Window.tsx` — header controls, three render states
- `src/components/FreeCanvas.tsx` — state wiring, `sync`, badge diffing, taskbar mount
- `src/components/TopBar.tsx` — `Focus map`
- `src/App.tsx` — hoist the store, wrap in the provider, extend reset

## Testing

TDD, following the existing suite's conventions.

- `use-window-state.test.ts` — shade/minimize/restore transitions; `sync` prunes dead ids and
  updates candidates; `toggleFocus` round-trips; `markUpdated` set and cleared by `restore`;
  `reset` clears everything.
- `window-state.test.ts` — `signatures` is stable for an unchanged node; `changedIds` reports
  only genuinely changed ids, and reports additions.
- `Window.test.tsx` — both controls present when `canMinimize`, absent for a base node; shaded
  hides content and resize handles but keeps a draggable header; minimized sets `hidden` while
  children remain in the DOM.
- `FreeCanvas.test.tsx` — minimizing puts a chip in the taskbar and hides the window while the
  molecule stays mounted; clicking the chip restores the identical rect; the base map exposes no
  minimize control; a rev that changes a minimized node badges its chip; restore clears the
  badge; `toggleFocus` never minimizes base.
- `TopBar.test.tsx` — `Focus map` appears only with candidates and toggles its label/state.

## Accepted simplifications

- No persistence across reload — consistent with layout overrides today.
- Shaded windows are still draggable and still occupy their header strip over the map; only
  minimize fully clears the canvas.
- The taskbar is a flat, non-scrolling row; with very many minimized windows chips will
  compress. Acceptable at expected panel counts.
- No per-window "restore all others" or window menu.
