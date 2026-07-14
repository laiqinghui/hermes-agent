# Trace-Rendering Parity (WS-A2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the AgentPanel trace like the Hermes dashboard — structured `Label: summary` rows instead of raw JSON, humanized tool headers with a field count, reconstructed tool nesting, and a derived heading on each Thinking block.

**Architecture:** Frontend-only, all under `apps/gis-canvas/src/`. New pure helpers `lib/humanize.ts`, `lib/summarize-value.ts`, `lib/derive-heading.ts`; new presentational `components/StructuredValue.tsx`; nesting added to `lib/activity.ts` derivation; `TraceStep.tsx`/`AgentTimeline.tsx`/`AgentPanel.tsx` updated to consume them. WS-A's `lib/format-value.ts` is superseded by StructuredValue and removed. Leaf modules land first so every task leaves typecheck + tests green.

**Tech Stack:** React 19, TypeScript, Tailwind v4, vitest + @testing-library/react.

## Global Constraints

- All changes under `apps/gis-canvas/`. No gateway/agent/plugin/schema edits (verbatim from spec: **"No gateway/agent/plugin/schema changes"**). Nesting is reconstructed on the client from the flat `tool.start`/`tool.complete` stream — no `parent_id` emission. No raw-JSON escape hatch / copy button; no loop detection.
- Work on branch `gis/wsa-agent-trace` (already checked out; the WS-A2 design doc is committed there at `0568cfe40`).
- Existing suite must stay green (currently **96**). Run `npx vitest run` from `apps/gis-canvas/`. Typecheck: `npm run typecheck`. Run the focused test while iterating; run the full suite + typecheck once before committing a task that touches shared files.
- Commit prefix `gis:`; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git add -A` — stage explicit paths.
- Real tool names the SPA receives (from live verify): `skill_view`, `execute_code`, `data_query`. Humanization is snake/kebab/camel → Title Case, preserving already-Cased tokens (`RowCount` stays `RowCount`). No hardcoded name map.
- `humanizeLabel` (Task 1) is the single humanizer used for BOTH tool names and object keys.

---

### Task 1: `lib/humanize.ts` — label humanizer (TDD)

**Files:**
- Create: `src/lib/humanize.ts`
- Create: `src/lib/humanize.test.ts`

**Interfaces produced:** `humanizeLabel(s: string): string`

- [ ] **Step 1: Write failing tests.** Create `src/lib/humanize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { humanizeLabel } from './humanize'

describe('humanizeLabel', () => {
  it('title-cases snake_case tool names', () => {
    expect(humanizeLabel('skill_view')).toBe('Skill View')
    expect(humanizeLabel('execute_code')).toBe('Execute Code')
    expect(humanizeLabel('data_query')).toBe('Data Query')
  })
  it('handles kebab-case', () => { expect(humanizeLabel('render-view')).toBe('Render View') })
  it('preserves already-cased keys', () => { expect(humanizeLabel('RowCount')).toBe('RowCount') })
  it('capitalizes a bare lowercase word', () => { expect(humanizeLabel('handle')).toBe('Handle') })
  it('returns empty input unchanged', () => { expect(humanizeLabel('')).toBe('') })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/lib/humanize.test.ts` → fails (`humanizeLabel` undefined).

- [ ] **Step 3: Implement `src/lib/humanize.ts`:**

```ts
/** Human-readable label from an identifier. Splits on `_`/`-`/whitespace and
 * Title-cases each token, preserving tokens that are already Cased:
 * `skill_view` → "Skill View", `RowCount` → "RowCount", `handle` → "Handle".
 * Used for both tool names and object keys. Empty input is returned unchanged. */
export function humanizeLabel(s: string): string {
  if (!s) return s
  return s
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/lib/humanize.test.ts`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/humanize.ts src/lib/humanize.test.ts
git commit -m "gis: humanizeLabel — snake/kebab identifier to Title Case

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `lib/summarize-value.ts` — value summaries + rows (TDD)

**Files:**
- Create: `src/lib/summarize-value.ts`
- Create: `src/lib/summarize-value.test.ts`

**Interfaces produced:**
- `summarizeValue(v: unknown): string`
- `fieldCount(v: unknown): number`
- `isExpandable(v: unknown): boolean`
- `ValueRow { label: string; value: unknown }`
- `toRows(v: unknown): ValueRow[]`

**Interfaces consumed:** `humanizeLabel` (Task 1)

- [ ] **Step 1: Write failing tests.** Create `src/lib/summarize-value.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { summarizeValue, fieldCount, isExpandable, toRows } from './summarize-value'

describe('summarizeValue', () => {
  it('shows scalars directly', () => {
    expect(summarizeValue(20)).toBe('20')
    expect(summarizeValue('data://x')).toBe('data://x')
    expect(summarizeValue(true)).toBe('true')
  })
  it('renders nullish as a dash', () => {
    expect(summarizeValue(null)).toBe('—')
    expect(summarizeValue(undefined)).toBe('—')
  })
  it('summarizes an array of objects with a field count', () => {
    expect(summarizeValue([{ name: 'a', type: 't' }, { name: 'b', type: 't' }])).toBe('2 items (2 fields)')
  })
  it('summarizes a scalar array without a field count', () => {
    expect(summarizeValue([1, 2, 3])).toBe('3 items')
  })
  it('summarizes a plain object as a field count', () => {
    expect(summarizeValue({ a: 1, b: 2 })).toBe('2 fields')
  })
  it('truncates long strings', () => {
    const out = summarizeValue('x'.repeat(200))
    expect(out.length).toBeLessThanOrEqual(81)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('fieldCount', () => {
  it('counts object keys and array length; scalars are 0', () => {
    expect(fieldCount({ a: 1, b: 2, c: 3 })).toBe(3)
    expect(fieldCount([1, 2])).toBe(2)
    expect(fieldCount('x')).toBe(0)
  })
})

describe('toRows / isExpandable', () => {
  it('makes a humanized row per object key, preserving order', () => {
    expect(toRows({ RowCount: 20, handle: 'x' })).toEqual([
      { label: 'RowCount', value: 20 },
      { label: 'Handle', value: 'x' }
    ])
  })
  it('makes an indexed row per array element', () => {
    expect(toRows(['a', 'b'])).toEqual([{ label: '[0]', value: 'a' }, { label: '[1]', value: 'b' }])
  })
  it('returns no rows for a scalar', () => { expect(toRows(5)).toEqual([]) })
  it('marks non-empty objects/arrays expandable, scalars not', () => {
    expect(isExpandable({ a: 1 })).toBe(true)
    expect(isExpandable([1])).toBe(true)
    expect(isExpandable(5)).toBe(false)
    expect(isExpandable({})).toBe(false)
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/lib/summarize-value.test.ts`.

- [ ] **Step 3: Implement `src/lib/summarize-value.ts`:**

```ts
import { humanizeLabel } from './humanize'

const MAX_STR = 80

/** One-line summary of a value for the trace UI: scalars inline, arrays as
 * "N items" (+ "(M fields)" when elements are objects), objects as "N fields". */
export function summarizeValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    const n = v.length
    const base = `${n} item${n === 1 ? '' : 's'}`
    const firstObj = v.find(x => x !== null && typeof x === 'object' && !Array.isArray(x))
    if (firstObj) return `${base} (${Object.keys(firstObj as object).length} fields)`
    return base
  }
  if (typeof v === 'object') {
    const k = Object.keys(v as object).length
    return `${k} field${k === 1 ? '' : 's'}`
  }
  return String(v)
}

/** Top-level field/element count for a header "N items" chip. */
export function fieldCount(v: unknown): number {
  if (Array.isArray(v)) return v.length
  if (v !== null && typeof v === 'object') return Object.keys(v as object).length
  return 0
}

/** Whether a value has rows worth expanding into. */
export function isExpandable(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  return v !== null && typeof v === 'object' && Object.keys(v as object).length > 0
}

export interface ValueRow { label: string; value: unknown }

/** Break a value into labeled child rows: humanized keys for objects,
 * `[i]` indices for arrays, none for scalars. */
export function toRows(v: unknown): ValueRow[] {
  if (Array.isArray(v)) return v.map((value, i) => ({ label: `[${i}]`, value }))
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).map(([key, value]) => ({ label: humanizeLabel(key), value }))
  }
  return []
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/lib/summarize-value.test.ts`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/summarize-value.ts src/lib/summarize-value.test.ts
git commit -m "gis: summarize-value — Hermes-style value summaries, field counts, labeled rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `lib/derive-heading.ts` — reasoning heading (TDD)

**Files:**
- Create: `src/lib/derive-heading.ts`
- Create: `src/lib/derive-heading.test.ts`

**Interfaces produced:** `deriveHeading(text: string): string`

- [ ] **Step 1: Write failing tests.** Create `src/lib/derive-heading.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveHeading } from './derive-heading'

describe('deriveHeading', () => {
  it('keeps a short punctuation-light first line as the title', () => {
    expect(deriveHeading('Exploring vessel positions')).toBe('Exploring vessel positions')
  })
  it('uses the first line even when a long body follows on later lines', () => {
    expect(deriveHeading('Considering display options\nI think a table is best...')).toBe('Considering display options')
  })
  it('truncates a long single-paragraph reasoning with an ellipsis', () => {
    const out = deriveHeading('I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.')
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
    expect(out.startsWith('I need to show')).toBe(true)
  })
  it('returns empty for empty input', () => { expect(deriveHeading('')).toBe('') })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/lib/derive-heading.test.ts`.

- [ ] **Step 3: Implement `src/lib/derive-heading.ts`:**

```ts
const MAX = 60

/** A short title derived from a reasoning body (the gateway sends no heading).
 * The first line if it is short and reads like a title; otherwise a
 * word-boundary truncation of the first line with an ellipsis. '' for empty. */
export function deriveHeading(text: string): string {
  const t = (text ?? '').trim()
  if (!t) return ''
  const firstLine = t.split(/\r?\n/)[0].trim()
  if (firstLine.length <= MAX && !/[.!?]/.test(firstLine)) return firstLine
  if (firstLine.length <= MAX) return firstLine.replace(/[.!?]+$/, '')
  const cut = firstLine.slice(0, MAX)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut
  return base.trim() + '…'
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/lib/derive-heading.test.ts`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/derive-heading.ts src/lib/derive-heading.test.ts
git commit -m "gis: deriveHeading — short title from reasoning body

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `lib/activity.ts` — tool nesting via an open-tool stack (TDD)

**Files:**
- Modify: `src/lib/activity.ts`
- Modify: `src/lib/activity.test.ts` (extend; keep existing cases green)

**Interfaces produced:** `BuildStep` gains optional `children?: BuildStep[]` and `depth?: number`. `deriveActivity` reconstructs a tool tree; `trace`/`timeline` hold only top-level tool steps.

**Interfaces consumed:** existing WS-A `ActivityItem`/`deriveActivity`.

- [ ] **Step 1: Write failing tests.** Append to `src/lib/activity.test.ts`:

```ts
describe('deriveActivity tool nesting', () => {
  const mk = (kind: string, payload: Record<string, unknown>, id: number): ActivityItem => ({ id, ...activityItemFromEvent(kind, payload) })
  it('keeps sequential (non-overlapping) tools flat at the top level', () => {
    const items: ActivityItem[] = [
      mk('tool.start', { tool_id: 'a', name: 'skill_view' }, 1),
      mk('tool.complete', { tool_id: 'a', name: 'skill_view' }, 2),
      mk('tool.start', { tool_id: 'b', name: 'data_query' }, 3),
      mk('tool.complete', { tool_id: 'b', name: 'data_query' }, 4)
    ]
    const d = deriveActivity(items)
    expect(d.trace.map(s => s.label)).toEqual(['skill_view', 'data_query'])
    expect(d.trace.every(s => (s.children ?? []).length === 0)).toBe(true)
    expect(d.trace.every(s => (s.depth ?? 0) === 0)).toBe(true)
  })
  it('nests a tool that starts while another is still open', () => {
    const items: ActivityItem[] = [
      mk('tool.start', { tool_id: 'p', name: 'data_discover' }, 1),
      mk('tool.start', { tool_id: 'c', name: 'data_query' }, 2),
      mk('tool.complete', { tool_id: 'c', name: 'data_query', result: { rows: 3 } }, 3),
      mk('tool.complete', { tool_id: 'p', name: 'data_discover' }, 4)
    ]
    const d = deriveActivity(items)
    expect(d.trace.map(s => s.label)).toEqual(['data_discover'])
    const parent = d.trace[0]
    expect(parent.children?.map(c => c.label)).toEqual(['data_query'])
    expect(parent.children?.[0].depth).toBe(1)
    expect(parent.children?.[0].result).toEqual({ rows: 3 })
    // nested tool does not get its own top-level timeline entry
    expect(d.timeline.filter(e => e.kind === 'tool').length).toBe(1)
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/lib/activity.test.ts` → the nesting cases fail (no `children`/`depth`; nested step currently pushed to top-level trace).

- [ ] **Step 3: Implement.** In `src/lib/activity.ts`, extend `BuildStep` and rewrite `deriveActivity`.

Change the `BuildStep` interface to add the two optional fields (keep the existing fields):

```ts
export interface BuildStep {
  id: number
  label: string
  status: 'running' | 'done'
  context?: string
  args?: unknown
  result?: unknown
  summary?: string
  durationS?: number
  children?: BuildStep[]
  depth?: number
}
```

Replace the `deriveActivity` function body with:

```ts
export function deriveActivity(items: ActivityItem[]): DerivedActivity {
  const messages: ChatMessage[] = []
  const reasoning: ReasoningItem[] = []
  const trace: BuildStep[] = []
  const timeline: TimelineEvent[] = []
  const openById = new Map<string, BuildStep>()
  const openStack: BuildStep[] = []

  const closeStep = (step: BuildStep, item: ActivityItem) => {
    step.status = 'done'
    step.args = item.args
    step.result = item.result
    step.summary = item.summary
    step.durationS = item.durationS
    if (item.context) step.context = item.context
  }

  for (const item of items) {
    switch (item.kind) {
      case 'you':
        messages.push({ id: item.id, role: 'user', text: item.text })
        timeline.push({ id: item.id, kind: 'message', role: 'user', text: item.text })
        break
      case 'message.complete':
        messages.push({ id: item.id, role: 'agent', text: item.text })
        timeline.push({ id: item.id, kind: 'message', role: 'agent', text: item.text })
        break
      case 'reasoning.available':
        reasoning.push({ id: item.id, text: item.text })
        timeline.push({ id: item.id, kind: 'reasoning', text: item.text })
        break
      case 'tool.start': {
        const step: BuildStep = {
          id: item.id,
          label: item.name ?? item.text,
          status: 'running',
          context: item.context,
          depth: openStack.length,
          children: []
        }
        if (openStack.length) {
          openStack[openStack.length - 1].children!.push(step)
        } else {
          trace.push(step)
          timeline.push({ id: item.id, kind: 'tool', step })
        }
        openStack.push(step)
        if (item.toolId) openById.set(item.toolId, step)
        break
      }
      case 'tool.complete': {
        const label = item.name ?? item.text
        let step: BuildStep | undefined
        if (item.toolId && openById.has(item.toolId)) {
          step = openById.get(item.toolId)
          openById.delete(item.toolId)
        } else {
          const idx = openStack.findIndex(s => s.label === label)
          if (idx !== -1) step = openStack[idx]
        }
        if (step) {
          closeStep(step, item)
          const si = openStack.indexOf(step)
          if (si !== -1) openStack.splice(si, 1)
        }
        break
      }
      case 'error':
        timeline.push({ id: item.id, kind: 'error', text: item.text })
        break
    }
  }

  const isBusy = trace.some(hasRunning)
  return { messages, trace: trace.slice(-8), reasoning, timeline, isBusy }
}

function hasRunning(s: BuildStep): boolean {
  return s.status === 'running' || (s.children?.some(hasRunning) ?? false)
}
```

- [ ] **Step 4: Run, confirm GREEN + existing cases still pass.** `npx vitest run src/lib/activity.test.ts` then `npm run typecheck`. The WS-A flat cases still land at the top level (existing field-level assertions unchanged); the new `children`/`depth` are optional so component test literals still compile.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/activity.ts src/lib/activity.test.ts
git commit -m "gis: reconstruct tool nesting from the flat event stream (open-tool stack)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `components/StructuredValue.tsx` — labeled expandable rows (TDD component)

**Files:**
- Create: `src/components/StructuredValue.tsx`
- Create: `src/components/StructuredValue.test.tsx`

**Interfaces:**
- Consumes: `summarizeValue`, `toRows`, `isExpandable` (Task 2)
- Produces: `StructuredValue({ value, depth? }: { value: unknown; depth?: number })`

- [ ] **Step 1: Write failing test.** Create `src/components/StructuredValue.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StructuredValue } from './StructuredValue'

describe('StructuredValue', () => {
  it('renders scalar fields as label + summary', () => {
    render(<StructuredValue value={{ RowCount: 20, Handle: 'data://x' }} />)
    expect(screen.getByText('RowCount')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('Handle')).toBeInTheDocument()
    expect(screen.getByText('data://x')).toBeInTheDocument()
  })
  it('summarizes a nested array of objects and expands it on click', () => {
    const sample = [
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }
    ]
    render(<StructuredValue value={{ Sample: sample }} />)
    expect(screen.getByText('3 items (6 fields)')).toBeInTheDocument()
    expect(screen.queryByText('[0]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sample/i }))
    expect(screen.getByText('[0]')).toBeInTheDocument()
  })
  it('renders a top-level scalar directly', () => {
    render(<StructuredValue value={42} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/components/StructuredValue.test.tsx`.

- [ ] **Step 3: Implement `src/components/StructuredValue.tsx`:**

```tsx
import { useState } from 'react'
import { summarizeValue, toRows, isExpandable } from '../lib/summarize-value'

const MAX_DEPTH = 6

export function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const rows = toRows(value)
  if (!rows.length) {
    return <span className="font-mono text-[10.5px] text-primary">{summarizeValue(value)}</span>
  }
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row, i) => (
        <ValueRowView key={`${row.label}-${i}`} label={row.label} value={row.value} depth={depth} />
      ))}
    </div>
  )
}

function ValueRowView({ label, value, depth }: { label: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(false)
  const expandable = isExpandable(value) && depth < MAX_DEPTH
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2">
        {expandable ? (
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex shrink-0 items-baseline gap-1 text-left">
            <span aria-hidden className="font-mono text-[10px] text-tertiary">{open ? '▾' : '▸'}</span>
            <span className="font-sans text-[11px] text-secondary">{label}</span>
          </button>
        ) : (
          <span className="shrink-0 font-sans text-[11px] text-secondary">{label}</span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-primary">{summarizeValue(value)}</span>
      </div>
      {expandable && open ? (
        <div className="mt-0.5 border-l border-hairline pl-3">
          <StructuredValue value={value} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/components/StructuredValue.test.tsx`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/StructuredValue.tsx src/components/StructuredValue.test.tsx
git commit -m "gis: StructuredValue — labeled, expandable value rows (replaces JSON blob)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `components/TraceStep.tsx` — humanized header, N items, structured rows, children (TDD)

Rewrite `TraceStep` to render the Hermes-style card and remove the superseded `format-value.ts`. Because the header now humanizes the tool name, the label assertions in `AgentTimeline.test.tsx` and `AgentPanel.test.tsx` (which render a `TraceStep`) must be updated in the SAME commit to stay green.

**Files:**
- Modify: `src/components/TraceStep.tsx`
- Modify: `src/components/TraceStep.test.tsx`
- Modify: `src/components/AgentTimeline.test.tsx` (update the rendered tool-name assertion)
- Modify: `src/components/AgentPanel.test.tsx` (update the rendered tool-name assertion)
- Delete: `src/lib/format-value.ts`, `src/lib/format-value.test.ts`

**Interfaces:**
- Consumes: `BuildStep` (Task 4), `humanizeLabel` (Task 1), `fieldCount` (Task 2), `StructuredValue` (Task 5)
- Produces: `TraceStep({ step }: { step: BuildStep })` (unchanged signature)

- [ ] **Step 1: Confirm `formatValue` has no remaining importers besides TraceStep.** Run (git-bash) `grep -rn "format-value\|formatValue" src/` — expect matches only in `TraceStep.tsx`, `format-value.ts`, `format-value.test.ts`. If any OTHER file imports it, STOP and report (the plan assumed TraceStep was the only consumer).

- [ ] **Step 2: Write/replace the failing tests.** Replace `src/components/TraceStep.test.tsx` with:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceStep } from './TraceStep'
import type { BuildStep } from '../lib/activity'

const step: BuildStep = {
  id: 1, label: 'data_query', status: 'done', context: 'From admin.vessel_positions',
  args: { sql: 'SELECT 1' }, result: { RowCount: 20, Handle: 'data://x' }, durationS: 1.2
}

describe('TraceStep', () => {
  it('shows a humanized name, field count, and context collapsed', () => {
    render(<TraceStep step={step} />)
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText(/From admin.vessel_positions/)).toBeInTheDocument()
    expect(screen.queryByText('RowCount')).not.toBeInTheDocument()
  })
  it('reveals structured rows (not a JSON blob) on click', () => {
    render(<TraceStep step={step} />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(screen.getByText('RowCount')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText(/SELECT 1/)).toBeInTheDocument()
    expect(screen.queryByText(/"RowCount": 20/)).not.toBeInTheDocument()
  })
  it('renders nested children steps', () => {
    const parent: BuildStep = {
      id: 2, label: 'data_discover', status: 'done', depth: 0,
      children: [{ id: 3, label: 'data_query', status: 'done', depth: 1 }]
    }
    render(<TraceStep step={parent} />)
    expect(screen.getByText('Data Discover')).toBeInTheDocument()
    expect(screen.getByText('Data Query')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run, confirm RED.** `npx vitest run src/components/TraceStep.test.tsx` (fails: header not humanized, no `2 items`, still JSON).

- [ ] **Step 4: Implement `src/components/TraceStep.tsx`** (replace the file contents):

```tsx
import { useState } from 'react'
import type { BuildStep } from '../lib/activity'
import { humanizeLabel } from '../lib/humanize'
import { fieldCount } from '../lib/summarize-value'
import { StructuredValue } from './StructuredValue'

export function TraceStep({ step }: { step: BuildStep }) {
  const [open, setOpen] = useState(false)
  const payload = step.result ?? step.args
  const count = fieldCount(payload)
  const hasDetail = step.args !== undefined || step.result !== undefined || !!step.summary
  const children = step.children ?? []
  return (
    <div className="border-b border-hairline last:border-b-0 py-1">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(o => !o)}
        aria-expanded={hasDetail ? open : undefined}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${step.status === 'done' ? 'border-accent bg-accent/15' : 'border-hairline-strong'}`}>
          {step.status === 'done'
            ? <span className="text-[10px] text-accent">✓</span>
            : <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-accent" style={{ animation: 'gc-pulse-dot .9s ease-in-out infinite' }} />}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] text-primary">{humanizeLabel(step.label)}</span>
        {count ? <span className="shrink-0 font-mono text-[10px] text-tertiary">{count} items</span> : null}
        {step.context ? <span className="min-w-0 flex-1 truncate font-sans text-[11px] text-tertiary">{step.context}</span> : <span className="flex-1" />}
        {step.durationS != null ? <span className="shrink-0 font-mono text-[10px] text-tertiary">{step.durationS.toFixed(1)}s</span> : null}
        {hasDetail ? <span aria-hidden className="shrink-0 font-mono text-[10px] text-tertiary">{open ? '▾' : '▸'}</span> : null}
      </button>
      {open ? (
        <div className="mt-1 flex flex-col gap-1.5 pl-6">
          {step.summary ? <div className="font-sans text-[11px] text-secondary">{step.summary}</div> : null}
          {step.args !== undefined ? (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">args</div>
              <StructuredValue value={step.args} />
            </div>
          ) : null}
          {step.result !== undefined ? (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">result</div>
              <StructuredValue value={step.result} />
            </div>
          ) : null}
        </div>
      ) : null}
      {children.length ? (
        <div className="mt-1 border-l border-hairline pl-3">
          {children.map(c => <TraceStep key={c.id} step={c} />)}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Delete the superseded helper.** `git rm src/lib/format-value.ts src/lib/format-value.test.ts`

- [ ] **Step 6: Update the two dependent test files' tool-name assertions.**

In `src/components/AgentTimeline.test.tsx`: the tool step fixture uses `label: 'query'` and asserts `screen.getByText('query')`. Change the fixture label to `'data_query'` and the assertion to `screen.getByText('Data Query')`. (Leave the reasoning/message/error/empty-hint cases unchanged.)

In `src/components/AgentPanel.test.tsx`: the trace fixture uses `label: 'query'`; the "toggles to the inspector timeline" test asserts `screen.getAllByText('query')`. Change the fixture label to `'data_query'` and the assertion to `screen.getAllByText('Data Query')`.

- [ ] **Step 7: Run, confirm GREEN + full suite + typecheck.** `npx vitest run src/components/TraceStep.test.tsx`, then `npx vitest run` (all pass — `format-value.test.ts` is gone; the two updated files pass), then `npm run typecheck` (clean). Re-run the Step-1 grep to confirm no dangling `formatValue` import remains.

- [ ] **Step 8: Commit.**

```bash
git add src/components/TraceStep.tsx src/components/TraceStep.test.tsx src/components/AgentTimeline.test.tsx src/components/AgentPanel.test.tsx src/lib/format-value.ts src/lib/format-value.test.ts
git commit -m "gis: TraceStep — humanized name, N-items, structured rows, nested children; drop format-value

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: derived Thinking headings in `AgentTimeline` + `AgentPanel` (TDD)

**Files:**
- Modify: `src/components/AgentTimeline.tsx`
- Modify: `src/components/AgentPanel.tsx`
- Modify: `src/components/AgentTimeline.test.tsx` (add a heading assertion)
- Modify: `src/components/AgentPanel.test.tsx` (add a heading assertion; fix the `my plan` disclosure assertion for the now-duplicated text)

**Interfaces consumed:** `deriveHeading` (Task 3)

- [ ] **Step 1: Write failing tests.**

Append to `src/components/AgentTimeline.test.tsx` (inside the existing `describe`):

```tsx
  it('shows a derived heading on a reasoning card', () => {
    const long = 'I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.'
    render(<AgentTimeline timeline={[{ id: 1, kind: 'reasoning', text: long }]} />)
    // the truncated heading (…-terminated) is distinct from the full body
    expect(screen.getByText(/^I need to show.*…$/)).toBeInTheDocument()
  })
```

In `src/components/AgentPanel.test.tsx`: change the reasoning fixture and the disclosure test. Replace the `reasoning` fixture with a long-text item and update the disclosure test to assert the derived heading:

```tsx
const reasoning: ReasoningItem[] = [{ id: 2, text: 'I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.' }]
```
```tsx
  it('exposes reasoning with a derived heading via the thinking disclosure', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /thinking/i }))
    expect(screen.getByText(/^I need to show.*…$/)).toBeInTheDocument()
  })
```
(The `timeline` fixture in that file that referenced the reasoning text can keep its own inline text — it is only used by the inspector-toggle test, which asserts on the tool name, not the reasoning.)

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/components/AgentTimeline.test.tsx src/components/AgentPanel.test.tsx` (heading assertions fail — no heading rendered yet).

- [ ] **Step 3: Implement.**

In `src/components/AgentTimeline.tsx`, import the helper and add the heading to the reasoning branch:
```tsx
import { deriveHeading } from '../lib/derive-heading'
```
Replace the `ev.kind === 'reasoning'` branch's returned JSX with:
```tsx
        if (ev.kind === 'reasoning') {
          const heading = deriveHeading(ev.text)
          return (
            <div key={ev.id} className="rounded-gc-md border border-hairline bg-surface-raised/50 p-2.5">
              <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wide text-tertiary">thinking</div>
              {heading ? <div className="mb-0.5 font-sans text-[12px] font-semibold text-primary">{heading}</div> : null}
              <div className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-secondary">{ev.text}</div>
            </div>
          )
        }
```

In `src/components/AgentPanel.tsx`, import the helper:
```tsx
import { deriveHeading } from '../lib/derive-heading'
```
In the Thinking disclosure body, replace the `reasoning.map(...)` block with one that shows the heading:
```tsx
                      {reasoning.map(r => {
                        const heading = deriveHeading(r.text)
                        return (
                          <div key={r.id}>
                            {heading ? <div className="font-sans text-[12px] font-semibold text-primary">{heading}</div> : null}
                            <div className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-secondary">{r.text}</div>
                          </div>
                        )
                      })}
```

- [ ] **Step 4: Run, confirm GREEN + full suite + typecheck.** `npx vitest run src/components/AgentTimeline.test.tsx src/components/AgentPanel.test.tsx`, then `npx vitest run` (all pass), then `npm run typecheck` (clean).

- [ ] **Step 5: Commit.**

```bash
git add src/components/AgentTimeline.tsx src/components/AgentPanel.tsx src/components/AgentTimeline.test.tsx src/components/AgentPanel.test.tsx
git commit -m "gis: derived Thinking headings on reasoning cards and the thinking disclosure

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** humanized tool names → Task 1 (`humanizeLabel`) + Task 6 header; structured `Label: summary` rows replacing JSON → Task 2 + Task 5 + Task 6; `N items` header → Task 2 (`fieldCount`) + Task 6; tool nesting via open-tool stack → Task 4 + Task 6 children rendering; derived Thinking heading → Task 3 + Task 7. All design sections covered. Non-goals respected (no gateway edits, no copy button, no loop detection).
- **Placeholder scan:** no TBD/TODO; every code step shows real code. The two dependent-test edits in Task 6 Step 6 and the AgentPanel fixture change in Task 7 Step 1 are described against the exact current assertions.
- **Type consistency:** `BuildStep.children`/`depth` optional (Task 4) so WS-A component test literals compile; `humanizeLabel` (Task 1) consumed by Task 2 `toRows` and Task 6 header; `summarizeValue`/`toRows`/`isExpandable`/`fieldCount` (Task 2) consumed by Task 5 + Task 6; `StructuredValue` (Task 5) consumed by Task 6; `deriveHeading` (Task 3) consumed by Task 7. `TraceStep({ step })` signature unchanged, so `AgentTimeline`/`AgentPanel` call sites are untouched.
- **Green at each task:** Tasks 1–3 add new leaf modules; Task 4 makes additive-optional `BuildStep` changes + a behavior-preserving derivation (flat cases unchanged); Task 5 adds a new component; Task 6 rewrites TraceStep and updates the two dependent tests in the same commit (label humanization propagates through them); Task 7 adds headings and fixes the one now-duplicated `my plan` assertion. Typecheck + full suite verified at Tasks 4, 6, 7 (the shared-file tasks).

---

## Amendment (2026-07-15): nesting dropped — render flat

**Task 4 is DROPPED.** During execution, the open-tool-stack nesting was found to misclassify
*concurrent* tools as *nested*: the gateway emits no parent/child signal on ordinary `tool.start`/
`tool.complete` events (only `subagent.*` delegation events carry `parent_id`/`depth`, which the SPA
doesn't capture and the observed data flow doesn't use). The existing WS-A tests correctly treat two
simultaneously-open tools as flat siblings, which the bracketing heuristic violated. Real observed
streams are flat. Decision (user-approved): render flat, no nesting reconstruction.

Consequences for the remaining tasks:
- **Task 4:** skipped entirely. `BuildStep` keeps its WS-A shape — **no `children`/`depth` fields**.
- **Task 6:** `TraceStep` renders **no children block** (there are none). Drop the "renders nested
  children steps" test case; keep the humanized-name / `N items` / structured-rows / drop-format-value
  changes. `payload = step.result ?? step.args` still drives the `N items` count.
- Tasks 1, 2, 3, 5, 7 are unaffected.
