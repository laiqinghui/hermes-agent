# Thought Canvas — Phase B (Stacking primitive & C2 map-hero) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the canvas a content-driven `layer`/`anchor`/`size`/`z` stacking primitive so a map can become the full-bleed base of a Command-and-Control view with other molecules floating over it as glass HUD panels — collapsing to today's flat grid when unused (zero regression), and auto-promoting a lone map even when the agent authors a flat doc.

**Architecture:** Additive schema fields on `ComponentNode` (`layer`, `anchor`, `size`, `z`), a layer-mode-aware validator, a pure client-side `applyAutoHero` transform, a pure anchor→CSS layout helper, and a `CanvasGrid` that renders base+float layers when a `base` exists and the existing flat grid otherwise. No new events, no agent tool calls, no changes to `App.tsx`, selection, or interaction.

**Tech Stack:** React 19 + TypeScript, Vite 8 (Rolldown), Vitest 4.1.9, @testing-library/react, Tailwind v4 (`@theme` tokens). Python 3 + jsonschema (Draft202012) for the validator; pytest.

## Global Constraints

- **Zero regression on the flat grid.** A doc with no `layer` on any component renders exactly as today (same grid CSS, same one-time `gc-tile-enter` entrance animation, same `mergeOverrides` path). This is a hard requirement — the existing `CanvasGrid.test.tsx` suite must stay green unchanged.
- **Frontend + schema/validator only.** No changes to `App.tsx`, `awareness.py`, `interaction.py`, the event stream, or the agent tool descriptions (those are Phase C). If a backend need is discovered, log it in `apps/gis-canvas/docs/2026-07-19-thought-canvas-backend-followups.md` — do NOT fix it here.
- **Auto-hero is a pure, guarded transform** that never mutates stored server state and returns the doc unchanged on any inconsistency (0 or >1 `esri:map`, or any explicit `layer` already present).
- **Auto-hero is zone-tiled place-all:** every non-map top-level molecule becomes a `float` (nothing dropped); multiples in the same zone tile within it.
- **Schema/types/validator stay in sync.** Every field added to `plugins/gis-canvas/schema/canvas.schema.json` is mirrored in `apps/gis-canvas/src/lib/types.ts` and honored by `plugins/gis-canvas/validator.py`.
- `componentNode` in the JSON schema has `additionalProperties: false` — new fields MUST be added to its `properties` or valid docs will be rejected.

**Anchor set (exact, 9 values):** `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right`.

**Role → anchor mapping (auto-hero + float fallback):** `stat`→`top-left`, `esri:legend`→`top-right`, `data-table`→`bottom`, `esri:feature-table`→`bottom`, `select`→`top`, `card`→`top`, anything else→`bottom`.

**Default float size per anchor (percent, `{w,h}`):** corners (`top-left`/`top-right`/`bottom-left`/`bottom-right`) `{24,40}`; sides (`left`/`right`) `{24,60}`; `top` `{60,22}`; `bottom` `{92,34}`; `center` `{60,60}`.

**Z-order:** base `z-0` < floats `z-10` < cognition plane `z-20` (Phase A, unchanged).

---

### Task 1: Schema + validator become layer-mode-aware (Python)

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json` (add `layer`/`anchor`/`size`/`z` to `$defs.componentNode.properties`)
- Modify: `plugins/gis-canvas/validator.py:106-131` (fork the top-level `area` rule on `layer`; add at-most-one-base)
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: existing `validate_doc(doc) -> list[str]`, the `plugin` pytest fixture, `CATALOG`.
- Produces: `validate_doc` accepts `layer`/`anchor`/`size`/`z`; requires `anchor` on `float`; requires neither `area` nor `anchor` on `base`; rejects >1 `base`; grid components (no `layer`) keep today's `area` rules.

- [ ] **Step 1: Write the failing tests**

Append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def test_base_layer_needs_no_area(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "layer": "base",
        "bindings": {"layers": "mock://incidents"},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_float_layer_requires_anchor(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "leg1", "type": "esri:legend",
        "layer": "float",  # no anchor
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("anchor" in e for e in errors)


def test_float_layer_with_anchor_and_size_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "leg1", "type": "esri:legend",
        "layer": "float", "anchor": "top-right",
        "size": {"w": 24, "h": 40}, "z": 2,
    })
    assert plugin.validator.validate_doc(doc) == []


def test_at_most_one_base(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map", "layer": "base",
        "bindings": {"layers": "mock://a"},
    })
    doc["components"].append({
        "id": "map2", "type": "esri:map", "layer": "base",
        "bindings": {"layers": "mock://b"},
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("one 'base'" in e for e in errors)


def test_grid_component_still_requires_area(plugin):
    # Regression: a component with NO layer keeps today's area requirement.
    doc = _minimal_doc()
    del doc["components"][0]["area"]  # stat, no layer
    errors = plugin.validator.validate_doc(doc)
    assert any("area" in e for e in errors)


def test_bad_anchor_value_rejected(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "leg1", "type": "esri:legend",
        "layer": "float", "anchor": "middle-ish",  # not in enum
    })
    errors = plugin.validator.validate_doc(doc)
    assert errors  # schema enum rejects it
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `hermes-agent/`): `python -m pytest tests/plugins/gis_canvas/test_validator.py -v`
Expected: the 6 new tests FAIL (schema rejects unknown `layer`/`anchor`/`size`/`z` props → `additionalProperties` errors; and `test_float_layer_requires_anchor`/`test_at_most_one_base` have no rule yet).

- [ ] **Step 3: Add the schema fields**

In `plugins/gis-canvas/schema/canvas.schema.json`, add to `$defs.componentNode.properties` (alongside `area`):

```json
        "layer": { "enum": ["base", "float"] },
        "anchor": { "enum": ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] },
        "size": {
          "type": "object",
          "additionalProperties": false,
          "required": ["w", "h"],
          "properties": {
            "w": { "type": "number", "minimum": 0, "maximum": 100 },
            "h": { "type": "number", "minimum": 0, "maximum": 100 }
          }
        },
        "z": { "type": "integer" },
```

- [ ] **Step 4: Fork the top-level rule + add the base count check in `validator.py`**

Replace the `if top_level:` block (currently lines ~106-113) with:

```python
        if top_level:
            layer = node.get("layer")
            if layer == "base":
                pass  # base: full-bleed, needs neither area nor anchor
            elif layer == "float":
                if not node.get("anchor"):
                    errors.append(f"'{node_id}': float component requires anchor")
            else:
                area = node.get("area")
                if not area:
                    errors.append(f"'{node_id}': top-level component requires area")
                elif area["col"] + area["colSpan"] - 1 > cols:
                    errors.append(
                        f"'{node_id}': area col {area['col']}+span {area['colSpan']} exceeds grid cols {cols}"
                    )
```

Then, just before `for comp in doc.get("components", []):` (the top-level walk loop, ~line 126), add:

```python
    base_count = sum(1 for c in doc.get("components", []) if c.get("layer") == "base")
    if base_count > 1:
        errors.append(f"at most one 'base' component allowed, found {base_count}")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -v`
Expected: all tests PASS (the new 6 plus the existing ones, including `test_top_level_component_requires_area` — the stat has no layer so its rule is unchanged).

- [ ] **Step 6: Commit**

```bash
git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "feat(gis-canvas): layer/anchor/size/z schema + layer-mode-aware validator"
```

---

### Task 2: TS types + `applyAutoHero` transform

**Files:**
- Modify: `apps/gis-canvas/src/lib/types.ts` (add `Anchor`, `Size`, and the four `ComponentNode` fields)
- Create: `apps/gis-canvas/src/lib/auto-hero.ts`
- Test: `apps/gis-canvas/src/lib/auto-hero.test.ts`

**Interfaces:**
- Consumes: `CanvasDoc`, `ComponentNode` from `./types`.
- Produces:
  - `type Anchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'`
  - `interface Size { w: number; h: number }`
  - `ComponentNode` gains `layer?: 'base' | 'float'`, `anchor?: Anchor`, `size?: Size`, `z?: number`
  - `anchorForType(type: string): Anchor` — role→anchor fallback
  - `applyAutoHero(doc: CanvasDoc): CanvasDoc` — pure, guarded

- [ ] **Step 1: Add the types**

In `apps/gis-canvas/src/lib/types.ts`, after the `Area` interface add:

```ts
export type Anchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'

export interface Size {
  w: number // percent of canvas, 0-100
  h: number // percent of canvas, 0-100
}
```

And extend `ComponentNode` (add the four fields after `area?: Area`):

```ts
  area?: Area
  layer?: 'base' | 'float'
  anchor?: Anchor
  size?: Size
  z?: number
```

- [ ] **Step 2: Write the failing test**

Create `apps/gis-canvas/src/lib/auto-hero.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyAutoHero, anchorForType } from './auto-hero'
import type { CanvasDoc, ComponentNode } from './types'

const comp = (id: string, type: string, extra: Partial<ComponentNode> = {}): ComponentNode =>
  ({ id, type, ...extra })

const doc = (components: ComponentNode[]): CanvasDoc =>
  ({ canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 }, components })

describe('anchorForType', () => {
  it('maps known roles and falls back to bottom', () => {
    expect(anchorForType('stat')).toBe('top-left')
    expect(anchorForType('esri:legend')).toBe('top-right')
    expect(anchorForType('data-table')).toBe('bottom')
    expect(anchorForType('esri:feature-table')).toBe('bottom')
    expect(anchorForType('select')).toBe('top')
    expect(anchorForType('card')).toBe('top')
    expect(anchorForType('future:widget')).toBe('bottom')
  })
})

describe('applyAutoHero', () => {
  it('promotes a lone map to base and floats the rest, zoned + z-ordered', () => {
    const out = applyAutoHero(doc([
      comp('s1', 'stat'),
      comp('m1', 'esri:map'),
      comp('t1', 'data-table'),
    ]))
    const byId = Object.fromEntries(out.components.map(c => [c.id, c]))
    expect(byId.m1.layer).toBe('base')
    expect(byId.m1.anchor).toBeUndefined()
    expect(byId.s1.layer).toBe('float')
    expect(byId.s1.anchor).toBe('top-left')
    expect(byId.t1.layer).toBe('float')
    expect(byId.t1.anchor).toBe('bottom')
    // z preserves document order for stable tiling
    expect(byId.s1.z).toBe(0)
    expect(byId.t1.z).toBe(2)
  })

  it('place-all: two tables both float to bottom (nothing dropped)', () => {
    const out = applyAutoHero(doc([
      comp('m1', 'esri:map'),
      comp('t1', 'data-table'),
      comp('t2', 'data-table'),
    ]))
    const floats = out.components.filter(c => c.layer === 'float')
    expect(floats.map(c => c.id)).toEqual(['t1', 't2'])
    expect(floats.every(c => c.anchor === 'bottom')).toBe(true)
  })

  it('is a no-op when any component already sets a layer', () => {
    const input = doc([comp('m1', 'esri:map', { layer: 'base' }), comp('s1', 'stat')])
    expect(applyAutoHero(input)).toBe(input) // same reference — unchanged
  })

  it('is a no-op when there is not exactly one map', () => {
    const none = doc([comp('s1', 'stat'), comp('t1', 'data-table')])
    expect(applyAutoHero(none)).toBe(none)
    const two = doc([comp('m1', 'esri:map'), comp('m2', 'esri:map')])
    expect(applyAutoHero(two)).toBe(two)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run (from `apps/gis-canvas/`): `npm test -- --run src/lib/auto-hero.test.ts`
Expected: FAIL — `./auto-hero` does not exist.

- [ ] **Step 4: Implement `auto-hero.ts`**

Create `apps/gis-canvas/src/lib/auto-hero.ts`:

```ts
import type { Anchor, CanvasDoc } from './types'

const ROLE_ANCHOR: Record<string, Anchor> = {
  stat: 'top-left',
  'esri:legend': 'top-right',
  'data-table': 'bottom',
  'esri:feature-table': 'bottom',
  select: 'top',
  card: 'top',
}

/** Role→anchor fallback for a floated molecule (also the auto-hero zoning). */
export function anchorForType(type: string): Anchor {
  return ROLE_ANCHOR[type] ?? 'bottom'
}

/**
 * Pure, guarded transform: if the doc has exactly one `esri:map` and NO component
 * sets `layer`, promote the map to `base` and float every other top-level molecule
 * into its role zone (place-all — nothing dropped; `z` = document index for stable
 * tiling). On any inconsistency return the SAME doc reference unchanged (grid mode
 * / agent-controlled). Never mutates the input.
 */
export function applyAutoHero(doc: CanvasDoc): CanvasDoc {
  const comps = doc.components
  if (comps.some(c => c.layer)) return doc
  const maps = comps.filter(c => c.type === 'esri:map')
  if (maps.length !== 1) return doc
  const mapId = maps[0].id
  const next = comps.map((c, i) =>
    c.id === mapId
      ? { ...c, layer: 'base' as const }
      : { ...c, layer: 'float' as const, anchor: anchorForType(c.type), z: i }
  )
  return { ...doc, components: next }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- --run src/lib/auto-hero.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/lib/types.ts apps/gis-canvas/src/lib/auto-hero.ts apps/gis-canvas/src/lib/auto-hero.test.ts
git commit -m "feat(gis-canvas): layer/anchor types + applyAutoHero zone-tiled transform"
```

---

### Task 3: Anchor → CSS layout helper

**Files:**
- Create: `apps/gis-canvas/src/lib/anchor.ts`
- Test: `apps/gis-canvas/src/lib/anchor.test.ts`

**Interfaces:**
- Consumes: `Anchor`, `Size` from `./types`.
- Produces:
  - `defaultSize(anchor: Anchor): Size`
  - `zoneStyle(anchor: Anchor): CSSProperties` — absolute position + flex layout for the zone container that holds all floats sharing that anchor
  - `floatStyle(anchor: Anchor, size?: Size): CSSProperties` — width/height (percent) + scroll cap for one float panel

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/anchor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { defaultSize, zoneStyle, floatStyle } from './anchor'

describe('defaultSize', () => {
  it('gives per-anchor defaults', () => {
    expect(defaultSize('top-left')).toEqual({ w: 24, h: 40 })
    expect(defaultSize('left')).toEqual({ w: 24, h: 60 })
    expect(defaultSize('top')).toEqual({ w: 60, h: 22 })
    expect(defaultSize('bottom')).toEqual({ w: 92, h: 34 })
    expect(defaultSize('center')).toEqual({ w: 60, h: 60 })
  })
})

describe('zoneStyle', () => {
  it('pins corners and stacks them as a column', () => {
    const s = zoneStyle('top-left')
    expect(s.position).toBe('absolute')
    expect(s.top).toBeDefined()
    expect(s.left).toBeDefined()
    expect(s.flexDirection).toBe('column')
  })

  it('lays horizontal strips as a centered row', () => {
    const s = zoneStyle('bottom')
    expect(s.flexDirection).toBe('row')
    expect(s.justifyContent).toBe('center')
    expect(s.bottom).toBeDefined()
    expect(s.left).toBeDefined()
    expect(s.right).toBeDefined()
  })
})

describe('floatStyle', () => {
  it('uses the given size as a width/height percent', () => {
    const s = floatStyle('top-left', { w: 30, h: 50 })
    expect(s.width).toBe('30%')
    expect(s.maxHeight).toBe('50%')
    expect(s.overflow).toBe('auto')
  })

  it('falls back to the anchor default size when none given', () => {
    const s = floatStyle('bottom')
    expect(s.width).toBe('92%')
    expect(s.maxHeight).toBe('34%')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --run src/lib/anchor.test.ts`
Expected: FAIL — `./anchor` does not exist.

- [ ] **Step 3: Implement `anchor.ts`**

Create `apps/gis-canvas/src/lib/anchor.ts`:

```ts
import type { CSSProperties } from 'react'
import type { Anchor, Size } from './types'

const GAP = 12 // px inset from the canvas edge and between tiled floats

const DEFAULTS: Record<Anchor, Size> = {
  'top-left': { w: 24, h: 40 },
  'top-right': { w: 24, h: 40 },
  'bottom-left': { w: 24, h: 40 },
  'bottom-right': { w: 24, h: 40 },
  left: { w: 24, h: 60 },
  right: { w: 24, h: 60 },
  top: { w: 60, h: 22 },
  bottom: { w: 92, h: 34 },
  center: { w: 60, h: 60 },
}

export function defaultSize(anchor: Anchor): Size {
  return DEFAULTS[anchor]
}

// Absolute position + flex layout for the container holding every float that
// shares this anchor. Horizontal strips (top/bottom) flow as a centered row;
// everything else stacks as a column aligned to its edge. The container is
// capped and its floats scroll, so a zone can never overflow the canvas.
// NOTE: transforms are set inline here (never as Tailwind `-translate-*`
// classes) so they don't compose with any keyframe transform (the Phase 6
// centering gotcha); floats do not get an entrance animation.
export function zoneStyle(anchor: Anchor): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    display: 'flex',
    gap: `${GAP}px`,
    maxWidth: `calc(100% - ${GAP * 2}px)`,
    maxHeight: `calc(100% - ${GAP * 2}px)`,
    pointerEvents: 'none', // panels re-enable it (see floatStyle usage in CanvasGrid)
  }
  switch (anchor) {
    case 'top-left':
      return { ...base, top: GAP, left: GAP, flexDirection: 'column', alignItems: 'flex-start' }
    case 'top-right':
      return { ...base, top: GAP, right: GAP, flexDirection: 'column', alignItems: 'flex-end' }
    case 'bottom-left':
      return { ...base, bottom: GAP, left: GAP, flexDirection: 'column', alignItems: 'flex-start' }
    case 'bottom-right':
      return { ...base, bottom: GAP, right: GAP, flexDirection: 'column', alignItems: 'flex-end' }
    case 'left':
      return { ...base, top: '50%', left: GAP, transform: 'translateY(-50%)', flexDirection: 'column', alignItems: 'flex-start' }
    case 'right':
      return { ...base, top: '50%', right: GAP, transform: 'translateY(-50%)', flexDirection: 'column', alignItems: 'flex-end' }
    case 'center':
      return { ...base, top: '50%', left: '50%', transform: 'translate(-50%,-50%)', flexDirection: 'column', alignItems: 'center' }
    case 'top':
      return { ...base, top: GAP, left: GAP, right: GAP, flexDirection: 'row', justifyContent: 'center' }
    case 'bottom':
      return { ...base, bottom: GAP, left: GAP, right: GAP, flexDirection: 'row', justifyContent: 'center' }
  }
}

// One float panel's box: width/height as a percent (of its zone container),
// capped so tall content scrolls inside the glass panel rather than overflowing.
export function floatStyle(anchor: Anchor, size?: Size): CSSProperties {
  const s = size ?? defaultSize(anchor)
  return {
    width: `${s.w}%`,
    maxHeight: `${s.h}%`,
    overflow: 'auto',
    pointerEvents: 'auto',
    flex: '0 0 auto',
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --run src/lib/anchor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/anchor.ts apps/gis-canvas/src/lib/anchor.test.ts
git commit -m "feat(gis-canvas): anchor→CSS zone/float layout helper"
```

---

### Task 4: `CanvasGrid` renders base + float layers (hero mode)

**Files:**
- Modify: `apps/gis-canvas/src/components/CanvasGrid.tsx`
- Test: `apps/gis-canvas/src/components/CanvasGrid.test.tsx` (append; do NOT change existing tests)

**Interfaces:**
- Consumes: `applyAutoHero`, `anchorForType` from `../lib/auto-hero`; `zoneStyle`, `floatStyle` from `../lib/anchor`; `Anchor` from `../lib/types`.
- Produces: `CanvasGrid` renders (a) a full-bleed base + anchored glass float panels when the resolved doc has a `base` component, or (b) exactly today's flat grid when it does not.

**Contract:** "hero mode" = the resolved doc (after `applyAutoHero`) has a `base` component. In hero mode there are only two layers — base and floats — and every non-base component is treated as a float, defaulting a missing `anchor` via `anchorForType(type)` and a missing `size` via the helper. Grid mode is byte-for-byte today's path (entrance animation included).

- [ ] **Step 1: Write the failing tests**

Append to `apps/gis-canvas/src/components/CanvasGrid.test.tsx`:

```ts
test('auto-hero: a lone map renders full-bleed base with floats over it', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 's1', type: 'stat', props: { label: 'Vessels', value: 20 } },
      { id: 'm1', type: 'esri:map', bindings: { layers: 'mock://incidents' } },
      { id: 't1', type: 'data-table', bindings: { source: 'mock://incidents' } },
    ],
  }
  render(<CanvasGrid doc={d} />)
  // base + float layers present; NO grid cells
  expect(screen.getByTestId('canvas-base')).toBeInTheDocument()
  expect(screen.getByTestId('float-s1')).toBeInTheDocument()
  expect(screen.getByTestId('float-t1')).toBeInTheDocument()
  expect(screen.queryByTestId('cell-s1')).toBeNull()
  // the stat's content still renders inside its float panel
  expect(screen.getByText('Vessels')).toBeInTheDocument()
})

test('explicit base/float layers are honored (no auto-hero needed)', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 'm1', type: 'esri:map', layer: 'base', bindings: { layers: 'mock://x' } },
      { id: 'l1', type: 'esri:legend', layer: 'float', anchor: 'top-right' },
    ],
  }
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('canvas-base')).toBeInTheDocument()
  expect(screen.getByTestId('float-l1')).toBeInTheDocument()
})

test('no base → unchanged flat grid (regression: grid cell + CSS preserved)', () => {
  render(<CanvasGrid doc={doc()} />)
  const cell = screen.getByTestId('cell-s1')
  expect(cell.style.gridColumn).toBe('1 / span 3')
  expect(screen.queryByTestId('canvas-base')).toBeNull()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --run src/components/CanvasGrid.test.tsx`
Expected: the 3 new tests FAIL (no `canvas-base`/`float-*` testids yet); the 11 existing tests still PASS.

- [ ] **Step 3: Rewrite `CanvasGrid.tsx` to branch on hero mode**

Replace the whole file with (grid path is the existing code verbatim, extracted into `GridLayer`):

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Anchor, CanvasDoc, ComponentNode } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { applyAutoHero, anchorForType } from '../lib/auto-hero'
import { zoneStyle, floatStyle } from '../lib/anchor'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const resolved = useMemo(() => applyAutoHero(doc), [doc])
  const base = resolved.components.find(c => c.layer === 'base')
  return base
    ? <HeroLayers doc={resolved} base={base} />
    : <GridLayer doc={resolved} />
}

// Full-bleed base + glass float panels grouped into anchor zones.
function HeroLayers({ doc, base }: { doc: CanvasDoc; base: ComponentNode }) {
  const floats = doc.components.filter(c => c !== base)
  // group floats by their (explicit or role-default) anchor
  const zones = new Map<Anchor, ComponentNode[]>()
  for (const c of floats) {
    const a = (c.anchor as Anchor | undefined) ?? anchorForType(c.type)
    const list = zones.get(a) ?? []
    list.push(c)
    zones.set(a, list)
  }
  return (
    <div className="relative w-full min-h-[80vh]">
      <div data-testid="canvas-base" className="absolute inset-0 z-0 overflow-hidden">
        {renderNode(base)}
      </div>
      <div className="absolute inset-0 z-10">
        {[...zones.entries()].map(([anchor, comps]) => (
          <div key={anchor} style={zoneStyle(anchor)}>
            {comps
              .slice()
              .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
              .map(c => {
                const a = (c.anchor as Anchor | undefined) ?? anchor
                return (
                  <div
                    key={c.id}
                    data-testid={`float-${c.id}`}
                    className="rounded-gc-md border border-hairline-strong bg-surface/90 shadow-gc-overlay backdrop-blur"
                    style={floatStyle(a, c.size)}
                  >
                    {renderNode(c)}
                  </div>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}

// Today's flat grid — unchanged (entrance animation preserved).
function GridLayer({ doc }: { doc: CanvasDoc }) {
  const { cols, rowHeight = 80, gap = 8 } = doc.layout

  const seenRef = useRef<Set<string>>(new Set())
  const [entering, setEntering] = useState<Set<string>>(new Set())

  useEffect(() => {
    const fresh = doc.components.map(n => n.id).filter(id => !seenRef.current.has(id))
    if (!fresh.length) return
    fresh.forEach(id => seenRef.current.add(id))
    setEntering(prev => {
      const next = new Set(prev)
      fresh.forEach(id => next.add(id))
      return next
    })
  }, [doc])

  const clearEntering = (id: string) =>
    setEntering(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  return (
    <div
      className="w-full"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeight}px`,
        gap: `${gap}px`
      }}
    >
      {doc.components.map((node, i) => {
        const area = node.area ?? { col: 1, colSpan: cols, row: 1, rowSpan: 1 }
        const isNew = entering.has(node.id)
        return (
          <div
            key={node.id}
            data-testid={`cell-${node.id}`}
            className={`relative overflow-hidden${isNew ? ' gc-tile-enter' : ''}`}
            onAnimationEnd={isNew ? (e) => { if (e.target === e.currentTarget) clearEntering(node.id) } : undefined}
            style={{
              gridColumn: `${area.col} / span ${area.colSpan}`,
              gridRow: `${area.row} / span ${area.rowSpan}`,
              minHeight: 0,
              animationDelay: isNew ? `${Math.min(i, 10) * 70}ms` : undefined
            }}
          >
            {renderNode(node)}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --run src/components/CanvasGrid.test.tsx`
Expected: PASS — all 14 tests (11 existing unchanged + 3 new).

- [ ] **Step 5: Typecheck + full suite + build**

Run (from `apps/gis-canvas/`): `npm run build` (runs `tsc -b` then vite build) and `npm test -- --run`.
Expected: typecheck clean, build clean, full suite green.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/components/CanvasGrid.tsx apps/gis-canvas/src/components/CanvasGrid.test.tsx
git commit -m "feat(gis-canvas): CanvasGrid base/float hero layering + auto-hero wire-up"
```

---

## Post-implementation

- **Live verify (manual, after the branch is built):** hard-refresh the SPA, run the GREY LADY geo prompt, confirm the map fills the canvas as the base with stats (top-left), legend (top-right), and the table (bottom) floating as glass panels over it; confirm a non-geo prompt (no map) still renders today's flat grid unchanged; confirm two-table over-composition tiles at the bottom (both visible), not overlapping/hidden.
- **Backend follow-ups:** none expected from Phase B (floats bind by id/source, so selection/awareness are untouched). If live verify surfaces one, append it to `apps/gis-canvas/docs/2026-07-19-thought-canvas-backend-followups.md` — do not fix inline.
- **Then:** Phase C (agent composition guidance) — separate plan.

## Self-Review

- **Spec coverage:** §4 schema additions → Task 1; layer-mode validator → Task 1; base/float/grid layers → Task 4; glass HUD → Task 4 (Step 3 classes); zone-tiled place-all auto-hero → Task 2; z-order handoff → Task 4 (`z-0`/`z-10`, cognition `z-20` unchanged). Covered.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `Anchor`/`Size`/`ComponentNode` fields defined in Task 2 and consumed by Tasks 3-4; `applyAutoHero`/`anchorForType` signatures match across auto-hero.ts, its test, and CanvasGrid; `zoneStyle`/`floatStyle`/`defaultSize` signatures match across anchor.ts, its test, and CanvasGrid. Consistent.
```
