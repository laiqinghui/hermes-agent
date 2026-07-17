# Thought Canvas — Phase A Rework (Narration Spotlight) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the merged cognition plane's cluttered per-step molecule stack with a bounded, narrative "Narration Spotlight" — a thinking star, one in-place current-step card, and a bounded breadcrumb rail — and give steps human sentences via a new `narrateStep` helper.

**Architecture:** Frontend-only, builds on the merged Phase A. The event plumbing (`Turn.items`, `ThinkingMolecule`, dock ticker, `describeStep`) is unchanged. This rework (a) adds `src/lib/narrate.ts` turning `name`+`args`+`result` into a human sentence + outcome, and (b) rewrites `src/components/CognitionPlane.tsx` from a `turn.trace.filter(done)` molecule grid into three bounded elements: `ThinkingMolecule` (top), one `CurrentStepCard` for the active step (middle, updates in place), and a bounded `StepRail` of completed steps (bottom). `describeStep`'s role narrows to supplying the outcome badge.

**Tech Stack:** React 19 + TypeScript, Vite, Vitest + @testing-library/react, Tailwind v4 (`@theme` tokens), CSS keyframes in `src/index.css`.

## Global Constraints

- App root: `apps/gis-canvas`. Run all commands from there. Focused test: `npx vitest run <file>`; full suite: `npm test`; types: `npm run typecheck`; build: `npm run build`.
- **Frontend-only**: do NOT touch `plugins/gis-canvas/**`, the canvas schema, or `tui_gateway/**`.
- Reuse existing helpers — do NOT duplicate: `humanizeLabel` (`src/lib/humanize.ts`), `summarizeValue` (`src/lib/summarize-value.ts`), `describeStep`/`StepMolecule` (`src/lib/cognition.ts`), `ThinkingMolecule` (`src/components/ThinkingMolecule.tsx`), `BuildStep`/`Turn` (`src/lib/activity.ts`).
- The plane must stay **bounded at any step count** — the rail shows at most `RAIL_MAX = 5` recent pills plus a `+N earlier` chip; there is never one card per completed step.
- Reuse existing animation classes: `gc-anim-cognition` (plane entrance) and `gc-anim-dock-sweep` (running sweep) — both already in `src/index.css` with reduced-motion guards. No new keyframes needed.
- Styling uses the established `@theme` token classes (`bg-surface`, `border-hairline`, `text-tertiary`, `text-positive`, `text-negative`, `text-accent`, `rounded-gc-md`, `font-mono`, …). Match neighboring molecules.
- Commit after every task with trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `narrateStep` — human step sentences (`lib/narrate.ts`)

Turns a `BuildStep` into a human sentence + outcome, keyed on the tool name for the verb/object with a generic fallback, reusing `describeStep` only for the outcome (ok/error/rows).

**Files:**
- Create: `apps/gis-canvas/src/lib/narrate.ts`
- Test: `apps/gis-canvas/src/lib/narrate.test.ts`

**Interfaces:**
- Consumes: `BuildStep` (`./activity`), `humanizeLabel` (`./humanize`), `describeStep` (`./cognition`).
- Produces:
  - `export type StepOutcome = 'ok' | 'error' | 'running'`
  - `export interface StepNarration { text: string; outcome: StepOutcome; glyph: string }`
  - `export function narrateStep(step: BuildStep): StepNarration`

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/narrate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { narrateStep } from './narrate'
import type { BuildStep } from './activity'

const mk = (label: string, extra: Partial<BuildStep> = {}): BuildStep =>
  ({ id: 1, label, status: 'done', ...extra })

describe('narrateStep', () => {
  it('skill_view names the skill from args', () => {
    const n = narrateStep(mk('skill_view', { args: { name: 'denodo-data-agent' } }))
    expect(n.text).toBe('Read skill · denodo-data-agent')
    expect(n.outcome).toBe('ok')
    expect(n.glyph).toBe('✓')
  })

  it('data_query names the table and row count on success', () => {
    const n = narrateStep(mk('data_query', { args: { table: 'admin.vessel_positions' }, result: { rows: [{ a: 1 }, { a: 2 }] } }))
    expect(n.text).toBe('Queried admin.vessel_positions · 2 rows')
    expect(n.outcome).toBe('ok')
  })

  it('data_query marks an error result', () => {
    const n = narrateStep(mk('data_query', { args: { table: 'admin.vessel_positions' }, result: { error: '401 Unauthorized' } }))
    expect(n.text.startsWith('Queried admin.vessel_positions')).toBe(true)
    expect(n.outcome).toBe('error')
    expect(n.glyph).toBe('✕')
  })

  it('search_files reports the match count from result.total_count', () => {
    expect(narrateStep(mk('search_files', { result: { total_count: 50, files: ['a', 'b'] } })).text)
      .toBe('Searched files · 50 matches')
    expect(narrateStep(mk('search_files', { result: { total_count: 1, files: ['a'] } })).text)
      .toBe('Searched files · 1 match')
  })

  it('read_file shows the basename of the path', () => {
    expect(narrateStep(mk('read_file', { args: { path: 'C:/Users/UserAdmin/data_agent_token.txt' } })).text)
      .toBe('Read data_agent_token.txt')
  })

  it('execute_code / terminal describe the run', () => {
    expect(narrateStep(mk('execute_code', { args: { language: 'python' } })).text).toBe('Ran python')
    expect(narrateStep(mk('terminal', { args: { command: 'python -c "x"' } })).text).toBe('Ran python')
  })

  it('render_view and browser_navigate read naturally', () => {
    expect(narrateStep(mk('render_view')).text).toBe('Rendered the canvas')
    expect(narrateStep(mk('browser_navigate', { args: { url: 'http://dev.com:8080/realms/master' } })).text)
      .toBe('Opened dev.com:8080')
  })

  it('running steps report a running outcome and a neutral glyph', () => {
    const n = narrateStep(mk('data_query', { status: 'running', args: { table: 'x' } }))
    expect(n.outcome).toBe('running')
    expect(n.glyph).toBe('·')
    expect(n.text).toBe('Queried x')
  })

  it('unknown tools fall back to a humanized label plus outcome tail', () => {
    const n = narrateStep(mk('forecast_weather', { result: { rows: [{ a: 1 }, { a: 2 }, { a: 3 }] } }))
    expect(n.text).toBe('Forecast Weather · 3 rows')
    expect(n.outcome).toBe('ok')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/narrate.test.ts`
Expected: FAIL — `Cannot find module './narrate'`.

- [ ] **Step 3: Implement `lib/narrate.ts`**

Create `apps/gis-canvas/src/lib/narrate.ts`:

```ts
import type { BuildStep } from './activity'
import { humanizeLabel } from './humanize'
import { describeStep } from './cognition'

/** Outcome of a step for the cognition UI: running (in flight), error, or ok. */
export type StepOutcome = 'ok' | 'error' | 'running'

export interface StepNarration {
  /** Human sentence, e.g. "Queried admin.vessel_positions · 20 rows". */
  text: string
  outcome: StepOutcome
  /** '✓' ok · '✕' error · '·' running. */
  glyph: string
}

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

const firstStr = (o: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const s = str(o[k])
    if (s) return s
  }
  return undefined
}

const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const hostOf = (u: string): string => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}

function outcomeOf(step: BuildStep): StepOutcome {
  if (step.status === 'running') return 'running'
  return describeStep(step).shape === 'error' ? 'error' : 'ok'
}

/** A concise result tail (error summary or row count), or '' when neither applies. */
function resultTail(step: BuildStep): string {
  const d = describeStep(step)
  if (d.shape === 'error') return d.summary
  if (typeof d.rowCount === 'number') return `${d.rowCount} row${d.rowCount === 1 ? '' : 's'}`
  return ''
}

export function narrateStep(step: BuildStep): StepNarration {
  const outcome = outcomeOf(step)
  const glyph = outcome === 'error' ? '✕' : outcome === 'running' ? '·' : '✓'
  const a = rec(step.args)
  const r = rec(step.result)
  const tail = resultTail(step)
  const withTail = (head: string) => (tail ? `${head} · ${tail}` : head)

  let text: string
  switch (step.label) {
    case 'skill_view':
      text = `Read skill · ${firstStr(a, ['name', 'skill', 'skill_name']) ?? '—'}`
      break
    case 'data_query':
      text = withTail(`Queried ${firstStr(a, ['table', 'view', 'dataset', 'from', 'source']) ?? 'data'}`)
      break
    case 'search_files': {
      const n = typeof r.total_count === 'number' ? (r.total_count as number) : undefined
      text = n !== undefined ? `Searched files · ${n} match${n === 1 ? '' : 'es'}` : 'Searched files'
      break
    }
    case 'read_file': {
      const p = firstStr(a, ['path', 'file', 'filename'])
      text = `Read ${p ? basename(p) : '—'}`
      break
    }
    case 'execute_code':
      text = `Ran ${firstStr(a, ['language', 'lang']) ?? 'code'}`
      break
    case 'terminal': {
      const cmd = firstStr(a, ['command', 'cmd'])
      text = `Ran ${cmd ? cmd.split(/\s+/)[0] : 'command'}`
      break
    }
    case 'render_view':
      text = 'Rendered the canvas'
      break
    case 'browser_navigate': {
      const u = firstStr(a, ['url', 'href'])
      text = `Opened ${u ? hostOf(u) : 'page'}`
      break
    }
    default:
      text = withTail(humanizeLabel(step.label))
  }

  return { text, outcome, glyph }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/narrate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd apps/gis-canvas
git add src/lib/narrate.ts src/lib/narrate.test.ts
git commit -m "$(printf 'feat(gis-canvas): narrateStep human step sentences\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: Rewrite `CognitionPlane` as the Narration Spotlight

Replace the per-step molecule grid with three bounded elements: `ThinkingMolecule` (or a `◆ Working…` placeholder), one `CurrentStepCard` for the active step, and a bounded `StepRail`.

**Files:**
- Modify (rewrite): `apps/gis-canvas/src/components/CognitionPlane.tsx`
- Modify (rewrite): `apps/gis-canvas/src/components/CognitionPlane.test.tsx`

**Interfaces:**
- Consumes: `Turn`/`BuildStep` (`../lib/activity`), `narrateStep`/`StepOutcome` (`../lib/narrate`), `humanizeLabel` (`../lib/humanize`), `ThinkingMolecule` (`./ThinkingMolecule`).
- Produces: `export function CognitionPlane({ turn }: { turn: Turn | undefined }): JSX.Element | null` (unchanged signature). Renders `data-testid="cognition-plane"` only when `turn?.isBusy`. Internals: `CurrentStepCard`, `StepRail`, `WorkingPlaceholder` (module-private).

- [ ] **Step 1: Rewrite the test**

Replace the whole file `apps/gis-canvas/src/components/CognitionPlane.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CognitionPlane } from './CognitionPlane'
import type { BuildStep, Turn, TurnItem } from '../lib/activity'

const step = (id: number, label: string, extra: Partial<BuildStep> = {}): BuildStep =>
  ({ id, label, status: 'done', ...extra })

const turnWith = (trace: BuildStep[], reasoning?: string): Turn => {
  const items: TurnItem[] = []
  if (reasoning) items.push({ kind: 'reasoning', id: 99, text: reasoning })
  trace.forEach(s => items.push({ kind: 'step', id: s.id, step: s }))
  return {
    id: 1, prompt: 'q',
    reasoning: reasoning ? [{ id: 99, text: reasoning }] : [],
    trace, items, answers: [], isBusy: true,
  }
}

describe('CognitionPlane (spotlight)', () => {
  it('renders nothing when there is no turn or the turn is not busy', () => {
    expect(render(<CognitionPlane turn={undefined} />).container.firstChild).toBeNull()
    expect(render(<CognitionPlane turn={{ ...turnWith([]), isBusy: false }} />).container.firstChild).toBeNull()
  })

  it('leads with the thinking star and shows one narrated current-step card', () => {
    const running = step(3, 'data_query', { status: 'running', args: { table: 'admin.vessel_positions' } })
    render(<CognitionPlane turn={turnWith([running], 'Planning the data query')} />)
    expect(screen.getByTestId('cognition-plane')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-molecule')).toBeInTheDocument()
    // exactly one current-step card, narrated as a human sentence
    expect(screen.getByTestId('current-step')).toHaveTextContent('Queried admin.vessel_positions')
  })

  it('falls back to a Working placeholder when there is no reasoning yet', () => {
    render(<CognitionPlane turn={turnWith([step(3, 'skill_view', { status: 'running' })])} />)
    expect(screen.queryByTestId('thinking-molecule')).toBeNull()
    expect(screen.getByTestId('cognition-working')).toBeInTheDocument()
  })

  it('bounds completed steps to a rail: at most 5 pills plus a "+N earlier" chip — never one card per step', () => {
    const trace: BuildStep[] = []
    for (let i = 1; i <= 8; i++) trace.push(step(i, 'search_files', { result: { total_count: i } }))
    trace.push(step(9, 'data_query', { status: 'running', args: { table: 'x' } }))
    render(<CognitionPlane turn={turnWith(trace, 'thinking')} />)
    // 8 completed steps -> rail shows the last 5 as pills + "+3 earlier"
    expect(screen.getAllByTestId('rail-pill')).toHaveLength(5)
    expect(screen.getByText('+3 earlier')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CognitionPlane.test.tsx`
Expected: FAIL — no `current-step`/`rail-pill`/`cognition-working` test ids (old component renders `StepChip`s).

- [ ] **Step 3: Rewrite `CognitionPlane.tsx`**

Replace the whole file `apps/gis-canvas/src/components/CognitionPlane.tsx` with:

```tsx
import type { BuildStep, Turn } from '../lib/activity'
import { narrateStep, type StepOutcome } from '../lib/narrate'
import { humanizeLabel } from '../lib/humanize'
import { ThinkingMolecule } from './ThinkingMolecule'

const RAIL_MAX = 5

const OUTCOME_TEXT: Record<StepOutcome, string> = {
  ok: 'text-positive',
  error: 'text-negative',
  running: 'text-accent',
}

// The single active step, narrated in place. A running step gets the sweep.
function CurrentStepCard({ step }: { step: BuildStep }) {
  const n = narrateStep(step)
  return (
    <div
      data-testid="current-step"
      className="relative flex items-center gap-2.5 overflow-hidden rounded-gc-md border border-hairline-strong bg-surface/95 px-3 py-2.5 shadow-gc-overlay backdrop-blur"
    >
      <span className={`shrink-0 font-mono text-[13px] ${OUTCOME_TEXT[n.outcome]}`}>{n.glyph}</span>
      <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-primary">{n.text}</span>
      {n.outcome === 'running' ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-2/5 gc-anim-dock-sweep"
          style={{ background: 'linear-gradient(90deg,transparent,color-mix(in oklab,var(--color-accent) 20%,transparent),transparent)' }}
        />
      ) : null}
    </div>
  )
}

// Completed steps as a bounded, single-row breadcrumb: at most RAIL_MAX recent
// pills on the right, older collapsed into a "+N earlier" chip on the left.
function StepRail({ steps }: { steps: BuildStep[] }) {
  const shown = steps.slice(-RAIL_MAX)
  const hidden = steps.length - shown.length
  return (
    <div className="flex items-center gap-1.5 overflow-hidden">
      {hidden > 0 ? (
        <span className="shrink-0 font-mono text-[9px] text-tertiary">+{hidden} earlier</span>
      ) : null}
      {shown.map(s => {
        const n = narrateStep(s)
        return (
          <span
            key={s.id}
            data-testid="rail-pill"
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-hairline bg-surface/80 px-2 py-1 font-mono text-[9px] text-secondary"
          >
            <span className={OUTCOME_TEXT[n.outcome]}>{n.glyph}</span>
            {humanizeLabel(s.label)}
          </span>
        )
      })}
    </div>
  )
}

function WorkingPlaceholder() {
  return (
    <div
      data-testid="cognition-working"
      className="w-full rounded-gc-lg border border-accent/40 bg-surface/90 px-4 py-3.5 font-mono text-[11px] uppercase tracking-[.14em] text-accent shadow-gc-overlay backdrop-blur"
    >
      ◆ Working…
    </div>
  )
}

// Narration Spotlight: while busy, exactly three bounded elements — a thinking
// star (or Working placeholder), one in-place current-step card, and a bounded
// breadcrumb rail of completed steps. Never a per-step stack. Unmounts when the
// turn is no longer busy (trail stays recallable via the Inspector).
export function CognitionPlane({ turn }: { turn: Turn | undefined }) {
  if (!turn || !turn.isBusy) return null

  let lastReasoning: { kind: 'reasoning'; id: number; text: string } | undefined
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i]
    if (it.kind === 'reasoning') {
      lastReasoning = it
      break
    }
  }

  let current: BuildStep | undefined
  for (let i = turn.trace.length - 1; i >= 0; i--) {
    if (turn.trace[i].status === 'running') {
      current = turn.trace[i]
      break
    }
  }
  if (!current && turn.trace.length) current = turn.trace[turn.trace.length - 1]

  const done = turn.trace.filter(s => s.status === 'done')

  return (
    <div
      data-testid="cognition-plane"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6 gc-anim-cognition"
    >
      <div className="flex w-[min(66%,520px)] flex-col items-stretch gap-3">
        {lastReasoning ? <ThinkingMolecule text={lastReasoning.text} /> : <WorkingPlaceholder />}
        {current ? <CurrentStepCard step={current} /> : null}
        {done.length ? <StepRail steps={done} /> : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CognitionPlane.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the App integration still holds**

Run: `npx vitest run src/App.test.tsx && npm run typecheck`
Expected: PASS / no type errors (`App` mounts `CognitionPlane` with the same `{ turn }` prop; the App test asserts the plane appears on a running tool and unmounts on completion — both still true).

- [ ] **Step 6: Commit**

```bash
cd apps/gis-canvas
git add src/components/CognitionPlane.tsx src/components/CognitionPlane.test.tsx
git commit -m "$(printf 'feat(gis-canvas): rework CognitionPlane to Narration Spotlight\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: Full-suite regression + typecheck + build gate

Confirm the rework is green together (no fixture drift; the old `StepChip`/`SHAPE_ACCENT` grid is fully gone).

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite**

Run: `cd apps/gis-canvas && npm test`
Expected: PASS — all files, including `narrate`, `cognition`, `CognitionPlane`, `App`, `TurnView`, `CommandDock`, `ThinkingMolecule`.

- [ ] **Step 2: Typecheck**

Run: `cd apps/gis-canvas && npm run typecheck`
Expected: no errors. (`describeStep`/`StepMolecule` in `lib/cognition.ts` remain — now consumed by `narrate.ts`, not `CognitionPlane`.)

- [ ] **Step 3: Build**

Run: `cd apps/gis-canvas && npm run build`
Expected: clean build (a pre-existing "chunks larger than 500 kB" ESRI warning is expected and fine).

- [ ] **Step 4: Confirm the old grid is gone**

Run: `grep -rn "StepChip\|SHAPE_ACCENT" apps/gis-canvas/src` (from repo root)
Expected: no matches — the reworked plane replaced them. If any remain, remove the dead code and re-run Steps 1–3.

- [ ] **Step 5: Commit any cleanup**

```bash
cd apps/gis-canvas
git add -A
git commit -m "$(printf 'test(gis-canvas): green full suite for spotlight rework\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')" || echo "nothing to commit"
```

---

## Self-review notes (traceability to the revised spec §2)

- "Three bounded elements, never a stack" → Task 2 (`CognitionPlane` = thinking star + one `CurrentStepCard` + bounded `StepRail`); the rail-bound test asserts ≤5 pills + `+N earlier` for 8 steps.
- "Thinking leads; `◆ Working…` when no reasoning" → Task 2 (`WorkingPlaceholder`, tested).
- "`narrateStep` meaningful sentences, generic fallback" → Task 1 (known verbs + unknown-tool fallback, tested).
- "`describeStep` narrows to the outcome badge" → Task 1 (`outcomeOf`/`resultTail` call `describeStep`; `CognitionPlane` no longer imports it).
- Reused unchanged: `ThinkingMolecule`, dock ticker, `Turn.items`/interleave, `gc-anim-cognition`/`gc-anim-dock-sweep`.
- Live visual re-verify (against the a2a stack, watching a real turn stay bounded and readable) is the acceptance gate after this plan — same walk-through as before.
