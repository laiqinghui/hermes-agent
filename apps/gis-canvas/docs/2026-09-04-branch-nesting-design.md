# Branch nesting — group forked sessions under the one they came from

**Date:** 2026-09-04
**Status:** approved design, ready for planning
**Continues:** `2026-09-03-session-branch-design.md`, `2026-09-04-session-management-design.md`

## Problem

Branching produces sessions named `branch`, `branch #2` … `branch #7`, and the picker lists them
flat, interleaved with everything else by recency. Seven near-identically-named rows with no
indication that they belong to one investigation — or which one they forked from — is worse than
useless: it is actively misleading, because they look like seven unrelated sessions.

The Hermes UI already nests them. The canvas has the data to do the same and does not use it.

## Goals

- Show at a glance which sessions belong to the same lineage.
- Never hide a session as a side effect of grouping it.
- Leave every existing row behaviour untouched (open, rename, archive, delete, `● current`).

## Non-goals

- Collapsing/expanding a family. Every row stays visible; this is grouping, not folding.
- Showing the full lineage of a deep chain (see **Shape** — deliberately flattened).
- Any change to how branches are created or named.

## Established facts (verified against live data, 2026-09-04)

- `/api/sessions` returns `parent_session_id` on every row. Of 144 rows, 7 had a parent, and all
  7 parents happened to be present in the same page.
- **Chains are genuinely deep: the live data nests 4 levels** (`branch` → `#2` → `#3` → `#4`).
- The Hermes UI displays those same chains at a **single** indent under the root — it flattens
  rather than drawing the true tree.
- The picker's rows arrive newest-first and are rendered in the order given.

## Architecture

### 1. Shape — flatten under the root

Every descendant renders at **one** indent under its root ancestor, never nested by true depth.

The question a picker answers is "which investigation is this?", and one indent answers it. True
depth-indenting would consume ~64px of a 720px panel on the existing 4-deep chain and cramp the
deepest rows, in exchange for lineage detail that belongs in a session's own view rather than a
list. This also matches the Hermes UI, so the two surfaces agree.

### 2. A pure grouping function

`src/lib/session-tree.ts`:

```ts
export interface GroupedRow { row: SessionRow; child: boolean }
export function groupSessions(rows: SessionRow[]): GroupedRow[]
```

For each row it resolves the **root ancestor** by walking `parent_session_id` through the rows it
was given, then emits every root immediately followed by its descendants, each flagged
`child: true`. The picker renders whatever list comes back; all the logic is here, pure and
separately tested.

**The walk is cycle-safe.** A corrupt chain (`a → b → a`) would otherwise hang the UI, so the walk
carries a `seen` set; on revisiting a row it stops and treats that row as its own root.

### 3. A family sits where its most recent member would have

A family appears at the position of its **first-appearing member** in the incoming order, and its
children keep their existing relative order beneath the root.

The obvious alternative — anchor the family at its *root* — is wrong, and the live data shows
why. Rows arrive newest-first, and a branch is always newer than its parent. Anchoring at the
root would drag `branch #7`, created minutes ago, down to sit beside `Target Locations and Gaps`
from days earlier, so the session you just forked would vanish from the top of the list. Recency
is the picker's primary signal and grouping must not destroy it.

This is still a deterministic function of the input order, not a re-sort: the family surfaces
when any member is recent, which is exactly when you want to see it.

### 4. Orphans render at the top level

A parent can be absent from the page: filtered out by `min_messages=1`, beyond the row limit,
archived, or permanently deleted. When a row's parent is not in the list, that row renders as an
ordinary top-level row rather than an indented one pointing at nothing.

**The invariant: no session is ever hidden by grouping.** `groupSessions(rows).length === rows.length`
always, and that is asserted directly.

### 5. Search drops the grouping

With a query active the picker renders a flat list of matches, exactly as today. Grouping applies
only to the unfiltered list.

Search is about finding one specific session. An indented row whose parent was filtered out is
more confusing than a plain one, and padding results with context rows nobody searched for makes
the match harder to spot.

### 6. The row is otherwise unchanged

A child row gets left padding and a `└` marker in its metadata line. The title, badge, hover
actions, `● current` marker and rename-in-place all behave identically. Nesting changes where a
row sits, never what you can do to it.

## Testing

- `groupSessions` — a root with children groups them beneath it; **a 4-deep chain flattens to one
  level under its root**; an orphan (parent absent) renders top-level; **a cycle terminates and
  does not hang**; rows with no branches pass through untouched; **a family anchors at its
  first-appearing member, so a fresh branch of an old root keeps the family near the top**;
  **the output length always equals the input length**.
- `SessionPicker` — child rows render the marker and top-level rows do not; a search collapses to
  a flat list with no markers; a child row still exposes rename/archive/delete and can be opened.

Live verification: the seven branches group under their two roots, and the counts in the picker
match the Hermes UI's tree for the same sessions.

## Accepted simplifications

- No collapse/expand.
- True lineage (which branch forked from which) is not shown; only family membership.
- Grouping is computed client-side per render from the page the picker already has; it never
  fetches a parent that was not returned.
