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
      // When the root is absent every member is an orphan — none indent, or
      // they would point at a row that is not on screen.
      out.push({ row: m, child: Boolean(root) })
    }
  }
  return out
}
