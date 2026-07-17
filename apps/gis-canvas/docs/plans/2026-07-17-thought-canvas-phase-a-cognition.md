# Thought Canvas — Phase A (Cognition Plane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the GIS Canvas visualize the agent's live reasoning stream and each execution step's output on the canvas itself, show reasoning *between* steps in the trace, and turn the minimized dock into a live step ticker — all client-projected from the event stream that already flows.

**Architecture:** Frontend-only. A new client-owned **cognition plane** overlays the result grid during a busy turn: a typewriter *thinking molecule* over the latest `reasoning.available` text, plus shape-detected *step molecules* from completed tool steps. The per-turn activity gains a chronological `items` sequence so reasoning and steps interleave in both the trace panel and the plane. No backend changes, no schema changes, no extra agent tool calls.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + @testing-library/react, Tailwind v4 (`@theme` tokens), CSS keyframes in `src/index.css`.

## Global Constraints

- App root: `apps/gis-canvas`. Run all commands from there. Tests: `npx vitest run <file>`; full suite: `npm test`; types: `npm run typecheck`.
- This phase is **frontend-only**: do NOT touch `plugins/gis-canvas/**`, the canvas schema, or `tui_gateway/**`.
- Reuse existing helpers — do NOT duplicate: `humanizeLabel` (`src/lib/humanize.ts`), `summarizeValue`/`fieldCount` (`src/lib/summarize-value.ts`), `deriveHeading` (`src/lib/derive-heading.ts`), `TraceStep` (`src/components/TraceStep.tsx`).
- Keyframe animations live in `src/index.css`; guard new ones with `@media (prefers-reduced-motion: reduce)` like the existing ones.
- Styling uses the `@theme` token classes already in use (`bg-surface`, `border-hairline`, `text-tertiary`, `rounded-gc-md`, `font-mono`, etc.). Match neighboring molecules.
- Commit after every task with a trailer line: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Per-turn interleaved `items` sequence in `activity.ts`

Adds a chronological `items` array to each `Turn` (reasoning + steps in emission order), so downstream UI can interleave them. `reasoning` and `trace` stay as-is for existing consumers.

**Files:**
- Modify: `apps/gis-canvas/src/lib/activity.ts`
- Test: `apps/gis-canvas/src/lib/activity.test.ts`

**Interfaces:**
- Consumes: existing `ActivityItem`, `BuildStep`, `ReasoningItem`.
- Produces:
  - `export type TurnItem = { kind: 'reasoning'; id: number; text: string } | { kind: 'step'; id: number; step: BuildStep }`
  - `Turn` gains `items: TurnItem[]` (chronological; a `step` entry shares the same `BuildStep` object as the matching `trace` entry, so `tool.complete` enrichment updates both).

- [ ] **Step 1: Write the failing test**

Add to `apps/gis-canvas/src/lib/activity.test.ts` (inside the existing `describe('deriveActivity turns', …)` block, after the `mk` helper):

```ts
it('exposes a per-turn chronological items sequence interleaving reasoning and steps', () => {
  const items: ActivityItem[] = [
    { id: 1, kind: 'you', text: 'q1' },
    mk('reasoning.available', { text: 'Identifying data agent' }, 2),
    mk('tool.start', { tool_id: 'a', name: 'skill_view' }, 3),
    mk('tool.complete', { tool_id: 'a', name: 'skill_view', result: { ok: true } }, 4),
    mk('reasoning.available', { text: 'Planning the query' }, 5),
    mk('tool.start', { tool_id: 'b', name: 'data_query' }, 6),
    mk('tool.complete', { tool_id: 'b', name: 'data_query', result: { rows: 20 } }, 7),
  ]
  const d = deriveActivity(items)
  const turn = d.turns[0]
  expect(turn.items.map(i => i.kind)).toEqual(['reasoning', 'step', 'reasoning', 'step'])
  // step entries share the enriched BuildStep object (so tool.complete result is visible)
  const firstStep = turn.items[1]
  expect(firstStep.kind === 'step' && firstStep.step.label).toBe('skill_view')
  const lastStep = turn.items[3]
  expect(lastStep.kind === 'step' && lastStep.step.status).toBe('done')
  expect(lastStep.kind === 'step' && lastStep.step.result).toEqual({ rows: 20 })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: FAIL — `Property 'items' does not exist on type 'Turn'` (typecheck) / `turn.items` is undefined.

- [ ] **Step 3: Add the `TurnItem` type and `items` to `Turn`**

In `apps/gis-canvas/src/lib/activity.ts`, add the type just above `export interface Turn` and the field inside it:

```ts
export type TurnItem =
  | { kind: 'reasoning'; id: number; text: string }
  | { kind: 'step'; id: number; step: BuildStep }
export interface Turn {
  id: number
  prompt?: string
  reasoning: ReasoningItem[]
  trace: BuildStep[]
  items: TurnItem[]
  answers: string[]
  isBusy: boolean
}
```

- [ ] **Step 4: Populate `items` in `deriveActivity`**

In `apps/gis-canvas/src/lib/activity.ts`, update the initial `cur` and the `you`/`reasoning.available`/`tool.start` branches so each also records into `cur.items`. Change the initial declaration:

```ts
let cur: Turn = { id: -1, reasoning: [], trace: [], items: [], answers: [], isBusy: false }
```

Update the `flush` guard to also count items:

```ts
const flush = () => {
  if (cur.prompt !== undefined || cur.reasoning.length || cur.trace.length || cur.items.length || cur.answers.length) {
    turns.push(cur)
  }
}
```

In the `case 'you':` branch replace the `cur = {…}` line with:

```ts
cur = { id: item.id, prompt: item.text, reasoning: [], trace: [], items: [], answers: [], isBusy: false }
```

In the `case 'reasoning.available':` block, after `cur.reasoning.push(r)` add:

```ts
cur.items.push({ kind: 'reasoning', id: item.id, text: item.text })
```

In the `case 'tool.start':` block, after `cur.trace.push(step)` add:

```ts
cur.items.push({ kind: 'step', id: item.id, step })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/activity.test.ts`
Expected: PASS (all tests in the file, including the existing turns/timeline ones).

- [ ] **Step 6: Commit**

```bash
cd apps/gis-canvas
git add src/lib/activity.ts src/lib/activity.test.ts
git commit -m "$(printf 'feat(gis-canvas): per-turn chronological items in deriveActivity\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Interleave reasoning between steps in `TurnView` (Gap #1)

Replace the single top "Thinking (N)" disclosure with per-step reasoning shown *before* the step it triggered, matching the Hermes main-UI cadence. Uses `turn.items` from Task 1.

**Files:**
- Modify: `apps/gis-canvas/src/components/TurnView.tsx`
- Test: `apps/gis-canvas/src/components/TurnView.test.tsx`

**Interfaces:**
- Consumes: `Turn.items` (Task 1), `deriveHeading`, `TraceStep`.
- Produces: no new exports (same `TurnView` component).

- [ ] **Step 1: Update the test fixture and assertions**

Replace the whole body of `apps/gis-canvas/src/components/TurnView.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TurnView } from './TurnView'
import type { Turn } from '../lib/activity'

const step = { id: 3, label: 'data_query', status: 'done' as const, result: { RowCount: 20 } }
const turn: Turn = {
  id: 1,
  prompt: 'show me the positions',
  reasoning: [{ id: 2, text: 'Exploring vessel positions before querying' }],
  trace: [step],
  items: [
    { kind: 'reasoning', id: 2, text: 'Exploring vessel positions before querying' },
    { kind: 'step', id: 3, step },
  ],
  answers: ['Displayed 20 positions.'],
  isBusy: false,
}

describe('TurnView', () => {
  it('renders the prompt, the FORMULATING CANVAS with its steps, and the answer', () => {
    render(<TurnView turn={turn} />)
    expect(screen.getByText('show me the positions')).toBeInTheDocument()
    expect(screen.getByText(/FORMULATING CANVAS/)).toBeInTheDocument()
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText('Displayed 20 positions.')).toBeInTheDocument()
  })

  it('shows a per-step Thinking row (heading visible) and reveals the body on click', () => {
    render(<TurnView turn={turn} />)
    // derived heading is always visible; full body hidden until expanded
    expect(screen.getByText('Exploring vessel positions before querying')).toBeInTheDocument()
    // body text (same string here) toggles: at least one Thinking toggle exists
    const toggle = screen.getByRole('button', { name: /thinking/i })
    expect(toggle).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getAllByText('Exploring vessel positions before querying').length).toBeGreaterThan(0)
  })

  it('orders the reasoning row before the step it triggered', () => {
    const { container } = render(<TurnView turn={turn} />)
    const html = container.innerHTML
    expect(html.indexOf('Thinking')).toBeLessThan(html.indexOf('Data Query'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/TurnView.test.tsx`
Expected: FAIL — the current `TurnView` renders a single aggregate Thinking block; the ordering/`items` assertions fail.

- [ ] **Step 3: Rewrite `TurnView` to interleave `items`**

Replace the whole file `apps/gis-canvas/src/components/TurnView.tsx` with:

```tsx
import { useState } from 'react'
import type { Turn } from '../lib/activity'
import { TraceStep } from './TraceStep'
import { deriveHeading } from '../lib/derive-heading'

// A single reasoning entry: the derived heading is always visible; clicking
// reveals the full body. Renders inline within FORMULATING CANVAS, before the
// step it triggered — the Hermes "Thinking → step → Thinking → step" cadence.
function ThinkingRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const heading = deriveHeading(text)
  return (
    <div className="rounded-gc-md border border-hairline bg-surface-raised/50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">Thinking</span>
        <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-secondary">{heading}</span>
        <span aria-hidden className="text-tertiary">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="whitespace-pre-wrap px-3 pb-2.5 font-sans text-[12px] leading-relaxed text-secondary">{text}</div>
      ) : null}
    </div>
  )
}

// One conversation turn: the user's prompt, its interleaved reasoning + tool
// trace (FORMULATING CANVAS), and the agent's answer(s) — so each follow-up
// question starts a fresh block instead of piling into a session-wide trace.
export function TurnView({ turn }: { turn: Turn }) {
  return (
    <>
      {turn.prompt !== undefined ? (
        <div className="flex justify-end">
          <div className="max-w-[86%] rounded-[12px_12px_3px_12px] bg-accent px-3 py-2 font-sans text-[12.5px] leading-relaxed text-accent-fg">
            {turn.prompt}
          </div>
        </div>
      ) : null}

      {turn.items.length ? (
        <div className="rounded-gc-md border border-hairline bg-surface p-3">
          <div className="mb-1.5 font-mono text-[9.5px] tracking-[.1em] text-tertiary">FORMULATING CANVAS</div>
          <div className="flex flex-col gap-1.5">
            {turn.items.map(it =>
              it.kind === 'reasoning'
                ? <ThinkingRow key={`r${it.id}`} text={it.text} />
                : <TraceStep key={`s${it.id}`} step={it.step} />
            )}
          </div>
        </div>
      ) : null}

      {turn.answers.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-gc-sm border border-hairline bg-surface font-display text-[11px] font-bold text-accent">
            H
          </span>
          <div className="max-w-[86%] rounded-[3px_12px_12px_12px] border border-hairline bg-surface px-3 py-2 font-sans text-[12.5px] leading-relaxed text-primary">
            {a}
          </div>
        </div>
      ))}
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/TurnView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify no other consumer broke**

Run: `npx vitest run src/components/AgentPanel.test.tsx && npm run typecheck`
Expected: PASS / no type errors (AgentPanel renders `TurnView`; any `Turn` fixtures there must include `items`).

If `AgentPanel.test.tsx` (or any other) constructs a `Turn` literal without `items`, add `items: []` (or a matching interleaved array) to that fixture and re-run.

- [ ] **Step 6: Commit**

```bash
cd apps/gis-canvas
git add src/components/TurnView.tsx src/components/TurnView.test.tsx
git commit -m "$(printf 'feat(gis-canvas): interleave reasoning between steps in TurnView\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Shape detector — `lib/cognition.ts`

Classifies a completed tool step's `result` into a cognition-molecule descriptor by *data shape* (never by tool name), with a generic fallback. This is the "no per-step registration" core.

**Files:**
- Create: `apps/gis-canvas/src/lib/cognition.ts`
- Test: `apps/gis-canvas/src/lib/cognition.test.ts`

**Interfaces:**
- Consumes: `BuildStep` (from `./activity`), `humanizeLabel`, `summarizeValue`.
- Produces:
  - `export type CognitionShape = 'error' | 'geo-rows' | 'rows' | 'stat' | 'text'`
  - `export interface StepMolecule { shape: CognitionShape; title: string; summary: string; rowCount?: number }`
  - `export function describeStep(step: BuildStep): StepMolecule`

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/cognition.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { describeStep } from './cognition'
import type { BuildStep } from './activity'

const mk = (label: string, result: unknown, extra: Partial<BuildStep> = {}): BuildStep =>
  ({ id: 1, label, status: 'done', result, ...extra })

describe('describeStep', () => {
  it('humanizes the tool label into the title', () => {
    expect(describeStep(mk('data_query', { rows: [] })).title).toBe('Data Query')
  })

  it('detects a bare array of rows', () => {
    const m = describeStep(mk('list', [{ a: 1 }, { a: 2 }]))
    expect(m.shape).toBe('rows')
    expect(m.rowCount).toBe(2)
    expect(m.summary).toBe('2 rows')
  })

  it('finds rows nested under sample/rows/data/records', () => {
    expect(describeStep(mk('q', { sample: [{ a: 1 }] })).shape).toBe('rows')
    expect(describeStep(mk('q', { rows: [{ a: 1 }, { a: 2 }] })).rowCount).toBe(2)
  })

  it('detects geospatial rows via lat/lng aliases (case-insensitive)', () => {
    const m = describeStep(mk('positions', { sample: [{ Latitude: 41.3, Longitude: -70.1, Speed: 24.7 }] }))
    expect(m.shape).toBe('geo-rows')
  })

  it('classifies an error result', () => {
    const m = describeStep(mk('data_query', { error: 'timeout' }))
    expect(m.shape).toBe('error')
    expect(m.summary).toBe('timeout')
  })

  it('classifies a scalar / small object as a stat', () => {
    expect(describeStep(mk('count', 42)).shape).toBe('stat')
    expect(describeStep(mk('meta', { rev: 3 })).shape).toBe('stat')
  })

  it('falls back to text (using summary/label) when there is no structured result', () => {
    const m = describeStep(mk('render_view', undefined, { summary: 'Rendered' }))
    expect(m.shape).toBe('text')
    expect(m.summary).toBe('Rendered')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cognition.test.ts`
Expected: FAIL — `Cannot find module './cognition'`.

- [ ] **Step 3: Implement `lib/cognition.ts`**

Create `apps/gis-canvas/src/lib/cognition.ts`:

```ts
import type { BuildStep } from './activity'
import { humanizeLabel } from './humanize'
import { summarizeValue } from './summarize-value'

/** Cognition-molecule shape, detected from a step's result DATA shape — never
 * from the tool name. New tools whose results are rows/geo-rows/scalars get the
 * right molecule automatically; genuinely novel shapes fall back to 'text'. */
export type CognitionShape = 'error' | 'geo-rows' | 'rows' | 'stat' | 'text'

export interface StepMolecule {
  shape: CognitionShape
  title: string
  summary: string
  rowCount?: number
}

// Same alias sets as detectGeoFields (kept local: this reads arbitrary row
// objects, not a typed schema).
const LAT = new Set(['lat', 'latitude', 'latitudedegrees', 'lat_dd', 'y'])
const LNG = new Set(['lng', 'lon', 'long', 'longitude', 'longitudedegrees', 'lon_dd', 'x'])

const isRowObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x)

/** Find a rows array either as the result itself or under a common key. */
function findRows(result: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(result) && result.length > 0 && result.every(isRowObject)) {
    return result as Record<string, unknown>[]
  }
  if (isRowObject(result)) {
    for (const key of ['rows', 'sample', 'data', 'records']) {
      const v = result[key]
      if (Array.isArray(v) && v.length > 0 && v.every(isRowObject)) {
        return v as Record<string, unknown>[]
      }
    }
  }
  return undefined
}

function hasGeo(rows: Record<string, unknown>[]): boolean {
  const keys = Object.keys(rows[0] ?? {}).map(k => k.toLowerCase())
  return keys.some(k => LAT.has(k)) && keys.some(k => LNG.has(k))
}

export function describeStep(step: BuildStep): StepMolecule {
  const title = humanizeLabel(step.label)
  const result = step.result

  if (isRowObject(result) && 'error' in result) {
    return { shape: 'error', title, summary: summarizeValue(result.error) }
  }

  const rows = findRows(result)
  if (rows) {
    const n = rows.length
    return {
      shape: hasGeo(rows) ? 'geo-rows' : 'rows',
      title,
      summary: `${n} row${n === 1 ? '' : 's'}`,
      rowCount: n,
    }
  }

  if (result === null || result === undefined) {
    return { shape: 'text', title, summary: step.summary ?? '—' }
  }
  if (typeof result === 'object') {
    return { shape: 'stat', title, summary: summarizeValue(result) }
  }
  return { shape: 'stat', title, summary: summarizeValue(result) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cognition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/gis-canvas
git add src/lib/cognition.ts src/lib/cognition.test.ts
git commit -m "$(printf 'feat(gis-canvas): shape-detector describeStep for cognition molecules\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: Typewriter `ThinkingMolecule`

A center-stage glass card that reveals the agent's current reasoning text character-by-character. Client animation only.

**Files:**
- Create: `apps/gis-canvas/src/components/ThinkingMolecule.tsx`
- Test: `apps/gis-canvas/src/components/ThinkingMolecule.test.tsx`

**Interfaces:**
- Produces: `export function ThinkingMolecule({ text, speedMs }: { text: string; speedMs?: number }): JSX.Element` — `speedMs` defaults to `18`. Renders a `data-testid="thinking-molecule"` container whose text content grows to `text`.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/components/ThinkingMolecule.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ThinkingMolecule } from './ThinkingMolecule'

afterEach(() => vi.useRealTimers())

describe('ThinkingMolecule', () => {
  it('types the text out character by character up to the full string', () => {
    vi.useFakeTimers()
    render(<ThinkingMolecule text="hello" speedMs={1} />)
    const el = screen.getByTestId('thinking-molecule')
    // starts (near) empty
    expect(el.textContent ?? '').not.toContain('hello')
    // advance past 5 chars worth of ticks
    act(() => { vi.advanceTimersByTime(20) })
    expect(el.textContent).toContain('hello')
  })

  it('restarts typing when the text prop changes', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ThinkingMolecule text="aaaa" speedMs={1} />)
    act(() => { vi.advanceTimersByTime(20) })
    rerender(<ThinkingMolecule text="bbbb" speedMs={1} />)
    const el = screen.getByTestId('thinking-molecule')
    expect(el.textContent).not.toContain('bbbb')
    act(() => { vi.advanceTimersByTime(20) })
    expect(el.textContent).toContain('bbbb')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ThinkingMolecule.test.tsx`
Expected: FAIL — `Cannot find module './ThinkingMolecule'`.

- [ ] **Step 3: Implement `ThinkingMolecule.tsx`**

Create `apps/gis-canvas/src/components/ThinkingMolecule.tsx`:

```tsx
import { useEffect, useState } from 'react'

// Typewriter over the agent's current reasoning text. Pure client animation —
// the agent emits reasoning on the token stream; it never calls a tool for this.
export function ThinkingMolecule({ text, speedMs = 18 }: { text: string; speedMs?: number }) {
  const [shown, setShown] = useState(0)

  // Restart whenever the text changes.
  useEffect(() => { setShown(0) }, [text])

  // Reveal one more character per tick until the full string is shown.
  useEffect(() => {
    if (shown >= text.length) return
    const t = setTimeout(() => setShown(n => Math.min(n + 1, text.length)), speedMs)
    return () => clearTimeout(t)
  }, [shown, text, speedMs])

  return (
    <div
      data-testid="thinking-molecule"
      className="w-full rounded-gc-lg border border-accent/40 bg-surface/90 px-4 py-3.5 shadow-gc-overlay backdrop-blur"
    >
      <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-accent">◆ Thinking</div>
      <div className="min-h-[2.6em] whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-primary">
        {text.slice(0, shown)}
        <span aria-hidden className="gc-caret text-accent">▍</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the blinking-caret animation**

In `apps/gis-canvas/src/index.css`, after the `gc-toast-in` keyframe block (around line 130), add:

```css
@keyframes gc-caret { 50% { opacity: 0; } }
.gc-caret { animation: gc-caret 1s steps(1) infinite; }
@media (prefers-reduced-motion: reduce) { .gc-caret { animation: none; } }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/ThinkingMolecule.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd apps/gis-canvas
git add src/components/ThinkingMolecule.tsx src/components/ThinkingMolecule.test.tsx src/index.css
git commit -m "$(printf 'feat(gis-canvas): typewriter ThinkingMolecule\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: `CognitionPlane` overlay

Renders the busy turn's thinking molecule + shape-detected step molecules, centered over the canvas. Returns `null` when not busy (fade-out on completion is handled by conditional unmount + the entrance animation; a persistent trail is intentionally NOT kept — it lives in the Inspector).

**Files:**
- Create: `apps/gis-canvas/src/components/CognitionPlane.tsx`
- Test: `apps/gis-canvas/src/components/CognitionPlane.test.tsx`

**Interfaces:**
- Consumes: `Turn` (`../lib/activity`), `describeStep`/`StepMolecule` (`../lib/cognition`), `ThinkingMolecule`.
- Produces: `export function CognitionPlane({ turn }: { turn: Turn | undefined }): JSX.Element | null`. Renders `data-testid="cognition-plane"` only when `turn?.isBusy`.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/components/CognitionPlane.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CognitionPlane } from './CognitionPlane'
import type { Turn } from '../lib/activity'

const busyTurn: Turn = {
  id: 1,
  prompt: 'q',
  reasoning: [{ id: 2, text: 'Planning the data query' }],
  trace: [{ id: 3, label: 'data_query', status: 'done', result: { rows: [{ a: 1 }, { a: 2 }] } }],
  items: [
    { kind: 'reasoning', id: 2, text: 'Planning the data query' },
    { kind: 'step', id: 3, step: { id: 3, label: 'data_query', status: 'done', result: { rows: [{ a: 1 }, { a: 2 }] } } },
  ],
  answers: [],
  isBusy: true,
}

describe('CognitionPlane', () => {
  it('renders nothing when there is no turn', () => {
    const { container } = render(<CognitionPlane turn={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the turn is not busy', () => {
    const { container } = render(<CognitionPlane turn={{ ...busyTurn, isBusy: false }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the thinking molecule and a step molecule when busy', () => {
    render(<CognitionPlane turn={busyTurn} />)
    expect(screen.getByTestId('cognition-plane')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-molecule')).toBeInTheDocument()
    // step molecule shows the humanized title + row summary
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText('2 rows')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CognitionPlane.test.tsx`
Expected: FAIL — `Cannot find module './CognitionPlane'`.

- [ ] **Step 3: Implement `CognitionPlane.tsx`**

Create `apps/gis-canvas/src/components/CognitionPlane.tsx`:

```tsx
import type { Turn } from '../lib/activity'
import { describeStep, type StepMolecule } from '../lib/cognition'
import { ThinkingMolecule } from './ThinkingMolecule'

const SHAPE_ACCENT: Record<StepMolecule['shape'], string> = {
  error: 'border-negative/50 text-negative',
  'geo-rows': 'border-accent/50 text-accent',
  rows: 'border-hairline-strong text-secondary',
  stat: 'border-hairline-strong text-secondary',
  text: 'border-hairline text-tertiary',
}

function StepChip({ molecule }: { molecule: StepMolecule }) {
  return (
    <div className={`rounded-gc-md border bg-surface/90 px-3 py-2 shadow-gc-overlay backdrop-blur ${SHAPE_ACCENT[molecule.shape]}`}>
      <div className="font-mono text-[9px] uppercase tracking-wide">{molecule.title}</div>
      <div className="mt-0.5 font-sans text-[12px] text-primary">{molecule.summary}</div>
    </div>
  )
}

// Ephemeral cognition overlay for the current (busy) turn: the latest reasoning
// as a typewriter, plus a molecule per completed step. Unmounts when the turn is
// no longer busy — the full trail stays recallable via the Inspector.
export function CognitionPlane({ turn }: { turn: Turn | undefined }) {
  if (!turn || !turn.isBusy) return null

  const lastReasoning = [...turn.items].reverse().find(i => i.kind === 'reasoning') as
    | { kind: 'reasoning'; id: number; text: string }
    | undefined
  const doneSteps = turn.trace.filter(s => s.status === 'done')

  return (
    <div
      data-testid="cognition-plane"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6"
      style={{ animation: 'gc-cognition-in .3s ease both' }}
    >
      <div className="flex w-[min(64%,460px)] flex-col items-stretch gap-3">
        {lastReasoning ? <ThinkingMolecule text={lastReasoning.text} /> : null}
        {doneSteps.length ? (
          <div className="flex flex-wrap justify-center gap-2">
            {doneSteps.map(s => <StepChip key={s.id} molecule={describeStep(s)} />)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the `gc-cognition-in` keyframe**

In `apps/gis-canvas/src/index.css`, after the `gc-caret` block added in Task 4, add:

```css
@keyframes gc-cognition-in { 0% { opacity: 0; transform: translateY(8px) scale(.98); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/CognitionPlane.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd apps/gis-canvas
git add src/components/CognitionPlane.tsx src/components/CognitionPlane.test.tsx src/index.css
git commit -m "$(printf 'feat(gis-canvas): CognitionPlane overlay for the busy turn\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: Mount `CognitionPlane` in `App`

Render the plane over the canvas grid, fed by the current busy turn.

**Files:**
- Modify: `apps/gis-canvas/src/App.tsx`
- Test: `apps/gis-canvas/src/App.test.tsx`

**Interfaces:**
- Consumes: `CognitionPlane`, `derived.turns`, `derived.isBusy` (all already available in `App`).

- [ ] **Step 1: Write the failing test**

Add this test to `apps/gis-canvas/src/App.test.tsx` (after the approval test near line 149, using the existing `makeFakeClient`/`emit` harness):

```tsx
test('shows the cognition plane while a tool is running and hides it when the turn completes', async () => {
  const client = makeFakeClient()
  render(<App client={client as unknown as GatewayLike} wsUrl="ws://x" />)
  client.openNow()
  await waitFor(() => expect(screen.getByTestId('agent-status')).toHaveAttribute('data-connected', 'true'))

  // a running tool with reasoning → busy turn → cognition plane appears
  act(() => client.emit({ type: 'reasoning.available', payload: { text: 'Planning the data query' } }))
  act(() => client.emit({ type: 'tool.start', payload: { tool_id: 't1', name: 'data_query' } }))
  expect(await screen.findByTestId('cognition-plane')).toBeInTheDocument()

  // tool completes and the agent answers → no longer busy → plane unmounts
  act(() => client.emit({ type: 'tool.complete', payload: { tool_id: 't1', name: 'data_query', result: { rows: 1 } } }))
  act(() => client.emit({ type: 'message.complete', payload: { text: 'Done.' } }))
  await waitFor(() => expect(screen.queryByTestId('cognition-plane')).toBeNull())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — no element with `data-testid="cognition-plane"` (not mounted yet).

- [ ] **Step 3: Import and render `CognitionPlane`**

In `apps/gis-canvas/src/App.tsx`, add the import near the other component imports (after the `CanvasHeader` import):

```tsx
import { CognitionPlane } from './components/CognitionPlane'
```

Then, inside the `<main>` element, render the plane as a sibling of the grid. Change the existing block so it reads:

```tsx
      <main className="relative min-h-0 flex-1 overflow-auto gc-canvas-grid-bg p-4">
        <CanvasHeader rev={mergedDoc?.rev} isBusy={isBusy} />
        {mergedDoc ? (
          <SelectionProvider nodesBySource={nodesBySource} onMirror={mirrorSelection}>
            <HandlerProvider actions={actions}>
              <CanvasGrid doc={mergedDoc} />
            </HandlerProvider>
          </SelectionProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-tertiary">
            No canvas yet — ask the agent to build a dashboard.
          </div>
        )}
        <CognitionPlane turn={isBusy ? derived.turns.at(-1) : undefined} />
      </main>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd apps/gis-canvas
git add src/App.tsx src/App.test.tsx
git commit -m "$(printf 'feat(gis-canvas): mount CognitionPlane over the canvas for busy turns\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: Live dock ticker + reconcile `BuildToast`

When minimized and busy, the dock shows the current step with a left→right sweep; `BuildToast` is limited to when the panel is open so progress shows in exactly one place.

**Files:**
- Modify: `apps/gis-canvas/src/components/CommandDock.tsx`
- Modify: `apps/gis-canvas/src/App.tsx`
- Modify: `apps/gis-canvas/src/index.css`
- Test: `apps/gis-canvas/src/components/CommandDock.test.tsx` (create)

**Interfaces:**
- Consumes: `ChatMessage` + `BuildStep` (`../lib/activity`), `humanizeLabel`.
- Produces: `CommandDock` now accepts `{ latest, onOpen, busy?: boolean, step?: BuildStep }`. Busy+step → ticker (`data-testid="dock-ticker"`); else the prompt pill.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/components/CommandDock.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommandDock } from './CommandDock'

describe('CommandDock', () => {
  it('shows the prompt pill when idle', () => {
    render(<CommandDock latest={undefined} onOpen={() => {}} />)
    expect(screen.getByText(/ask the agent to build a dashboard/i)).toBeInTheDocument()
    expect(screen.queryByTestId('dock-ticker')).toBeNull()
  })

  it('shows a live ticker with the humanized current step when busy', () => {
    render(
      <CommandDock
        latest={undefined}
        onOpen={() => {}}
        busy
        step={{ id: 1, label: 'data_query', status: 'running', context: 'retrieving latest 20 rows', durationS: 31.3 }}
      />
    )
    expect(screen.getByTestId('dock-ticker')).toBeInTheDocument()
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText(/retrieving latest 20 rows/)).toBeInTheDocument()
    expect(screen.getByText('31.3s')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CommandDock.test.tsx`
Expected: FAIL — `CommandDock` does not accept `busy`/`step`; no `dock-ticker`.

- [ ] **Step 3: Rewrite `CommandDock.tsx`**

Replace the whole file `apps/gis-canvas/src/components/CommandDock.tsx` with:

```tsx
import type { ChatMessage, BuildStep } from '../lib/activity'
import { humanizeLabel } from '../lib/humanize'

export function CommandDock({
  latest,
  onOpen,
  busy = false,
  step,
}: {
  latest: ChatMessage | undefined
  onOpen: () => void
  busy?: boolean
  step?: BuildStep
}) {
  const live = busy && step
  return (
    <button
      onClick={onOpen}
      className="fixed bottom-6 left-1/2 z-30 flex w-[min(560px,90vw)] -translate-x-1/2 items-center gap-2.5 overflow-hidden rounded-full border border-hairline-strong bg-rail px-2.5 py-2.5 text-left shadow-gc-overlay"
      style={{ animation: 'gc-dock-in .35s cubic-bezier(.2,.8,.2,1) both' }}
    >
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-hairline bg-surface font-display text-xs font-bold text-accent">
        H
      </span>
      {live ? (
        <span data-testid="dock-ticker" className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-accent">{humanizeLabel(step!.label)}</span>
          {step!.context ? (
            <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-tertiary">· {step!.context}</span>
          ) : null}
          {typeof step!.durationS === 'number' ? (
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-tertiary">{step!.durationS.toFixed(1)}s</span>
          ) : null}
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-secondary">
            {latest?.text ?? 'Ask the agent to build a dashboard…'}
          </span>
          <span className="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-tertiary">/</span>
        </>
      )}
      {live ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-2/5"
          style={{ background: 'linear-gradient(90deg,transparent,color-mix(in oklab,var(--color-accent) 22%,transparent),transparent)', animation: 'gc-dock-sweep 1.6s linear infinite' }}
        />
      ) : null}
    </button>
  )
}
```

- [ ] **Step 4: Add the `gc-dock-sweep` keyframe**

In `apps/gis-canvas/src/index.css`, after the `gc-cognition-in` block added in Task 5, add:

```css
@keyframes gc-dock-sweep { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
@media (prefers-reduced-motion: reduce) { @keyframes gc-dock-sweep { 0%,100% { transform: none; } } }
```

- [ ] **Step 5: Wire the dock props + reconcile `BuildToast` in `App.tsx`**

In `apps/gis-canvas/src/App.tsx`, replace the `BuildToast` + `CommandDock` lines:

```tsx
      <BuildToast show={isBusy} step={trace.at(-1)} />
      {!overlayOpen && <CommandDock latest={messages.at(-1)} onOpen={() => setOverlayOpen(true)} />}
```

with:

```tsx
      {/* progress shows in exactly one place: the dock ticker when minimized,
          the top toast when the panel is open (dock hidden). */}
      <BuildToast show={isBusy && overlayOpen} step={trace.at(-1)} />
      {!overlayOpen && (
        <CommandDock latest={messages.at(-1)} onOpen={() => setOverlayOpen(true)} busy={isBusy} step={trace.at(-1)} />
      )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/CommandDock.test.tsx src/App.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd apps/gis-canvas
git add src/components/CommandDock.tsx src/components/CommandDock.test.tsx src/App.tsx src/index.css
git commit -m "$(printf 'feat(gis-canvas): live dock step ticker + single-source progress\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 8: Full-suite regression + typecheck gate

Confirm the whole phase is green together (no fixture drift from the `Turn.items` field).

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite**

Run: `cd apps/gis-canvas && npm test`
Expected: PASS — all test files, including `activity`, `TurnView`, `cognition`, `ThinkingMolecule`, `CognitionPlane`, `CommandDock`, `App`, `AgentPanel`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/gis-canvas && npm run typecheck`
Expected: no errors. If any `Turn` literal elsewhere lacks `items`, add `items: []` and re-run.

- [ ] **Step 3: Build**

Run: `cd apps/gis-canvas && npm run build`
Expected: clean build.

- [ ] **Step 4: Commit any fixture fixes**

```bash
cd apps/gis-canvas
git add -A
git commit -m "$(printf 'test(gis-canvas): green full suite for cognition plane (phase A)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" || echo "nothing to commit"
```

---

## Phase A → later phases

- **Phase B (stacking primitive)** — `layer`/`anchor`/`size`/`z` schema + validator + `CanvasGrid` base/float/grid split + glass HUD + auto-hero promotion. Separate plan.
- **Phase C (agent composition guidance)** — `plugins/gis-canvas/tools_canvas.py` render_view-always + hero + anti-redundancy. Separate plan.

## Self-review notes (traceability to spec §2 / §3)

- Spec §2 "Thinking molecule" → Task 4; "Step molecules / shape detectors" → Task 3 + Task 5; "fade-out lifecycle / collapse" → Task 5 (unmount when not busy) + Task 6 (busy-gated mount); "interleave fix (Gap #1)" → Tasks 1–2.
- Spec §3 "Dock ticker with L→R sweep" → Task 7; "reconcile BuildToast" → Task 7 Step 5.
- Live end-to-end verification of the cognition plane against the real a2a stack (map-hero prompt) is deferred to after Phase B, when the result plane gains the hero layout; Phase A is verified by the unit/integration suite above.
