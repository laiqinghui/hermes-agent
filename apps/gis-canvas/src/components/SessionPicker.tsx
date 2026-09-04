import { useMemo, useRef, useState } from 'react'
import type { SessionRow } from '../lib/sessions'
import { groupSessions, type GroupedRow } from '../lib/session-tree'

function label(row: SessionRow): string {
  return row.title?.trim() || row.preview?.trim() || row.id
}

function ago(ts: number): string {
  if (!ts) return ''
  const mins = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Browse every Hermes session — own and foreign. Presentational: the caller
 * supplies rows and the stored-canvas key set.
 *
 * Titles and previews are authored on OTHER surfaces by OTHER users. React
 * escapes them as text here; never move them into dangerouslySetInnerHTML. */
export function SessionPicker({
  open, rows, canvasKeys, busy, onOpenSession, onClose,
  currentId, onRename, onArchive, onDelete,
}: {
  open: boolean
  rows: SessionRow[]
  canvasKeys: Set<string>
  busy: boolean
  onOpenSession: (row: SessionRow, hasCanvas: boolean) => void
  onClose: () => void
  /** Stored key of the loaded session — it may be renamed but not removed. */
  currentId?: string
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState<SessionRow | null>(null)
  // Escape also blurs, so without this flag the blur handler would commit the
  // very edit Escape just cancelled.
  const cancelled = useRef(false)

  const beginRename = (row: SessionRow) => {
    cancelled.current = false
    setDraft(row.title ?? '')
    setEditing(row.id)
  }
  const commitRename = (id: string) => {
    if (cancelled.current || editing !== id) return
    setEditing(null)
    onRename(id, draft.trim())
  }
  const cancelRename = () => { cancelled.current = true; setEditing(null) }
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

  if (!open) return null

  return (
    <div data-testid="session-picker"
      className="fixed inset-0 z-50 flex items-start justify-center bg-canvas/80 p-8 backdrop-blur-sm">
      <div className="gc-hud flex max-h-full w-[min(720px,92vw)] flex-col overflow-hidden rounded-gc-md">
        <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-3">
          <span className="font-display text-sm font-semibold text-primary">Sessions</span>
          <input
            data-testid="session-search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search titles and previews…"
            className="min-w-0 flex-1 rounded-gc-sm border border-hairline bg-surface px-2.5 py-1.5 font-sans text-[12.5px] text-primary placeholder:text-tertiary"
          />
          <button onClick={onClose}
            className="shrink-0 rounded-gc-sm border border-hairline px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary">
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {busy ? (
            <p className="px-4 py-6 text-center font-sans text-[12.5px] text-tertiary">Loading sessions…</p>
          ) : !visible.length ? (
            <p className="px-4 py-6 text-center font-sans text-[12.5px] text-tertiary">
              No sessions{q ? ' match that search' : ' yet'}.
            </p>
          ) : (
            visible.map(({ row, child }) => {
              const hasCanvas = canvasKeys.has(row.id)
              return (
                <button
                  key={row.id}
                  data-testid={`session-row-${row.id}`}
                  onClick={() => onOpenSession(row, hasCanvas)}
                  className={`group flex w-full items-center gap-3 border-b border-hairline/40 py-2.5 pr-4 text-left hover:bg-surface ${child ? 'pl-10' : 'pl-4'}`}
                >
                  <span className="min-w-0 flex-1">
                    {editing === row.id ? (
                      <input
                        data-testid={`rename-input-${row.id}`}
                        autoFocus
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => {
                          e.stopPropagation()
                          if (e.key === 'Enter') commitRename(row.id)
                          if (e.key === 'Escape') cancelRename()
                        }}
                        onBlur={() => commitRename(row.id)}
                        className="w-full rounded-gc-sm border border-hairline bg-surface px-1.5 py-0.5 font-sans text-[12.5px] text-primary"
                      />
                    ) : (
                      <span className="block truncate font-sans text-[12.5px] text-primary">{label(row)}</span>
                    )}
                    <span className="mt-0.5 block font-mono text-[10.5px] text-tertiary">
                      {child && (
                        <span data-testid={`child-${row.id}`} aria-label="Branched from the session above"
                          className="mr-1 text-tertiary">└</span>
                      )}
                      {row.source} · {row.message_count} msg · {ago(row.last_active)}
                    </span>
                  </span>

                  {row.id === currentId && (
                    <span data-testid={`current-${row.id}`}
                      className="shrink-0 font-mono text-[10px] text-accent">● current</span>
                  )}
                  {/* Icon buttons, quiet until the row is hovered or focused, so
                      the Canvas/Transcript badge stays the row's only persistent
                      chip. Revealed on focus-within as well as hover — hover
                      alone would strand keyboard users. They are dimmed, never
                      display:none, so they remain focusable and tabbable.
                      Every action stops propagation: the row itself is a button
                      that opens the session. The glyph never carries the meaning
                      on its own; aria-label and title both spell it out. */}
                  <span
                    data-testid={`row-actions-${row.id}`}
                    className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    <button data-testid={`rename-${row.id}`} aria-label="Rename session" title="Rename"
                      onClick={e => { e.stopPropagation(); beginRename(row) }}
                      className="rounded-gc-sm px-1.5 py-1 text-[12px] leading-none text-tertiary hover:bg-surface hover:text-primary">
                      ✎
                    </button>
                    <button data-testid={`archive-${row.id}`} disabled={row.id === currentId}
                      aria-label="Archive session"
                      title={row.id === currentId ? 'You cannot archive the session you are in' : 'Archive'}
                      onClick={e => { e.stopPropagation(); onArchive(row.id) }}
                      className="rounded-gc-sm px-1.5 py-1 text-[12px] leading-none text-tertiary hover:bg-surface hover:text-primary disabled:opacity-30 disabled:hover:bg-transparent">
                      ⊟
                    </button>
                    <button data-testid={`delete-${row.id}`} disabled={row.id === currentId}
                      aria-label="Delete session permanently"
                      title={row.id === currentId ? 'You cannot delete the session you are in' : 'Delete permanently'}
                      onClick={e => { e.stopPropagation(); setConfirming(row) }}
                      className="rounded-gc-sm px-1.5 py-1 text-[12px] leading-none text-tertiary hover:bg-surface hover:text-negative disabled:opacity-30 disabled:hover:bg-transparent">
                      ✕
                    </button>
                  </span>
                  <span
                    data-testid={`session-badge-${row.id}`}
                    className={`shrink-0 rounded-gc-sm border px-1.5 py-0.5 font-mono text-[10px] ${
                      hasCanvas ? 'border-accent/50 text-accent' : 'border-hairline text-tertiary'
                    }`}
                  >
                    {hasCanvas ? 'Canvas' : 'Transcript'}
                  </span>
                </button>
              )
            })
          )}
        </div>

        {confirming && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-canvas/80 p-6">
            <div className="gc-hud w-[min(420px,90vw)] rounded-gc-md p-4">
              {/* label() output is a title authored on another surface — React
                  renders it as text; never move it into innerHTML. */}
              <p className="font-sans text-[12.5px] text-primary">
                Delete “{label(confirming)}” permanently? This cannot be undone.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button data-testid="cancel-delete" onClick={() => setConfirming(null)}
                  className="rounded-gc-sm border border-hairline px-2.5 py-1.5 font-sans text-[11.5px] text-secondary hover:text-primary">
                  Cancel
                </button>
                <button data-testid="confirm-delete"
                  onClick={() => { const r = confirming; setConfirming(null); onDelete(r.id) }}
                  className="rounded-gc-sm border border-negative/50 px-2.5 py-1.5 font-sans text-[11.5px] text-negative hover:text-primary">
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
