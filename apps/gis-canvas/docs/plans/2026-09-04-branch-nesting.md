# Branch Nesting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group forked sessions under the session they came from, so a run of `branch #2…#7` reads as one investigation instead of seven unrelated rows.

**Architecture:** A pure `groupSessions(rows)` resolves each row's root ancestor by walking `parent_session_id` and returns a flat list where every root is followed by its descendants, each flagged `child`. The picker renders that list, adding an indent and a `└` marker to child rows. Grouping applies only to the unfiltered list — searching collapses back to a flat list of matches.

**Tech Stack:** React 19 + TypeScript + Vitest.

**Spec:** `apps/gis-canvas/docs/2026-09-04-branch-nesting-design.md`

## Global Constraints

- **No session is ever hidden by grouping.** `groupSessions(rows).length === rows.length`, always — asserted directly.
- **A family anchors at its FIRST-APPEARING member**, not at its root. Rows arrive newest-first and a branch is always newer than its parent, so anchoring at the root would drag a just-created branch down beside a days-old parent and off the top of the list.
- **The ancestor walk must be cycle-safe.** A corrupt `a → b → a` chain would otherwise hang the UI.
- **Descendants flatten to ONE indent** under their root, never nested by true depth — the live data is 4 deep.
- **Orphans render top-level.** A parent may be absent (filtered by `min_messages=1`, beyond the page limit, archived, deleted).
- **Search drops grouping entirely** — a flat list of matches, exactly as today.
- **Row behaviour is unchanged**: open, rename-in-place, archive, delete, `● current`, the Canvas/Transcript badge, and the hover-revealed icon actions all work identically on a child row.
- **Working directory:** the Bash tool's cwd resets between calls — prefix every command with `cd apps/gis-canvas`.
- **NEVER run `tests/test_tui_gateway_server.py` or `tests/tui_gateway/` on this machine** — that suite is not hermetic and previously wiped the user's `auth.json`. This plan is SPA-only and touches neither.
- **Branch:** `gis/main` is the current branch and this work has no branch of its own yet; create `gis/branch-nesting` before Task 1.
- **Existing suites must stay green:** 462 SPA tests.

## File Structure

| File | Responsibility |
|---|---|
| `apps/gis-canvas/src/lib/session-tree.ts` (create) | `groupSessions` — pure root resolution and ordering |
| `apps/gis-canvas/src/lib/session-tree.test.ts` (create) | Its tests |
| `apps/gis-canvas/src/components/SessionPicker.tsx` (modify) | Render child rows indented, only when not searching |
| `apps/gis-canvas/src/components/SessionPicker.test.tsx` (modify) | Marker, search-collapses, child-row actions |

---

### Task 0: Branch

- [ ] **Step 1: Create the working branch**

```bash
cd /c/workspace/analyst/hermes-agent
git checkout -b gis/branch-nesting
git branch --show-current
```
Expected: `gis/branch-nesting`.

---

### Task 1: groupSessions

**Files:**
- Create: `apps/gis-canvas/src/lib/session-tree.ts`
- Test: `apps/gis-canvas/src/lib/session-tree.test.ts`

**Interfaces:**
- Consumes: `SessionRow` from `src/lib/sessions.ts` (fields used: `id`, `parent_session_id`)
- Produces:
  - `export interface GroupedRow { row: SessionRow; child: boolean }`
  - `export function groupSessions(rows: SessionRow[]): GroupedRow[]`

`SessionRow` does not declare `parent_session_id` yet — the API returns it but the interface omits it. Add it as `parent_session_id?: string | null` in `src/lib/sessions.ts` as part of this task.

**The algorithm**, precisely:

1. Index rows by id.
2. For each row, resolve its **root**: walk `parent_session_id` while the parent is present in the index, carrying a `seen` set; stop on a repeat (cycle) or when the parent is absent (orphan). The row you stop on is the root. A row with no parent is its own root.
3. Emit families **in the order their first member appears** in the input. Within a family: the root first (if the root is itself in the list), then its descendants in input order.
4. A row whose root is itself is emitted with `child: false`; every other row with `child: true`.

Edge case worth stating: a family's first-appearing member is often a **child**, not the root — rows arrive newest-first. The family still renders root-first; only its *position* comes from the first-appearing member.

- [ ] **Step 1: Write the failing test**

Create `apps/gis-canvas/src/lib/session-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupSessions } from './session-tree'
import type { SessionRow } from './sessions'

const row = (id: string, parent?: string): SessionRow => ({
  id,
  parent_session_id: parent ?? null,
  source: 'tui',
  title: id,
  preview: '',
  message_count: 5,
  started_at: 1,
  last_active: 1,
})

const shape = (rows: SessionRow[]) =>
  groupSessions(rows).map(g => `${g.child ? '  └ ' : ''}${g.row.id}`)

describe('groupSessions', () => {
  it('passes through a list with no branches, order intact', () => {
    expect(shape([row('a'), row('b'), row('c')])).toEqual(['a', 'b', 'c'])
  })

  it('groups children under their root', () => {
    expect(shape([row('kid', 'root'), row('root'), row('other')]))
      .toEqual(['root', '  └ kid', 'other'])
  })

  it('flattens a 4-deep chain to ONE indent under the root', () => {
    // The live data nests this deep: branch -> #2 -> #3 -> #4.
    const rows = [row('b4', 'b3'), row('b3', 'b2'), row('b2', 'b1'), row('b1', 'root'), row('root')]
    expect(shape(rows)).toEqual(['root', '  └ b4', '  └ b3', '  └ b2', '  └ b1'])
  })

  it('anchors a family at its FIRST-APPEARING member, not at its root', () => {
    // Newest-first input: a fresh branch of an old root must keep the family
    // near the top, or the session you just forked drops off the list.
    const rows = [row('fresh-branch', 'old-root'), row('newer-unrelated'), row('old-root')]
    expect(shape(rows)).toEqual(['old-root', '  └ fresh-branch', 'newer-unrelated'])
  })

  it('renders an orphan at the top level when its parent is absent', () => {
    // The parent may be filtered out by min_messages, paged away, archived or deleted.
    expect(shape([row('orphan', 'not-in-this-page'), row('a')])).toEqual(['orphan', 'a'])
  })

  it('terminates on a cycle instead of hanging', () => {
    const rows = [row('a', 'b'), row('b', 'a')]
    const out = groupSessions(rows)
    expect(out).toHaveLength(2)
    expect(out.map(g => g.row.id).sort()).toEqual(['a', 'b'])
  })

  it('never hides a row, whatever the shape', () => {
    const rows = [
      row('b4', 'b3'), row('b3', 'b2'), row('b2', 'b1'), row('b1', 'root'), row('root'),
      row('orphan', 'missing'), row('loner'), row('cyc1', 'cyc2'), row('cyc2', 'cyc1'),
    ]
    expect(groupSessions(rows)).toHaveLength(rows.length)
    expect(new Set(groupSessions(rows).map(g => g.row.id)).size).toBe(rows.length)
  })

  it('handles an empty list', () => {
    expect(groupSessions([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/session-tree.test.ts`
Expected: FAIL — `Failed to resolve import "./session-tree"`.

- [ ] **Step 3: Declare the field**

In `apps/gis-canvas/src/lib/sessions.ts`, add to `SessionRow` after `source`:

```ts
  /** Set when this session was forked from another (see canvas.branch). The API
   * returns it; grouping in the picker resolves families from it. */
  parent_session_id?: string | null
```

- [ ] **Step 4: Write the implementation**

Create `apps/gis-canvas/src/lib/session-tree.ts`:

```ts
import type { SessionRow } from './sessions'

export interface GroupedRow {
  row: SessionRow
  /** Renders indented under its root. False for roots and for orphans. */
  child: boolean
}

/** Group forked sessions under the session they came from.
 *
 * Descendants flatten to ONE level under their root ancestor rather than
 * nesting by true depth: the live data is four deep, and the question a picker
 * answers is "which investigation is this?", which one indent already answers.
 *
 * Two properties this must hold, both tested:
 *   - It never hides a row. Output length always equals input length.
 *   - A family sits where its FIRST-APPEARING member did. Rows arrive
 *     newest-first and a branch is newer than its parent, so anchoring at the
 *     root would drag a just-created branch down beside its days-old parent. */
export function groupSessions(rows: SessionRow[]): GroupedRow[] {
  const byId = new Map(rows.map(r => [r.id, r]))

  // Walk to the root ancestor. `seen` makes a corrupt cycle terminate instead
  // of spinning forever; an absent parent (filtered, paged away, deleted) means
  // this row IS its own root, which is what puts orphans at the top level.
  const rootOf = (row: SessionRow): SessionRow => {
    const seen = new Set<string>([row.id])
    let cur = row
    for (;;) {
      const parentId = cur.parent_session_id
      if (!parentId) return cur
      const parent = byId.get(parentId)
      if (!parent || seen.has(parent.id)) return cur
      seen.add(parent.id)
      cur = parent
    }
  }

  // Families keyed by root id, in the order their first member appears.
  const families = new Map<string, SessionRow[]>()
  for (const row of rows) {
    const rootId = rootOf(row).id
    const family = families.get(rootId)
    if (family) family.push(row)
    else families.set(rootId, [row])
  }

  const out: GroupedRow[] = []
  for (const [rootId, members] of families) {
    // Root first when it is itself in the list; the rest keep input order.
    const root = members.find(m => m.id === rootId)
    if (root) out.push({ row: root, child: false })
    for (const m of members) {
      if (m.id === rootId) continue
      out.push({ row: m, child: Boolean(root) })
    }
  }
  return out
}
```

Note the `child: Boolean(root)` — when the root is absent from the list every member of that "family" is an orphan, so none of them indent.

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/session-tree.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/lib/session-tree.ts apps/gis-canvas/src/lib/session-tree.test.ts apps/gis-canvas/src/lib/sessions.ts
git commit -m "feat(gis-canvas): group forked sessions under their root"
```

---

### Task 2: Render nested rows in the picker

**Files:**
- Modify: `apps/gis-canvas/src/components/SessionPicker.tsx`
- Test: `apps/gis-canvas/src/components/SessionPicker.test.tsx`

**Interfaces:**
- Consumes: `groupSessions`, `GroupedRow` from `src/lib/session-tree.ts` (Task 1)
- Produces: no new props. Child rows carry `data-testid="child-<id>"` on their marker.

Grouping applies **only when not searching**. The existing `filtered` memo returns `rows`
unchanged with no query, and a filtered subset otherwise; the new memo wraps it: group when the
query is empty, otherwise map the matches to `child: false`.

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/components/SessionPicker.test.tsx`:

```tsx
const familyRows: SessionRow[] = [
  { id: 'kid', parent_session_id: 'root', source: 'tui', title: 'branch #2', preview: '', message_count: 9, started_at: 3, last_active: 9 },
  { id: 'root', parent_session_id: null, source: 'tui', title: 'Gap analysis', preview: '', message_count: 20, started_at: 1, last_active: 5 },
  { id: 'solo', parent_session_id: null, source: 'cli', title: 'Unrelated', preview: '', message_count: 4, started_at: 2, last_active: 4 },
]

function setupFamily(over = {}) {
  render(<SessionPicker open rows={familyRows} canvasKeys={new Set()} busy={false}
    onOpenSession={() => {}} onClose={() => {}}
    onRename={() => {}} onArchive={() => {}} onDelete={() => {}} {...over} />)
}

describe('SessionPicker branch nesting', () => {
  it('marks a forked session as a child and leaves roots unmarked', () => {
    setupFamily()
    expect(screen.getByTestId('child-kid')).toBeInTheDocument()
    expect(screen.queryByTestId('child-root')).toBeNull()
    expect(screen.queryByTestId('child-solo')).toBeNull()
  })

  it('places the child directly after its root', () => {
    setupFamily()
    const ids = screen.getAllByTestId(/^session-row-/).map(el => el.getAttribute('data-testid'))
    expect(ids).toEqual(['session-row-root', 'session-row-kid', 'session-row-solo'])
  })

  it('drops the nesting while searching', () => {
    setupFamily()
    fireEvent.change(screen.getByTestId('session-search'), { target: { value: 'branch' } })
    expect(screen.getByTestId('session-row-kid')).toBeInTheDocument()
    // A match whose parent was filtered out must not render as an orphaned indent.
    expect(screen.queryByTestId('child-kid')).toBeNull()
  })

  it('still shows every session once when grouped', () => {
    setupFamily()
    expect(screen.getAllByTestId(/^session-row-/)).toHaveLength(familyRows.length)
  })

  it('leaves a child row fully actionable', () => {
    const onOpenSession = vi.fn()
    setupFamily({ onOpenSession })
    expect(screen.getByTestId('rename-kid')).toBeInTheDocument()
    expect(screen.getByTestId('archive-kid')).toBeInTheDocument()
    expect(screen.getByTestId('delete-kid')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('session-row-kid'))
    expect(onOpenSession).toHaveBeenCalledWith(familyRows[0], false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/SessionPicker.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="child-kid"]`.

- [ ] **Step 3: Group in the picker**

In `apps/gis-canvas/src/components/SessionPicker.tsx`, add the import:

```tsx
import { groupSessions, type GroupedRow } from '../lib/session-tree'
```

Replace the `filtered` memo with one that returns `GroupedRow[]`:

```tsx
  // Grouping applies only to the unfiltered list. While searching, an indented
  // row whose parent was filtered out is more confusing than a plain one, so
  // matches render flat.
  const visible = useMemo<GroupedRow[]>(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return groupSessions(rows)
    return rows
      .filter(r => `${r.title} ${r.preview}`.toLowerCase().includes(needle))
      .map(row => ({ row, child: false }))
  }, [rows, q])
```

Change the empty check and the row loop from `filtered` to `visible`:

```tsx
          ) : !visible.length ? (
```

```tsx
            visible.map(({ row, child }) => {
```

Add the indent to the row's className (it is currently a fixed string):

```tsx
                  className={`group flex w-full items-center gap-3 border-b border-hairline/40 py-2.5 pr-4 text-left hover:bg-surface ${child ? 'pl-10' : 'pl-4'}`}
```

And render the marker in the metadata line, replacing that `<span>`:

```tsx
                    <span className="mt-0.5 block font-mono text-[10.5px] text-tertiary">
                      {child && (
                        <span data-testid={`child-${row.id}`} aria-label="Branched from the session above"
                          className="mr-1 text-tertiary">└</span>
                      )}
                      {row.source} · {row.message_count} msg · {ago(row.last_active)}
                    </span>
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/components/SessionPicker.test.tsx`
Expected: PASS — the 5 new tests plus the 19 existing ones.

- [ ] **Step 5: Full verification**

Run: `cd apps/gis-canvas && npx vitest run && npx tsc -p . --noEmit && npx vite build`
Expected: all PASS (~475), typecheck clean, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/components/SessionPicker.tsx apps/gis-canvas/src/components/SessionPicker.test.tsx
git commit -m "feat(gis-canvas): nest branch rows under their root in the picker"
```

---

## Manual verification

SPA-only — no gateway or BFF restart. Refresh and open **▤ Sessions**.

1. The seven branches group under their two roots, each indented one level with a `└`, matching
   what the Hermes UI shows for the same sessions.
2. The row count is unchanged from before grouping — nothing disappeared.
3. A family whose newest member is recent still appears near the top, rather than sinking to
   where its older root sits.
4. Typing in the search box flattens the list — no indents, no markers.
5. A child row still opens, renames in place, and shows Archive/Delete on hover.

## Known risks

- **Grouping is per-page.** If a root is beyond the 100-row limit or filtered out by
  `min_messages=1`, its children render top-level rather than grouped. That is the orphan path and
  it is correct — but it means the same session can appear grouped or ungrouped depending on how
  much of the list was fetched.
