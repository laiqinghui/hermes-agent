# Session browser — open past and foreign Hermes sessions in Thoughts Canvas

**Date:** 2026-09-02
**Status:** approved design, ready for planning
**Continues:** the Thoughts Canvas SPA (`apps/gis-canvas`) + BFF (`apps/gis-canvas-bff`)

## Problem

Thoughts Canvas creates a brand-new gateway session every time it loads
([`App.tsx:91`](../src/App.tsx) calls `session.create` unconditionally) and offers no way to
reach any other session. Two things are therefore invisible:

1. **Your own past canvases.** `CanvasStore` already persists one JSON doc per session under
   `~/.hermes/gis_canvas/`, explicitly so they survive gateway restarts. Those docs are on disk
   right now and nothing can open them.
2. **Every session from another surface.** Hermes records all sessions — Telegram, Discord, CLI,
   TUI, ACP, cron — in the shared `state.db` registry. A research session run from the CLI has a
   full transcript, including reasoning, that the canvas could visualise and build on.

## Goals

- Browse and reopen sessions, own and foreign, from inside Thoughts Canvas.
- Reconstruct a best-effort chain of thought from a foreign transcript and show it in the
  expanded dock, reusing the cognition UI that already exists.
- Let the model decide whether a foreign session warrants a canvas, and render one when it does.
- Let the user continue from a foreign session without ever mutating the original.

## Non-goals

- Editing, deleting, renaming or archiving sessions from the canvas.
- Per-user session ownership or filtering (see **Access control**).
- Live-following a session that is currently running on another surface.
- A cheap "peek" preview that avoids spending an agent turn — see **Backlog**.

## Established facts (verified in the codebase, 2026-09-02)

These shaped the design; re-verify before contradicting any of them.

- The SPA's socket (`ws://127.0.0.1:9119/api/ws`) is the dashboard gateway, and
  `hermes_cli/web_server.py:12797` hands it to `tui_gateway.ws.handle_ws`, which "reuses
  `tui_gateway.server.dispatch` **verbatim** so every RPC method" is reachable. `session.list`,
  `session.resume`, `session.branch`, `session.history` are all allowlisted there.
- `session.list` (`tui_gateway/server.py:5037`) deliberately spans every user-facing surface; it
  deny-lists only `tool` (sub-agent runs) rather than allow-listing platform names.
- **`session.history` requires a LIVE session** (`_sess_nowait`), not an arbitrary DB id.
- **`session.resume` MUTATES the target** — it reopens the session and claims an active slot.
  Unusable for read-only browsing.
- **`session.branch` requires a live in-memory session** and copies the parent's `source`
  (`server.py:7780`), so it cannot fork a dormant foreign session as-is.
- Read-only REST already exists on the gateway: `GET /api/sessions`,
  `GET /api/sessions/{id}/messages`, plus `/search`, `/stats`, `/export`.
- The `messages` table carries `role`, `content`, `tool_calls`, `tool_name`, `timestamp` and
  `reasoning` / `reasoning_content` / `reasoning_details`.
- `CanvasStore` (`plugins/gis-canvas/store.py`) keys docs by session id, persists one JSON per
  key, and has `get`/`put`/`reset` but **no `list()`**.
- The plugin exposes exactly **two** canvas RPCs, `canvas.interaction` and `canvas.data_fetch`
  (`tui_gateway/server.py:13783`), both delegating to `plugins/gis-canvas/wire.py`. **There is no
  way to read a stored canvas doc back** — the SPA only ever receives a doc pushed live by the
  agent during a turn.
- The BFF's `POST /auth/bind` maps the browser's OIDC `sid` cookie to a list of canvas session
  ids; the A2A proxy authorises Denodo access off that binding.

## Phases

The work ships in three phases, each independently useful:

- **A — Picker.** List sessions; reopen your own past canvases.
- **B — Reconstruction.** Foreign transcript → chain of thought in the expanded dock.
- **C — Judgement.** The model decides whether to render a canvas, and does.

## Architecture

### 1. Data path and access control

Listing and transcript reads go through the **BFF**, not the gateway WS directly.

```
SPA :5174  ──►  BFF :9109  ──►  gateway :9119 REST
                  │              GET /api/sessions
                  │              GET /api/sessions/{id}/messages
                  └─ OIDC sid required; visibility rule applied here
```

`session.list` over the existing socket would need zero backend code, but it applies no
authorization and the SPA is cross-origin to `:9119`. The BFF already terminates OIDC and
already proxies for the SPA, so both problems disappear by routing there.

Two new BFF routes, both **read-only**:

- `GET /sessions?limit=&offset=&q=` → proxies `/api/sessions`
- `GET /sessions/{id}/messages` → proxies `/api/sessions/{id}/messages`

Both require an authenticated `sid` (401 otherwise), mirroring `/auth/bind`.

**Browsing must never mutate a session.** `session.resume` and `session.branch` are explicitly
not on this path.

**Access control (v1): any authenticated user may see every session on the host.** This matches
the current single-operator deployment. It is a deliberate, stated choice, not an oversight:
there is no OIDC-subject column on `sessions`, and the existing `user_id` is platform-scoped (a
Telegram user id, say), so per-user filtering would require a new identity mapping. The rule is
isolated in one function — `visible_sessions(rows, principal)` in the BFF — so tightening it
later is a change in one place with its own test.

### 2. Session picker (Phase A)

A `SessionPicker` overlay, opened from a `TopBar` button, following the existing overlay
pattern. Each row shows title-or-preview, source badge, message count, and last activity, from
the fields `list_sessions_rich` already returns. Rows are marked:

- **Canvas** — a stored canvas doc exists for this id (own past session; opens instantly).
- **Transcript** — no canvas doc (foreign; goes through phases B and C).

#### Reading a stored canvas back

Nothing today can read a stored canvas doc — the SPA only ever receives docs pushed live by the
agent mid-turn. Phase A therefore adds a read path, mirroring the two existing canvas RPCs
exactly (`tui_gateway/server.py` `@method` delegating to `wire.py`, which calls the store):

- `canvas.list` → `handle_canvas_list()` → `CanvasStore.list() -> list[str]`, the stored keys.
  Feeds the picker's Canvas/Transcript marking, fetched once per picker open.
- `canvas.get {session_id}` → `handle_canvas_get()` → `CanvasStore.get(key)`, the stored doc or
  `null`.

Both are read-only. Because they live in `tui_gateway/server.py`, **Phase A requires a gateway
restart to verify** — unlike the SPA-only work in Phase B.

Opening an own past session fetches its doc via `canvas.get`, renders it, resumes the session so
it can be continued (`session.resume` — mutation is correct here; it is the user's own session
and continuing it is the intent), and binds it via `bindSessions()` as a fresh session is bound
today. The composer stays live.

**Session ids are untrusted display data.** Titles and previews come from other surfaces and
other users; they are rendered as text, never as markup or instructions.

### 3. Transcript reconstruction (Phase B)

A pure adapter in `src/lib/transcript.ts`:

```ts
export interface MessageRow {
  role: string
  content: string | null
  tool_calls: string | null
  tool_name: string | null
  reasoning: string | null
  reasoning_content: string | null
  timestamp: number
}

export function transcriptToTurns(rows: MessageRow[]): Turn[]
```

The row shape maps onto the existing `Turn` (`src/lib/activity.ts:41`):

| `Turn` field | Source |
|---|---|
| `prompt` | `role='user'` content that opens the turn |
| `reasoning` | `reasoning` ?? `reasoning_content` on assistant rows |
| `trace` | `tool_calls` / `tool_name`, one `BuildStep` per call |
| `answers` | `role='assistant'` content |
| `isBusy` | always `false` — a replayed turn is never in flight |

Feeding the result to the existing `AgentPanel` makes the whole cognition UI — `TurnView`,
`TraceStep`, per-turn trace, narration spotlight — work on a foreign transcript with **no new
cognition components**.

**Best-effort means degrading honestly.** Providers that do not persist reasoning yield turns
with tool calls and answers and no inner monologue. The adapter renders that as-is; it never
synthesises reasoning to fill the gap, and the panel states that reasoning was not recorded
rather than showing an empty section.

`AgentPanel` gains a read-only mode: the composer is replaced by a **Continue here** button.

### 4. Judgement and render (Phase C)

Opening a foreign session lazily creates a **preview session** — once per foreign session id —
and submits a synthesised prompt containing the transcript plus an instruction to judge whether
a canvas is warranted and, if so, to author one. This is an ordinary agent turn using the canvas
tools that already exist; **no new rendering machinery**.

**Transcript packing — head + tail, elided middle.** The opening exchange (what was actually
asked) and the final messages verbatim, with the middle condensed to a count and a list of tools
used. This directly serves the emphasis on the tail: an analysis lands its conclusions in the
final messages, and that is what the render decision should hinge on. Packing is a pure,
separately-tested function with an explicit character budget.

**The verdict is a first-class outcome.** "No canvas warranted — this was a debugging session"
is displayed as a stated result beside the transcript. A declined render is a success, not an
empty canvas and not an error.

Judgement fires **automatically on open, and is cached** against the foreign session id, so a
session costs one agent turn ever, and sessions never opened cost nothing.

### 5. Continue here

The fork **is the preview session, promoted** — not a separate construct:

1. `bindSessions(bffUrl, [previewSessionId])` attaches the user's OIDC identity, which is what
   authorises Denodo through the A2A proxy.
2. The composer unlocks.

It already holds the full transcript (submitted as its opening context) and the rendered canvas,
which is exactly the inheritance required. The original foreign session is never reopened, never
appended to, and its `end_reason` is never changed.

### 6. Storage and caching

Preview canvases are stored in the existing `CanvasStore` under a derived key,
`preview-<foreign_session_id>`, so they survive gateway restarts and reopening is instant. The
derived prefix keeps them distinguishable from canvases owned by a real canvas session.

The cached record holds three things beside the doc:

- `verdict` — `rendered` or `declined`, with the model's one-line reason, so a declined session
  is remembered too and never re-spends a turn.
- `preview_session_id` — the gateway session created for this foreign session. **This is the
  foreign-id → preview-id mapping**, and it is what makes "lazily once" work across a page
  reload: reopening finds the record, reuses the recorded session, and skips the turn.
- `source_session_id` — the foreign session it was built from, for provenance in the UI.

A preview record whose `preview_session_id` no longer exists in `state.db` (pruned, deleted) is
treated as a cache miss for **Continue here** only: the doc and verdict still display, and
continuing creates a fresh preview session and re-submits the transcript. Displaying must never
require the session to still exist.

## Testing

- `transcriptToTurns` — table-driven over real row shapes: a plain Q&A turn; a turn with tool
  calls; a turn with reasoning; the **degraded no-reasoning case**; interleaved multi-turn;
  malformed `tool_calls` JSON (skipped, not thrown).
- Transcript packing — under budget passes through whole; over budget keeps the head and the
  tail and elides the middle; the tail is never truncated in favour of the head.
- `CanvasStore.list()` — returns stored keys, ignores unrelated files, tolerates an empty dir.
- `handle_canvas_get` / `handle_canvas_list` — a stored key round-trips; an unknown key returns
  `null` rather than raising; neither writes to the store.
- BFF routes — 401 unauthenticated; authenticated proxies and returns rows; `visible_sessions`
  has its own test so the v1 rule is explicit and a future change is a visible diff.
- `SessionPicker` — renders rows; marks canvas vs transcript; renders a hostile title as text.
- `AgentPanel` read-only mode — no composer, Continue here present and wired.

The judgement itself is a **live-verify item**; it cannot be meaningfully unit-tested. Live
verification must cover: a research/analysis session renders a canvas; a debugging session is
declined with a reason; a foreign session with no persisted reasoning still shows a usable
chain of thought; Continue here works and leaves the original session untouched (verify
`ended_at` / `end_reason` / message count are unchanged in `state.db`).

## Accepted simplifications

- Any authenticated user sees every session on the host (stated above).
- The picker is a flat list with search; no grouping by source, project or date.
- Preview sessions accumulate in `state.db` like any other session.
- No live-following of a session running elsewhere; the view is a snapshot at open.

## Backlog (out of scope)

- **Peek.** Phase C spends a full agent turn with a long transcript in context the first time a
  foreign session is opened — cached, so once per session, but a user browsing out of curiosity
  pays it. A "peek" mode would show the reconstructed chain of thought and a cheap local summary
  *without* the judgement turn, promoting to a full render only on request. Deliberately
  deferred: it needs real usage data to know whether the automatic render is worth its cost.
- Per-user session visibility, once an OIDC-subject → session mapping exists.
- Grouping and filtering in the picker (by source, project, cwd, date).
