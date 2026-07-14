# GIS Canvas — Workstream A: Agent-Trace Observability

**Design spec.** 2026-07-14. Frontend-only enhancement of the Phase 6 / WS1 AgentPanel
(`apps/gis-canvas/`). Surfaces the agent's reasoning and full tool inputs/outputs that the gateway
already emits but the SPA currently discards. Motivated by needing to debug why the agent loops
(that fix is a separate backend concern — see *Non-goals*).

## Context

The AgentPanel's "FORMULATING CANVAS" trace shows only tool *names* because `deriveActivity`
(`src/lib/activity.ts`) keeps only `{id, kind, text, toolId}` per event and extracts the tool name.
But the gateway already sends far more over the same websocket (`tui_gateway/server.py`):

- `_on_tool_start` → **`tool.start`** `{ tool_id, name, context, args_text? (verbose) }`
- `_on_tool_complete` → **`tool.complete`** `{ tool_id, name, args, result, summary, duration_s, result_text? (verbose), inline_diff?, todos? }` — note `args`, `result`, `summary`, `duration_s`, and `context` are sent **regardless of verbose**.
- `_on_tool_progress` → **`reasoning.available`** `{ text }` — the agent's thoughts; emitted whenever the session's tool-progress mode isn't `"off"` and the model produces reasoning.
- `message.delta` `{ text }` (streaming) and `message.complete` `{ text }`.

The SPA's `App.tsx` `onAny` handler subscribes to `LOGGED_EVENTS`
(`message.delta`, `message.complete`, `tool.start`, `tool.complete`, `error`) — **not**
`reasoning.available` — and flattens each event to a name/text summary. So the rich data is on the
wire and simply dropped. **This workstream is therefore purely frontend: capture what's already
sent, and render it.**

## Goals

Let an operator watch the agent's actual workflow — its reasoning, and each tool call's inputs and
outputs — inside the AgentPanel, without leaving the polished Phase 6 UI for normal use. Structured,
in chronological order, so a repeating loop reads plainly top-to-bottom.

## Non-goals

No gateway/agent/plugin/schema changes. No raw-JSON escape hatch or copy-to-clipboard. No automatic
loop detection or repeated-call grouping. No `message.delta` token-by-token streaming (final
`message.complete` only). **Fixing the loop itself is Workstream B** (backend/agent). Linked
map↔table selection + agent state context remain **WS2**.

## Design

### 1. Event capture — `App.tsx` + `activity.ts`

Extend the captured `ActivityItem` to retain the structured fields instead of only a text summary:

```ts
export interface ActivityItem {
  id: number
  kind: string            // 'you' | 'message.complete' | 'tool.start' | 'tool.complete'
                          // | 'reasoning.available' | 'error' | 'system'
  text: string            // human summary/label (as today)
  toolId?: string
  name?: string           // tool name
  context?: string        // tool.start/complete human context
  args?: unknown          // tool.complete args
  result?: unknown        // tool.complete result (parsed)
  summary?: string        // tool.complete summary
  durationS?: number      // tool.complete duration_s
}
```

- Add `reasoning.available` to the subscribed event set; capture `payload.text`.
- For `tool.start`/`tool.complete`, populate `name`/`context`/`args`/`result`/`summary`/`durationS`
  from the payload when present.
- The append-only ordering (and the existing `slice(-199)` cap) is unchanged — order across
  reasoning/tools/messages is the array order, which is emission order.

### 2. Derivation — `activity.ts` (pure, unit-tested)

`deriveActivity(items)` returns an extended `DerivedActivity`:

```ts
export interface DerivedActivity {
  messages: ChatMessage[]          // unchanged: user prompts + message.complete
  trace: BuildStep[]               // enriched (below)
  reasoning: ReasoningItem[]       // NEW: ordered reasoning.available texts
  timeline: TimelineEvent[]        // NEW: chronological typed stream for the inspector
  isBusy: boolean                  // unchanged: any tool still running
}

export interface BuildStep {       // enriched
  id: number
  label: string                    // tool name (as today)
  status: 'running' | 'done'
  context?: string
  args?: unknown
  result?: unknown
  summary?: string
  durationS?: number
}

export interface ReasoningItem { id: number; text: string }

export type TimelineEvent =
  | { id: number; kind: 'reasoning'; text: string }
  | { id: number; kind: 'tool'; step: BuildStep }
  | { id: number; kind: 'message'; role: 'user' | 'agent'; text: string }
  | { id: number; kind: 'error'; text: string }
```

- `trace`: same `tool_id`-first pairing (FIFO-by-name fallback) as today, but the `tool.complete`
  item's structured fields are copied onto the matching `BuildStep`. Still `slice(-8)` for the
  compact default view; the timeline keeps the full ordered set.
- `timeline`: one pass over `items` in order, emitting a typed event per reasoning / paired-tool /
  message / error. Tool events use the same paired `BuildStep` (so a tool card shows its result once
  complete).

### 3. Rendering — AgentPanel + focused child components

- **Default view (polished, unchanged language):** conversation + the compact step list, but each
  step is an **expandable `TraceStep`** — clicking reveals `context`, args-in / result-out
  (formatted), and duration. A subtle collapsible **"thinking"** disclosure shows `reasoning`.
- **Inspector toggle:** a small control in the panel header switches the body to **`AgentTimeline`** —
  the chronological `timeline` rendered as structured cards (reasoning / tool (reusing `TraceStep`) /
  message / error), in emission order.
- **New files** (keep `AgentPanel.tsx` lean):
  - `src/components/TraceStep.tsx` — the expandable tool step (name + context header; expand →
    formatted args/result/duration). Reused in both views.
  - `src/components/AgentTimeline.tsx` — the inspector body over `timeline`.
  - `src/lib/format-value.ts` — `formatValue(v: unknown): string` renders an arg/result value as
    readable text (objects → pretty JSON via `JSON.stringify(v, null, 2)`; strings passthrough;
    truncate very long values with an indication).
- `AgentPanel` prop change: receive the whole `DerivedActivity` (or add `reasoning`/`timeline`)
  instead of just `messages`/`trace`; view-mode and per-step expand state are local `useState`.

## Testing

- `activity.test.ts` (extend, TDD): reasoning items captured in order; a completed tool step carries
  `args`/`result`/`durationS`; `timeline` interleaves reasoning + tool + message events in emission
  order; start/complete still pair by `tool_id` (existing cases stay green).
- `format-value.test.ts` (TDD): object → pretty JSON; string passthrough; long value truncated.
- `TraceStep` component test: collapsed shows name/context; after click shows formatted args/result.
- `AgentPanel` component test: the inspector toggle switches from the default view to the timeline
  (a reasoning card / tool card present after toggling).

## Success criteria

In a real run, the AgentPanel's default view lets you expand any tool step to see its inputs and
outputs and shows the agent's reasoning; the inspector toggle shows the full run as an ordered
structured timeline — enough to read a repeating tool loop directly. No gateway changes; existing
tests stay green.
