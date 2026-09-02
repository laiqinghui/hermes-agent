# Window Minimize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user shade or minimize any non-hero canvas window — with a taskbar, an update badge, and a one-click "Focus map" — so the agent's growing pile of panels stops burying the map.

**Architecture:** A second ephemeral store (`useWindowStateStore`) sits beside the existing `useLayoutStore`, holding `open | shaded | minimized` per molecule id. Geometry and visibility stay separate, so a minimized window keeps its layout override untouched and restores to exactly where it was. Minimized windows stay **mounted** under the `hidden` attribute — unmounting would refetch broker data and drop the shared time extent. The hero is exempt by `node.layer !== 'base'`, enforced both in `Window` (no controls) and in `FreeCanvas` (base is never a focus candidate).

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + @testing-library/react, Tailwind with `gc-` design tokens.

**Spec:** `apps/gis-canvas/docs/2026-09-02-window-minimize-design.md`

## Global Constraints

- **Frontend only.** No backend, plugin, or tool-description change. No gateway restart is needed to verify — only the SPA.
- **Working directory:** every command below runs from `apps/gis-canvas`. The Bash tool's cwd resets between calls, so prefix each command with `cd apps/gis-canvas &&` (or run from that directory).
- **Test runner:** `npx vitest run <path>` works from `apps/gis-canvas`; `npm run dev` does **not** (the `vite` binary is hoisted to the root `node_modules/.bin` by npm workspaces — dev runs from the repo root as `npm run dev --workspace @hermes/gis-canvas`).
- **Store lifecycle rule (both stores):** session-ephemeral, never persisted, never sent to the gateway, and **NOT** reset on `doc.rev`. Only `sync` (molecule removed) and `reset` (user action) clear entries.
- **React bailout rule:** every state updater that prunes must return the **same object reference** when nothing changed. `sync` runs from a `useEffect` on every doc change; returning a fresh object each time causes an infinite render loop. The existing `useLayoutStore.prune` is the pattern to copy, and `use-layout-store.test.ts` already asserts it.
- **Branch:** `gis/window-minimize` (already created, holds the design commit).
- **Existing test suites must stay green** — 298+ frontend tests. New props on `Window` and `TopBar` must therefore be optional or every existing call site updated in the same task.

---

### Task 1: Pure window-state helpers

**Files:**
- Create: `src/lib/window-state.ts`
- Test: `src/lib/window-state.test.ts`
- Modify: `src/components/Window.tsx` (delete the local `humanTitle`, import it from the new module)

**Interfaces:**
- Consumes: `CanvasDoc`, `ComponentNode` from `src/lib/types.ts`
- Produces:
  - `type WindowState = 'open' | 'shaded' | 'minimized'`
  - `canMinimize(node: ComponentNode): boolean`
  - `humanTitle(node: ComponentNode): string`
  - `signatures(doc: CanvasDoc): Record<string, string>`
  - `changedIds(prev: Record<string, string>, next: Record<string, string>): string[]`

`humanTitle` moves out of `Window.tsx` unchanged, because Task 4's taskbar needs the identical label. Do not swap it for `humanizeLabel` from `src/lib/humanize.ts` — that one Title-cases, which would change how existing window headers read.

- [ ] **Step 1: Write the failing test**

Create `src/lib/window-state.test.ts`:

```tsx
import { describe, it, expect } from 'vitest'
import { canMinimize, humanTitle, signatures, changedIds } from './window-state'
import type { CanvasDoc } from './types'

const doc: CanvasDoc = {
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
  components: [
    { id: 'm', type: 'esri:map', layer: 'base' },
    { id: 't', type: 'data-table', layer: 'dock', edge: 'right', props: { title: 'Tracks' } },
  ],
}

describe('canMinimize', () => {
  it('exempts the base layer and allows everything else', () => {
    expect(canMinimize({ id: 'm', type: 'esri:map', layer: 'base' })).toBe(false)
    expect(canMinimize({ id: 't', type: 'data-table', layer: 'dock' })).toBe(true)
    expect(canMinimize({ id: 'n', type: 'note' })).toBe(true)
  })
})

describe('humanTitle', () => {
  it('prefers props.title and otherwise humanizes the type', () => {
    expect(humanTitle({ id: 'a', type: 'data-table', props: { title: 'Tracks' } })).toBe('Tracks')
    expect(humanTitle({ id: 'b', type: 'esri:time-slider' })).toBe('time slider')
    expect(humanTitle({ id: 'c', type: 'note', props: { title: '   ' } })).toBe('note')
  })
})

describe('signatures / changedIds', () => {
  it('is stable when nothing changed', () => {
    expect(changedIds(signatures(doc), signatures(doc))).toEqual([])
  })

  it('reports only the molecule whose content changed', () => {
    const next: CanvasDoc = {
      ...doc, rev: 2,
      components: [doc.components[0], { ...doc.components[1], props: { title: 'Tracks (12)' } }],
    }
    expect(changedIds(signatures(doc), signatures(next))).toEqual(['t'])
  })

  it('reports a newly added molecule and ignores a removed one', () => {
    const next: CanvasDoc = {
      ...doc, rev: 2,
      components: [doc.components[0], { id: 'n', type: 'note' }],
    }
    expect(changedIds(signatures(doc), signatures(next))).toEqual(['n'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/window-state.test.ts`
Expected: FAIL — `Failed to resolve import "./window-state"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/window-state.ts`:

```ts
import type { CanvasDoc, ComponentNode } from './types'

/** A window is in exactly one of these; absent from the store means 'open'. */
export type WindowState = 'open' | 'shaded' | 'minimized'

/** The hero (base-layer map) is the view everything else annotates, so it is
 * never minimizable. Mirrors the base-layer exception in FreeCanvas.beginGesture,
 * which likewise refuses to raise the map above the panels. */
export function canMinimize(node: ComponentNode): boolean {
  return node.layer !== 'base'
}

/** Window header / taskbar chip label. */
export function humanTitle(node: ComponentNode): string {
  const t = (node.props?.title as string | undefined)?.trim()
  return t || node.type.replace(/^esri:/, '').replace(/[-_]/g, ' ')
}

/** Per-molecule content fingerprint. Canvas docs are small LLM-authored
 * structures, so a stringify per revision is cheap — and unlike object identity
 * it survives the merge layer rebuilding every node on each rev. */
export function signatures(doc: CanvasDoc): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of doc.components) out[c.id] = JSON.stringify(c)
  return out
}

/** Ids present in `next` whose content differs from `prev` (additions included;
 * removals are not reported — the caller prunes those separately). */
export function changedIds(prev: Record<string, string>, next: Record<string, string>): string[] {
  return Object.keys(next).filter(id => prev[id] !== next[id])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/window-state.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Point Window.tsx at the shared helper**

In `src/components/Window.tsx`, delete this local function:

```tsx
function humanTitle(node: ComponentNode): string {
  const t = (node.props?.title as string | undefined)?.trim()
  return t || node.type.replace(/^esri:/, '').replace(/[-_]/g, ' ')
}
```

and add the import beside the existing ones:

```tsx
import { humanTitle } from '../lib/window-state'
```

- [ ] **Step 6: Verify nothing regressed**

Run: `cd apps/gis-canvas && npx vitest run src/components/Window.test.tsx && npx tsc -p . --noEmit`
Expected: Window tests PASS, typecheck clean with no output.

- [ ] **Step 7: Commit**

```bash
git add apps/gis-canvas/src/lib/window-state.ts apps/gis-canvas/src/lib/window-state.test.ts apps/gis-canvas/src/components/Window.tsx
git commit -m "feat(gis-canvas): pure window-state helpers (canMinimize, signatures, changedIds)"
```

---

### Task 2: The window-state store and its provider

**Files:**
- Create: `src/lib/use-window-state.ts`
- Create: `src/components/WindowStateProvider.tsx`
- Test: `src/lib/use-window-state.test.ts`

**Interfaces:**
- Consumes: `WindowState` from `src/lib/window-state.ts` (Task 1)
- Produces:
  - `useWindowStateStore(): WindowStateStore`
  - `interface WindowStateStore` with: `states: Record<string, WindowState>`, `updated: Set<string>`, `get(id): WindowState`, `toggleShade(id)`, `minimize(id)`, `restore(id)`, `markUpdated(id)`, `sync(minimizableIds: string[])`, `toggleFocus()`, `reset()`, `minimizedIds: string[]`, `canFocus: boolean`, `isFocused: boolean`, `isEmpty: boolean`
  - `<WindowStateProvider store={...}>` and `useWindowState(): WindowStateStore` from `src/components/WindowStateProvider.tsx`

`isFocused` is **derived**, never stored: true only when the candidate list is non-empty and every candidate is minimized. That is why the candidate list lives in state, not a ref — a ref would leave `isFocused` stale in the `useMemo` when the agent adds a panel while focused.

- [ ] **Step 1: Write the failing test**

Create `src/lib/use-window-state.test.ts`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWindowStateStore } from './use-window-state'

describe('useWindowStateStore', () => {
  it('defaults to open and toggles shade back and forth', () => {
    const { result } = renderHook(() => useWindowStateStore())
    expect(result.current.get('a')).toBe('open')
    expect(result.current.isEmpty).toBe(true)
    act(() => result.current.toggleShade('a'))
    expect(result.current.get('a')).toBe('shaded')
    expect(result.current.isEmpty).toBe(false)
    act(() => result.current.toggleShade('a'))
    expect(result.current.get('a')).toBe('open')
    expect(result.current.isEmpty).toBe(true)
  })

  it('minimizes and restores, and lists minimized ids', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.minimize('a'))
    expect(result.current.get('a')).toBe('minimized')
    expect(result.current.minimizedIds).toEqual(['a'])
    act(() => result.current.restore('a'))
    expect(result.current.get('a')).toBe('open')
    expect(result.current.minimizedIds).toEqual([])
  })

  it('markUpdated flags a window and restore clears the flag', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.minimize('a'); result.current.markUpdated('a') })
    expect(result.current.updated.has('a')).toBe(true)
    act(() => result.current.restore('a'))
    expect(result.current.updated.has('a')).toBe(false)
  })

  it('sync prunes states and updated flags for molecules that are gone', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.minimize('a'); result.current.markUpdated('a'); result.current.toggleShade('b') })
    act(() => result.current.sync(['b']))
    expect(result.current.get('a')).toBe('open')
    expect(result.current.updated.has('a')).toBe(false)
    expect(result.current.get('b')).toBe('shaded')
  })

  it('sync with an unchanged id list keeps the same state reference (React bailout)', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.minimize('a'))
    const before = result.current.states
    act(() => result.current.sync(['a', 'b']))
    act(() => result.current.sync(['a', 'b']))
    expect(result.current.states).toBe(before)
  })

  it('toggleFocus minimizes every candidate, then restores them all', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.sync(['a', 'b']))
    expect(result.current.canFocus).toBe(true)
    expect(result.current.isFocused).toBe(false)
    act(() => result.current.toggleFocus())
    expect(result.current.get('a')).toBe('minimized')
    expect(result.current.get('b')).toBe('minimized')
    expect(result.current.isFocused).toBe(true)
    act(() => result.current.toggleFocus())
    expect(result.current.get('a')).toBe('open')
    expect(result.current.get('b')).toBe('open')
    expect(result.current.isFocused).toBe(false)
  })

  it('toggleFocus also swallows shaded windows and only acts on candidates', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.sync(['a']); result.current.toggleShade('a') })
    act(() => result.current.toggleFocus())
    expect(result.current.get('a')).toBe('minimized')
    expect(result.current.get('map')).toBe('open')
  })

  it('isFocused goes false when a new candidate appears while focused', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => result.current.sync(['a']))
    act(() => result.current.toggleFocus())
    expect(result.current.isFocused).toBe(true)
    act(() => result.current.sync(['a', 'b']))
    expect(result.current.isFocused).toBe(false)
  })

  it('reset clears states and update flags', () => {
    const { result } = renderHook(() => useWindowStateStore())
    act(() => { result.current.minimize('a'); result.current.markUpdated('a'); result.current.toggleShade('b') })
    act(() => result.current.reset())
    expect(result.current.isEmpty).toBe(true)
    expect(result.current.updated.size).toBe(0)
  })

  it('canFocus is false with no candidates', () => {
    const { result } = renderHook(() => useWindowStateStore())
    expect(result.current.canFocus).toBe(false)
    expect(result.current.isFocused).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/use-window-state.test.ts`
Expected: FAIL — `Failed to resolve import "./use-window-state"`.

- [ ] **Step 3: Write the store**

Create `src/lib/use-window-state.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from 'react'
import type { WindowState } from './window-state'

export interface WindowStateStore {
  states: Record<string, WindowState>
  updated: Set<string>
  get: (id: string) => WindowState
  toggleShade: (id: string) => void
  minimize: (id: string) => void
  restore: (id: string) => void
  markUpdated: (id: string) => void
  /** Prune dead ids AND record the focus candidates. One call so the two lists
   * can never drift apart. */
  sync: (minimizableIds: string[]) => void
  toggleFocus: () => void
  reset: () => void
  minimizedIds: string[]
  canFocus: boolean
  isFocused: boolean
  isEmpty: boolean
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Ephemeral, session-only window visibility keyed by molecule id. Never
 * persisted, never sent to the gateway, and — exactly like the layout override
 * store — NOT reset on doc.rev: minimizing is a user decision that outlives the
 * agent's revisions. Only sync (molecule removed) and reset (user) clear it. */
export function useWindowStateStore(): WindowStateStore {
  const [states, setStates] = useState<Record<string, WindowState>>({})
  const [updated, setUpdated] = useState<Set<string>>(new Set())
  // Candidates live in state, not a ref: isFocused is derived in the useMemo
  // below, and a ref change would not re-run it when the agent adds a panel.
  const [candidates, setCandidates] = useState<string[]>([])

  const statesRef = useRef(states); statesRef.current = states
  const candRef = useRef(candidates); candRef.current = candidates

  const get = useCallback((id: string) => statesRef.current[id] ?? 'open', [])

  const setOne = useCallback((id: string, s: WindowState) => {
    setStates(prev => ((prev[id] ?? 'open') === s ? prev : { ...prev, [id]: s }))
  }, [])

  const clearUpdated = useCallback((id: string) => {
    setUpdated(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev); next.delete(id); return next
    })
  }, [])

  const toggleShade = useCallback((id: string) => {
    setStates(prev => ({ ...prev, [id]: (prev[id] ?? 'open') === 'shaded' ? 'open' : 'shaded' }))
  }, [])

  const minimize = useCallback((id: string) => setOne(id, 'minimized'), [setOne])

  const restore = useCallback((id: string) => { setOne(id, 'open'); clearUpdated(id) }, [setOne, clearUpdated])

  const markUpdated = useCallback((id: string) => {
    setUpdated(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  // Runs from a useEffect on every doc change — every updater below MUST return
  // the previous reference when nothing changed, or the effect loops forever.
  const sync = useCallback((ids: string[]) => {
    setCandidates(prev => (sameList(prev, ids) ? prev : ids))
    const valid = new Set(ids)
    setStates(prev => {
      const next: Record<string, WindowState> = {}
      let changed = false
      for (const [id, s] of Object.entries(prev)) { if (valid.has(id)) next[id] = s; else changed = true }
      return changed ? next : prev
    })
    setUpdated(prev => {
      const next = new Set([...prev].filter(id => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [])

  const toggleFocus = useCallback(() => {
    const ids = candRef.current
    if (!ids.length) return
    const allMinimized = ids.every(id => (statesRef.current[id] ?? 'open') === 'minimized')
    setStates(prev => {
      const next = { ...prev }
      for (const id of ids) next[id] = allMinimized ? 'open' : 'minimized'
      return next
    })
    if (allMinimized) setUpdated(prev => (prev.size ? new Set() : prev))
  }, [])

  const reset = useCallback(() => {
    setStates(prev => (Object.keys(prev).length ? {} : prev))
    setUpdated(prev => (prev.size ? new Set() : prev))
  }, [])

  return useMemo(() => {
    const minimizedIds = Object.keys(states).filter(id => states[id] === 'minimized')
    return {
      states, updated, get, toggleShade, minimize, restore, markUpdated, sync, toggleFocus, reset,
      minimizedIds,
      canFocus: candidates.length > 0,
      isFocused: candidates.length > 0 && candidates.every(id => states[id] === 'minimized'),
      isEmpty: Object.values(states).every(s => s === 'open'),
    }
  }, [states, updated, candidates, get, toggleShade, minimize, restore, markUpdated, sync, toggleFocus, reset])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/use-window-state.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Write the provider**

Create `src/components/WindowStateProvider.tsx` — deliberately a mirror of `LayoutProvider.tsx`, including the NOOP default so components render standalone in tests:

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { WindowStateStore } from '../lib/use-window-state'

const NOOP: WindowStateStore = {
  states: {}, updated: new Set(), get: () => 'open',
  toggleShade: () => {}, minimize: () => {}, restore: () => {}, markUpdated: () => {},
  sync: () => {}, toggleFocus: () => {}, reset: () => {},
  minimizedIds: [], canFocus: false, isFocused: false, isEmpty: true,
}
const Ctx = createContext<WindowStateStore>(NOOP)

/** Distributes the App-owned window-state store to canvas windows. Controlled:
 * App owns the store so TopBar's Focus map and Reset can reach it too. */
export function WindowStateProvider({ store, children }: { store: WindowStateStore; children: ReactNode }) {
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}

export function useWindowState(): WindowStateStore {
  return useContext(Ctx)
}
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/gis-canvas && npx tsc -p . --noEmit`
Expected: clean, no output.

- [ ] **Step 7: Commit**

```bash
git add apps/gis-canvas/src/lib/use-window-state.ts apps/gis-canvas/src/lib/use-window-state.test.ts apps/gis-canvas/src/components/WindowStateProvider.tsx
git commit -m "feat(gis-canvas): ephemeral window-state store + provider"
```

---

### Task 3: Window renders open / shaded / minimized

**Files:**
- Modify: `src/components/Window.tsx`
- Test: `src/components/Window.test.tsx`

**Interfaces:**
- Consumes: `WindowState`, `humanTitle` from `src/lib/window-state.ts` (Task 1)
- Produces: `<Window>` accepting four new **optional** props — `state?: WindowState` (default `'open'`), `canMinimize?: boolean` (default `false`), `onToggleShade?: () => void`, `onMinimize?: () => void`. Test ids `shade-<id>` and `minimize-<id>`.

The props are optional so the existing `Window.test.tsx` `setup()` helper and any other call site keep compiling. `canMinimize` defaults to `false`, so a caller that has not opted in shows no controls at all.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/Window.test.tsx` (inside the existing `describe('Window', ...)` block):

```tsx
  it('shows no shade/minimize controls unless canMinimize is set', () => {
    setup()
    expect(screen.queryByTestId('shade-w1')).toBeNull()
    expect(screen.queryByTestId('minimize-w1')).toBeNull()
  })

  it('fires the callbacks without starting a drag', () => {
    const onToggleShade = vi.fn(); const onMinimize = vi.fn()
    const { onDragMove, onGestureStart } = setup({ canMinimize: true, onToggleShade, onMinimize })
    fireEvent.pointerDown(screen.getByTestId('shade-w1'))
    fireEvent.click(screen.getByTestId('shade-w1'))
    fireEvent.click(screen.getByTestId('minimize-w1'))
    expect(onToggleShade).toHaveBeenCalledTimes(1)
    expect(onMinimize).toHaveBeenCalledTimes(1)
    expect(onDragMove).not.toHaveBeenCalled()
    expect(onGestureStart).not.toHaveBeenCalled()
  })

  it('shaded collapses to the header: no content, no resize handles, still draggable', () => {
    setup({ canMinimize: true, state: 'shaded' })
    expect(screen.queryByText('body')).toBeNull()
    expect(screen.queryByTestId('resize-w1-se')).toBeNull()
    expect(screen.getByTestId('window-w1')).toHaveStyle({ height: 'auto' })
    expect(screen.getByTestId('window-header-w1')).toBeInTheDocument()
  })

  it('minimized hides the window but keeps its children mounted', () => {
    setup({ canMinimize: true, state: 'minimized' })
    const el = screen.getByTestId('window-w1')
    expect(el).toHaveAttribute('hidden')
    // Load-bearing: unmounting would refetch broker data and drop the shared
    // time extent, so the molecule must survive minimize.
    expect(el).toHaveTextContent('body')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/gis-canvas && npx vitest run src/components/Window.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="shade-w1"]` and the shaded/minimized assertions.

- [ ] **Step 3: Implement the three render states**

In `src/components/Window.tsx`, extend the props interface:

```tsx
interface WindowProps {
  node: ComponentNode
  rect: WindowRect
  getContainer: () => { w: number; h: number } // LIVE accessor — called per gesture, never snapshotted
  onGestureStart: () => void                    // pointerdown: parent snapshots rect + brings to front
  onDragMove: (dxPct: number, dyPct: number, commit: boolean) => void
  onResizeMove: (handle: ResizeHandle, dxPct: number, dyPct: number, commit: boolean) => void
  state?: WindowState
  canMinimize?: boolean
  onToggleShade?: () => void
  onMinimize?: () => void
  children: ReactNode
}
```

Add the import:

```tsx
import { humanTitle, type WindowState } from '../lib/window-state'
```

Change the signature and replace the returned JSX:

```tsx
export function Window({
  node, rect, getContainer, onGestureStart, onDragMove, onResizeMove,
  state = 'open', canMinimize = false, onToggleShade, onMinimize, children,
}: WindowProps) {
```

```tsx
  const shaded = state === 'shaded'
  const minimized = state === 'minimized'
  // Keep the pointerdown off both the header drag and the outer gesture start —
  // pressing a control must never move or re-stack the window.
  const swallow = (e: RPointerEvent) => e.stopPropagation()

  return (
    <div
      data-testid={`window-${node.id}`}
      hidden={minimized}
      onPointerDown={onGestureStart}
      className="gc-hud pointer-events-auto absolute flex flex-col overflow-hidden rounded-gc-md"
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: shaded ? 'auto' : `${rect.h}%`, zIndex: rect.z }}
    >
      <div
        data-testid={`window-header-${node.id}`}
        onPointerDown={beginDrag}
        className="flex shrink-0 cursor-move items-center gap-1.5 border-b border-hairline/40 px-2 py-1 font-mono text-[10.5px] uppercase tracking-wide text-tertiary select-none"
      >
        <span className="truncate">{humanTitle(node)}</span>
        {canMinimize && (
          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              data-testid={`shade-${node.id}`}
              aria-label={shaded ? 'Expand' : 'Collapse'}
              title={shaded ? 'Expand' : 'Collapse'}
              onPointerDown={swallow}
              onClick={onToggleShade}
              className="cursor-pointer px-1 leading-none text-tertiary hover:text-primary"
            >
              {shaded ? '⌃' : '⌄'}
            </button>
            <button
              data-testid={`minimize-${node.id}`}
              aria-label="Minimize"
              title="Minimize"
              onPointerDown={swallow}
              onClick={onMinimize}
              className="cursor-pointer px-1 leading-none text-tertiary hover:text-primary"
            >
              ▁
            </button>
          </span>
        )}
      </div>
      {!shaded && <div className="relative min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>}
      {!shaded && HANDLES.map(h => (
        <span key={h} data-testid={`resize-${node.id}-${h}`} onPointerDown={beginResize(h)}
          className={`absolute ${handleClass(h)}`} />
      ))}
    </div>
  )
```

Note the content div is dropped when shaded but kept when minimized — `hidden` on the ancestor is what makes a minimized window disappear, and it keeps React mounted.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/gis-canvas && npx vitest run src/components/Window.test.tsx`
Expected: PASS — the four new tests plus every pre-existing Window test.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/Window.tsx apps/gis-canvas/src/components/Window.test.tsx
git commit -m "feat(gis-canvas): Window shade/minimize controls and three render states"
```

---

### Task 4: The taskbar

**Files:**
- Create: `src/components/WindowTaskbar.tsx`
- Test: `src/components/WindowTaskbar.test.tsx`

**Interfaces:**
- Consumes: `humanTitle` from `src/lib/window-state.ts` (Task 1), `RESERVE_PCT` from `src/lib/window-layout.ts`
- Produces: `<WindowTaskbar nodes={ComponentNode[]} updated={Set<string>} onRestore={(id: string) => void} />`; test ids `window-taskbar` and `taskbar-chip-<id>`, badge test id `chip-badge-<id>`.

The component is presentational — it takes the already-filtered, already-ordered node list. `FreeCanvas` (Task 5) supplies it in doc order so chips do not jump around as windows are minimized.

`RESERVE_PCT` is reused rather than re-specified: seed rects already keep windows above that strip so the map's "Map data ©…" attribution stays visible, and the taskbar must respect the same reserve.

- [ ] **Step 1: Write the failing test**

Create `src/components/WindowTaskbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WindowTaskbar } from './WindowTaskbar'
import type { ComponentNode } from '../lib/types'

const nodes: ComponentNode[] = [
  { id: 'tbl', type: 'data-table', props: { title: 'AIS points' } },
  { id: 'ts', type: 'esri:time-slider' },
]

describe('WindowTaskbar', () => {
  it('renders a chip per minimized window and restores on click', () => {
    const onRestore = vi.fn()
    render(<WindowTaskbar nodes={nodes} updated={new Set()} onRestore={onRestore} />)
    expect(screen.getByText('AIS points')).toBeInTheDocument()
    expect(screen.getByText('time slider')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('taskbar-chip-ts'))
    expect(onRestore).toHaveBeenCalledWith('ts')
  })

  it('badges only the chips the agent has revised', () => {
    render(<WindowTaskbar nodes={nodes} updated={new Set(['tbl'])} onRestore={() => {}} />)
    expect(screen.getByTestId('chip-badge-tbl')).toBeInTheDocument()
    expect(screen.queryByTestId('chip-badge-ts')).toBeNull()
  })

  it('renders nothing when no window is minimized', () => {
    render(<WindowTaskbar nodes={[]} updated={new Set()} onRestore={() => {}} />)
    expect(screen.queryByTestId('window-taskbar')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/WindowTaskbar.test.tsx`
Expected: FAIL — `Failed to resolve import "./WindowTaskbar"`.

- [ ] **Step 3: Write the component**

Create `src/components/WindowTaskbar.tsx`:

```tsx
import type { ComponentNode } from '../lib/types'
import { humanTitle } from '../lib/window-state'
import { RESERVE_PCT } from '../lib/window-layout'

/** Strip of restore chips for minimized windows. Sits above the reserved
 * attribution strip at the canvas bottom (same RESERVE_PCT the seed rects use),
 * so the map's "Map data ©…" credit is never covered. */
export function WindowTaskbar({
  nodes, updated, onRestore,
}: {
  nodes: ComponentNode[]
  updated: Set<string>
  onRestore: (id: string) => void
}) {
  if (!nodes.length) return null
  return (
    <div
      data-testid="window-taskbar"
      className="gc-hud pointer-events-auto absolute left-2 right-2 z-[60] flex flex-wrap items-center gap-1.5 rounded-gc-md px-2 py-1.5"
      style={{ bottom: `${RESERVE_PCT}%` }}
    >
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-tertiary">Minimized</span>
      {nodes.map(node => (
        <button
          key={node.id}
          data-testid={`taskbar-chip-${node.id}`}
          onClick={() => onRestore(node.id)}
          title={`Restore ${humanTitle(node)}`}
          className="flex max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 rounded-gc-sm border border-hairline bg-surface px-2 py-1 font-sans text-[11.5px] text-secondary hover:text-primary"
        >
          <span className="truncate">{humanTitle(node)}</span>
          {updated.has(node.id) && (
            <span data-testid={`chip-badge-${node.id}`} aria-label="Updated"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          )}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/components/WindowTaskbar.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/WindowTaskbar.tsx apps/gis-canvas/src/components/WindowTaskbar.test.tsx
git commit -m "feat(gis-canvas): minimized-window taskbar with update badges"
```

---

### Task 5: Wire it into FreeCanvas

**Files:**
- Modify: `src/components/FreeCanvas.tsx`
- Test: `src/components/FreeCanvas.test.tsx`

**Interfaces:**
- Consumes: `useWindowState` (Task 2), `<Window state canMinimize onToggleShade onMinimize>` (Task 3), `<WindowTaskbar>` (Task 4), `canMinimize` / `signatures` / `changedIds` (Task 1)
- Produces: nothing new for later tasks; this is the integration point.

Two effects are added. Both must be loop-safe: their dependency arrays include the store object, whose identity changes whenever store state changes, so each effect must be a no-op on its second run. `sync` bails out by reference (Task 2); the badge effect bails out because it writes `sigRef` **before** comparing on the next run.

- [ ] **Step 1: Write the failing tests**

First extend the existing `Harness` in `src/components/FreeCanvas.test.tsx` so windows get a real store. Replace the existing `Harness` with:

```tsx
function Harness({ doc }: { doc: CanvasDoc }) {
  const store = useLayoutStore()
  const windows = useWindowStateStore()
  return (
    <LayoutProvider store={store}>
      <WindowStateProvider store={windows}>
        <div data-testid="store-empty">{String(store.isEmpty)}</div>
        <button data-testid="focus-toggle" onClick={windows.toggleFocus}>focus</button>
        <FreeCanvas doc={doc} />
      </WindowStateProvider>
    </LayoutProvider>
  )
}
```

and add these imports at the top of the file:

```tsx
import { WindowStateProvider } from './WindowStateProvider'
import { useWindowStateStore } from '../lib/use-window-state'
```

Then append this block at the end of the file:

```tsx
describe('FreeCanvas minimize', () => {
  it('the hero map exposes no shade or minimize control', () => {
    render(<Harness doc={doc} />)
    expect(screen.queryByTestId('minimize-m')).toBeNull()
    expect(screen.queryByTestId('shade-m')).toBeNull()
    expect(screen.getByTestId('minimize-lg')).toBeInTheDocument()
  })

  it('minimizing hides the window, adds a chip, and keeps the molecule mounted', () => {
    render(<Harness doc={doc} />)
    fireEvent.click(screen.getByTestId('minimize-lg'))
    expect(screen.getByTestId('window-lg')).toHaveAttribute('hidden')
    expect(screen.getByTestId('taskbar-chip-lg')).toBeInTheDocument()
  })

  it('restoring from the chip returns the window and drops the chip', () => {
    render(<Harness doc={doc} />)
    fireEvent.click(screen.getByTestId('minimize-lg'))
    fireEvent.click(screen.getByTestId('taskbar-chip-lg'))
    expect(screen.getByTestId('window-lg')).not.toHaveAttribute('hidden')
    expect(screen.queryByTestId('window-taskbar')).toBeNull()
  })

  it('a minimized window keeps its exact rect when restored', () => {
    render(<Harness doc={doc} />)
    const before = screen.getByTestId('window-lg').getAttribute('style')
    fireEvent.click(screen.getByTestId('minimize-lg'))
    fireEvent.click(screen.getByTestId('taskbar-chip-lg'))
    expect(screen.getByTestId('window-lg').getAttribute('style')).toBe(before)
  })

  it('badges a minimized chip when the agent revises that molecule, and clears on restore', () => {
    const { rerender } = render(<Harness doc={doc} />)
    fireEvent.click(screen.getByTestId('minimize-lg'))
    expect(screen.queryByTestId('chip-badge-lg')).toBeNull()
    const revised: CanvasDoc = {
      ...doc, rev: 2,
      components: [doc.components[0], { ...doc.components[1], props: { title: 'Legend (updated)' } }],
    }
    rerender(<Harness doc={revised} />)
    expect(screen.getByTestId('chip-badge-lg')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('taskbar-chip-lg'))
    expect(screen.queryByTestId('chip-badge-lg')).toBeNull()
  })

  it('an agent revision does not restore a minimized window', () => {
    const { rerender } = render(<Harness doc={doc} />)
    fireEvent.click(screen.getByTestId('minimize-lg'))
    rerender(<Harness doc={{ ...doc, rev: 2 }} />)
    expect(screen.getByTestId('window-lg')).toHaveAttribute('hidden')
  })

  it('focus mode minimizes every panel but never the map', () => {
    render(<Harness doc={doc} />)
    fireEvent.click(screen.getByTestId('focus-toggle'))
    expect(screen.getByTestId('window-lg')).toHaveAttribute('hidden')
    expect(screen.getByTestId('window-m')).not.toHaveAttribute('hidden')
  })

  it('shading collapses the window in place without a chip', () => {
    render(<Harness doc={doc} />)
    fireEvent.click(screen.getByTestId('shade-lg'))
    expect(screen.getByTestId('window-lg')).not.toHaveAttribute('hidden')
    expect(screen.getByTestId('window-lg')).toHaveStyle({ height: 'auto' })
    expect(screen.queryByTestId('window-taskbar')).toBeNull()
  })
})
```

Note the rerender-based tests mount a fresh `Harness` element but the same component instance, so store state survives the rerender — that is exactly the "sticky across rev" behaviour under test.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/gis-canvas && npx vitest run src/components/FreeCanvas.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="minimize-lg"]`.

- [ ] **Step 3: Wire the store into FreeCanvas**

In `src/components/FreeCanvas.tsx`, add imports:

```tsx
import { useWindowState } from './WindowStateProvider'
import { WindowTaskbar } from './WindowTaskbar'
import { canMinimize, signatures, changedIds } from '../lib/window-state'
```

Add below `const store = useLayout()`:

```tsx
  const windows = useWindowState()
  const sigRef = useRef<Record<string, string>>({})
```

Replace the existing prune effect with the combined one:

```tsx
  // Prune overrides for molecules the agent removed (sticky otherwise — NOT reset
  // on rev), and refresh the focus-candidate set. The map is excluded: it is the
  // hero, so it can never be a minimize target.
  const minimizable = useMemo(() => doc.components.filter(canMinimize).map(c => c.id), [doc])
  useEffect(() => {
    store.prune(doc.components.map(c => c.id))
    windows.sync(minimizable)
  }, [doc, store, windows, minimizable])
```

Add the badge effect right after it:

```tsx
  // Badge minimized windows the agent has revised since they were set aside, so
  // an update is visible without the panel jumping back over the map. sigRef is
  // written before the comparison, so the re-run this triggers is a no-op.
  useEffect(() => {
    const next = signatures(doc)
    const prev = sigRef.current
    sigRef.current = next
    for (const id of changedIds(prev, next)) {
      if (windows.get(id) === 'minimized') windows.markUpdated(id)
    }
  }, [doc, windows])
```

Pass the new props in the `Window` element, replacing the existing element with:

```tsx
        <Window
          key={node.id}
          node={node}
          rect={rectOf(node.id)}
          getContainer={getContainer}
          onGestureStart={beginGesture(node.id)}
          onDragMove={onDrag(node.id)}
          onResizeMove={onResize(node.id, node.type)}
          state={canMinimize(node) ? windows.get(node.id) : 'open'}
          canMinimize={canMinimize(node)}
          onToggleShade={() => windows.toggleShade(node.id)}
          onMinimize={() => windows.minimize(node.id)}
        >
          {renderNode(node)}
        </Window>
```

And mount the taskbar just before the closing `</div>`, after the two guide elements:

```tsx
      <WindowTaskbar
        nodes={doc.components.filter(c => canMinimize(c) && windows.get(c.id) === 'minimized')}
        updated={windows.updated}
        onRestore={windows.restore}
      />
```

Chips are derived from `doc.components` rather than `windows.minimizedIds` so their order follows the document and stays stable as windows come and go.

The `canMinimize(node) ? … : 'open'` guard on `state` is the third layer of hero protection: even if a stale or corrupt entry named the map, it still renders open.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/gis-canvas && npx vitest run src/components/FreeCanvas.test.tsx`
Expected: PASS — the 8 new tests plus every pre-existing FreeCanvas test (drag, resize, snapping, base z-order).

- [ ] **Step 5: Run the whole suite to catch loops and regressions**

Run: `cd apps/gis-canvas && npx vitest run`
Expected: PASS, ~318 tests. A hang or "Maximum update depth exceeded" here means a `sync`/badge effect is not bailing out — fix the updater, do not add a dependency-array workaround.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/components/FreeCanvas.tsx apps/gis-canvas/src/components/FreeCanvas.test.tsx
git commit -m "feat(gis-canvas): wire shade/minimize/taskbar into FreeCanvas"
```

---

### Task 6: Focus map in TopBar, and App wiring

**Files:**
- Modify: `src/components/TopBar.tsx`
- Modify: `src/App.tsx:52` (store), `src/App.tsx:183-195` (TopBar props and provider nesting)
- Test: `src/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: `useWindowStateStore` and `WindowStateProvider` (Task 2)
- Produces: `<TopBar>` with three new **required** props — `onFocusMap: () => void`, `canFocus: boolean`, `isFocused: boolean`. Test id `focus-map`.

These are required, not optional: `TopBar` has exactly two call sites (`App.tsx` and its own test), both updated here.

- [ ] **Step 1: Write the failing test**

Replace the contents of `src/components/TopBar.test.tsx` with:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopBar } from './TopBar'

const base = {
  theme: 'dark' as const, onToggleTheme: () => {}, connected: true, isBusy: false,
  onLogout: () => {}, onResetLayout: () => {}, canReset: false,
  onFocusMap: () => {}, canFocus: false, isFocused: false,
}

describe('TopBar', () => {
  it('shows Reset only when a layout override exists and calls back', () => {
    const onResetLayout = vi.fn()
    const { rerender } = render(<TopBar {...base} onResetLayout={onResetLayout} />)
    expect(screen.queryByTestId('reset-layout')).toBeNull()
    rerender(<TopBar {...base} onResetLayout={onResetLayout} canReset />)
    fireEvent.click(screen.getByTestId('reset-layout'))
    expect(onResetLayout).toHaveBeenCalled()
  })

  it('shows Focus map only when there is something to minimize and calls back', () => {
    const onFocusMap = vi.fn()
    const { rerender } = render(<TopBar {...base} onFocusMap={onFocusMap} />)
    expect(screen.queryByTestId('focus-map')).toBeNull()
    rerender(<TopBar {...base} onFocusMap={onFocusMap} canFocus />)
    fireEvent.click(screen.getByTestId('focus-map'))
    expect(onFocusMap).toHaveBeenCalled()
  })

  it('flips its label once everything is minimized', () => {
    const { rerender } = render(<TopBar {...base} canFocus />)
    expect(screen.getByTestId('focus-map')).toHaveTextContent('Focus map')
    rerender(<TopBar {...base} canFocus isFocused />)
    expect(screen.getByTestId('focus-map')).toHaveTextContent('Show all')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/TopBar.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="focus-map"]`.

- [ ] **Step 3: Add the button to TopBar**

In `src/components/TopBar.tsx`, extend the destructured props and their type:

```tsx
export function TopBar({
  theme,
  onToggleTheme,
  connected,
  isBusy,
  onLogout,
  onResetLayout,
  canReset,
  onFocusMap,
  canFocus,
  isFocused
}: {
  theme: ThemeMode
  onToggleTheme: () => void
  connected: boolean
  isBusy: boolean
  onLogout: () => void
  onResetLayout: () => void
  canReset: boolean
  onFocusMap: () => void
  canFocus: boolean
  isFocused: boolean
}) {
```

Insert the button immediately **before** the existing `{canReset && (` block:

```tsx
        {canFocus && (
          <button
            data-testid="focus-map"
            onClick={onFocusMap}
            title={isFocused ? 'Restore all panels' : 'Minimize every panel except the map'}
            className="rounded-gc-sm border border-hairline bg-surface px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary"
          >
            {isFocused ? '⊙ Show all' : '⊙ Focus map'}
          </button>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/components/TopBar.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Wire App**

In `src/App.tsx`, add the imports beside the existing layout ones:

```tsx
import { WindowStateProvider } from './components/WindowStateProvider'
import { useWindowStateStore } from './lib/use-window-state'
```

Add the store next to the layout store (currently `src/App.tsx:52`):

```tsx
  const layout = useLayoutStore()
  const windows = useWindowStateStore()
```

Add a combined reset beside `handleLogout` — `Reset layout` is the "put everything back" button, so it clears window state too:

```tsx
  const handleResetLayout = () => { layout.reset(); windows.reset() }
```

Replace the `TopBar` element:

```tsx
      <TopBar theme={theme} onToggleTheme={toggleTheme} connected={connected} isBusy={isBusy}
        onLogout={handleLogout} onResetLayout={handleResetLayout}
        canReset={!layout.isEmpty || !windows.isEmpty}
        onFocusMap={windows.toggleFocus} canFocus={windows.canFocus} isFocused={windows.isFocused} />
```

Wrap `CanvasGrid` in the new provider, inside `LayoutProvider`:

```tsx
                    <LayoutProvider store={layout}>
                      <WindowStateProvider store={windows}>
                        <CanvasGrid doc={mergedDoc} />
                      </WindowStateProvider>
                    </LayoutProvider>
```

- [ ] **Step 6: Full verification**

Run: `cd apps/gis-canvas && npx vitest run && npx tsc -p . --noEmit`
Expected: all tests PASS (~321), typecheck clean with no output.

- [ ] **Step 7: Commit**

```bash
git add apps/gis-canvas/src/components/TopBar.tsx apps/gis-canvas/src/components/TopBar.test.tsx apps/gis-canvas/src/App.tsx
git commit -m "feat(gis-canvas): Focus map toggle and App wiring for window state"
```

---

## Manual verification

Automated tests run in jsdom, which has no layout — the taskbar's position, the shaded window's collapsed height, and the glass chrome on the chips can only be judged in the browser.

Only the SPA is needed (no gateway restart — nothing here touches the backend), but the map must render, so run the normal stack:

```bash
# from the repo root
npm run dev --workspace @hermes/gis-canvas
```

Check, on a canvas with several panels over the map:

1. Each panel header shows `⌄` and `▁`; the map header shows neither.
2. `⌄` collapses a panel to its header bar in place; `⌃` expands it back.
3. `▁` removes a panel from the canvas and adds a chip to the bottom strip; the strip sits above the "Map data © OpenStreetMap contributors" credit, which stays readable.
4. Clicking the chip restores the panel to the exact position and size it had.
5. Minimize a data table, wait for the agent to revise it, and confirm the chip gets an accent dot and the panel does **not** pop back open. Restoring clears the dot, and the table shows its data immediately with no refetch flash.
6. Minimize the time slider and confirm the map keeps its time filter (the molecule stays mounted).
7. `⊙ Focus map` clears every panel to the taskbar and leaves the map full-bleed; the button becomes `⊙ Show all` and brings them all back.
8. `⤢ Reset layout` restores and unshades everything as well as clearing drag/resize overrides.
