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
