# Thought Canvas — Phase B refine: base-agnostic C2 shell (base / dock / float)

> REQUIRED SUB-SKILL: superpowers:executing-plans. Refines the shipped `base`/`float` Phase B
> (commits `1499dc20b`..`6398d4ed6`) into the hybrid C2 shell after live verify + the Gotham reference.

**Goal:** Replace the free-floating anchored-card model (which collapsed panels and read as opaque
cards) with a base-agnostic **C2 shell**: full-bleed base + **dock** edge rails + **float** cards, with
theme-aware translucent glass and definite-size geometry that fixes the collapse/overflow bugs.

**Architecture:** Add a `dock` layer + `edge` field; generalize `applyAutoHero`→`applyAutoShell` (map→base,
others→dock by role); rework the layout helper into rail + float styles that resolve against a definite
shell box; render base/dock/float layers in `CanvasGrid`; add a `.gc-hud` glass utility. Grid mode
(no base) unchanged. See design §4.

## Global Constraints

- **Zero regression on the flat grid** — no-base docs render exactly as today (grid CSS + entrance anim).
- **Frontend + schema/validator only.** No `App.tsx`/awareness/interaction/agent-tool changes (agent
  authorship is Phase C). Log any backend need in `docs/2026-07-19-thought-canvas-backend-followups.md`.
- **Definite-size geometry:** rails set both cross-axis edges (`top:0;bottom:0` or `left/right`) so
  their thickness `%` and children `%` resolve; floats are direct children of a definite `inset-0` layer.
- **Auto-shell is pure + guarded:** exactly one `esri:map` AND no `layer` set → transform; else return
  the same doc reference. No map ⇒ no promotion (grid).
- **Theme-aware glass** (`.gc-hud`): translucent surface + strong blur + hairline + overlay shadow;
  follows the app theme (dark glass in dark mode, light in light).

**Role → edge (auto-shell + dock fallback):** `data-table`/`esri:feature-table`→`bottom`, `esri:legend`→`right`, `stat`→`left`, `select`/`card`→`top`, else `bottom`.
**Dock thickness defaults (percent):** left/right `w:26`; top `h:10`; bottom `h:34`.
**Z-order:** base `z-0` < docks `z-10` < floats `z-20`.

---

### Task R1: Schema + validator — add `dock` + `edge` (Python)

**Files:** `plugins/gis-canvas/schema/canvas.schema.json`, `plugins/gis-canvas/validator.py`, `tests/plugins/gis_canvas/test_validator.py`

- [ ] **Step 1 — failing tests.** Append:

```python
def test_dock_layer_requires_edge(plugin):
    doc = _minimal_doc()
    doc["components"].append({"id": "tbl", "type": "data-table", "layer": "dock",
                              "bindings": {"source": "mock://x"}})  # no edge
    assert any("edge" in e for e in plugin.validator.validate_doc(doc))

def test_dock_layer_with_edge_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append({"id": "tbl", "type": "data-table", "layer": "dock",
                              "edge": "bottom", "size": {"w": 100, "h": 34},
                              "bindings": {"source": "mock://x"}})
    assert plugin.validator.validate_doc(doc) == []

def test_bad_edge_value_rejected(plugin):
    doc = _minimal_doc()
    doc["components"].append({"id": "tbl", "type": "data-table", "layer": "dock",
                              "edge": "north", "bindings": {"source": "mock://x"}})
    assert plugin.validator.validate_doc(doc)  # schema enum rejects
```

- [ ] **Step 2 — run, expect fail:** `python -m pytest tests/plugins/gis_canvas/test_validator.py -q`
- [ ] **Step 3 — schema:** in `componentNode.properties`, extend `layer` enum and add `edge`:

```json
        "layer": { "enum": ["base", "dock", "float"] },
        "edge": { "enum": ["left", "right", "top", "bottom"] },
```

- [ ] **Step 4 — validator:** add a `dock` branch in the `if top_level:` fork:

```python
            elif layer == "dock":
                if not node.get("edge"):
                    errors.append(f"'{node_id}': dock component requires edge")
```
(place it between the `base` and `float` branches).

- [ ] **Step 5 — run, expect pass** (all green, incl. existing).
- [ ] **Step 6 — commit:** `feat(gis-canvas): dock layer + edge in schema/validator`

---

### Task R2: types + `applyAutoShell`

**Files:** `apps/gis-canvas/src/lib/types.ts`; rename `auto-hero.ts`→`auto-shell.ts` (+ test)

- [ ] **Step 1 — types.** Add `export type Edge = 'left' | 'right' | 'top' | 'bottom'`; change
  `ComponentNode.layer` to `'base' | 'dock' | 'float'`; add `edge?: Edge` (after `anchor?`).
- [ ] **Step 2 — failing test.** Create `src/lib/auto-shell.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { applyAutoShell, edgeForType } from './auto-shell'
import type { CanvasDoc, ComponentNode } from './types'

const comp = (id: string, type: string, extra: Partial<ComponentNode> = {}): ComponentNode => ({ id, type, ...extra })
const doc = (components: ComponentNode[]): CanvasDoc => ({ canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 }, components })

describe('edgeForType', () => {
  it('maps roles to edges, default bottom', () => {
    expect(edgeForType('data-table')).toBe('bottom')
    expect(edgeForType('esri:feature-table')).toBe('bottom')
    expect(edgeForType('esri:legend')).toBe('right')
    expect(edgeForType('stat')).toBe('left')
    expect(edgeForType('select')).toBe('top')
    expect(edgeForType('card')).toBe('top')
    expect(edgeForType('future:widget')).toBe('bottom')
  })
})

describe('applyAutoShell', () => {
  it('promotes a lone map to base and docks the rest by role', () => {
    const out = applyAutoShell(doc([comp('s1', 'stat'), comp('m1', 'esri:map'), comp('t1', 'data-table')]))
    const byId = Object.fromEntries(out.components.map(c => [c.id, c]))
    expect(byId.m1.layer).toBe('base')
    expect(byId.s1.layer).toBe('dock'); expect(byId.s1.edge).toBe('left'); expect(byId.s1.z).toBe(0)
    expect(byId.t1.layer).toBe('dock'); expect(byId.t1.edge).toBe('bottom'); expect(byId.t1.z).toBe(2)
  })
  it('place-all: two tables both dock bottom', () => {
    const out = applyAutoShell(doc([comp('m1', 'esri:map'), comp('t1', 'data-table'), comp('t2', 'data-table')]))
    const docks = out.components.filter(c => c.layer === 'dock')
    expect(docks.map(c => c.id)).toEqual(['t1', 't2'])
    expect(docks.every(c => c.edge === 'bottom')).toBe(true)
  })
  it('no-op when a layer is already set', () => {
    const input = doc([comp('m1', 'esri:map', { layer: 'base' }), comp('s1', 'stat')])
    expect(applyAutoShell(input)).toBe(input)
  })
  it('no-op when not exactly one map', () => {
    const none = doc([comp('s1', 'stat')]); expect(applyAutoShell(none)).toBe(none)
    const two = doc([comp('m1', 'esri:map'), comp('m2', 'esri:map')]); expect(applyAutoShell(two)).toBe(two)
  })
})
```

- [ ] **Step 3 — run, expect fail.**
- [ ] **Step 4 — implement.** `git mv apps/gis-canvas/src/lib/auto-hero.ts apps/gis-canvas/src/lib/auto-shell.ts` and replace its contents:

```ts
import type { Edge, CanvasDoc } from './types'

const ROLE_EDGE: Record<string, Edge> = {
  'data-table': 'bottom',
  'esri:feature-table': 'bottom',
  'esri:legend': 'right',
  stat: 'left',
  select: 'top',
  card: 'top',
}

/** Role→edge fallback for a docked molecule (also the auto-shell rail assignment). */
export function edgeForType(type: string): Edge {
  return ROLE_EDGE[type] ?? 'bottom'
}

/**
 * Pure, guarded transform: exactly one `esri:map` and NO component sets `layer` →
 * promote the map to `base` and dock every other top-level molecule to its role edge
 * (place-all; `z` = document index). Any inconsistency → the SAME doc reference.
 */
export function applyAutoShell(doc: CanvasDoc): CanvasDoc {
  const comps = doc.components
  if (comps.some(c => c.layer)) return doc
  const maps = comps.filter(c => c.type === 'esri:map')
  if (maps.length !== 1) return doc
  const mapId = maps[0].id
  const next = comps.map((c, i) =>
    c.id === mapId
      ? { ...c, layer: 'base' as const }
      : { ...c, layer: 'dock' as const, edge: edgeForType(c.type), z: i }
  )
  return { ...doc, components: next }
}
```
Delete `auto-hero.test.ts` (replaced by `auto-shell.test.ts`).

- [ ] **Step 5 — run, expect pass.**
- [ ] **Step 6 — commit:** `feat(gis-canvas): applyAutoShell (map->base, others->dock by edge)`

---

### Task R3: rail + float layout helpers + `.gc-hud` glass

**Files:** `apps/gis-canvas/src/lib/anchor.ts` (+ test), `apps/gis-canvas/src/index.css`

- [ ] **Step 1 — rewrite the test** `src/lib/anchor.test.ts` (drop `zoneStyle`; add `railStyle`/`defaultDockSize`; keep `defaultSize`/`floatStyle`):

```ts
import { describe, it, expect } from 'vitest'
import { defaultSize, defaultDockSize, railStyle, floatStyle } from './anchor'

describe('defaultDockSize', () => {
  it('per-edge thickness defaults', () => {
    expect(defaultDockSize('left')).toEqual({ w: 26, h: 100 })
    expect(defaultDockSize('bottom')).toEqual({ w: 100, h: 34 })
    expect(defaultDockSize('top')).toEqual({ w: 100, h: 10 })
  })
})

describe('railStyle', () => {
  it('left rail fills full height with a definite width', () => {
    const s = railStyle('left')
    expect(s.position).toBe('absolute')
    expect(s.top).toBe(0); expect(s.bottom).toBe(0); expect(s.left).toBe(0)
    expect(s.width).toBe('26%'); expect(s.flexDirection).toBe('column')
  })
  it('bottom rail fills width (inset by vertical rails) with a definite height', () => {
    const s = railStyle('bottom', undefined, { left: '26%', right: '0' })
    expect(s.bottom).toBe(0); expect(s.left).toBe('26%'); expect(s.right).toBe('0')
    expect(s.height).toBe('34%'); expect(s.flexDirection).toBe('row')
  })
})

describe('floatStyle', () => {
  it('positions at the anchor with definite % size', () => {
    const s = floatStyle('top-left', { w: 30, h: 50 })
    expect(s.position).toBe('absolute'); expect(s.top).toBe(12); expect(s.left).toBe(12)
    expect(s.width).toBe('30%'); expect(s.maxHeight).toBe('50%')
  })
  it('falls back to anchor default size', () => {
    const s = floatStyle('bottom')
    expect(s.width).toBe('60%'); expect(s.maxHeight).toBe('22%')
  })
})

describe('defaultSize', () => {
  it('float anchor defaults preserved', () => {
    expect(defaultSize('top-left')).toEqual({ w: 24, h: 40 })
  })
})
```

- [ ] **Step 2 — run, expect fail** (`railStyle`/`defaultDockSize` missing).
- [ ] **Step 3 — rewrite `src/lib/anchor.ts`:**

```ts
import type { CSSProperties } from 'react'
import type { Anchor, Edge, Size } from './types'

const GAP = 12 // px inset/padding

const FLOAT_DEFAULTS: Record<Anchor, Size> = {
  'top-left': { w: 24, h: 40 }, 'top-right': { w: 24, h: 40 },
  'bottom-left': { w: 24, h: 40 }, 'bottom-right': { w: 24, h: 40 },
  left: { w: 24, h: 60 }, right: { w: 24, h: 60 },
  top: { w: 60, h: 22 }, bottom: { w: 60, h: 22 }, center: { w: 60, h: 60 },
}

const DOCK_DEFAULTS: Record<Edge, Size> = {
  left: { w: 26, h: 100 }, right: { w: 26, h: 100 },
  top: { w: 100, h: 10 }, bottom: { w: 100, h: 34 },
}

export function defaultSize(anchor: Anchor): Size { return FLOAT_DEFAULTS[anchor] }
export function defaultDockSize(edge: Edge): Size { return DOCK_DEFAULTS[edge] }

export interface RailInsets { left?: string; right?: string }

// A dock rail: absolute, definite-size flex box pinned to `edge`. Vertical rails
// fill full height (top:0;bottom:0) with a % width; horizontal rails fill width
// (inset by any adjacent vertical rails) with a % height. Definite by construction
// so thickness and children percentages resolve.
export function railStyle(edge: Edge, size?: Size, insets: RailInsets = {}): CSSProperties {
  const s = size ?? DOCK_DEFAULTS[edge]
  const base: CSSProperties = { position: 'absolute', display: 'flex', gap: `${GAP}px`, padding: `${GAP}px` }
  switch (edge) {
    case 'left': return { ...base, top: 0, bottom: 0, left: 0, width: `${s.w}%`, flexDirection: 'column' }
    case 'right': return { ...base, top: 0, bottom: 0, right: 0, width: `${s.w}%`, flexDirection: 'column' }
    case 'top': return { ...base, top: 0, left: insets.left ?? 0, right: insets.right ?? 0, height: `${s.h}%`, flexDirection: 'row' }
    case 'bottom': return { ...base, bottom: 0, left: insets.left ?? 0, right: insets.right ?? 0, height: `${s.h}%`, flexDirection: 'row' }
  }
}

// A float card: absolute at the anchor, sized as a % of the definite inset-0 float
// layer (so width/maxHeight resolve). One card per anchor is the norm (auto-shell
// uses docks); multiple same-anchor floats are agent-authored and may overlap.
export function floatStyle(anchor: Anchor, size?: Size): CSSProperties {
  const s = size ?? FLOAT_DEFAULTS[anchor]
  const box: CSSProperties = { position: 'absolute', width: `${s.w}%`, maxHeight: `${s.h}%`, overflow: 'auto' }
  switch (anchor) {
    case 'top-left': return { ...box, top: GAP, left: GAP }
    case 'top': return { ...box, top: GAP, left: '50%', transform: 'translateX(-50%)' }
    case 'top-right': return { ...box, top: GAP, right: GAP }
    case 'left': return { ...box, top: '50%', left: GAP, transform: 'translateY(-50%)' }
    case 'center': return { ...box, top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }
    case 'right': return { ...box, top: '50%', right: GAP, transform: 'translateY(-50%)' }
    case 'bottom-left': return { ...box, bottom: GAP, left: GAP }
    case 'bottom': return { ...box, bottom: GAP, left: '50%', transform: 'translateX(-50%)' }
    case 'bottom-right': return { ...box, bottom: GAP, right: GAP }
  }
}
```

- [ ] **Step 4 — glass utility.** Append to `src/index.css`:

```css
/* Theme-aware translucent HUD panel for C2 shell docks + floats. */
.gc-hud {
  background: color-mix(in oklab, var(--color-surface) 72%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--color-hairline-strong);
  box-shadow: var(--shadow-gc-overlay);
}
```

- [ ] **Step 5 — run, expect pass.**
- [ ] **Step 6 — commit:** `feat(gis-canvas): rail/float layout helpers + .gc-hud glass`

---

### Task R4: `CanvasGrid` renders the base/dock/float shell

**Files:** `apps/gis-canvas/src/components/CanvasGrid.tsx`, `CanvasGrid.test.tsx`

- [ ] **Step 1 — replace the two hero tests** (auto-hero→auto-shell) and keep the regression test:

```ts
test('auto-shell: a lone map renders a full-bleed base with dock rails', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 's1', type: 'stat', props: { label: 'Vessels', value: 20 } },
      { id: 'm1', type: 'esri:map', bindings: { layers: 'mock://incidents' } },
      { id: 't1', type: 'data-table', bindings: { source: 'mock://incidents' } },
    ],
  }
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('canvas-base')).toBeInTheDocument()
  expect(screen.getByTestId('dock-left')).toBeInTheDocument()   // stat
  expect(screen.getByTestId('dock-bottom')).toBeInTheDocument() // table
  expect(screen.getByTestId('panel-s1')).toBeInTheDocument()
  expect(screen.queryByTestId('cell-s1')).toBeNull()
  expect(screen.getByText('Vessels')).toBeInTheDocument()
})

test('explicit dock + float layers are honored', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 'm1', type: 'esri:map', layer: 'base', bindings: { layers: 'mock://x' } },
      { id: 't1', type: 'data-table', layer: 'dock', edge: 'bottom', bindings: { source: 'mock://incidents' } },
      { id: 'st', type: 'stat', layer: 'float', anchor: 'top-left', props: { label: 'N', value: 3 } },
    ],
  }
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('canvas-base')).toBeInTheDocument()
  expect(screen.getByTestId('panel-t1')).toBeInTheDocument()
  expect(screen.getByTestId('float-st')).toBeInTheDocument()
})

test('no base -> unchanged flat grid (regression)', () => {
  render(<CanvasGrid doc={doc()} />)
  expect(screen.getByTestId('cell-s1').style.gridColumn).toBe('1 / span 3')
  expect(screen.queryByTestId('canvas-base')).toBeNull()
})
```

- [ ] **Step 2 — run, expect the new shell tests to fail** (old `float-*` testids gone).
- [ ] **Step 3 — rewrite `CanvasGrid.tsx`** (`CanvasGrid` + `ShellLayers` + unchanged `GridLayer`):

```tsx
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Anchor, CanvasDoc, ComponentNode, Edge } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'
import { applyAutoShell, edgeForType } from '../lib/auto-shell'
import { railStyle, floatStyle, defaultDockSize } from '../lib/anchor'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const resolved = useMemo(() => applyAutoShell(doc), [doc])
  const base = resolved.components.find(c => c.layer === 'base')
  return base ? <ShellLayers doc={resolved} base={base} /> : <GridLayer doc={resolved} />
}

// Full-bleed base + dock rails + float cards. The shell is a definite-size box so
// all the percentage geometry below resolves.
function ShellLayers({ doc, base }: { doc: CanvasDoc; base: ComponentNode }) {
  const rest = doc.components.filter(c => c !== base)
  const floats = rest.filter(c => c.layer === 'float')
  const docks = rest.filter(c => c.layer !== 'float') // dock or leftover grid → dock

  const byEdge = new Map<Edge, ComponentNode[]>()
  for (const c of docks) {
    const e = (c.edge as Edge | undefined) ?? edgeForType(c.type)
    const list = byEdge.get(e) ?? []
    list.push(c)
    byEdge.set(e, list)
  }
  const thickness = (edge: Edge): string => {
    const list = byEdge.get(edge)
    if (!list) return '0'
    const s = list[0].size ?? defaultDockSize(edge)
    return `${edge === 'left' || edge === 'right' ? s.w : s.h}%`
  }
  const insets = { left: thickness('left'), right: thickness('right') }

  return (
    <div className="relative w-full min-h-[80vh] overflow-hidden">
      <div data-testid="canvas-base" className="absolute inset-0 z-0 overflow-hidden">
        {renderNode(base)}
      </div>

      {[...byEdge.entries()].map(([edge, comps]) => (
        <div
          key={edge}
          data-testid={`dock-${edge}`}
          className="z-10"
          style={railStyle(edge, comps[0].size, edge === 'top' || edge === 'bottom' ? insets : undefined)}
        >
          {comps
            .slice()
            .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
            .map(c => (
              <div
                key={c.id}
                data-testid={`panel-${c.id}`}
                className="gc-hud rounded-gc-md min-w-0 min-h-0 flex-1 overflow-auto"
              >
                {renderNode(c)}
              </div>
            ))}
        </div>
      ))}

      {floats.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20">
          {floats.map(c => (
            <div
              key={c.id}
              data-testid={`float-${c.id}`}
              className="gc-hud pointer-events-auto rounded-gc-md"
              style={floatStyle((c.anchor as Anchor | undefined) ?? 'top-left', c.size)}
            >
              {renderNode(c)}
            </div>
          ))}
        </div>
      )}
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

- [ ] **Step 4 — run** `npm test -- --run src/components/CanvasGrid.test.tsx` (expect pass).
- [ ] **Step 5 — typecheck + full suite + build:** `npm run build` and `npm test -- --run`.
- [ ] **Step 6 — commit:** `feat(gis-canvas): CanvasGrid base/dock/float C2 shell + glass`

---

## Post-implementation
- **Live verify:** map prompt → full-bleed base, table in a bottom rail, stats left rail, translucent
  glass (base reads through), no sliver/overflow; non-map prompt → flat grid unchanged.
- **Known follow-ups to log if seen:** `esri:legend` rendered its raw layer handle in the sliver — may
  be a standalone-legend molecule bug; verify whether it renders correctly at real width. Multiple
  same-anchor *floats* can overlap (auto-shell uses docks, so only agent-authored; Phase C).
- **Then:** Phase C — agent authors the shell (base map/table + docks + floats; map & non-map).

## Self-Review
- Design §4 coverage: dock+edge schema/validator → R1; `Edge`/`layer` types + auto-shell → R2; rail/float
  definite geometry + glass → R3; base/dock/float rendering + grid regression → R4. Covered.
- Placeholders: none. Type consistency: `Edge`/`applyAutoShell`/`edgeForType`/`railStyle`/`floatStyle`/
  `defaultDockSize` signatures match across types, auto-shell, anchor, their tests, and CanvasGrid.
