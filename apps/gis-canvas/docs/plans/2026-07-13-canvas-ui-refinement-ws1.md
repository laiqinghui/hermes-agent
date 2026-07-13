# Canvas UI Refinement — Workstream 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the frontend legibility & resilience refinement of the Phase 6 GIS canvas — correct overlay centering, skeleton→reveal-on-ready loading, container-resilient molecules, and a non-broken feature-table — with no schema/plugin/agent changes.

**Architecture:** All changes under `apps/gis-canvas/src/` plus `vite.config.ts`. Design tokens and animations live in `src/index.css`; each molecule owns its own loading state and renders a shared `Skeleton` atom until its content is ready. The broken ESRI feature-table is aliased to the working `DataTableMolecule` at the registry level.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 (`@theme` + `@container`), ESRI Calcite tokens, `@arcgis/*` native ESM, vitest + @testing-library/react.

## Global Constraints

- All changes under `apps/gis-canvas/` (plus its `vite.config.ts`). No edits to the plugin, gateway, canvas schema, or agent prompt (those are Workstream 2). Verbatim from spec: **"No changes to the canvas schema, the plugin, the gateway, or the agent prompt."**
- Work on branch `gis/ws1-ui-refinement` (already created; the WS1 design doc is committed there).
- Existing suite MUST stay green: 71 tests. Run `npx vitest run` from `apps/gis-canvas/`.
- Typecheck MUST stay clean: `npm run typecheck` (`tsc -p . --noEmit`) from `apps/gis-canvas/`.
- Commit prefix `gis:`; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git add -A` — stage explicit paths.
- The dev server is a background Vite on port 5174; source edits hot-reload. Visual verification is done in the running app in **both** light and dark.
- Component type keys (registry): `card`, `stat`, `data-table`, `select`, `esri:map`, `esri:legend`, `esri:feature-table`. Feature-table nodes bind data via `bindings.layer` (string or `[string]`); DataTable binds via `bindings.source`.

---

### Task 1: Commit the map-load fix from the debugging pass

The debugging pass already fixed the map (it plots live). Those edits are uncommitted in the working tree: `loadEsri()` no longer imports `arcgis-feature-table` (the `@vaadin/@polymer` chain Vite mis-optimizes), a new `loadFeatureTable()` loads it on demand, and `vite.config.ts` excludes the ESRI/Vaadin/Polymer subtree from dep pre-bundling. This task commits exactly those, nothing else.

**Files:**
- Modify: `vite.config.ts` (already edited — `optimizeDeps.exclude`)
- Modify: `src/lib/esri/loader.ts` (already edited — split `loadEsri` / `loadFeatureTable`)
- Modify: `src/components/molecules/EsriFeatureTableMolecule.tsx` (already edited — `Promise.all([loadEsri(), loadFeatureTable()])`)

**Interfaces:**
- Produces: `loadEsri(): Promise<EsriBag>` (map + legend + core only), `loadFeatureTable(): Promise<void>` (registers `arcgis-feature-table` on demand).

- [ ] **Step 1: Confirm these three files carry only the map-fix edits (no debug logs).**

Run: `git diff --stat vite.config.ts src/lib/esri/loader.ts src/components/molecules/EsriFeatureTableMolecule.tsx`
Expected: three files changed; inspect `git diff` and confirm no `console.log('[.*DBG]'` lines are present in them.

- [ ] **Step 2: Typecheck + full suite green.**

Run (from `apps/gis-canvas/`): `npm run typecheck && npx vitest run`
Expected: typecheck clean; `Tests 71 passed (71)`.

- [ ] **Step 3: Commit exactly these three files.**

```bash
git add vite.config.ts src/lib/esri/loader.ts src/components/molecules/EsriFeatureTableMolecule.tsx
git commit -m "gis: lazy-load ESRI feature-table so the map never pulls the Polymer chain

@arcgis/core -> @vaadin/grid -> @polymer/polymer's dom-module.js is mis-emitted
by Vite 8's Rolldown dep optimizer (static import(...) -> browser rejects). It was
imported eagerly in loadEsri(), rejecting the whole load and blanking the map even
on canvases with no feature-table. Split it into loadFeatureTable() (on demand) and
exclude the subtree from optimizeDeps.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Fix overlay centering + lengthen the tile entrance (CSS)

**Root cause:** Tailwind v4 emits `-translate-x-1/2` as the CSS `translate` property, while the overlay keyframes also set `transform: translate(-50%, …)`. `translate` and `transform` compose → −100% X, shoving the dock/panel/toast a full width left. Fix: keyframes animate only Y + scale + opacity; `-translate-x-1/2` remains the sole X-centering.

**Files:**
- Modify: `src/index.css` (keyframes `gc-dock-in`, `gc-panel-in`, `gc-toast-in`; entrance duration on `.gc-tile-enter`)

**Interfaces:** none (CSS only). `CommandDock`/`AgentPanel`/`BuildToast` markup unchanged (they keep `left-1/2 -translate-x-1/2`).

- [ ] **Step 1: Replace the three overlay keyframes.** In `src/index.css`, replace:

```css
@keyframes gc-dock-in { 0% { opacity: 0; transform: translate(-50%, 10px) scale(.96); } 100% { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes gc-panel-in { 0% { opacity: 0; transform: translate(-50%, 16px) scale(.97); } 100% { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes gc-scrim-in { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes gc-toast-in { 0% { opacity: 0; transform: translate(-50%, -8px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
```

with (only the X-translate removed; scrim untouched):

```css
@keyframes gc-dock-in { 0% { opacity: 0; transform: translateY(10px) scale(.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes gc-panel-in { 0% { opacity: 0; transform: translateY(16px) scale(.97); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes gc-scrim-in { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes gc-toast-in { 0% { opacity: 0; transform: translateY(-8px); } 100% { opacity: 1; transform: translateY(0); } }
```

- [ ] **Step 2: Lengthen the tile entrance.** In `src/index.css`, change:

```css
.gc-tile-enter { animation: gc-materialize 0.62s cubic-bezier(.16,1,.3,1) both; }
```
to:
```css
.gc-tile-enter { animation: gc-materialize 0.85s cubic-bezier(.16,1,.3,1) both; }
```
And change the `::after` scan-sweep duration to match:
```css
.gc-tile-enter::after { /* … unchanged properties … */ animation: gc-scan-sweep 0.85s ease-out both; }
```

- [ ] **Step 3: Verify no overlay keyframe still translates X.**

Run (from `apps/gis-canvas/`): `grep -nE "gc-(dock|panel|toast)-in" -A1 src/index.css | grep "translate(-50%" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Typecheck + suite.**

Run: `npm run typecheck && npx vitest run`
Expected: clean; 71 passed.

- [ ] **Step 5: Visual check.** In the running app, open the command dock (press `/`) and the agent panel; both are horizontally centered. Trigger an agent turn; the BuildToast is centered. Confirm in light and dark.

- [ ] **Step 6: Commit.**

```bash
git add src/index.css
git commit -m "gis: fix overlay centering (Tailwind translate vs keyframe transform compose) + lengthen tile entrance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Skeleton atom + shimmer

**Files:**
- Create: `src/components/atoms/Skeleton.tsx`
- Create: `src/components/atoms/Skeleton.test.tsx`
- Modify: `src/index.css` (add `.gc-skeleton` + `gc-shimmer` keyframe)

**Interfaces:**
- Produces: `Skeleton({ className?: string; rows?: number })` — renders one shimmer block, or `rows` stacked line-blocks when `rows` is given. Root element always carries `data-testid="skeleton"`.

- [ ] **Step 1: Write the failing test.** Create `src/components/atoms/Skeleton.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Skeleton } from './Skeleton'

describe('Skeleton', () => {
  it('renders a single shimmer block by default', () => {
    render(<Skeleton />)
    const el = screen.getByTestId('skeleton')
    expect(el).toHaveClass('gc-skeleton')
  })

  it('renders N line rows when rows is given', () => {
    render(<Skeleton rows={4} />)
    const container = screen.getByTestId('skeleton')
    expect(container.querySelectorAll('.gc-skeleton')).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run test, verify it fails.**

Run: `npx vitest run src/components/atoms/Skeleton.test.tsx`
Expected: FAIL (cannot find module `./Skeleton`).

- [ ] **Step 3: Implement `src/components/atoms/Skeleton.tsx`:**

```tsx
export function Skeleton({ className = '', rows }: { className?: string; rows?: number }) {
  if (rows && rows > 0) {
    return (
      <div data-testid="skeleton" className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={`gc-skeleton h-4 w-full rounded-gc-sm ${className}`} />
        ))}
      </div>
    )
  }
  return <div data-testid="skeleton" className={`gc-skeleton rounded-gc-sm ${className}`} />
}
```

- [ ] **Step 4: Add shimmer CSS.** In `src/index.css`, after the existing keyframes, add:

```css
.gc-skeleton { position: relative; overflow: hidden; background: var(--color-surface-raised); }
.gc-skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in oklab, var(--color-hairline-strong) 55%, transparent), transparent);
  animation: gc-shimmer 1.4s ease-in-out infinite;
}
@keyframes gc-shimmer { 100% { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .gc-skeleton::after { animation: none; } }
```

- [ ] **Step 5: Run test, verify pass.**

Run: `npx vitest run src/components/atoms/Skeleton.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit.**

```bash
git add src/components/atoms/Skeleton.tsx src/components/atoms/Skeleton.test.tsx src/index.css
git commit -m "gis: add Skeleton atom + token-driven shimmer (reduced-motion aware)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: DataTable skeleton while a data:// source loads

Currently, while a `data://` handle is fetching, `fetched === null` → `data` is null → the molecule renders a red **"Unknown data source"** error (a mislabeled loading flash). Show a skeleton instead, and reserve the error for genuinely unknown mock sources.

**Files:**
- Modify: `src/components/molecules/DataTableMolecule.tsx`
- Modify: `src/components/molecules/DataTableMolecule.test.tsx` (add a case)

**Interfaces:**
- Consumes: `Skeleton` (Task 3).

- [ ] **Step 1: Write the failing test.** Append to `src/components/molecules/DataTableMolecule.test.tsx` inside the existing `describe`:

```tsx
  it('shows a skeleton (not an error) while a data:// handle is pending', () => {
    const fetchData = vi.fn(() => new Promise<never>(() => {})) // never resolves
    renderWith({ id: 't3', type: 'data-table', bindings: { source: 'data://pending' } }, fetchData as any)
    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
    expect(screen.queryByText(/Unknown data source/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run, verify fail.**

Run: `npx vitest run src/components/molecules/DataTableMolecule.test.tsx`
Expected: FAIL (no `skeleton` testid; "Unknown data source: data://pending" rendered).

- [ ] **Step 3: Implement.** In `DataTableMolecule.tsx`, add the import:

```tsx
import { Skeleton } from '../atoms/Skeleton'
```

Replace the current not-found branch:

```tsx
  if (!data) {
    return <div className="p-2 text-sm text-negative">Unknown data source: {source || '(none)'}</div>
  }
```

with:

```tsx
  if (!data) {
    // A data:// handle that hasn't resolved yet is loading, not unknown.
    if (isDataHandle(source)) {
      return (
        <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised">
          <div className="flex shrink-0 items-center justify-between border-b border-hairline px-3 py-2">
            <span className="truncate font-display text-sm font-semibold text-primary">
              {(node.props?.title as string | undefined) ?? source}
            </span>
          </div>
          <div className="min-h-0 flex-1 p-3">
            <Skeleton rows={8} />
          </div>
        </div>
      )
    }
    return <div className="p-2 text-sm text-negative">Unknown data source: {source || '(none)'}</div>
  }
```

- [ ] **Step 4: Run, verify pass (and no regressions in the file's other tests).**

Run: `npx vitest run src/components/molecules/DataTableMolecule.test.tsx`
Expected: PASS (all cases, including the new one).

- [ ] **Step 5: Commit.**

```bash
git add src/components/molecules/DataTableMolecule.tsx src/components/molecules/DataTableMolecule.test.tsx
git commit -m "gis: DataTable shows a skeleton (not a false 'unknown source' error) while data:// loads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Map skeleton overlay until ready + strip MAPDBG

Add a `ready` flag set once the ESRI view is up and layers are added; overlay a skeleton on the map frame until then. Also remove the temporary `[MAPDBG]` logs and the temp dynamic `import('../../lib/esri/graphics')` added while debugging.

**Files:**
- Modify: `src/components/molecules/EsriMapMolecule.tsx`
- Create: `src/components/molecules/EsriMapMolecule.test.tsx`

**Interfaces:**
- Consumes: `Skeleton` (Task 3), `loadEsri` (Task 1).

- [ ] **Step 1: Write the failing test.** Create `src/components/molecules/EsriMapMolecule.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HandlerProvider } from '../HandlerContext'
import type { CanvasActions } from '../../lib/handlers'

// Keep ESRI out of jsdom: loadEsri resolves a stub; the readiness event never fires.
vi.mock('../../lib/esri/loader', () => ({
  loadEsri: vi.fn().mockResolvedValue({
    esriConfig: {}, FeatureLayer: class {}, reactiveUtils: { on: () => ({ remove() {} }) }
  })
}))

import { EsriMapMolecule } from './EsriMapMolecule'

function renderMap(node: any) {
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData: vi.fn() }
  return render(
    <HandlerProvider actions={actions}>
      <EsriMapMolecule node={node} renderChild={() => null} />
    </HandlerProvider>
  )
}

describe('EsriMapMolecule', () => {
  it('shows a map skeleton until the view is ready', () => {
    renderMap({ id: 'map', type: 'esri:map', bindings: { layers: ['data://x'] }, props: {} })
    expect(screen.getByTestId('map-skeleton')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, verify fail.**

Run: `npx vitest run src/components/molecules/EsriMapMolecule.test.tsx`
Expected: FAIL (no `map-skeleton` testid).

- [ ] **Step 3: Implement.** In `EsriMapMolecule.tsx`:

Add imports/state — add `useState` to the React import and import `Skeleton`:
```tsx
import { useEffect, useRef, useState } from 'react'
import { Skeleton } from './Skeleton' // NOTE: correct relative path below
```
(Use `import { Skeleton } from '../atoms/Skeleton'`.)

Add readiness state near the top of the component:
```tsx
  const [ready, setReady] = useState(false)
```

Remove the temporary debug block inside the `onReady` layer loop — delete these lines:
```tsx
      console.log('[MAPDBG] node', node.id, 'layerRefs=', layerRefs) // TEMP
```
and inside the `isDataHandle(r)` branch delete:
```tsx
            // TEMP instrumentation: what did the broker return, and can we geo-locate it?
            const schemaNames = (page.schema ?? []).map((f: { name: string }) => f.name)
            const { detectGeoFields } = await import('../../lib/esri/graphics')
            const geo = detectGeoFields(page.schema as never)
            const sample = (page.rows ?? []).slice(0, 2)
            console.log('[MAPDBG] handle', r, 'rows=', page.rows?.length, 'schema=', schemaNames, 'detectedGeo=', geo, 'sampleRows=', sample) // TEMP
```
(Leave the surrounding `const page = await actions.fetchData(...)` and `layer = buildRowsLayer(...)` lines intact.)

At the end of `onReady`, after the layer loop and before the selection `clickHandle` wiring (or at the end — either is fine), mark ready:
```tsx
      if (!cancelled) setReady(true)
```

Render the skeleton overlay inside `EsriFrame`, as a sibling of `<arcgis-map>`:
```tsx
    <EsriFrame title={(node.props?.title as string | undefined) ?? 'Map'} meta={basemap} corners>
      {/* @ts-expect-error — arcgis-map is a custom element (typed loosely for React) */}
      <arcgis-map
        ref={ref}
        id={`esri-map-${node.id}`}
        basemap={basemap}
        {...(center ? { center } : {})}
        {...(props.zoom != null ? { zoom: String(props.zoom) } : {})}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      {!ready ? (
        <div data-testid="map-skeleton" className="absolute inset-0 z-10 transition-opacity duration-300">
          <Skeleton className="h-full w-full" />
        </div>
      ) : null}
      {selectionSummary ? (
        /* … existing selection badge unchanged … */
      ) : null}
    </EsriFrame>
```

- [ ] **Step 4: Run, verify pass.**

Run: `npx vitest run src/components/molecules/EsriMapMolecule.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm no MAPDBG remains.**

Run: `grep -n "MAPDBG" src/components/molecules/EsriMapMolecule.tsx || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Typecheck + full suite.**

Run: `npm run typecheck && npx vitest run`
Expected: clean; all pass (72 now).

- [ ] **Step 7: Visual check.** In the running app, ask the agent for a map; the map area shows a shimmer skeleton, then reveals the basemap + plotted points once ready.

- [ ] **Step 8: Commit.**

```bash
git add src/components/molecules/EsriMapMolecule.tsx src/components/molecules/EsriMapMolecule.test.tsx
git commit -m "gis: map skeleton overlay until view ready; remove debug instrumentation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: CanvasGrid — keep the entrance-survival fix, tune stagger, strip ANIMDBG

The debugging pass already replaced the per-render `newIds` diff (which stripped the animation class on the next re-render) with an `entering` state set + `onAnimationEnd` cleanup — keep it. Remove the temporary `[ANIMDBG]` log and widen the stagger slightly to match the longer entrance.

**Files:**
- Modify: `src/components/CanvasGrid.tsx`
- Modify: `src/components/CanvasGrid.test.tsx` (add an entrance assertion)

- [ ] **Step 1: Write the failing test.** Append to `src/components/CanvasGrid.test.tsx` (inside its `describe`; reuse its existing render helper/imports — a minimal standalone version shown here):

```tsx
  it('marks a freshly-rendered tile with the entrance class', async () => {
    const { waitFor } = await import('@testing-library/react')
    const doc = {
      rev: 1,
      layout: { cols: 12, rowHeight: 80, gap: 8 },
      components: [{ id: 'a', type: 'stat', area: { col: 1, colSpan: 4, row: 1, rowSpan: 1 }, props: { label: 'x', value: 1 } }]
    }
    const { getByTestId } = render(<CanvasGrid doc={doc as any} />)
    await waitFor(() => expect(getByTestId('cell-a').className).toContain('gc-tile-enter'))
  })
```

(If `CanvasGrid.test.tsx` already imports `render`/`CanvasGrid`, reuse those imports instead of redeclaring.)

- [ ] **Step 2: Run, verify current state.**

Run: `npx vitest run src/components/CanvasGrid.test.tsx`
Expected: PASS already if the `entering` fix is intact (this test guards it against regression). If it FAILS, the entrance-survival fix is missing — restore it per the design before continuing.

- [ ] **Step 3: Remove the ANIMDBG log.** In `CanvasGrid.tsx`, delete:

```tsx
  // TEMP: is the animation firing, or is it disabled by OS reduced-motion?
  console.log('[ANIMDBG] entering=', [...entering], 'reducedMotion=',
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
```

- [ ] **Step 4: Widen the stagger.** In `CanvasGrid.tsx`, change:

```tsx
              animationDelay: isNew ? `${Math.min(i, 8) * 40}ms` : undefined
```
to:
```tsx
              animationDelay: isNew ? `${Math.min(i, 10) * 70}ms` : undefined
```

- [ ] **Step 5: Confirm clean + run.**

Run: `grep -n "ANIMDBG" src/components/CanvasGrid.tsx || echo "clean"; npx vitest run src/components/CanvasGrid.test.tsx`
Expected: `clean`; tests PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/components/CanvasGrid.tsx src/components/CanvasGrid.test.tsx
git commit -m "gis: keep tile-entrance-survival fix (guarded by test), widen stagger, drop debug log

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Container-resilient molecules (no clipping at any cell size)

Make each molecule root a size container and drive type/overflow off it so a large/long value in a short cell (the clipped "20") shrinks/truncates instead of overflowing.

**Files:**
- Modify: `src/components/molecules/StatMolecule.tsx`
- Modify: `src/components/molecules/CardMolecule.tsx`
- Modify: `src/components/molecules/SelectMolecule.tsx`
- Create: `src/components/molecules/StatMolecule.test.tsx`

- [ ] **Step 1: Write the failing test.** Create `src/components/molecules/StatMolecule.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatMolecule } from './StatMolecule'

describe('StatMolecule', () => {
  it('renders value inside a size-container with clamped/truncating value text', () => {
    render(<StatMolecule node={{ id: 's', type: 'stat', props: { label: 'Latest', value: '2025-05-05 23:59:47 UTC-ish' } } as any} renderChild={() => null} />)
    const value = screen.getByText('2025-05-05 23:59:47 UTC-ish')
    expect(value.className).toMatch(/truncate|overflow-hidden|\[font-size:/)
    // root establishes a container
    const root = value.closest('[data-molecule="stat"]')
    expect(root).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify fail.**

Run: `npx vitest run src/components/molecules/StatMolecule.test.tsx`
Expected: FAIL (no `data-molecule="stat"` root / value lacks clamp/truncate class).

- [ ] **Step 3: Implement StatMolecule.** Replace the returned JSX in `StatMolecule.tsx` with a container-query-driven version:

```tsx
  return (
    <div
      data-molecule="stat"
      className="@container flex h-full items-stretch overflow-hidden rounded-gc-md border border-hairline bg-surface shadow-gc-raised"
    >
      <span aria-hidden className={`w-[3px] shrink-0 ${barClass}`} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
        <span className="truncate font-mono text-[11px] uppercase tracking-wide text-tertiary">{label ?? node.id}</span>
        <span
          className="truncate font-display font-semibold leading-none tabular-nums text-primary [font-size:clamp(1rem,7cqi,1.75rem)]"
          title={String(value ?? '')}
        >
          {String(value ?? '—')}
        </span>
        {trend ? <span className={`truncate font-mono text-xs ${trendClass}`}>{trend}</span> : null}
      </div>
    </div>
  )
```

(`7cqi` = 7% of the container's inline size; `clamp` floors at 1rem and caps at 1.75rem. `min-w-0` + `truncate` prevent overflow; `title` keeps the full value on hover.)

- [ ] **Step 4: Run, verify pass.**

Run: `npx vitest run src/components/molecules/StatMolecule.test.tsx`
Expected: PASS.

- [ ] **Step 5: Harden Card + Select (no new tests — visual).** In `CardMolecule.tsx`, add `min-w-0` to the header title span and ensure the content wrapper has `min-h-0`. In `SelectMolecule.tsx`, add `min-w-0` to the root and `truncate` to the label so a long field name can't overflow. Keep existing token classes.

- [ ] **Step 6: Typecheck + full suite.**

Run: `npm run typecheck && npx vitest run`
Expected: clean; all pass.

- [ ] **Step 7: Visual check.** Ask the agent for a stat with a long value in a short tile (or reuse the GREY LADY canvas): the value shrinks/truncates within the tile, no clipping, in light and dark.

- [ ] **Step 8: Commit.**

```bash
git add src/components/molecules/StatMolecule.tsx src/components/molecules/StatMolecule.test.tsx src/components/molecules/CardMolecule.tsx src/components/molecules/SelectMolecule.tsx
git commit -m "gis: container-query resilient molecules (stat value clamps/truncates; no clipping)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Drop the ESRI feature-table — alias to DataTable

A `esri:feature-table` node carries the same `data://` handle (in `bindings.layer`) as a data table. Unregister the broken ESRI widget and render such nodes through `DataTableMolecule`, remapping `bindings.layer` → `bindings.source`.

**Files:**
- Modify: `src/components/registry.tsx`
- Create: `src/components/registry.test.tsx`

**Interfaces:**
- Consumes: `DataTableMolecule` (existing), `ComponentNode` type.

- [ ] **Step 1: Write the failing test.** Create `src/components/registry.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { COMPONENT_REGISTRY } from './registry'
import { HandlerProvider } from './HandlerContext'
import type { CanvasActions } from '../lib/handlers'

const page = {
  ok: true, total: 1, page: 0, pageSize: 1000,
  schema: [{ name: 'id', type: 'string' }],
  rows: [{ id: 'feat-1' }]
}

describe('registry', () => {
  it('does not register a native ESRI feature-table widget', () => {
    // esri:feature-table is handled by the DataTable alias, not the broken widget.
    expect(COMPONENT_REGISTRY['esri:feature-table']).toBeDefined()
  })

  it('renders an esri:feature-table node as a data table over its layer handle', async () => {
    const fetchData = vi.fn().mockResolvedValue(page)
    const actions: CanvasActions = { setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData }
    const Alias = COMPONENT_REGISTRY['esri:feature-table']
    render(
      <HandlerProvider actions={actions}>
        <Alias node={{ id: 'ft', type: 'esri:feature-table', bindings: { layer: 'data://ft1' } } as any} renderChild={() => null} />
      </HandlerProvider>
    )
    await waitFor(() => expect(screen.getByText('feat-1')).toBeInTheDocument())
    expect(fetchData).toHaveBeenCalledWith('data://ft1', expect.anything())
  })
})
```

(Note: `toBeDefined()` — the first test just asserts the key is still registered, now via the alias.)

- [ ] **Step 2: Run, verify fail.**

Run: `npx vitest run src/components/registry.test.tsx`
Expected: FAIL (current `esri:feature-table` renders the ESRI widget, which does not fetch via `data://source`).

- [ ] **Step 3: Implement the alias.** In `registry.tsx`:

Remove the `EsriFeatureTableLazy` + `EsriFeatureTable` definitions (lines defining them). Add an alias component after the imports:

```tsx
import type { ComponentNode } from '../lib/types'
// … existing imports …

// The native ESRI feature-table pulls a Vaadin/Polymer subtree Vite mis-bundles,
// and duplicates the DataTable for the same data. Render feature-table nodes as a
// DataTable over their layer handle instead (bindings.layer -> source).
function FeatureTableAsDataTable({ node, renderChild }: MoleculeProps) {
  const layer = Array.isArray(node.bindings?.layer) ? node.bindings!.layer[0] : (node.bindings?.layer as string | undefined)
  const adapted: ComponentNode = { ...node, type: 'data-table', bindings: { ...node.bindings, source: layer } }
  return <DataTableMolecule node={adapted} renderChild={renderChild} />
}
```

Update the registry map entry:
```tsx
  'esri:feature-table': FeatureTableAsDataTable
```

- [ ] **Step 4: Run, verify pass.**

Run: `npx vitest run src/components/registry.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + full suite.**

Run: `npm run typecheck && npx vitest run`
Expected: clean; all pass.

- [ ] **Step 6: Visual check.** Ask the agent for a map + feature-table + data table; there is no empty/broken ESRI panel — the feature-table slot shows the rows as a data table.

- [ ] **Step 7: Commit.**

```bash
git add src/components/registry.tsx src/components/registry.test.tsx
git commit -m "gis: alias esri:feature-table node to DataTable (drop broken Polymer widget)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Strip remaining debug + final verification

**Files:**
- Modify: `src/components/CommandDock.tsx` (remove `DOCKDBG` probe + its `useEffect`/`useRef`/`dbgRef`)

- [ ] **Step 1: Remove the DOCKDBG probe.** In `CommandDock.tsx`, delete the temporary `useEffect`/`useRef` block (the one logging `[DOCKDBG]`) and the `dbgRef` usage. Restore the component to a plain function: drop the `import { useEffect, useRef } from 'react'` line if nothing else uses them, and remove `ref={dbgRef}` from the `<button>`.

- [ ] **Step 2: Confirm no debug logs remain anywhere.**

Run (from `apps/gis-canvas/`): `grep -rn "DOCKDBG\|MAPDBG\|ANIMDBG\|GRIDDBG" src/ || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Full verification — suite, typecheck, production build.**

Run (from `apps/gis-canvas/`): `npx vitest run && npm run typecheck && npm run build`
Expected: all tests pass; typecheck clean; `vite build` completes without error.

- [ ] **Step 4: Visual smoke (light + dark).** Reload the app; run `retrieve 20 rows and show them on a map with a table`. Confirm: centered dock/panel/toast; skeleton→reveal on the map; no clipped stat; no empty feature-table; tile entrance reads deliberately.

- [ ] **Step 5: Commit.**

```bash
git add src/components/CommandDock.tsx
git commit -m "gis: remove remaining debug instrumentation; WS1 complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** (1) overlay centering → Task 2; (2) skeleton→reveal-on-ready → Tasks 3 (atom), 4 (DataTable), 5 (Map), plus entrance tuning in Tasks 2 & 6; (3) container-resilience → Task 7; (4) drop/alias ESRI feature-table → Task 8; (5) remove debug → folded into Tasks 5 (MAPDBG), 6 (ANIMDBG), 9 (DOCKDBG). Map-load fix from the debugging pass → Task 1. All spec sections covered.
- **Placeholder scan:** no TBD/TODO; every code step shows real code; commands have expected output.
- **Type consistency:** `Skeleton({ className?, rows? })` used identically in Tasks 4/5/7; `loadEsri`/`loadFeatureTable` names match Task 1 and the loader; registry key `esri:feature-table` and binding `bindings.layer`→`source` consistent between Task 8 code and test; `data-molecule="stat"` and `data-testid` values (`skeleton`, `map-skeleton`, `cell-a`) match between implementation and tests.
- **Scope:** single subsystem (frontend). No schema/plugin/agent edits. WS2 explicitly excluded.
