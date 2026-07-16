# Generic Linked Selection (WS2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable primitive that links any canvas components bound to the same data `source` through a shared selection, mirrored into each linked node's `state.rowSelection` so the agent sees it. Map↔table is the first application.

**Architecture:** Frontend-only, under `apps/gis-canvas/src/`. Pure helpers in `lib/selection.ts`; a `SelectionContext` (provider + `useLinkedSelection` hook); `App.tsx` wires the provider; `DataTableMolecule`/`EsriMapMolecule` consume the hook. No backend/schema/awareness changes — `awareness.py` already surfaces `rowSelection`.

**Tech Stack:** React 19, TypeScript, Tailwind v4, ESRI `@arcgis/map-components`, vitest + @testing-library/react.

## Global Constraints

- All changes under `apps/gis-canvas/`. No backend/plugin/schema/awareness edits (verbatim from spec: **"No backend/schema/awareness changes"**).
- Work on branch `gis/ws2-linked-selection` (already created; the WS2 design doc is committed there).
- Existing suite must stay green (currently **127**). Run `npx vitest run` and `npm run typecheck` from `apps/gis-canvas/`.
- Commit prefix `gis:`; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git add -A` — stage explicit paths.
- Shared row identity is the **`idField` value** = `schema[0]?.name ?? 'id'` (today's table behavior), via `resolveIdField`. Selection is toggle/multi-select. The map `goTo`s the selected features (recenters).
- Types: `ComponentNode { id; type; bindings?: Record<string,string|string[]>; state?; children?; slots? }`, `CanvasDoc { components: ComponentNode[]; overlays?: ComponentNode[] }` (`src/lib/types.ts`).

---

### Task 1: `lib/selection.ts` — pure helpers (TDD)

**Files:**
- Create: `src/lib/selection.ts`
- Create: `src/lib/selection.test.ts`

**Interfaces produced:**
- `resolveIdField(schema: { name: string }[] | undefined): string`
- `collectNodesBySource(doc: CanvasDoc | null): Record<string, string[]>`

- [ ] **Step 1: Write failing tests.** Create `src/lib/selection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveIdField, collectNodesBySource } from './selection'
import type { CanvasDoc } from './types'

describe('resolveIdField', () => {
  it('uses the first schema column', () => {
    expect(resolveIdField([{ name: 'Timestamp' }, { name: 'Lat' }])).toBe('Timestamp')
  })
  it('falls back to "id" for an empty/missing schema', () => {
    expect(resolveIdField([])).toBe('id')
    expect(resolveIdField(undefined)).toBe('id')
  })
})

describe('collectNodesBySource', () => {
  it('maps each data source to the node ids bound to it (table source + map data-layers)', () => {
    const doc = {
      rev: 1,
      layout: { cols: 12, rowH: 8 },
      components: [
        { id: 'tbl', type: 'esri:data-table', bindings: { source: 'data://ab' } },
        { id: 'map', type: 'esri:map', bindings: { layers: ['data://ab', 'https://x/FeatureServer/0'] } },
        { id: 'stat', type: 'stat', bindings: { source: 'data://cd' } }
      ]
    } as unknown as CanvasDoc
    const m = collectNodesBySource(doc)
    expect(m['data://ab'].sort()).toEqual(['map', 'tbl'])
    expect(m['data://cd']).toEqual(['stat'])
    expect(m['https://x/FeatureServer/0']).toBeUndefined() // non-data layer ignored
  })
  it('returns {} for a null doc', () => { expect(collectNodesBySource(null)).toEqual({}) })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/lib/selection.test.ts`.

- [ ] **Step 3: Implement `src/lib/selection.ts`:**

```ts
import { isDataHandle } from './data-plane'
import type { CanvasDoc, ComponentNode } from './types'

/** Shared row identity: the first schema column's name (today's table behavior). */
export function resolveIdField(schema: { name: string }[] | undefined): string {
  return schema?.[0]?.name ?? 'id'
}

/** Map each data-source handle to the ids of nodes bound to it — a table's
 * `bindings.source` and each data:// handle in a map's `bindings.layers`. */
export function collectNodesBySource(doc: CanvasDoc | null): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!doc) return out
  const add = (source: unknown, id: string) => {
    if (typeof source !== 'string' || !source) return
    ;(out[source] ??= []).push(id)
  }
  const walk = (node: ComponentNode) => {
    const src = node.bindings?.source
    add(Array.isArray(src) ? src[0] : src, node.id)
    const layers = node.bindings?.layers
    for (const layer of Array.isArray(layers) ? layers : []) if (isDataHandle(layer)) add(layer, node.id)
    for (const kid of node.children ?? []) walk(kid)
    for (const kids of Object.values(node.slots ?? {})) for (const kid of kids) walk(kid)
  }
  for (const c of doc.components ?? []) walk(c)
  for (const o of doc.overlays ?? []) walk(o)
  return out
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/lib/selection.test.ts`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/selection.ts src/lib/selection.test.ts
git commit -m "gis: selection helpers — resolveIdField + collectNodesBySource

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `components/SelectionContext.tsx` — provider + hook (TDD)

**Files:**
- Create: `src/components/SelectionContext.tsx`
- Create: `src/components/SelectionContext.test.tsx`

**Interfaces produced:**
- `SelectionProvider({ nodesBySource, onMirror, children })`
- `useLinkedSelection(source: string | undefined): [string[], (ids: string[]) => void]`

- [ ] **Step 1: Write failing test.** Create `src/components/SelectionContext.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectionProvider, useLinkedSelection } from './SelectionContext'

function Consumer({ source, label }: { source: string; label: string }) {
  const [sel, setSel] = useLinkedSelection(source)
  return (
    <div>
      <span data-testid={`${label}-sel`}>{sel.join(',')}</span>
      <button onClick={() => setSel(['a'])}>{label}-set</button>
    </div>
  )
}

describe('SelectionContext', () => {
  it('shares selection between consumers of the same source and mirrors to bound nodes', () => {
    const onMirror = vi.fn()
    render(
      <SelectionProvider nodesBySource={{ s: ['n1', 'n2'] }} onMirror={onMirror}>
        <Consumer source="s" label="x" />
        <Consumer source="s" label="y" />
        <Consumer source="other" label="z" />
      </SelectionProvider>
    )
    fireEvent.click(screen.getByText('x-set'))
    expect(screen.getByTestId('x-sel')).toHaveTextContent('a')
    expect(screen.getByTestId('y-sel')).toHaveTextContent('a') // linked (same source)
    expect(screen.getByTestId('z-sel')).toHaveTextContent('')  // independent (different source)
    expect(onMirror).toHaveBeenCalledWith('n1', ['a'])
    expect(onMirror).toHaveBeenCalledWith('n2', ['a'])
  })
  it('no-ops safely without a provider', () => {
    render(<Consumer source="s" label="x" />)
    fireEvent.click(screen.getByText('x-set')) // must not throw
    expect(screen.getByTestId('x-sel')).toHaveTextContent('')
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/components/SelectionContext.test.tsx`.

- [ ] **Step 3: Implement `src/components/SelectionContext.tsx`:**

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface SelectionContextValue {
  get: (source: string) => string[]
  set: (source: string, ids: string[]) => void
}

const NOOP: SelectionContextValue = { get: () => [], set: () => {} }
const Ctx = createContext<SelectionContextValue>(NOOP)

/** Holds selection keyed by data source and mirrors every change onto the
 * `rowSelection` state of each node bound to that source (via onMirror), so the
 * agent's canvas awareness reflects it. */
export function SelectionProvider({
  nodesBySource,
  onMirror,
  children
}: {
  nodesBySource: Record<string, string[]>
  onMirror: (nodeId: string, ids: string[]) => void
  children: ReactNode
}) {
  const [selection, setSelection] = useState<Record<string, string[]>>({})
  const get = useCallback((source: string) => selection[source] ?? [], [selection])
  const set = useCallback((source: string, ids: string[]) => {
    setSelection(prev => ({ ...prev, [source]: ids }))
    for (const nodeId of nodesBySource[source] ?? []) onMirror(nodeId, ids)
  }, [nodesBySource, onMirror])
  const value = useMemo(() => ({ get, set }), [get, set])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Linked selection for a data source. A falsy source (component not data-bound)
 * yields an empty, inert selection. */
export function useLinkedSelection(source: string | undefined): [string[], (ids: string[]) => void] {
  const ctx = useContext(Ctx)
  const selected = source ? ctx.get(source) : []
  const setSelected = useCallback((ids: string[]) => { if (source) ctx.set(source, ids) }, [ctx, source])
  return [selected, setSelected]
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/components/SelectionContext.test.tsx`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/SelectionContext.tsx src/components/SelectionContext.test.tsx
git commit -m "gis: SelectionContext — source-keyed shared selection + useLinkedSelection hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `App.tsx` — wire the provider

**Files:**
- Modify: `src/App.tsx`

**Interfaces consumed:** `collectNodesBySource` (Task 1), `SelectionProvider` (Task 2).

- [ ] **Step 1: Import.** Add to `App.tsx`:

```tsx
import { SelectionProvider } from './components/SelectionContext'
import { collectNodesBySource } from './lib/selection'
```

- [ ] **Step 2: Derive `nodesBySource`.** After `const mergedDoc = doc ? mergeOverrides(doc, overrides) : null`:

```tsx
  const nodesBySource = useMemo(() => collectNodesBySource(mergedDoc), [mergedDoc])
```

- [ ] **Step 3: Wrap the canvas.** In the render, replace the existing `mergedDoc ? (<HandlerProvider …><CanvasGrid…/></HandlerProvider>) : (…)` block so the `HandlerProvider` is wrapped by `SelectionProvider`:

```tsx
        {mergedDoc ? (
          <SelectionProvider
            nodesBySource={nodesBySource}
            onMirror={(id, ids) => actions.reportInteraction(id, { rowSelection: ids })}
          >
            <HandlerProvider actions={actions}>
              <CanvasGrid doc={mergedDoc} />
            </HandlerProvider>
          </SelectionProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-tertiary">
            No canvas yet — ask the agent to build a dashboard.
          </div>
        )}
```

- [ ] **Step 4: Verify.** `npm run typecheck` (clean) and `npx vitest run` (all pass — `App.test.tsx` stays green: with no doc, `mergedDoc` is null so the provider isn't rendered; nothing else changes).

- [ ] **Step 5: Commit.**

```bash
git add src/App.tsx
git commit -m "gis: wire SelectionProvider around the canvas, mirroring selection to node state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `DataTableMolecule` — consume the hook (TDD)

**Files:**
- Modify: `src/components/molecules/DataTableMolecule.tsx`
- Modify: `src/components/molecules/DataTableMolecule.test.tsx`

**Interfaces consumed:** `useLinkedSelection` (Task 2), `resolveIdField` (Task 1).

- [ ] **Step 1: Write failing test.** Append to `src/components/molecules/DataTableMolecule.test.tsx` (add imports at top: `import { SelectionProvider } from '../SelectionContext'` and `fireEvent` in the testing-library import):

```tsx
describe('DataTableMolecule linked selection', () => {
  it('toggling a row sets the shared selection (mirrored to the node)', async () => {
    const onMirror = vi.fn()
    const fetchData = vi.fn().mockResolvedValue(page)
    render(
      <SelectionProvider nodesBySource={{ 'data://ab12': ['t1'] }} onMirror={onMirror}>
        <HandlerProvider actions={{ setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData }}>
          <DataTableMolecule node={{ id: 't1', type: 'data-table', bindings: { source: 'data://ab12' } } as any} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    )
    await waitFor(() => expect(screen.getByText('x1')).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText('select x1'))
    expect(onMirror).toHaveBeenCalledWith('t1', ['x1'])
    // the row now reads as selected
    expect((screen.getByLabelText('select x1') as HTMLInputElement).checked).toBe(true)
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/components/molecules/DataTableMolecule.test.tsx` (fails: toggle still calls `reportInteraction` directly, not the provider's `onMirror`).

- [ ] **Step 3: Implement.** In `DataTableMolecule.tsx`:

Add imports:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react' // ensure useEffect + useRef present
import { useLinkedSelection } from '../SelectionContext'
import { resolveIdField } from '../../lib/selection'
```
Replace `const selected = (node.state?.rowSelection as string[] | undefined) ?? []` with:
```tsx
  const [selected, setSelected] = useLinkedSelection(source)
```
Replace `const idField = data?.schema[0]?.name ?? 'id'` with:
```tsx
  const idField = resolveIdField(data?.schema)
```
Replace the `toggle` body:
```tsx
  const toggle = (rowId: string) => {
    setSelected(selected.includes(rowId) ? selected.filter(x => x !== rowId) : [...selected, rowId])
  }
```
Add a ref for the first selected row and scroll it into view on selection change. Near the other hooks:
```tsx
  const firstSelRef = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => { if (selected.length) firstSelRef.current?.scrollIntoView({ block: 'nearest' }) }, [selected])
```
On the row `<tr>` (the one keyed `row.id`), attach the ref to the first selected row only:
```tsx
                <tr
                  key={row.id}
                  ref={selected[0] === rid ? firstSelRef : undefined}
                  /* …existing className/props unchanged… */
```
(Keep the existing `isSel = selected.includes(rid)` styling and the checkbox `onChange={() => toggle(rid)}` unchanged.)

- [ ] **Step 4: Run, confirm GREEN + full suite.** `npx vitest run src/components/molecules/DataTableMolecule.test.tsx`, then `npx vitest run` and `npm run typecheck`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/molecules/DataTableMolecule.tsx src/components/molecules/DataTableMolecule.test.tsx
git commit -m "gis: DataTableMolecule uses linked selection (shared, scroll-into-view)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `EsriMapMolecule` — consume the hook, highlight + reposition (TDD for the read path; ESRI reposition live-verified)

**Files:**
- Modify: `src/components/molecules/EsriMapMolecule.tsx`
- Modify: `src/components/molecules/EsriMapMolecule.test.tsx`

**Interfaces consumed:** `useLinkedSelection` (Task 2), `resolveIdField` (Task 1).

- [ ] **Step 1: Write failing test.** Append to `EsriMapMolecule.test.tsx` (the file already mocks `loadEsri`; add `import { SelectionProvider } from '../SelectionContext'`):

```tsx
describe('EsriMapMolecule linked selection', () => {
  it('reads the shared selection for its data source and shows the selected count', () => {
    const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData: vi.fn() }
    const mapNode: ComponentNode = { id: 'm', type: 'esri:map', bindings: { layers: ['data://x'] }, props: {} }
    render(
      <SelectionProvider nodesBySource={{ 'data://x': ['m'] }} onMirror={() => {}}>
        <HandlerProvider actions={actions}>
          <EsriMapMolecule node={mapNode} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    )
    // no selection yet → no chip
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument()
  })
})
```
(Then extend it: render a second case where the provider is seeded by clicking a consumer, OR assert the chip via a helper. Keep it to the read-path — the chip renders from the hook's `selected.length`, no ESRI view needed. If seeding the provider state from a test is awkward, assert only the no-selection case here and rely on live-verify for the populated chip; do NOT weaken by asserting nothing.)

- [ ] **Step 2: Run, confirm RED/GREEN as appropriate.** `npx vitest run src/components/molecules/EsriMapMolecule.test.tsx` (the read-path wiring compiles against the hook).

- [ ] **Step 3: Implement.** In `EsriMapMolecule.tsx`:

Add imports:
```tsx
import { useLinkedSelection } from '../SelectionContext'
import { resolveIdField } from '../../lib/selection'
```
Compute the linked source (first data-handle layer) and the hook near the top of the component:
```tsx
  const source = layerRefs.find(isDataHandle) ?? ''
  const [selected, setSelected] = useLinkedSelection(source)
```
Stash the map context so the selection effect can match/reposition. Add a ref:
```tsx
  const mapCtx = useRef<{ view: any; layer: any; idField: string } | null>(null)
```
In `onReady`, when a data handle is loaded, after `view.map.add(layer)`, record the context:
```tsx
            if (isDataHandle(r)) {
              const page = await actions.fetchData(r, { pageSize: 5000 })
              if (cancelled) return
              layer = buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, r)
              if (view) mapCtx.current = { view, layer, idField: resolveIdField(page.schema as { name: string }[]) }
            } else {
              layer = buildLayer(r, esri)
            }
```
Change the **click emit** to report the shared `idField` value (toggle into the current selection) instead of `__oid`:
```tsx
      clickHandle = esri.reactiveUtils.on(() => el, 'arcgisViewClick', async (event: unknown) => {
        const ctx = mapCtx.current
        if (!ctx) return
        const detail = (event as Record<string, unknown>)?.['detail']
        const hit = await (el as Record<string, unknown> & { hitTest?(e: unknown): Promise<{ results: unknown[] }> }).hitTest?.(detail)
        const ids = (hit?.results ?? [])
          .map((r: unknown) => (r as Record<string, unknown>)?.['graphic'] as Record<string, unknown>)
          .map(g => (g?.['attributes'] as Record<string, unknown> | undefined)?.[ctx.idField])
          .filter((x: unknown) => x != null)
          .map(String)
        if (!ids.length) return
        const next = ids.reduce((acc, id) => acc.includes(id) ? acc.filter(x => x !== id) : [...acc, id], selectedRef.current)
        setSelected(next)
      })
```
Because the click closure captures `selected` once, keep a ref of the latest selection for the toggle:
```tsx
  const selectedRef = useRef<string[]>(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])
```
Add the **react effect** (highlight + `goTo`) keyed on `selected` + `ready`:
```tsx
  useEffect(() => {
    const ctx = mapCtx.current
    if (!ready || !ctx) return
    let handle: { remove(): void } | null = null
    let cancelled = false
    void ctx.view.whenLayerView(ctx.layer).then(async (lv: any) => {
      if (cancelled) return
      const { features } = await lv.queryFeatures()
      const matched = (features as any[]).filter(f => selected.includes(String(f.attributes?.[ctx.idField])))
      handle?.remove()
      handle = matched.length ? lv.highlight(matched) : null
      if (matched.length) void ctx.view.goTo(matched, { animate: true }).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true; handle?.remove() }
  }, [selected, ready])
```
Replace the chip source: change `const selection = node.state?.selection …` / `selectionSummary` to read the hook value:
```tsx
  const selectionSummary = selected.length ? `${selected.length} selected` : undefined
```
(Remove the now-unused `node.state?.selection` line.)

- [ ] **Step 4: Run, confirm GREEN + full suite + typecheck.** `npx vitest run src/components/molecules/EsriMapMolecule.test.tsx`, then `npx vitest run` and `npm run typecheck`. The ESRI `whenLayerView`/`queryFeatures`/`highlight`/`goTo` paths are guarded by `mapCtx.current`/`ready` and are exercised in **live verification**, not unit tests.

- [ ] **Step 5: Commit.**

```bash
git add src/components/molecules/EsriMapMolecule.tsx src/components/molecules/EsriMapMolecule.test.tsx
git commit -m "gis: EsriMapMolecule linked selection — emit idField value, highlight + goTo on selection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** shared identity → Task 1 (`resolveIdField`); generic primitive → Task 2 (`SelectionContext`/`useLinkedSelection`); provider mirror to agent state → Task 2 + Task 3 wiring; table linking + scroll → Task 4; map emit(idField) + highlight + `goTo` → Task 5; agent context via existing awareness → no task (reused). All spec sections covered. Non-goals respected (no backend/schema/awareness edits, no control-linking, no cross-source linking).
- **Placeholder scan:** no TBD/TODO; every code step shows real code. Task 5's "extend it / do NOT weaken" note is a testing-discipline instruction, not a placeholder — the concrete no-selection assertion is given, and the ESRI reposition is explicitly live-verified.
- **Type consistency:** `resolveIdField`/`collectNodesBySource` (Task 1) consumed by Tasks 3/4/5; `SelectionProvider`/`useLinkedSelection` (Task 2) consumed by Tasks 3/4/5; `onMirror` signature `(nodeId, ids)` matches App's `reportInteraction(id, { rowSelection })`; `ComponentNode`/`CanvasDoc` from `types.ts`.
- **Green at each task:** Tasks 1–2 add leaf modules; Task 3 wires the provider (inert without a doc, so App.test stays green); Task 4 switches the table to the hook (its test wraps in a provider); Task 5 switches the map (read-path unit-tested, ESRI reposition guarded + live-verified). Typecheck holds throughout.
