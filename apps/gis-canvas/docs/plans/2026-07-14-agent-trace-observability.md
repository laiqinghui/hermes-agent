# Agent-Trace Observability (WS-A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the agent's reasoning and full tool inputs/outputs (already emitted by the gateway, currently dropped) in the AgentPanel — an expandable polished default plus a verbose chronological inspector toggle.

**Architecture:** Frontend-only, all under `apps/gis-canvas/src/`. Pure logic lives in `lib/activity.ts` (event→item mapping + derivation) and `lib/format-value.ts`; presentation in new `TraceStep.tsx` / `AgentTimeline.tsx` and the existing `AgentPanel.tsx`; `App.tsx` wires capture. Leaf modules land first so every task leaves typecheck + tests green.

**Tech Stack:** React 19, TypeScript, Tailwind v4, vitest + @testing-library/react.

## Global Constraints

- All changes under `apps/gis-canvas/`. No gateway/agent/plugin/schema edits (verbatim from spec: **"No gateway/agent/plugin/schema changes"**). No raw-JSON escape hatch / copy button, no loop auto-detection, no `message.delta` token streaming.
- Work on branch `gis/wsa-agent-trace` (already created; the WS-A design doc is committed there).
- Existing suite must stay green (currently 80). Run `npx vitest run` from `apps/gis-canvas/`. Typecheck: `npm run typecheck`.
- Commit prefix `gis:`; trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Never `git add -A` — stage explicit paths.
- Event fields available from the gateway (source of truth for what to capture): `tool.start {tool_id, name, context}`, `tool.complete {tool_id, name, args, result, summary, duration_s}`, `reasoning.available {text}`, `message.complete {text}`, plus SPA-internal `you`/`system`/`error` items.

---

### Task 1: `activity.ts` — extended types, event mapper, enriched derivation (TDD)

**Files:**
- Modify: `src/lib/activity.ts`
- Modify: `src/lib/activity.test.ts` (extend; keep existing cases green)

**Interfaces produced:**
- `ActivityItem` (extended with `name?, context?, args?, result?, summary?, durationS?`)
- `ReasoningItem { id: number; text: string }`
- `BuildStep` (extended with `context?, args?, result?, summary?, durationS?`)
- `TimelineEvent` (union, see below)
- `DerivedActivity { messages, trace, reasoning, timeline, isBusy }`
- `activityItemFromEvent(kind: string, payload: Record<string, unknown> | undefined): Omit<ActivityItem, 'id'>`
- `deriveActivity(items: ActivityItem[]): DerivedActivity`

- [ ] **Step 1: Write failing tests.** Append to `src/lib/activity.test.ts`:

```ts
import { activityItemFromEvent, deriveActivity, type ActivityItem } from './activity'

describe('activityItemFromEvent', () => {
  it('captures structured tool.complete fields', () => {
    const it0 = activityItemFromEvent('tool.complete', {
      tool_id: 't1', name: 'search_files', context: 'searching', args: { q: 'x' }, result: { hits: 2 }, summary: '2 hits', duration_s: 1.5
    })
    expect(it0).toMatchObject({ kind: 'tool.complete', toolId: 't1', name: 'search_files', context: 'searching', summary: '2 hits', durationS: 1.5 })
    expect(it0.args).toEqual({ q: 'x' })
    expect(it0.result).toEqual({ hits: 2 })
  })
  it('captures reasoning text', () => {
    expect(activityItemFromEvent('reasoning.available', { text: 'thinking...' })).toMatchObject({ kind: 'reasoning.available', text: 'thinking...' })
  })
})

describe('deriveActivity reasoning + timeline', () => {
  const mk = (kind: string, payload: Record<string, unknown>, id: number): ActivityItem => ({ id, ...activityItemFromEvent(kind, payload) })
  it('collects reasoning and enriches completed tool steps', () => {
    const items: ActivityItem[] = [
      mk('reasoning.available', { text: 'plan' }, 1),
      mk('tool.start', { tool_id: 'a', name: 'query' }, 2),
      mk('tool.complete', { tool_id: 'a', name: 'query', args: { sql: 'x' }, result: { rows: 3 }, duration_s: 2 }, 3)
    ]
    const d = deriveActivity(items)
    expect(d.reasoning).toEqual([{ id: 1, text: 'plan' }])
    const step = d.trace.find(s => s.label === 'query')!
    expect(step.status).toBe('done')
    expect(step.args).toEqual({ sql: 'x' })
    expect(step.durationS).toBe(2)
  })
  it('builds a chronological timeline interleaving reasoning, tool, message', () => {
    const items: ActivityItem[] = [
      { id: 1, kind: 'you', text: 'hi' },
      mk('reasoning.available', { text: 'plan' }, 2),
      mk('tool.start', { tool_id: 'a', name: 'query' }, 3),
      mk('tool.complete', { tool_id: 'a', name: 'query', result: { rows: 1 } }, 4),
      mk('message.complete', { text: 'done' }, 5)
    ]
    const d = deriveActivity(items)
    expect(d.timeline.map(e => e.kind)).toEqual(['message', 'reasoning', 'tool', 'message'])
    const toolEvent = d.timeline.find(e => e.kind === 'tool')!
    expect(toolEvent.kind === 'tool' && toolEvent.step.result).toEqual({ rows: 1 })
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/lib/activity.test.ts` → new tests fail (`activityItemFromEvent` undefined; no `reasoning`/`timeline`).

- [ ] **Step 3: Implement.** Replace the contents of `src/lib/activity.ts` with:

```ts
// Derivation layer over App.tsx's gateway activity log. Splits one ordered event
// stream into what the AgentPanel needs: a conversation thread, an enriched
// tool-call trace (with inputs/outputs the gateway already sends), the agent's
// reasoning, and a chronological timeline for the verbose inspector.
export interface ActivityItem {
  id: number
  kind: string
  text: string
  toolId?: string
  name?: string
  context?: string
  args?: unknown
  result?: unknown
  summary?: string
  durationS?: number
}
export interface ChatMessage { id: number; role: 'user' | 'agent'; text: string }
export interface ReasoningItem { id: number; text: string }
export interface BuildStep {
  id: number
  label: string
  status: 'running' | 'done'
  context?: string
  args?: unknown
  result?: unknown
  summary?: string
  durationS?: number
}
export type TimelineEvent =
  | { id: number; kind: 'reasoning'; text: string }
  | { id: number; kind: 'tool'; step: BuildStep }
  | { id: number; kind: 'message'; role: 'user' | 'agent'; text: string }
  | { id: number; kind: 'error'; text: string }
export interface DerivedActivity {
  messages: ChatMessage[]
  trace: BuildStep[]
  reasoning: ReasoningItem[]
  timeline: TimelineEvent[]
  isBusy: boolean
}

/** Map a raw gateway event into an ActivityItem (id is assigned by the caller).
 * Keeps the structured tool/reasoning fields the gateway already sends. */
export function activityItemFromEvent(kind: string, payload: Record<string, unknown> | undefined): Omit<ActivityItem, 'id'> {
  const p = payload ?? {}
  const name = typeof p.name === 'string' ? p.name : undefined
  const text = typeof p.text === 'string' ? p.text : (name ?? JSON.stringify(p).slice(0, 160))
  const item: Omit<ActivityItem, 'id'> = { kind, text }
  if (typeof p.tool_id === 'string') item.toolId = p.tool_id
  if (name) item.name = name
  if (typeof p.context === 'string') item.context = p.context
  if ('args' in p) item.args = p.args
  if ('result' in p) item.result = p.result
  if (typeof p.summary === 'string') item.summary = p.summary
  if (typeof p.duration_s === 'number') item.durationS = p.duration_s
  return item
}

export function deriveActivity(items: ActivityItem[]): DerivedActivity {
  const messages: ChatMessage[] = []
  const reasoning: ReasoningItem[] = []
  const trace: BuildStep[] = []
  const timeline: TimelineEvent[] = []
  const openById = new Map<string, BuildStep>()
  const openByName: BuildStep[] = []

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
        const step: BuildStep = { id: item.id, label: item.name ?? item.text, status: 'running', context: item.context }
        trace.push(step)
        timeline.push({ id: item.id, kind: 'tool', step })
        if (item.toolId) openById.set(item.toolId, step)
        else openByName.push(step)
        break
      }
      case 'tool.complete': {
        const label = item.name ?? item.text
        let step: BuildStep | undefined
        if (item.toolId && openById.has(item.toolId)) {
          step = openById.get(item.toolId); openById.delete(item.toolId)
        } else {
          const idx = openByName.findIndex(s => s.label === label)
          if (idx !== -1) { step = openByName[idx]; openByName.splice(idx, 1) }
        }
        if (step) {
          step.status = 'done'
          step.args = item.args
          step.result = item.result
          step.summary = item.summary
          step.durationS = item.durationS
          if (item.context) step.context = item.context
        }
        break
      }
      case 'error':
        timeline.push({ id: item.id, kind: 'error', text: item.text })
        break
    }
  }

  return { messages, trace: trace.slice(-8), reasoning, timeline, isBusy: trace.some(s => s.status === 'running') }
}
```

- [ ] **Step 4: Run, confirm GREEN + existing cases still pass.** `npx vitest run src/lib/activity.test.ts`. If a pre-existing case relied on a tool item's `text` as the label with no `name`, it still passes (`item.name ?? item.text`). Do NOT weaken existing assertions.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/activity.ts src/lib/activity.test.ts
git commit -m "gis: capture reasoning + structured tool payloads; derive reasoning/timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `format-value.ts` (TDD)

**Files:**
- Create: `src/lib/format-value.ts`
- Create: `src/lib/format-value.test.ts`

**Interfaces produced:** `formatValue(v: unknown, max?: number): string`

- [ ] **Step 1: Write failing tests.** Create `src/lib/format-value.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatValue } from './format-value'

describe('formatValue', () => {
  it('passes strings through', () => { expect(formatValue('hello')).toBe('hello') })
  it('pretty-prints objects', () => { expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}') })
  it('renders null/undefined as a dash', () => {
    expect(formatValue(null)).toBe('—')
    expect(formatValue(undefined)).toBe('—')
  })
  it('truncates very long values with an ellipsis marker', () => {
    const out = formatValue('x'.repeat(5000), 100)
    expect(out.length).toBeLessThan(140)
    expect(out).toContain('…')
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/lib/format-value.test.ts`.

- [ ] **Step 3: Implement `src/lib/format-value.ts`:**

```ts
/** Render an arbitrary tool arg/result value as readable text for the trace UI.
 * Strings pass through; objects are pretty-printed JSON; nullish shows a dash.
 * Long output is truncated with an ellipsis marker (default cap 2000 chars). */
export function formatValue(v: unknown, max = 2000): string {
  if (v === null || v === undefined) return '—'
  let s: string
  if (typeof v === 'string') s = v
  else {
    try { s = JSON.stringify(v, null, 2) } catch { s = String(v) }
  }
  return s.length > max ? s.slice(0, max) + '\n… (truncated)' : s
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/lib/format-value.test.ts`.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/format-value.ts src/lib/format-value.test.ts
git commit -m "gis: add formatValue helper for trace arg/result rendering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `TraceStep.tsx` — expandable tool step (TDD component)

**Files:**
- Create: `src/components/TraceStep.tsx`
- Create: `src/components/TraceStep.test.tsx`

**Interfaces:**
- Consumes: `BuildStep` (Task 1), `formatValue` (Task 2)
- Produces: `TraceStep({ step }: { step: BuildStep })`

- [ ] **Step 1: Write failing test.** Create `src/components/TraceStep.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceStep } from './TraceStep'

describe('TraceStep', () => {
  const step = { id: 1, label: 'query', status: 'done' as const, context: 'running vql', args: { sql: 'SELECT 1' }, result: { rows: 3 }, durationS: 1.2 }
  it('shows the name and context collapsed, hides args/result until expanded', () => {
    render(<TraceStep step={step} />)
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText(/running vql/)).toBeInTheDocument()
    expect(screen.queryByText(/SELECT 1/)).not.toBeInTheDocument()
  })
  it('reveals args and result on click', () => {
    render(<TraceStep step={step} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/SELECT 1/)).toBeInTheDocument()
    expect(screen.getByText(/"rows": 3/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/components/TraceStep.test.tsx`.

- [ ] **Step 3: Implement `src/components/TraceStep.tsx`:**

```tsx
import { useState } from 'react'
import type { BuildStep } from '../lib/activity'
import { formatValue } from '../lib/format-value'

export function TraceStep({ step }: { step: BuildStep }) {
  const [open, setOpen] = useState(false)
  const hasDetail = step.args !== undefined || step.result !== undefined || !!step.summary
  return (
    <div className="border-b border-hairline last:border-b-0 py-1">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(o => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${step.status === 'done' ? 'border-accent bg-accent/15' : 'border-hairline-strong'}`}>
          {step.status === 'done'
            ? <span className="text-[10px] text-accent">✓</span>
            : <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-accent" style={{ animation: 'gc-pulse-dot .9s ease-in-out infinite' }} />}
        </span>
        <span className="font-mono text-[11.5px] text-primary">{step.label}</span>
        {step.context ? <span className="min-w-0 flex-1 truncate font-sans text-[11px] text-tertiary">{step.context}</span> : <span className="flex-1" />}
        {step.durationS != null ? <span className="shrink-0 font-mono text-[10px] text-tertiary">{step.durationS.toFixed(1)}s</span> : null}
        {hasDetail ? <span className="shrink-0 font-mono text-[10px] text-tertiary">{open ? '▾' : '▸'}</span> : null}
      </button>
      {open ? (
        <div className="mt-1 flex flex-col gap-1.5 pl-6">
          {step.summary ? <div className="font-sans text-[11px] text-secondary">{step.summary}</div> : null}
          {step.args !== undefined ? (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">args</div>
              <pre className="overflow-x-auto rounded-gc-sm bg-surface-raised p-2 font-mono text-[10.5px] text-primary">{formatValue(step.args)}</pre>
            </div>
          ) : null}
          {step.result !== undefined ? (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">result</div>
              <pre className="overflow-x-auto rounded-gc-sm bg-surface-raised p-2 font-mono text-[10.5px] text-primary">{formatValue(step.result)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/components/TraceStep.test.tsx`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/TraceStep.tsx src/components/TraceStep.test.tsx
git commit -m "gis: TraceStep — expandable tool step showing context/args/result/duration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `AgentTimeline.tsx` — chronological inspector body (TDD component)

**Files:**
- Create: `src/components/AgentTimeline.tsx`
- Create: `src/components/AgentTimeline.test.tsx`

**Interfaces:**
- Consumes: `TimelineEvent` (Task 1), `TraceStep` (Task 3)
- Produces: `AgentTimeline({ timeline }: { timeline: TimelineEvent[] })`

- [ ] **Step 1: Write failing test.** Create `src/components/AgentTimeline.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentTimeline } from './AgentTimeline'
import type { TimelineEvent } from '../lib/activity'

describe('AgentTimeline', () => {
  it('renders reasoning, tool, and message events in order', () => {
    const timeline: TimelineEvent[] = [
      { id: 1, kind: 'reasoning', text: 'thinking about it' },
      { id: 2, kind: 'tool', step: { id: 2, label: 'query', status: 'done', result: { rows: 1 } } },
      { id: 3, kind: 'message', role: 'agent', text: 'here you go' }
    ]
    render(<AgentTimeline timeline={timeline} />)
    expect(screen.getByText(/thinking about it/)).toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText(/here you go/)).toBeInTheDocument()
  })
  it('shows an empty hint when there are no events', () => {
    render(<AgentTimeline timeline={[]} />)
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/components/AgentTimeline.test.tsx`.

- [ ] **Step 3: Implement `src/components/AgentTimeline.tsx`:**

```tsx
import type { TimelineEvent } from '../lib/activity'
import { TraceStep } from './TraceStep'

export function AgentTimeline({ timeline }: { timeline: TimelineEvent[] }) {
  if (!timeline.length) {
    return <div className="py-6 text-center font-sans text-xs text-tertiary">No activity yet.</div>
  }
  return (
    <div className="flex flex-col gap-2">
      {timeline.map(ev => {
        if (ev.kind === 'reasoning') {
          return (
            <div key={ev.id} className="rounded-gc-md border border-hairline bg-surface-raised/50 p-2.5">
              <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wide text-tertiary">thinking</div>
              <div className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-secondary">{ev.text}</div>
            </div>
          )
        }
        if (ev.kind === 'tool') {
          return (
            <div key={ev.id} className="rounded-gc-md border border-hairline bg-surface px-2.5 py-1">
              <TraceStep step={ev.step} />
            </div>
          )
        }
        if (ev.kind === 'error') {
          return (
            <div key={ev.id} className="rounded-gc-sm border border-negative/40 bg-negative/10 px-2.5 py-1.5 font-mono text-[11px] text-negative">
              {ev.text}
            </div>
          )
        }
        return (
          <div key={ev.id} className={ev.role === 'user' ? 'flex justify-end' : 'flex'}>
            <div className={ev.role === 'user'
              ? 'max-w-[86%] rounded-[12px_12px_3px_12px] bg-accent px-3 py-2 font-sans text-[12.5px] text-accent-fg'
              : 'max-w-[86%] rounded-[3px_12px_12px_12px] border border-hairline bg-surface px-3 py-2 font-sans text-[12.5px] text-primary'}>
              {ev.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run, confirm GREEN.** `npx vitest run src/components/AgentTimeline.test.tsx`.

- [ ] **Step 5: Commit.**

```bash
git add src/components/AgentTimeline.tsx src/components/AgentTimeline.test.tsx
git commit -m "gis: AgentTimeline — chronological structured inspector over the event timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `AgentPanel.tsx` — expandable steps, thinking disclosure, inspector toggle

Add the new capabilities behind **additive optional props** (`reasoning`, `timeline`) so the build stays green before `App.tsx` (Task 6) passes them. Keep the existing `messages`/`trace`/`errors`/`connected`/`onSend`/`open`/`onClose` props.

**Files:**
- Modify: `src/components/AgentPanel.tsx`
- Create: `src/components/AgentPanel.test.tsx`

**Interfaces:**
- Consumes: `TraceStep` (Task 3), `AgentTimeline` (Task 4), `ReasoningItem`/`TimelineEvent` (Task 1)

- [ ] **Step 1: Write failing test.** Create `src/components/AgentPanel.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPanel } from './AgentPanel'
import type { BuildStep, TimelineEvent, ReasoningItem } from '../lib/activity'

const trace: BuildStep[] = [{ id: 1, label: 'query', status: 'done', args: { sql: 'x' } }]
const reasoning: ReasoningItem[] = [{ id: 2, text: 'my plan' }]
const timeline: TimelineEvent[] = [{ id: 2, kind: 'reasoning', text: 'my plan' }, { id: 1, kind: 'tool', step: trace[0] }]

function renderPanel() {
  return render(
    <AgentPanel open onClose={() => {}} messages={[]} trace={trace} reasoning={reasoning} timeline={timeline} errors={[]} connected onSend={() => {}} />
  )
}

describe('AgentPanel', () => {
  it('exposes reasoning via a thinking disclosure', () => {
    renderPanel()
    expect(screen.getByText(/my plan/)).toBeInTheDocument()
  })
  it('toggles to the inspector timeline', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /inspector/i }))
    // timeline renders the tool step name
    expect(screen.getAllByText('query').length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run, confirm RED.** `npx vitest run src/components/AgentPanel.test.tsx`.

- [ ] **Step 3: Implement.** In `AgentPanel.tsx`:

Update imports + props:
```tsx
import { useEffect, useRef, useState } from 'react'
import type { BuildStep, ChatMessage, ReasoningItem, TimelineEvent } from '../lib/activity'
import { TraceStep } from './TraceStep'
import { AgentTimeline } from './AgentTimeline'
```
```tsx
export function AgentPanel({
  open, onClose, messages, trace, reasoning = [], timeline = [], errors, connected, onSend
}: {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  trace: BuildStep[]
  reasoning?: ReasoningItem[]
  timeline?: TimelineEvent[]
  errors: string[]
  connected: boolean
  onSend: (text: string) => void
}) {
```

Add local state near the other hooks:
```tsx
  const [inspector, setInspector] = useState(false)
  const [showThinking, setShowThinking] = useState(false)
```

In the header (the `flex … justify-between … border-b` block), add an inspector toggle button next to the close button:
```tsx
          <button
            type="button"
            onClick={() => setInspector(v => !v)}
            aria-pressed={inspector}
            className={`rounded-gc-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${inspector ? 'border-accent text-accent' : 'border-hairline text-tertiary hover:text-primary'}`}
          >
            Inspector
          </button>
```
(place it just before the existing close `✕` button, inside the header's right-hand group — wrap the two in a `flex items-center gap-2` if needed.)

Replace the scrolling body. The current body renders `messages`, then the `trace` block, then `errors`. Wrap it so the inspector view swaps in:
```tsx
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-4 py-3.5">
          {inspector ? (
            <AgentTimeline timeline={timeline} />
          ) : (
            <>
              {messages.map(m => (
                /* … existing message-bubble JSX unchanged … */
              ))}

              {reasoning.length ? (
                <div className="rounded-gc-md border border-hairline bg-surface-raised/50">
                  <button
                    type="button"
                    onClick={() => setShowThinking(s => !s)}
                    className="flex w-full items-center justify-between px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-tertiary"
                  >
                    <span>Thinking ({reasoning.length})</span>
                    <span>{showThinking ? '▾' : '▸'}</span>
                  </button>
                  {showThinking ? (
                    <div className="flex flex-col gap-2 px-3 pb-2.5">
                      {reasoning.map(r => (
                        <div key={r.id} className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-secondary">{r.text}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {trace.length ? (
                <div className="rounded-gc-md border border-hairline bg-surface p-3">
                  <div className="mb-1 font-mono text-[9.5px] tracking-[.1em] text-tertiary">FORMULATING CANVAS</div>
                  {trace.map(step => <TraceStep key={step.id} step={step} />)}
                </div>
              ) : null}

              {errors.map((e, i) => (
                /* … existing error JSX unchanged … */
              ))}
            </>
          )}
        </div>
```
Keep the suggested-prompts row and the input row below, unchanged.

- [ ] **Step 4: Run, confirm GREEN + full suite.** `npx vitest run src/components/AgentPanel.test.tsx` then `npx vitest run` (all pass) and `npm run typecheck` (clean — the new props are optional, so existing `App.tsx` usage still compiles).

- [ ] **Step 5: Commit.**

```bash
git add src/components/AgentPanel.tsx src/components/AgentPanel.test.tsx
git commit -m "gis: AgentPanel — expandable trace steps, thinking disclosure, inspector toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `App.tsx` — capture reasoning + structured payloads, feed the panel

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `activityItemFromEvent`, `deriveActivity`, `DerivedActivity` (Task 1); AgentPanel's `reasoning`/`timeline` props (Task 5)

- [ ] **Step 1: Subscribe to reasoning + capture structured items.** In `App.tsx`:

Add `reasoning.available` to the logged set:
```tsx
const LOGGED_EVENTS = new Set(['message.delta', 'message.complete', 'tool.start', 'tool.complete', 'reasoning.available', 'error'])
```
Import the mapper:
```tsx
import { deriveActivity, activityItemFromEvent, type ActivityItem } from './lib/activity'
```
Change `log` to append a full item, and the `onAny` handler to use the mapper:
```tsx
  const log = (item: Omit<ActivityItem, 'id'>) =>
    setActivity(prev => [...prev.slice(-199), { id: nextId.current++, ...item }])
```
```tsx
    const off = client.onAny((event: { type?: string; payload?: unknown }) => {
      const type = event?.type ?? ''
      if (!LOGGED_EVENTS.has(type)) return
      log(activityItemFromEvent(type, event.payload as Record<string, unknown> | undefined))
    })
```
Update the other `log(...)` call sites to the object form:
- session ready: `log({ kind: 'system', text: \`session ${created.session_id} ready\` })`
- connect/send error catches: `log({ kind: 'error', text: err instanceof Error ? err.message : String(err) })`
- user prompt in `send`: `log({ kind: 'you', text })`

- [ ] **Step 2: Feed the panel.** The derived value already exists:
```tsx
  const { messages, trace, isBusy } = useMemo(() => deriveActivity(activity), [activity])
```
Change it to keep the whole object and destructure what the shell needs:
```tsx
  const derived = useMemo(() => deriveActivity(activity), [activity])
  const { messages, trace, isBusy } = derived
```
Pass reasoning + timeline to the panel (existing props unchanged):
```tsx
      <AgentPanel
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        messages={messages}
        trace={trace}
        reasoning={derived.reasoning}
        timeline={derived.timeline}
        errors={errors}
        connected={connected}
        onSend={send}
      />
```

- [ ] **Step 3: Verify.** `npm run typecheck` (clean) and `npx vitest run` (all pass — `App.test.tsx` must stay green; if it asserted on the old `log` signature it does not — `log` is internal). Confirm no other `log(` call sites remain in the old `(kind, text, toolId)` form: `grep -n "log(" src/App.tsx`.

- [ ] **Step 4: Visual check.** In the running app, open the AgentPanel: tool steps expand to show args/result; a "Thinking" disclosure appears when the agent reasons; the Inspector toggle shows the ordered timeline. Light + dark.

- [ ] **Step 5: Commit.**

```bash
git add src/App.tsx
git commit -m "gis: capture reasoning.available + structured tool payloads; feed AgentPanel inspector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** capture reasoning + structured tool fields → Task 1 (`activityItemFromEvent`) + Task 6 (wiring); enriched derivation (reasoning + timeline + enriched trace) → Task 1; formatted values → Task 2; expandable steps → Task 3 + Task 5; inspector timeline → Task 4 + Task 5 toggle; thinking disclosure → Task 5. All spec sections covered. Non-goals respected (no gateway edits, no raw-JSON/copy, no loop-detection, no delta streaming).
- **Placeholder scan:** no TBD/TODO; every code step shows real code. The two "… existing JSX unchanged …" markers in Task 5 reference the current file's message-bubble and error blocks, which the implementer keeps verbatim — not placeholders for new code.
- **Type consistency:** `ActivityItem`/`BuildStep` extra fields (`context/args/result/summary/durationS`) match across Tasks 1/3/5; `activityItemFromEvent` returns `Omit<ActivityItem,'id'>` consumed by Task 6's `log`; `DerivedActivity.reasoning`/`timeline` produced in Task 1 and consumed in Tasks 4/5/6; `TimelineEvent` union kinds (`reasoning|tool|message|error`) identical in Tasks 1/4.
- **Green at each task:** Tasks 1–4 add new modules/keep existing exports; Task 5 uses additive optional props; Task 6 wires them. Typecheck holds throughout.
