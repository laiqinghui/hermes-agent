# Draggable / Resizable Canvas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every molecule on the Situation Canvas — including the map — draggable and resizable, with hybrid magnetic snapping and sticky per-molecule user overrides, while the agent keeps authoring content.

**Architecture:** A client-owned **layout override layer**. `applyAutoShell` + `anchor.ts` are converted into per-molecule **seed rectangles** (`WindowRect`, all `%`); a lifted, ephemeral `Map<id, WindowRect>` of user overrides composes on top (`override ?? seed`). A single `FreeCanvas` renders each molecule as an absolutely-positioned `Window` (header drag bar + resize handles). Snapping and clamping are pure functions. The agent-authored `CanvasDoc` is never mutated.

**Tech Stack:** React 19, TypeScript, Vite 8 (Rolldown), Vitest + @testing-library/react, Tailwind v4.

## Global Constraints

- All window geometry is stored in **percent of the canvas box** (`WindowRect.x/y/w/h`); pixels are used only for live pointer math and per-type min-sizes, converted to `%` at the boundary against the live container rect.
- Layout overrides are **ephemeral client state**, keyed by molecule id: never written into `CanvasDoc`, never sent to the gateway, **survive `doc.rev` changes** (sticky), pruned when their id disappears, and cleared only by **Reset layout**.
- Do **not** collide with the existing `Overrides` / `mergeOverrides` in `src/lib/merge.ts` (that is molecule *interaction* state and resets on `doc.rev`). Use `WindowRect` / `layout` naming for everything here.
- **Drag only via the window header.** The molecule body keeps its own interactions (ESRI map pan/zoom, table scroll). Never attach drag to the body.
- The **flat `GridLayer` fallback** (docs with no `base` molecule) stays byte-for-byte unchanged.
- Keep the `.gc-hud` glass treatment on windows. Map attribution stays visible on first render.
- Tests are colocated `*.test.ts(x)`. **Run `npm test` with the Vite SPA stopped** (node_modules drift on this machine — see memory), then restart the SPA.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/types.ts` (modify) | add `WindowRect` |
| `src/lib/window-layout.ts` (new) | seed conversion, per-type min-size, drag/resize/clamp pure math, constants |
| `src/lib/window-snap.ts` (new) | snap-target computation + snap-resolution (pure) |
| `src/lib/use-layout-store.ts` (new) | ephemeral override store hook (get/set/bringToFront/prune/reset/isEmpty) |
| `src/components/LayoutProvider.tsx` (new) | thin context distributor + `useLayout` hook |
| `src/components/Window.tsx` (new) | one draggable/resizable window (header + handles) |
| `src/components/FreeCanvas.tsx` (new) | compose seed∘override, render Windows, snap guides, Alt toggle |
| `src/components/CanvasGrid.tsx` (modify) | render `FreeCanvas` when a `base` molecule exists; `GridLayer` unchanged |
| `src/components/TopBar.tsx` (modify) | Reset-layout button |
| `src/App.tsx` (modify) | own the layout store, wrap in `LayoutProvider`, pass reset to `TopBar` |

`applyAutoShell` / `anchor.ts` keep their current exports and behaviour; `ShellLayers` in `CanvasGrid.tsx` is superseded by `FreeCanvas` for the interactive path (delete it in Task 7).

---

### Task 1: `WindowRect` type + geometry constants & seed conversion

**Files:**
- Modify: `src/lib/types.ts` (add `WindowRect` after `Size`, ~line 25)
- Create: `src/lib/window-layout.ts`
- Test: `src/lib/window-layout.test.ts`

**Interfaces:**
- Consumes: `CanvasDoc`, `ComponentNode`, `Edge`, `Anchor`, `Size` from `types.ts`; `applyAutoShell`, `edgeForType` from `auto-shell.ts`; `defaultDockSize`, `FLOAT_DEFAULTS` semantics from `anchor.ts` (re-implemented in `%`).
- Produces: `WindowRect`; `seedRects(doc): Record<string, WindowRect>`; `MIN_SIZE_PX`, `minSizePct`, `RESERVE_PCT`.

- [ ] **Step 1: Add the type.** In `src/lib/types.ts`, after the `Size` interface:

```ts
export interface WindowRect {
  x: number // percent of canvas box, left edge
  y: number // percent of canvas box, top edge
  w: number // percent width
  h: number // percent height
  z: number // stacking order
}
```

- [ ] **Step 2: Write the failing test** `src/lib/window-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { seedRects, minSizePct, MIN_SIZE_PX, RESERVE_PCT } from './window-layout'
import type { CanvasDoc } from './types'

const doc = (components: CanvasDoc['components']): CanvasDoc => ({
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 }, components,
})

describe('seedRects', () => {
  it('seeds a lone map as full-bleed at z 0', () => {
    const rects = seedRects(doc([{ id: 'm', type: 'esri:map', layer: 'base' }]))
    expect(rects.m).toEqual({ x: 0, y: 0, w: 100, h: 100, z: 0 })
  })

  it('seeds a right-docked legend as a right rail above z 0', () => {
    const rects = seedRects(doc([
      { id: 'm', type: 'esri:map', layer: 'base' },
      { id: 'lg', type: 'esri:legend', layer: 'dock', edge: 'right' },
    ]))
    expect(rects.lg.x + rects.lg.w).toBeCloseTo(100, 5) // pinned to right edge
    expect(rects.lg.y).toBe(0)
    expect(rects.lg.z).toBeGreaterThan(0)
  })

  it('reserves the attribution strip: a bottom dock stops short of the bottom', () => {
    const rects = seedRects(doc([
      { id: 'm', type: 'esri:map', layer: 'base' },
      { id: 'tb', type: 'data-table', layer: 'dock', edge: 'bottom' },
    ]))
    expect(rects.tb.y + rects.tb.h).toBeCloseTo(100 - RESERVE_PCT, 5)
  })

  it('seeds a float from its anchor + size', () => {
    const rects = seedRects(doc([
      { id: 'm', type: 'esri:map', layer: 'base' },
      { id: 'f', type: 'stat', layer: 'float', anchor: 'top-left', size: { w: 20, h: 15 } },
    ]))
    expect(rects.f.x).toBeGreaterThanOrEqual(0)
    expect(rects.f.y).toBeGreaterThanOrEqual(0)
    expect(rects.f.w).toBe(20)
    expect(rects.f.h).toBe(15)
  })
})

describe('minSizePct', () => {
  it('converts per-type px minimums against the container', () => {
    expect(MIN_SIZE_PX['esri:map']).toEqual({ w: 280, h: 220 })
    const min = minSizePct('esri:map', { w: 1000, h: 800 })
    expect(min).toEqual({ w: 28, h: 27.5 })
  })
  it('falls back to the default minimum for unknown types', () => {
    expect(minSizePct('mystery', { w: 1000, h: 1000 })).toEqual({ w: 16, h: 10 })
  })
})
```

- [ ] **Step 3: Run test to verify it fails.** Run: `npm test -- window-layout` → FAIL ("seedRects is not a function").

- [ ] **Step 4: Implement `src/lib/window-layout.ts`:**

```ts
import type { Anchor, CanvasDoc, ComponentNode, Edge, WindowRect } from './types'
import { applyAutoShell, edgeForType } from './auto-shell'

// Attribution strip reserved at the canvas bottom on first render, as a % of
// height (the map's "Map data ©…" must stay visible). Approximates the old 22px
// px reserve; the user can nudge windows afterward, so exact px is not critical.
export const RESERVE_PCT = 3

// Dock rail thickness as a % of the canvas box, mirroring anchor.ts DOCK_DEFAULTS.
const DOCK_PCT: Record<Edge, { w: number; h: number }> = {
  left: { w: 26, h: 100 }, right: { w: 26, h: 100 },
  top: { w: 100, h: 10 }, bottom: { w: 100, h: 34 },
}
// Float default size + anchor placement, mirroring anchor.ts FLOAT_DEFAULTS.
const FLOAT_PCT: Record<Anchor, { w: number; h: number }> = {
  'top-left': { w: 24, h: 40 }, 'top-right': { w: 24, h: 40 },
  'bottom-left': { w: 24, h: 40 }, 'bottom-right': { w: 24, h: 40 },
  left: { w: 24, h: 60 }, right: { w: 24, h: 60 },
  top: { w: 60, h: 22 }, bottom: { w: 60, h: 22 }, center: { w: 60, h: 60 },
}
const GAP_PCT = 1.5

export const MIN_SIZE_PX: Record<string, { w: number; h: number }> = {
  'esri:map': { w: 280, h: 220 },
  'data-table': { w: 260, h: 160 },
  'esri:feature-table': { w: 260, h: 160 },
  'esri:legend': { w: 180, h: 120 },
  card: { w: 160, h: 100 },
  stat: { w: 120, h: 64 },
  select: { w: 160, h: 64 },
}
const DEFAULT_MIN_PX = { w: 160, h: 100 }

export function minSizePct(type: string, container: { w: number; h: number }): { w: number; h: number } {
  const px = MIN_SIZE_PX[type] ?? DEFAULT_MIN_PX
  return { w: (px.w / container.w) * 100, h: (px.h / container.h) * 100 }
}

function dockRect(edge: Edge, size?: { w: number; h: number }): Omit<WindowRect, 'z'> {
  const s = size ?? DOCK_PCT[edge]
  const bottom = 100 - RESERVE_PCT
  switch (edge) {
    case 'left': return { x: 0, y: 0, w: s.w, h: bottom }
    case 'right': return { x: 100 - s.w, y: 0, w: s.w, h: bottom }
    case 'top': return { x: 0, y: 0, w: 100, h: s.h }
    case 'bottom': return { x: 0, y: bottom - s.h, w: 100, h: s.h }
  }
}

function floatRect(anchor: Anchor, size?: { w: number; h: number }): Omit<WindowRect, 'z'> {
  const s = size ?? FLOAT_PCT[anchor]
  const g = GAP_PCT
  const midX = (100 - s.w) / 2, midY = (100 - s.h) / 2
  const rightX = 100 - s.w - g, bottomY = 100 - s.h - g - RESERVE_PCT
  switch (anchor) {
    case 'top-left': return { x: g, y: g, w: s.w, h: s.h }
    case 'top': return { x: midX, y: g, w: s.w, h: s.h }
    case 'top-right': return { x: rightX, y: g, w: s.w, h: s.h }
    case 'left': return { x: g, y: midY, w: s.w, h: s.h }
    case 'center': return { x: midX, y: midY, w: s.w, h: s.h }
    case 'right': return { x: rightX, y: midY, w: s.w, h: s.h }
    case 'bottom-left': return { x: g, y: bottomY, w: s.w, h: s.h }
    case 'bottom': return { x: midX, y: bottomY, w: s.w, h: s.h }
    case 'bottom-right': return { x: rightX, y: bottomY, w: s.w, h: s.h }
  }
}

/** Convert the agent's auto-shell arrangement into a seed WindowRect per molecule.
 * base → full bleed; dock → its rail slot; float → its anchor point. z ascends by
 * order so docks/floats sit above the map. Pure: no DOM, no overrides. */
export function seedRects(doc: CanvasDoc): Record<string, WindowRect> {
  const resolved = applyAutoShell(doc)
  const out: Record<string, WindowRect> = {}
  resolved.components.forEach((c: ComponentNode, i: number) => {
    if (c.layer === 'base') { out[c.id] = { x: 0, y: 0, w: 100, h: 100, z: 0 }; return }
    if (c.layer === 'float') {
      const r = floatRect((c.anchor as Anchor | undefined) ?? 'top-left', c.size)
      out[c.id] = { ...r, z: i + 1 }; return
    }
    const edge = (c.edge as Edge | undefined) ?? edgeForType(c.type)
    out[c.id] = { ...dockRect(edge, c.size), z: i + 1 }
  })
  return out
}
```

- [ ] **Step 5: Run test to verify it passes.** Run: `npm test -- window-layout` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/types.ts src/lib/window-layout.ts src/lib/window-layout.test.ts
git commit -m "feat(canvas): WindowRect + seed conversion from auto-shell"
```

---

### Task 2: drag / resize / clamp pure math

**Files:**
- Modify: `src/lib/window-layout.ts` (append)
- Test: `src/lib/window-layout.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `WindowRect`, `minSizePct`.
- Produces: `applyDrag(rect, dxPct, dyPct)`, `ResizeHandle`, `applyResize(rect, handle, dxPct, dyPct, minPct)`, `clampToBounds(rect, marginPct)`, `HANDLES`.

- [ ] **Step 1: Write the failing test** (append):

```ts
import { applyDrag, applyResize, clampToBounds } from './window-layout'

describe('applyDrag', () => {
  it('translates by a percent delta', () => {
    expect(applyDrag({ x: 10, y: 10, w: 20, h: 20, z: 1 }, 5, -3))
      .toEqual({ x: 15, y: 7, w: 20, h: 20, z: 1 })
  })
})

describe('applyResize', () => {
  const r = { x: 20, y: 20, w: 40, h: 40, z: 1 }
  const min = { w: 10, h: 10 }
  it('se handle grows width/height, keeps origin', () => {
    expect(applyResize(r, 'se', 5, 5, min)).toMatchObject({ x: 20, y: 20, w: 45, h: 45 })
  })
  it('nw handle moves origin and shrinks, clamped to min size', () => {
    expect(applyResize(r, 'nw', 100, 100, min)).toMatchObject({ w: 10, h: 10 })
  })
})

describe('clampToBounds', () => {
  it('keeps the top edge on-canvas so the header stays reachable', () => {
    expect(clampToBounds({ x: 10, y: -50, w: 20, h: 20, z: 1 }, 8).y).toBe(0)
  })
  it('allows partial off-right but keeps a visible margin', () => {
    const c = clampToBounds({ x: 130, y: 10, w: 20, h: 20, z: 1 }, 8)
    expect(c.x).toBe(92) // 100 - marginPct
  })
})
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npm test -- window-layout` → FAIL.

- [ ] **Step 3: Implement (append to `window-layout.ts`):**

```ts
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export function applyDrag(r: WindowRect, dxPct: number, dyPct: number): WindowRect {
  return { ...r, x: r.x + dxPct, y: r.y + dyPct }
}

/** Resize along a handle. West/north edges move the origin; min size clamps so a
 * window never inverts or collapses below its per-type floor. */
export function applyResize(
  r: WindowRect, h: ResizeHandle, dxPct: number, dyPct: number, min: { w: number; h: number },
): WindowRect {
  let { x, y, w, hgt } = { x: r.x, y: r.y, w: r.w, hgt: r.h }
  if (h.includes('e')) w = Math.max(min.w, r.w + dxPct)
  if (h.includes('s')) hgt = Math.max(min.h, r.h + dyPct)
  if (h.includes('w')) { const nw = Math.max(min.w, r.w - dxPct); x = r.x + (r.w - nw); w = nw }
  if (h.includes('n')) { const nh = Math.max(min.h, r.h - dyPct); y = r.y + (r.h - nh); hgt = nh }
  return { ...r, x, y, w, h: hgt }
}

/** Keep at least `marginPct` of the window on-canvas on each side, and never let
 * the top edge (the drag header) leave the top — so no window is ever lost. */
export function clampToBounds(r: WindowRect, marginPct: number): WindowRect {
  const x = Math.min(Math.max(r.x, marginPct - r.w), 100 - marginPct)
  const y = Math.min(Math.max(r.y, 0), 100 - marginPct)
  return { ...r, x, y }
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `npm test -- window-layout` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/window-layout.ts src/lib/window-layout.test.ts
git commit -m "feat(canvas): drag/resize/clamp pure geometry"
```

---

### Task 3: snapping math

**Files:**
- Create: `src/lib/window-snap.ts`
- Test: `src/lib/window-snap.test.ts`

**Interfaces:**
- Consumes: `WindowRect`.
- Produces: `snapTargets(others, gridPct): { xs, ys }`; `snapDrag(rect, targets, thresholdPct): { rect, guideX, guideY }`.

- [ ] **Step 1: Write the failing test** `src/lib/window-snap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { snapTargets, snapDrag } from './window-snap'
import type { WindowRect } from './types'

const R = (x: number, y: number, w = 20, h = 20): WindowRect => ({ x, y, w, h, z: 1 })

describe('snapTargets', () => {
  it('emits neighbour edges/centres plus grid + canvas edges', () => {
    const t = snapTargets([R(40, 0)], 10)
    expect(t.xs).toContain(40)        // neighbour left
    expect(t.xs).toContain(60)        // neighbour right
    expect(t.xs).toContain(50)        // neighbour centre
    expect(t.xs).toContain(0)         // canvas edge
    expect(t.xs).toContain(100)
    expect(t.xs).toContain(10)        // grid line
  })
})

describe('snapDrag', () => {
  const targets = snapTargets([R(40, 0)], 10)
  it('snaps a near-left edge to the neighbour and reports a guide', () => {
    const res = snapDrag(R(41.5, 30), targets, 3)
    expect(res.rect.x).toBe(40)
    expect(res.guideX).toBe(40)
  })
  it('leaves rects outside the threshold untouched', () => {
    const res = snapDrag(R(55, 30), targets, 3)
    expect(res.rect.x).toBe(55)
    expect(res.guideX).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npm test -- window-snap` → FAIL.

- [ ] **Step 3: Implement `src/lib/window-snap.ts`:**

```ts
import type { WindowRect } from './types'

export interface SnapTargets { xs: number[]; ys: number[] }

/** Candidate snap lines: every other window's left/right/centre-x and
 * top/bottom/centre-y, plus grid lines at `gridPct` cadence and the canvas edges. */
export function snapTargets(others: WindowRect[], gridPct: number): SnapTargets {
  const xs = new Set<number>([0, 100])
  const ys = new Set<number>([0, 100])
  for (let v = gridPct; v < 100; v += gridPct) { xs.add(v); ys.add(v) }
  for (const o of others) {
    xs.add(o.x); xs.add(o.x + o.w); xs.add(o.x + o.w / 2)
    ys.add(o.y); ys.add(o.y + o.h); ys.add(o.y + o.h / 2)
  }
  return { xs: [...xs], ys: [...ys] }
}

function nearest(edges: number[], targets: number[], threshold: number): { offset: number; guide: number } | null {
  let best: { offset: number; guide: number } | null = null
  for (const e of edges) for (const t of targets) {
    const d = t - e
    if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.offset))) best = { offset: d, guide: t }
  }
  return best
}

/** Snap a dragged rect: consider left/right/centre against xs and top/bottom/centre
 * against ys; shift by the nearest within threshold and report the guide line. */
export function snapDrag(r: WindowRect, targets: SnapTargets, threshold: number): { rect: WindowRect; guideX?: number; guideY?: number } {
  const sx = nearest([r.x, r.x + r.w, r.x + r.w / 2], targets.xs, threshold)
  const sy = nearest([r.y, r.y + r.h, r.y + r.h / 2], targets.ys, threshold)
  return {
    rect: { ...r, x: r.x + (sx?.offset ?? 0), y: r.y + (sy?.offset ?? 0) },
    guideX: sx?.guide, guideY: sy?.guide,
  }
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `npm test -- window-snap` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/window-snap.ts src/lib/window-snap.test.ts
git commit -m "feat(canvas): magnetic snap-target math"
```

---

### Task 4: layout store hook + LayoutProvider context

**Files:**
- Create: `src/lib/use-layout-store.ts`
- Create: `src/components/LayoutProvider.tsx`
- Test: `src/lib/use-layout-store.test.ts`

**Interfaces:**
- Consumes: `WindowRect`.
- Produces: `LayoutStore` = `{ overrides: Record<string, WindowRect>; get; set; bringToFront; prune; reset; isEmpty }`; `useLayoutStore()`; `LayoutProvider`; `useLayout()`.

- [ ] **Step 1: Write the failing test** `src/lib/use-layout-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLayoutStore } from './use-layout-store'

describe('useLayoutStore', () => {
  it('sets and reads an override', () => {
    const { result } = renderHook(() => useLayoutStore())
    act(() => result.current.set('a', { x: 1, y: 2, w: 3, h: 4, z: 1 }))
    expect(result.current.get('a')).toEqual({ x: 1, y: 2, w: 3, h: 4, z: 1 })
    expect(result.current.isEmpty).toBe(false)
  })

  it('bringToFront raises z above every other override', () => {
    const { result } = renderHook(() => useLayoutStore())
    act(() => {
      result.current.set('a', { x: 0, y: 0, w: 10, h: 10, z: 1 })
      result.current.set('b', { x: 0, y: 0, w: 10, h: 10, z: 5 })
    })
    act(() => result.current.bringToFront('a'))
    expect(result.current.get('a')!.z).toBeGreaterThan(5)
  })

  it('prune drops overrides whose id is gone; reset clears all', () => {
    const { result } = renderHook(() => useLayoutStore())
    act(() => {
      result.current.set('a', { x: 0, y: 0, w: 10, h: 10, z: 1 })
      result.current.set('b', { x: 0, y: 0, w: 10, h: 10, z: 1 })
    })
    act(() => result.current.prune(['a']))
    expect(result.current.get('b')).toBeUndefined()
    act(() => result.current.reset())
    expect(result.current.isEmpty).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npm test -- use-layout-store` → FAIL.

- [ ] **Step 3: Implement `src/lib/use-layout-store.ts`:**

```ts
import { useCallback, useMemo, useRef, useState } from 'react'
import type { WindowRect } from './types'

export interface LayoutStore {
  overrides: Record<string, WindowRect>
  get: (id: string) => WindowRect | undefined
  set: (id: string, rect: WindowRect) => void
  bringToFront: (id: string) => void
  prune: (validIds: string[]) => void
  reset: () => void
  isEmpty: boolean
}

/** Ephemeral, session-only layout overrides keyed by molecule id. Never persisted,
 * never sent to the gateway, and — unlike interaction Overrides — NOT reset on
 * doc.rev; only prune (id removed) and reset (user) clear entries. */
export function useLayoutStore(): LayoutStore {
  const [overrides, setOverrides] = useState<Record<string, WindowRect>>({})
  const ref = useRef(overrides); ref.current = overrides

  const get = useCallback((id: string) => ref.current[id], [])
  const set = useCallback((id: string, rect: WindowRect) => {
    setOverrides(prev => ({ ...prev, [id]: rect }))
  }, [])
  const bringToFront = useCallback((id: string) => {
    setOverrides(prev => {
      const cur = prev[id]; if (!cur) return prev
      const maxZ = Math.max(0, ...Object.values(prev).map(r => r.z))
      if (cur.z === maxZ && cur.z > 0) return prev
      return { ...prev, [id]: { ...cur, z: maxZ + 1 } }
    })
  }, [])
  const prune = useCallback((validIds: string[]) => {
    const valid = new Set(validIds)
    setOverrides(prev => {
      const next: Record<string, WindowRect> = {}
      let changed = false
      for (const [id, r] of Object.entries(prev)) { if (valid.has(id)) next[id] = r; else changed = true }
      return changed ? next : prev
    })
  }, [])
  const reset = useCallback(() => setOverrides({}), [])

  return useMemo(
    () => ({ overrides, get, set, bringToFront, prune, reset, isEmpty: Object.keys(overrides).length === 0 }),
    [overrides, get, set, bringToFront, prune, reset],
  )
}
```

- [ ] **Step 4: Implement `src/components/LayoutProvider.tsx`:**

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { LayoutStore } from '../lib/use-layout-store'

const NOOP: LayoutStore = {
  overrides: {}, get: () => undefined, set: () => {}, bringToFront: () => {},
  prune: () => {}, reset: () => {}, isEmpty: true,
}
const Ctx = createContext<LayoutStore>(NOOP)

/** Distributes the App-owned layout store to canvas windows. Controlled: App owns
 * the store (so TopBar's Reset can call it too) and passes it straight through. */
export function LayoutProvider({ store, children }: { store: LayoutStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useLayout(): LayoutStore {
  return useContext(Ctx)
}
```

- [ ] **Step 5: Run test to verify it passes.** Run: `npm test -- use-layout-store` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/use-layout-store.ts src/components/LayoutProvider.tsx src/lib/use-layout-store.test.ts
git commit -m "feat(canvas): ephemeral layout override store + provider"
```

---

### Task 5: `Window` — draggable/resizable wrapper

**Files:**
- Create: `src/components/Window.tsx`
- Test: `src/components/Window.test.tsx`

**Interfaces:**
- Consumes: `WindowRect`, `applyDrag`, `applyResize`, `clampToBounds`, `minSizePct`, `HANDLES`, `ResizeHandle` from `window-layout`; `ComponentNode`.
- Produces: `Window` component. Props: `{ node, rect, container, minPx?, onDragMove(dxPct,dyPct,commit), onResizeMove(handle,dxPct,dyPct,commit), onFocus, children }`. **The parent (`FreeCanvas`) owns snap + store writes**; `Window` only reports pointer deltas as `%` of the container and renders chrome.

> Design note: `Window` is deliberately dumb about snapping/clamping — it converts pointer px→% against `container` and calls the callbacks. This keeps DOM-pointer glue thin and puts all policy (snap, clamp, store) in `FreeCanvas`, which is unit-tested via the pure libs. `Window`'s own tests assert it emits the right deltas.

- [ ] **Step 1: Write the failing test** `src/components/Window.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Window } from './Window'
import type { ComponentNode } from '../lib/types'

const node: ComponentNode = { id: 'w1', type: 'stat', props: { title: 'Speed' } }
const rect = { x: 10, y: 10, w: 30, h: 20, z: 1 }
const container = { w: 1000, h: 500 }

function setup(over = {}) {
  const onDragMove = vi.fn(); const onFocus = vi.fn()
  render(
    <Window node={node} rect={rect} container={container}
      onDragMove={onDragMove} onResizeMove={vi.fn()} onFocus={onFocus} {...over}>
      <div>body</div>
    </Window>,
  )
  return { onDragMove, onFocus }
}

describe('Window', () => {
  it('renders the title in the header and positions from the rect', () => {
    setup()
    expect(screen.getByText('Speed')).toBeInTheDocument()
    expect(screen.getByTestId('window-w1')).toHaveStyle({ left: '10%', top: '10%', width: '30%', height: '20%' })
  })

  it('dragging the header reports a percent delta of the container', () => {
    const { onDragMove } = setup()
    const header = screen.getByTestId('window-header-w1')
    fireEvent.pointerDown(header, { clientX: 0, clientY: 0 })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 50 }) // +100px/1000, +50px/500
    expect(onDragMove).toHaveBeenLastCalledWith(10, 10, false)
    fireEvent.pointerUp(window, { clientX: 100, clientY: 50 })
    expect(onDragMove).toHaveBeenLastCalledWith(10, 10, true) // commit
  })

  it('pointerdown anywhere focuses (raises z)', () => {
    const { onFocus } = setup()
    fireEvent.pointerDown(screen.getByTestId('window-w1'))
    expect(onFocus).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npm test -- Window` → FAIL.

- [ ] **Step 3: Implement `src/components/Window.tsx`:**

```tsx
import { useRef, type ReactNode, type PointerEvent as RPointerEvent } from 'react'
import type { ComponentNode, WindowRect } from '../lib/types'
import { HANDLES, type ResizeHandle } from '../lib/window-layout'

interface WindowProps {
  node: ComponentNode
  rect: WindowRect
  container: { w: number; h: number }
  onDragMove: (dxPct: number, dyPct: number, commit: boolean) => void
  onResizeMove: (handle: ResizeHandle, dxPct: number, dyPct: number, commit: boolean) => void
  onFocus: () => void
  children: ReactNode
}

function humanTitle(node: ComponentNode): string {
  const t = (node.props?.title as string | undefined)?.trim()
  return t || node.type.replace(/^esri:/, '').replace(/[-_]/g, ' ')
}

export function Window({ node, rect, container, onDragMove, onResizeMove, onFocus, children }: WindowProps) {
  const start = useRef<{ x: number; y: number } | null>(null)

  // px→% deltas against the live container; window-level listeners so a fast drag
  // that outruns the header still tracks. Released on pointerup.
  const beginDrag = (e: RPointerEvent) => {
    e.preventDefault()
    start.current = { x: e.clientX, y: e.clientY }
    const move = (ev: PointerEvent) => emit(ev, false)
    const up = (ev: PointerEvent) => { emit(ev, true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    const emit = (ev: PointerEvent, commit: boolean) => {
      if (!start.current) return
      onDragMove(((ev.clientX - start.current.x) / container.w) * 100, ((ev.clientY - start.current.y) / container.h) * 100, commit)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const beginResize = (handle: ResizeHandle) => (e: RPointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    start.current = { x: e.clientX, y: e.clientY }
    const emit = (ev: PointerEvent, commit: boolean) => {
      if (!start.current) return
      onResizeMove(handle, ((ev.clientX - start.current.x) / container.w) * 100, ((ev.clientY - start.current.y) / container.h) * 100, commit)
    }
    const move = (ev: PointerEvent) => emit(ev, false)
    const up = (ev: PointerEvent) => { emit(ev, true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      data-testid={`window-${node.id}`}
      onPointerDown={onFocus}
      className="gc-hud pointer-events-auto absolute flex flex-col overflow-hidden rounded-gc-md"
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, zIndex: rect.z }}
    >
      <div
        data-testid={`window-header-${node.id}`}
        onPointerDown={beginDrag}
        className="flex shrink-0 cursor-move items-center gap-1.5 border-b border-hairline/40 px-2 py-1 font-mono text-[10.5px] uppercase tracking-wide text-tertiary select-none"
      >
        <span className="truncate">{humanTitle(node)}</span>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
      {HANDLES.map(h => (
        <span key={h} data-testid={`resize-${node.id}-${h}`} onPointerDown={beginResize(h)}
          className={`absolute ${handleClass(h)}`} />
      ))}
    </div>
  )
}

// Hit-zones for the 8 handles (edges 6px, corners 12px), invisible but grabbable.
function handleClass(h: ResizeHandle): string {
  const edges: Record<ResizeHandle, string> = {
    n: 'top-0 left-0 right-0 h-1.5 cursor-ns-resize',
    s: 'bottom-0 left-0 right-0 h-1.5 cursor-ns-resize',
    e: 'top-0 bottom-0 right-0 w-1.5 cursor-ew-resize',
    w: 'top-0 bottom-0 left-0 w-1.5 cursor-ew-resize',
    ne: 'top-0 right-0 h-3 w-3 cursor-nesw-resize',
    nw: 'top-0 left-0 h-3 w-3 cursor-nwse-resize',
    se: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize',
    sw: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize',
  }
  return edges[h]
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `npm test -- Window` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/Window.tsx src/components/Window.test.tsx
git commit -m "feat(canvas): draggable/resizable Window chrome"
```

---

### Task 6: `FreeCanvas` — compose, snap, render

**Files:**
- Create: `src/components/FreeCanvas.tsx`
- Test: `src/components/FreeCanvas.test.tsx`

**Interfaces:**
- Consumes: `CanvasDoc`, `seedRects`, `applyDrag`, `applyResize`, `clampToBounds`, `minSizePct` (`window-layout`); `snapTargets`, `snapDrag` (`window-snap`); `useLayout` (`LayoutProvider`); `Window`; `COMPONENT_REGISTRY`, `UnknownTile`.
- Produces: `FreeCanvas` component `{ doc }`.

- [ ] **Step 1: Write the failing test** `src/components/FreeCanvas.test.tsx`:

```tsx
import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FreeCanvas } from './FreeCanvas'
import { LayoutProvider } from './LayoutProvider'
import { useLayoutStore } from '../lib/use-layout-store'
import type { CanvasDoc } from '../lib/types'

// jsdom has no layout; give the container a real rect so px→% is finite.
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON: () => {} }) as DOMRect
})

const doc: CanvasDoc = {
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
  components: [
    { id: 'm', type: 'esri:map', layer: 'base' },
    { id: 'lg', type: 'esri:legend', layer: 'dock', edge: 'right' },
  ],
}

function Harness({ doc }: { doc: CanvasDoc }) {
  const store = useLayoutStore()
  return <LayoutProvider store={store}><FreeCanvas doc={doc} /></LayoutProvider>
}

describe('FreeCanvas', () => {
  it('renders one window per molecule, seeded from auto-shell', () => {
    render(<Harness doc={doc} />)
    expect(screen.getByTestId('window-m')).toBeInTheDocument()
    expect(screen.getByTestId('window-lg')).toBeInTheDocument()
    // map full-bleed
    expect(screen.getByTestId('window-m')).toHaveStyle({ left: '0%', top: '0%', width: '100%', height: '100%' })
  })

  it('dragging a window commits a clamped override', () => {
    render(<Harness doc={doc} />)
    const header = screen.getByTestId('window-header-lg')
    fireEvent.pointerDown(header, { clientX: 500, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 300, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 300, clientY: 100 })
    // legend seeded at right edge (x≈74); dragged -20% → override persists (x moved left)
    const el = screen.getByTestId('window-lg')
    expect(el.style.left).not.toBe('74%')
  })
})
```

- [ ] **Step 2: Run test to verify it fails.** Run: `npm test -- FreeCanvas` → FAIL.

- [ ] **Step 3: Implement `src/components/FreeCanvas.tsx`:**

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CanvasDoc, ComponentNode, WindowRect } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { Window } from './Window'
import { useLayout } from './LayoutProvider'
import { seedRects, applyDrag, applyResize, clampToBounds, minSizePct, type ResizeHandle } from '../lib/window-layout'
import { snapTargets, snapDrag } from '../lib/window-snap'

const GRID_PCT = 5
const SNAP_PX = 8
const MARGIN_PCT = 8

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function FreeCanvas({ doc }: { doc: CanvasDoc }) {
  const store = useLayout()
  const boxRef = useRef<HTMLDivElement>(null)
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({})
  const altRef = useRef(false)

  const seeds = useMemo(() => seedRects(doc), [doc])

  // Prune overrides for molecules the agent removed (sticky otherwise — NOT reset
  // on rev). Runs after each doc change.
  useEffect(() => { store.prune(doc.components.map(c => c.id)) }, [doc, store])

  // Track Alt to suppress snapping for fine placement.
  useEffect(() => {
    const set = (e: KeyboardEvent) => { altRef.current = e.altKey }
    window.addEventListener('keydown', set); window.addEventListener('keyup', set)
    return () => { window.removeEventListener('keydown', set); window.removeEventListener('keyup', set) }
  }, [])

  const container = () => {
    const r = boxRef.current?.getBoundingClientRect()
    return { w: r?.width || 1, h: r?.height || 1 }
  }
  const rectOf = (id: string): WindowRect => store.get(id) ?? seeds[id]
  const others = (id: string) => doc.components.filter(c => c.id !== id).map(c => rectOf(c.id))

  const commitDrag = (id: string) => (dxPct: number, dyPct: number, commit: boolean) => {
    let next = applyDrag(seedOrOverride(id), dxPct, dyPct)
    if (!altRef.current) {
      const c = container()
      const snapped = snapDrag(next, snapTargets(others(id), GRID_PCT), (SNAP_PX / c.w) * 100)
      next = snapped.rect
      setGuides(commit ? {} : { x: snapped.guideX, y: snapped.guideY })
    }
    next = clampToBounds(next, MARGIN_PCT)
    store.set(id, next)
    if (commit) setGuides({})
  }

  const commitResize = (id: string) => (handle: ResizeHandle, dxPct: number, dyPct: number, commit: boolean) => {
    const node = doc.components.find(c => c.id === id)!
    const next = applyResize(seedOrOverride(id), handle, dxPct, dyPct, minSizePct(node.type, container()))
    store.set(id, clampToBounds(next, MARGIN_PCT))
    if (commit) setGuides({})
  }

  // Drag/resize deltas are relative to where the window was when the gesture began.
  // We snapshot that rect on first delta of a gesture so a live (uncommitted) drag
  // doesn't compound. Simplest correct form: base each delta on the last committed
  // rect captured at pointerdown — tracked per-id here.
  const gestureBase = useRef<Record<string, WindowRect>>({})
  const seedOrOverride = (id: string) => gestureBase.current[id] ?? rectOf(id)

  const beginGesture = (id: string) => () => { gestureBase.current[id] = rectOf(id); store.bringToFront(id) }
  const endGesture = (id: string) => { delete gestureBase.current[id] }

  const ordered = [...doc.components].sort((a, b) => rectOf(a.id).z - rectOf(b.id).z)

  return (
    <div ref={boxRef} data-testid="free-canvas" className="relative w-full min-h-[80vh] overflow-hidden">
      {ordered.map(node => (
        <Window
          key={node.id}
          node={node}
          rect={rectOf(node.id)}
          container={container()}
          onFocus={beginGesture(node.id)}
          onDragMove={(dx, dy, commit) => { commitDrag(node.id)(dx, dy, commit); if (commit) endGesture(node.id) }}
          onResizeMove={(h, dx, dy, commit) => { commitResize(node.id)(h, dx, dy, commit); if (commit) endGesture(node.id) }}
        >
          {renderNode(node)}
        </Window>
      ))}
      {guides.x !== undefined && <div className="pointer-events-none absolute top-0 bottom-0 z-50 w-px bg-accent/70" style={{ left: `${guides.x}%` }} />}
      {guides.y !== undefined && <div className="pointer-events-none absolute left-0 right-0 z-50 h-px bg-accent/70" style={{ top: `${guides.y}%` }} />}
    </div>
  )
}
```

> Implementer note: the `gestureBase` snapshot (captured in `onFocus`/pointerdown) is what makes live drags stable — each pointermove delta applies to the rect as it was when the gesture began, not to the last mid-drag value. Verify the drag test asserts the *net* delta, and add a test that a two-move drag (pointerdown → move → move → up) lands at the single net offset, not the sum-of-sums.

- [ ] **Step 4: Add the two-move stability test** to `FreeCanvas.test.tsx`:

```tsx
it('a multi-move drag lands at the net offset (no compounding)', () => {
  render(<Harness doc={doc} />)
  fireEvent.pointerDown(screen.getByTestId('window-header-lg'), { clientX: 500, clientY: 100 })
  fireEvent.pointerMove(window, { clientX: 450, clientY: 100 })
  fireEvent.pointerMove(window, { clientX: 400, clientY: 100 }) // net -100px = -10%
  fireEvent.pointerUp(window, { clientX: 400, clientY: 100 })
  // seed x≈74; net -10% (snap may adjust a few %); assert it's near 64, not 54 (compounded)
  const x = parseFloat(screen.getByTestId('window-lg').style.left)
  expect(x).toBeGreaterThan(60)
  expect(x).toBeLessThan(68)
})
```

- [ ] **Step 5: Run tests to verify they pass.** Run: `npm test -- FreeCanvas` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/components/FreeCanvas.tsx src/components/FreeCanvas.test.tsx
git commit -m "feat(canvas): FreeCanvas free-window renderer with snap guides"
```

---

### Task 7: wire into `CanvasGrid`, `App`, `TopBar` (Reset)

**Files:**
- Modify: `src/components/CanvasGrid.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/TopBar.tsx`
- Test: `src/components/CanvasGrid.test.tsx` (update), `src/components/TopBar.test.tsx` (add if present; else create)

**Interfaces:**
- Consumes: `FreeCanvas`, `useLayoutStore`, `LayoutProvider`.
- Produces: interactive path renders `FreeCanvas`; `TopBar` gains `onResetLayout` + `canReset`.

- [ ] **Step 1: Update `CanvasGrid.tsx`** — replace `ShellLayers` usage and delete the old shell/anchor rendering (seed conversion now lives in `window-layout`):

```tsx
import { useMemo, useRef, useState, useEffect, type ReactNode } from 'react'
import type { CanvasDoc, ComponentNode } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { applyAutoShell } from '../lib/auto-shell'
import { FreeCanvas } from './FreeCanvas'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const resolved = useMemo(() => applyAutoShell(doc), [doc])
  const hasBase = resolved.components.some(c => c.layer === 'base')
  return hasBase ? <FreeCanvas doc={resolved} /> : <GridLayer doc={resolved} />
}

// GridLayer unchanged — copy the existing function body verbatim.
function GridLayer({ doc }: { doc: CanvasDoc }) { /* ...unchanged... */ }
```

Delete `ShellLayers` and the now-unused `railStyle`/`floatStyle`/`defaultDockSize`/`edgeForType`/`Anchor`/`Edge` imports from this file. Keep `anchor.ts` (its logic is mirrored by `window-layout`; leave the module and its tests in place — it is still exercised by `window-layout` indirectly and by its own unit tests).

> Reviewer/decision note: `anchor.ts` becomes dead code once `ShellLayers` is gone. Do **not** delete it in this task — flag it for the final review to decide, since removing it also removes `anchor.test.ts`. Keeping it is harmless; the plan chooses to keep to minimize blast radius.

- [ ] **Step 2: Update `App.tsx`** — own the store, wrap, pass Reset:

Add imports:
```tsx
import { LayoutProvider } from './components/LayoutProvider'
import { useLayoutStore } from './lib/use-layout-store'
```
Create the store near the other hooks (after `const [theme, toggleTheme] = useTheme()`):
```tsx
const layout = useLayoutStore()
```
Pass Reset to `TopBar`:
```tsx
<TopBar theme={theme} onToggleTheme={toggleTheme} connected={connected} isBusy={isBusy}
  onLogout={handleLogout} onResetLayout={layout.reset} canReset={!layout.isEmpty} />
```
Wrap the canvas subtree with `LayoutProvider` (inside `SelectionProvider`/`HandlerProvider` is fine; it must be a parent of `CanvasGrid`):
```tsx
<SelectionProvider nodesBySource={nodesBySource} onMirror={mirrorSelection}>
  <HandlerProvider actions={actions}>
    <LayoutProvider store={layout}>
      <CanvasGrid doc={mergedDoc} />
    </LayoutProvider>
  </HandlerProvider>
</SelectionProvider>
```

- [ ] **Step 3: Update `TopBar.tsx`** — add the Reset button (only enabled when overrides exist):

Add to the props type: `onResetLayout: () => void; canReset: boolean`. Render before the theme button:
```tsx
{canReset && (
  <button
    data-testid="reset-layout"
    onClick={onResetLayout}
    className="rounded-gc-sm border border-hairline bg-surface px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary"
  >
    ⤢ Reset layout
  </button>
)}
```

- [ ] **Step 4: Write/adjust tests.** In `CanvasGrid.test.tsx`, the base-doc case now asserts `free-canvas` (not the old `dock-*`/`canvas-base` testids); wrap renders in a `LayoutProvider` + `useLayoutStore` harness like `FreeCanvas.test.tsx`. Keep/verify the no-base grid case still asserts `cell-*`. Add a `TopBar.test.tsx` case:

```tsx
it('shows Reset only when a layout override exists and calls back', () => {
  const onResetLayout = vi.fn()
  const { rerender } = render(<TopBar theme="dark" onToggleTheme={() => {}} connected isBusy={false}
    onLogout={() => {}} onResetLayout={onResetLayout} canReset={false} />)
  expect(screen.queryByTestId('reset-layout')).toBeNull()
  rerender(<TopBar theme="dark" onToggleTheme={() => {}} connected isBusy={false}
    onLogout={() => {}} onResetLayout={onResetLayout} canReset />)
  fireEvent.click(screen.getByTestId('reset-layout'))
  expect(onResetLayout).toHaveBeenCalled()
})
```

- [ ] **Step 5: Run the full suite (SPA stopped).** Run: `npm test` → all pass. Investigate any `dock-*`/`canvas-base` references left in other tests and update them to the `window-*`/`free-canvas` testids.

- [ ] **Step 6: Commit.**

```bash
git add src/components/CanvasGrid.tsx src/App.tsx src/components/TopBar.tsx src/components/CanvasGrid.test.tsx src/components/TopBar.test.tsx
git commit -m "feat(canvas): render FreeCanvas + Reset layout control"
```

---

### Task 8: live verification + docs/memory

**Files:**
- Modify: `apps/gis-canvas/docs/2026-07-20-draggable-canvas-design.md` (append a "Verified" note)

- [ ] **Step 1:** Restart the gateway if needed (no backend change here, so usually not) and start the SPA. Prompt the agent for the standard GREY LADY view. Verify: first render matches today's shell (full-bleed map + glass panels); every molecule (incl. the map) drags via its header and resizes via handles; snapping shows guides and Alt suppresses; a second agent turn keeps dragged panels put and flows only untouched/new ones; Reset restores the agent layout; map attribution visible on first render.
- [ ] **Step 2:** Fix any issues found (each via systematic-debugging), re-run `npm test`.
- [ ] **Step 3:** Append a short "Live-verified" note to the design doc; commit.
- [ ] **Step 4:** Update memory (`gis_canvas_thought_canvas.md` or a new `gis_canvas_draggable_layout.md`) once merged.

---

## Self-Review

- **Spec coverage:** hybrid snap (Task 3, 6) ✓; sticky user-wins overrides (Task 4, 6 prune-not-reset) ✓; map full-bleed then draggable (seed z0 + Window on map, Task 1/5/6) ✓; session-ephemeral, agent never reads (Task 4) ✓; min-size (Task 1/2), bounds (Task 2), new-panel placement (seed + prune; nearest-open-space is out of scope per design non-goals — seeds may overlap, user resolves), overlap/z (bringToFront), attribution (RESERVE_PCT), Reset (Task 7) ✓.
- **Placeholder scan:** `GridLayer` body is "unchanged — copy verbatim" (explicit instruction, not a placeholder); all new code is complete.
- **Type consistency:** `WindowRect` fields `x/y/w/h/z` used identically across `window-layout`, `window-snap`, store, `Window`, `FreeCanvas`; `ResizeHandle`/`HANDLES` shared from `window-layout`; store method names (`get/set/bringToFront/prune/reset/isEmpty`) consistent between hook, provider, and consumers.
- **Known simplification (flag for review):** `RESERVE_PCT = 3` approximates the old 22px attribution strip in `%`; acceptable because the user immediately owns layout. The design's "nearest-open-space nudge" for new panels is deferred (non-goal) — new agent panels seed at their auto-shell spot and may overlap until the user moves them.
```
