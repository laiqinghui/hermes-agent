# GIS Canvas — Trace-Rendering Parity (WS-A2)

**Design spec.** 2026-07-14. Frontend-only follow-up to WS-A (agent-trace observability). Renders the
AgentPanel trace like the **Hermes official dashboard**: structured `Label: summary` fields instead of
raw JSON, humanized tool headers with a field count, reconstructed tool nesting, and a heading on each
Thinking card. No gateway/agent/plugin/schema changes.

## Context

WS-A surfaced the agent's reasoning + tool inputs/outputs, but `TraceStep` renders `args`/`result` as a
raw `JSON.stringify` blob in a `<pre>`. The user wants the Hermes dashboard's structured rendering
instead (`Schema: 6 items (2 fields)`, `RowCount: 20`, `Sample: 3 items (6 fields)`).

**Confirmed against the running stack (same "GREY LADY" prompt):**

- The gateway already sends everything needed (`tui_gateway/server.py`): `tool.start {tool_id, name,
  context}`, `tool.complete {tool_id, name, args, result (parsed), summary, duration_s}`,
  `reasoning.available {text}`. `context` and `summary` are already human strings.
- Real tool names our SPA receives: `skill_view`, `execute_code`, `data_query` — so the Hermes labels
  ("Skill View", "Data Query") are just snake_case → Title Case. No hardcoded name map.
- For this prompt the tool calls are **flat/sequential** (each completes before the next starts). The
  Hermes screenshot showed one query nested (`Data Discover › Data Query`); nesting is therefore an
  occasional shape, not the norm. Our reconstruction must render flat correctly and nest only when
  tools genuinely overlap.
- `"N items"` in the Hermes header = the payload's top-level field count (`Data Query 6 items` =
  Handle/Schema/RowCount/Sample + 2 more).
- The gateway sends **no** reasoning heading — only the body. The Hermes "Exploring vessel positions"
  heading is derived by its UI. The user approved deriving ours frontend-side.

## Goals

Make the AgentPanel trace read like the Hermes dashboard: each tool step is a card with a humanized
name + field count + the gateway's human summary; expanding it shows structured `Label: summary` rows
(recursively expandable) rather than JSON; nested tool calls indent under their parent; each Thinking
block carries a short derived heading. Frontend-only; existing WS-A behavior and tests preserved.

## Non-goals

No gateway/agent/plugin/schema changes (no `parent_id`/skill-boundary emission — nesting is
reconstructed on the client). No raw-JSON escape hatch / copy button (unchanged from WS-A). No loop
detection or repeated-call grouping (that repeating `execute_code`/`data_query` is workstream B). No
change to the inspector-toggle / thinking-disclosure UX shell from WS-A — only what those views render.

## Design

### 1. `lib/humanize.ts` (pure, unit-tested)

`humanizeToolName(name: string): string` — snake/kebab/camel → Title Case
(`skill_view` → "Skill View", `execute_code` → "Execute Code", `data_query` → "Data Query"). Falls back
to the raw name if empty.

### 2. `lib/summarize-value.ts` (pure, unit-tested)

`summarizeValue(v: unknown): string` — the one-line summary shown to the right of a label / in a header:

- `null`/`undefined` → `—`
- string → the string, truncated to ~80 chars with `…`
- number/boolean → `String(v)`
- array → `` `${n} item${n===1?'':'s'}` `` plus, when the first element is a non-null object,
  `` ` (${Object.keys(first).length} fields)` `` → `6 items (2 fields)`
- object → `` `${k} field${k===1?'':'s'}` `` where `k = Object.keys(v).length`

`fieldCount(v: unknown): number` — top-level field/element count for the header `N items`
(object → key count; array → length; scalar → 0).

`toRows(v: unknown): { label: string; value: unknown }[]` — for an object, `[{label: humanizeKey(key),
value}]` per own-enumerable key (preserving insertion order); for an array, `[{label: '[i]', value}]`
per element; for a scalar, `[]`. `humanizeKey` Title-cases the key but preserves already-Cased keys
(`RowCount` stays `RowCount`, `row_count` → `Row Count`).

### 3. `components/StructuredValue.tsx`

Renders a value as labeled rows. For each row from `toRows`:

- **scalar value** → `Label`  ·  `summarizeValue(value)` inline (monospace value, no toggle).
- **object/array value** → `Label`  ·  `summarizeValue(value)` with a `▸`/`▾` toggle; expanding renders
  `<StructuredValue value={value} />` recursively, indented. Local `useState` per row for expand.
- A scalar passed at the top level (no rows) renders `summarizeValue(v)` directly.

Depth is naturally bounded by user clicks; a `depth` prop caps auto-work at, say, 6 to avoid pathological
nesting, rendering deeper values as their summary string only.

### 4. Nesting in `lib/activity.ts` — `BuildStep.children` via an open-tool stack

`deriveActivity` gains tool-tree reconstruction. `BuildStep` adds `children?: BuildStep[]` and
`depth: number`. Maintain a stack of open steps:

- on `tool.start`: create the step; if the stack is non-empty, push it onto `stack.top.children` (and
  set `depth = stack.length`); else push to the top-level `trace`. Then push the step on the stack.
- on `tool.complete`: pop the matching open step (by `tool_id`, else FIFO-by-name **within the open
  stack**) and enrich it (as today). If it isn't the stack top (out-of-order completion), still enrich
  by id and remove it from the stack.

Because our observed stream is flat (start→complete with no overlap), every step lands at the top level
with empty `children` — identical to today's flat render. Nesting appears only when a `tool.start`
arrives while another tool is still open.

`trace` stays the top-level list (the flat `slice(-8)` compact view keeps working — it just shows
top-level steps). `timeline` tool events reference the same top-level `BuildStep` objects, so a nested
tool renders its subtree inside the timeline card too. Reasoning/message events stay at emission order
in the timeline (Hermes shows Thinking between tool groups at the top level — matches).

### 5. `lib/derive-heading.ts` (pure, unit-tested)

`deriveHeading(text: string): string` — a short title from reasoning body: first non-empty line if it
is ≤ ~60 chars and has no sentence-ending punctuation mid-string; else the first sentence/clause
truncated to ~60 chars. Never longer than the body; returns `''` for empty input (caller then shows no
heading).

### 6. `components/TraceStep.tsx` (updated, tests extended)

- **Header:** status dot · `humanizeToolName(step.label)` · `` `${fieldCount(payload)} items` `` (small,
  where `payload = step.result ?? step.args`) · the gateway `context`/`summary` string (truncated) ·
  duration · expand chevron (when there is detail).
- **Expanded:** `summary` line (if present), then an **Args** section and a **Result** section, each
  `<StructuredValue value={…} />` (replacing the `<pre>{formatValue(...)}</pre>`). Omit a section whose
  value is `undefined`.
- **Children:** after the expanded detail, render `step.children` as nested `<TraceStep>` indented by
  `depth` (a left border/pad), so overlapping tools nest visually.

`formatValue`/`format-value.ts` from WS-A is retained only if still referenced; otherwise removed with
its test. (StructuredValue supersedes it for the trace.)

### 7. `components/AgentPanel.tsx` + `AgentTimeline.tsx` (updated)

- **Thinking disclosure** (AgentPanel) and **reasoning cards** (AgentTimeline): show
  `deriveHeading(text)` as a bold heading line above the body (when non-empty).
- **AgentTimeline** tool cards already render `<TraceStep>`, which now carries children — no structural
  change beyond the heading.

## Testing

- `humanize.test.ts`: `skill_view`/`execute_code`/`data_query` → Title Case; camel + kebab; empty → raw.
- `summarize-value.test.ts`: scalar summaries; `array of objects → "N items (M fields)"`; `object → "N
  fields"`; string truncation; `toRows` preserves key order and humanizes keys (`RowCount` preserved).
- `derive-heading.test.ts`: short first line kept; long paragraph → truncated first clause; empty → ''.
- `StructuredValue.test.tsx`: renders `RowCount: 20` inline; a nested array shows `3 items (6 fields)`
  collapsed and its element rows after clicking.
- `activity.test.ts` (extend): overlapping `tool.start`/`complete` nests as `children` with `depth`;
  the existing flat cases still land at top level with empty `children` (unchanged assertions stay
  green); `timeline` still interleaves reasoning/tool/message in order.
- `TraceStep.test.tsx` (extend): header shows humanized name + `N items`; expand shows structured rows
  (not a JSON blob); a step with `children` renders a nested step.
- `AgentPanel.test.tsx` / `AgentTimeline.test.tsx` (extend): a reasoning block shows its derived heading.

## Success criteria

On the live "GREY LADY" run, expanding `Data Query` shows `Handle`, `Schema: 6 items (2 fields)`,
`RowCount: 20`, `Sample: 3 items (6 fields)` as labeled rows (no JSON blob); the header reads
"Data Query · N items" with the gateway's human context; each Thinking block shows a short heading;
and if two tool calls ever overlap, the inner one indents under the outer. Existing WS-A tests stay
green; no gateway changes.
