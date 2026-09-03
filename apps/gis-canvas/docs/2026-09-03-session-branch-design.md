# Branch a session — fork your own work without touching the original

**Date:** 2026-09-03
**Status:** approved design, ready for planning
**Continues:** `2026-09-02-session-browser-design.md`

## Problem

You are deep in a session — a canvas built up over many turns — and you want to try a different
direction: a different tasking window, a different hypothesis, a different data source. Today
the only option is to keep prompting the same session, which permanently mixes the exploration
into the record you already trust.

The session browser added "Continue here" for **foreign** sessions, which promotes a preview
session. There is no equivalent for your **own** sessions: no way to fork one and leave the
original exactly as it was.

## Goals

- Fork the session you have loaded — whether you have been working in it, or just opened it
  from the picker — into a brand-new session.
- The fork carries the **full conversation context** and starts from the **same canvas**.
- The original is left byte-for-byte as it was: same canvas doc, same transcript, same
  `ended_at` / `end_reason`.
- One click. No dialog.

## Non-goals

- Renaming a branch from the canvas (the gateway auto-names it; renaming can come later).
- Visualising the branch tree, or navigating parent/child links in the picker.
- Branching a foreign session — that is what "Continue here" already does.
- Branching from a specific point in the middle of a conversation. This forks the whole thing.

## Established facts (verified in the codebase, 2026-09-03)

- **`session.branch` (`tui_gateway/server.py:7749`) is already a near-complete primitive.** It
  requires the parent to be LIVE, copies the full history into a new session, sets
  `parent_session_id` and a stable `_branched_from` marker, copies the parent's `source` and
  `cwd`, auto-titles from the lineage when given no `name`, and builds a fresh agent seeded with
  that history.
- **It leaves the parent live and untouched** — the TUI branch path deliberately does not set
  `end_reason='branched'` on the parent (that is why the `_branched_from` marker exists).
- **It returns only the runtime sid** (`{session_id, title, parent}`) — not the new stored key.
  The stored key is reachable in-process as `_sessions[new_sid]["session_key"]`.
- **`_sessions` is keyed by RUNTIME SID**, not the stored key (`_sess_nowait`,
  `server.py:1333`). `session.resume` returns both: `{session_id: <runtime sid>,
  session_key: <stored key>}`.
- `CanvasStore` keys docs by the **stored** key, so a new branch has no canvas doc at all.

## Prerequisite defect (must be fixed first)

`openOwnSession` in `App.tsx` sets `sessionIdRef.current = row.id` — the **stored** key — after
resuming. But `prompt.submit`, `approval.respond` and `session.branch` all resolve sessions by
**runtime sid** through `_sess_nowait`. So a follow-up prompt in a reopened session fails with
`4001 session not found`, and branching one would fail the same way.

The two ids must be tracked separately, exactly as the bootstrap path already does:

| ref | value | used by |
|---|---|---|
| `sessionIdRef` | runtime sid | `prompt.submit`, `approval.respond`, `canvas.branch` |
| `canvasKeyRef` | stored key | `canvas.interaction`, `canvas.get` |

`openOwnSession` must therefore record `resume.session_id` as the runtime sid and keep `row.id`
as the canvas key. This is a prerequisite, not a side quest: you cannot branch a session you
cannot address.

## Architecture

### 1. `canvas.branch` — a thin fenced RPC

The client cannot do this alone. `session.branch` never reveals the branch's stored key, so the
SPA could only discover it by polling `session.list` and matching on parent — racy, and it would
still need somewhere to copy the canvas. Extending `session.branch` itself would model the data
better but edits a core handler outside the fenced gis-canvas block, inviting upstream merge
pain. So, mirroring `canvas.judge`: a thin delegate inside the fence.

`canvas.branch {session_id}` (runtime sid of the loaded session):

1. Delegate to `_methods["session.branch"]`, which does all the real work.
2. Look up `_sessions[new_sid]["session_key"]` — the stored key the response omits.
3. Copy the parent's canvas doc under the branch's key (below).
4. Return `{session_id, stored_session_id, title, parent, doc}`.

It is **not** added to `_LONG_HANDLERS`: unlike `canvas.judge` it runs no agent turn. It does
build an agent (`_make_agent`), which `session.branch` already does synchronously today on the
normal RPC path, so its latency profile is unchanged from the existing behaviour.

### 2. `handle_canvas_branch_doc` — the canvas copy

In `plugins/gis-canvas/wire.py`:

```python
handle_canvas_branch_doc({"from_key": str, "to_key": str}) -> {"ok": True, "doc": dict | None}
```

Reads the parent's stored doc and writes it under the branch's key via `CanvasStore.put`, which
stamps it as the branch's own **rev 1**. Returns the stored doc, or `None` when the parent had
no canvas (a perfectly normal case — a conversation-only session branches fine).

The parent's doc is never written, only read. That is what makes "the original is preserved"
true rather than aspirational, and it gets its own test.

### 3. SPA

A `⑂ Branch` button in `TopBar`, rendered only when there is **something to branch** and the
session is **not** mid-turn.

"Something to branch" is not the same as "a session exists": the bootstrap creates an empty
session at startup, and `session.branch` rejects an empty history outright with
`4008 nothing to branch — send a message first`. So the button appears when the loaded session
has at least one turn — either replayed history (`opened`) or activity from this connection
(`derived.turns`) — rather than offering an action that is guaranteed to fail.

Mid-turn is excluded because branching then would copy a half-finished exchange into the fork.

On click:

1. `canvas.branch {session_id: sessionIdRef.current}`
2. `bindSessions(bffUrl, [stored_session_id, session_id])` — the same pair the bootstrap binds,
   so the branch can reach Denodo through the A2A proxy under the user's OIDC identity.
3. Point `sessionIdRef` at the runtime sid and `canvasKeyRef` at the stored key.
4. Install the returned doc via `setDoc`.
5. Replay the branch's transcript into the dock through the existing replay path, so the
   inherited context is visible immediately rather than appearing to be an empty session.
6. Log which branch you are now in, by title.

Step 5 reuses the `opened` state, which is typed around a `SessionRow` from the picker. A branch
has no picker row, so one is **synthesised** from the RPC response — `id` = stored key,
`title` = the returned title, `source` = the parent's source, `message_count` = the replayed
turn count — and `readOnly: false`, because a branch is ours to continue. Synthesising the row
here is deliberate: it keeps one replay path rather than forking the state shape for a second
kind of "loaded session".

The button is disabled while `isBusy`, and while no session is loaded.

### 4. What "preserve the original" means concretely

- The parent's canvas doc is read, never written; the branch writes only under its own key.
- The parent's transcript is copied, never appended to.
- The parent's `ended_at` and `end_reason` are never set — `session.branch`'s TUI path leaves
  them alone by design.
- The parent is **not** closed. Closing would set an end reason, and the gateway already trims
  detached idle sessions over its cap (`_schedule_session_cap_enforcement`), so there is nothing
  to clean up by hand.

## Testing

- `handle_canvas_branch_doc` — copies the doc under the new key; the branch's doc starts at
  rev 1; **the parent's doc is unchanged afterwards** (content and rev); a parent with no canvas
  returns `None` and writes nothing; missing `from_key`/`to_key` is an error.
- Registration guard — the fenced block declares `canvas.branch` alongside the other canvas RPCs,
  so an upstream merge that drops the block fails loudly.
- App — clicking Branch calls `canvas.branch`, rebinds, installs the returned doc, and replays
  the branch's transcript; the button is absent while busy and with no session loaded.
- App — reopening an own session records the RUNTIME sid (regression test for the prerequisite
  defect), asserted by a subsequent `prompt.submit` carrying that id.

Live verification is required for the parts jsdom cannot cover: that the branch actually carries
the conversation (ask it something that depends on earlier context), and that the parent's row in
`state.db` and its canvas file in `~/.hermes/gis_canvas/` are untouched afterwards.

## Accepted simplifications

- Whole-conversation fork only; no branch-from-turn-N.
- Auto-naming only; no rename from the canvas.
- No branch-tree visualisation. Branches appear in the picker as ordinary sessions (the
  `_branched_from` marker keeps them listed).
- The parent stays live after branching.
