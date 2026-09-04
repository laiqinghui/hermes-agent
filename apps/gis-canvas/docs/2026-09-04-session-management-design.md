# Session management — rename, archive, delete, and knowing where you are

**Date:** 2026-09-04
**Status:** approved design, ready for planning
**Continues:** `2026-09-02-session-browser-design.md`, `2026-09-03-session-branch-design.md`

## Problem

The session browser can open sessions but not manage them, and the canvas never says which
session you are looking at.

Both gaps compound as branching gets used: a run of exploratory branches produces
`branch`, `branch #2` … `branch #7`, all identically named, none removable from the canvas, and
with nothing on screen to tell you which one is loaded. The canvas currently shows a static
"Situation Canvas" heading regardless of what is open.

## Goals

- Rename a session from the picker.
- Remove a session — reversibly by default, permanently when explicitly confirmed.
- Show which session is currently loaded, in a way that fits the existing chrome.

## Non-goals

- Bulk operations (multi-select archive/delete).
- Restoring archived sessions from the canvas — archiving hides them here; the Hermes UI
  remains the place to bring one back.
- Editing anything about a session other than its title (model, cwd, system prompt).
- A branch tree in the picker (still deferred; see the session-browser spec's backlog).

## Established facts (verified in the codebase, 2026-09-04)

- `PATCH /api/sessions/{id}` accepts `{title, archived, profile}`. An empty/null `title` clears
  the title; `archived` soft-hides or restores (`hermes_cli/web_server.py:8204`).
- `DELETE /api/sessions/{id}` removes the session and is idempotent — an already-absent id
  returns `{"ok": true, "already_absent": true}` rather than 404.
- `list_sessions_rich` excludes archived rows by default, so archiving is sufficient to hide a
  session from the picker with no client-side filtering.
- `CanvasStore.reset(key)` already unlinks a stored canvas doc (`plugins/gis-canvas/store.py`).
- `CanvasHeader` takes only `{rev, isBusy}` and renders a hard-coded "Situation Canvas".

## Architecture

### 1. Where the mutations live

`apps/gis-canvas-bff/app/sessions_proxy.py` is documented today as read-only: *"no
resume/branch/delete endpoint may be added to this module."* That constraint exists because
**browsing** must never mutate a session — not because the module must stay read-only forever.
Rename, archive and delete are explicit, user-initiated actions and belong on the same path.

They go in the same module rather than a second one: they share the authentication, principal
lookup and gateway-proxy plumbing, and duplicating that to satisfy a naming purity argument
would be worse than restating the invariant. The module docstring changes to say precisely
what is true — **the GET routes are side-effect free; the mutating routes below are explicit
user actions** — and the read helpers stay untouched.

Three routes, each requiring an authenticated `sid` (401 otherwise):

| Route | Proxies | Purpose |
|---|---|---|
| `PATCH /sessions/{id}` `{title}` | `PATCH /api/sessions/{id}` | rename |
| `PATCH /sessions/{id}` `{archived}` | `PATCH /api/sessions/{id}` | archive / restore |
| `DELETE /sessions/{id}` | `DELETE /api/sessions/{id}` | permanent delete |

Rename and archive share one route because the gateway endpoint takes both fields; the client
sends whichever it is changing.

### 2. Picker row actions

Each row gains `Rename · Archive · Delete…`.

**Rename is inline.** The title becomes an input in place; Enter commits, Escape cancels, blur
commits. No dialog — renaming is the most frequent action and should cost one gesture. An empty
title is allowed and clears it (the gateway's documented behaviour), after which the row falls
back to its preview text exactly as an untitled session does today.

Escape and blur interact and must be resolved explicitly: pressing Escape also blurs the input,
so a naive "blur commits" handler would commit the very edit Escape just cancelled. Escape
therefore clears the editing state **before** blurring, and the blur handler commits only when
the row is still in editing state. This is the one fiddly part of the interaction and it gets
its own test.

**Archive is one click**, no confirmation. It is reversible and the row simply leaves the list.

**Delete requires confirmation**: *"Delete «title» permanently? This cannot be undone."* with
Cancel and Delete. Sessions cost hours of agent turns to produce; the cheap gesture must be the
reversible one, and the destructive one must be deliberate.

**The currently-loaded session is protected.** Its row shows a `● current` marker, and Archive
and Delete are disabled with a tooltip explaining you cannot remove the session you are in.
Rename stays enabled. This avoids designing for a state where the canvas displays a session
that no longer exists — the escape hatch (open another session first) is obvious and needs no
explanation beyond the tooltip.

After any mutation the picker refetches, so its rows and the Canvas/Transcript badges stay
consistent with the server rather than being patched optimistically.

**The picker stays presentational.** It does not know which session is loaded, nor how to call
the BFF — both would give it two jobs. `App` passes the loaded session's stored key as
`currentId` (from `canvasKeyRef`, which is the stored key on every path) and three callbacks:

```ts
currentId?: string
onRename: (id: string, title: string) => void
onArchive: (id: string) => void
onDelete: (id: string) => void
```

`App` performs the request, refetches the list, and — when the renamed id is the loaded one —
updates `opened.row.title` so the header changes immediately rather than on the next picker
open.

### 3. Permanent delete cleans up the canvas

Deleting a session's rows leaves `~/.hermes/gis_canvas/<id>.json` orphaned and its key in
`canvas.list` forever. A thin `canvas.forget {session_id}` RPC in the existing fenced block
delegates to a plugin handler that calls `CanvasStore.reset(key)` and drops any matching
preview-index entry (both the record keyed by that id, and any record whose
`preview_session_id` points at it).

**Archive must NOT forget the canvas.** Archiving is reversible, so the doc has to survive it —
restoring a session whose canvas had been deleted would be a data-loss bug wearing a
"reversible" label.

`canvas.forget` is called after the DELETE succeeds. If the delete fails, nothing is forgotten.

### 4. The header indicator

`CanvasHeader` gains a `title` prop:

```
BEFORE                          AFTER
Situation Canvas                AIS Gap Satellite Tasking Analysis
rev 4                    LIVE   Situation Canvas · rev 4      LIVE
```

The session title becomes the heading; the existing static string moves to the metadata line
beside the rev, keeping the LIVE/COMPOSING indicator where it is. Long titles truncate.

The title comes from what the app already knows: `opened.row.title` when a session was opened
from the picker, or `title` from the `canvas.branch` response. A session with no title shows
**New session**.

**A stated limitation:** a fresh session has no title until the agent assigns one, and the SPA
is never told when that happens. Rather than poll, the header refreshes opportunistically — when
the picker is opened it refetches every session anyway, so if the loaded session appears in that
list with a title, the header adopts it. A fresh session therefore self-corrects the next time
you open ▤ Sessions, at no extra request cost. Renaming from the picker updates the header
immediately, because the client owns that state.

## Testing

- **BFF** — each route 401s unauthenticated; rename proxies the title; archive proxies the flag;
  delete proxies through and returns the gateway's body; a gateway 404 surfaces as 404 and a 5xx
  as 502 (matching the existing read routes).
- **Picker** — rename commits on Enter, cancels on Escape leaving the original title; archive
  and delete are disabled on the current row and enabled elsewhere; delete shows a confirmation
  and does nothing when cancelled; **Escape leaves the title unchanged even though it also
  blurs the input**; a hostile title renders as text in both the row and the
  confirmation prompt.
- **Plugin** — `canvas.forget` removes the stored doc; removes a preview record keyed by the id
  and one pointing at it via `preview_session_id`; is a no-op (not an error) for an unknown key;
  requires `session_id`.
- **Registration guard** — the fenced block declares `canvas.forget` alongside the other canvas
  RPCs.
- **Header** — renders the given title; falls back to `New session`; still shows the rev and the
  LIVE/COMPOSING state.

Live verification: rename a session and confirm it changes in both the canvas picker and the
Hermes UI (same row, one database); archive one and confirm it leaves the canvas list but is
still present in `state.db` with `archived=1`; delete one and confirm both the row and its
`~/.hermes/gis_canvas/<id>.json` are gone.

## Accepted simplifications

- No undo for permanent delete beyond the confirmation prompt.
- No restore-from-archive in the canvas.
- Rename is title-only; the gateway's `profile` parameter is never sent, so all operations act
  on the default profile — the same one the picker reads.
- The header shows one line of identity; it does not show the parent for a branch.
