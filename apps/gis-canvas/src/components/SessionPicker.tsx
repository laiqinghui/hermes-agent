import { useMemo, useState } from 'react'
import type { SessionRow } from '../lib/sessions'

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
}: {
  open: boolean
  rows: SessionRow[]
  canvasKeys: Set<string>
  busy: boolean
  onOpenSession: (row: SessionRow, hasCanvas: boolean) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(r => `${r.title} ${r.preview}`.toLowerCase().includes(needle))
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
          ) : !filtered.length ? (
            <p className="px-4 py-6 text-center font-sans text-[12.5px] text-tertiary">
              No sessions{q ? ' match that search' : ' yet'}.
            </p>
          ) : (
            filtered.map(row => {
              const hasCanvas = canvasKeys.has(row.id)
              return (
                <button
                  key={row.id}
                  data-testid={`session-row-${row.id}`}
                  onClick={() => onOpenSession(row, hasCanvas)}
                  className="flex w-full items-center gap-3 border-b border-hairline/40 px-4 py-2.5 text-left hover:bg-surface"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-[12.5px] text-primary">{label(row)}</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-tertiary">
                      {row.source} · {row.message_count} msg · {ago(row.last_active)}
                    </span>
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
      </div>
    </div>
  )
}
