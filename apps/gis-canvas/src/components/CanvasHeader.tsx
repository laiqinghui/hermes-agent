// Frontend-only header for the canvas area. CanvasDoc has no title field
// (see lib/types.ts) — the title here is the SESSION's, supplied by App from
// the picker row or the branch response, not agent-authored canvas data.
export function CanvasHeader({
  rev, isBusy, title,
}: {
  rev: number | undefined
  isBusy: boolean
  title?: string
}) {
  return (
    <div className="mb-3.5 flex shrink-0 items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="truncate font-display text-[19px] font-semibold text-primary">
          {title?.trim() || 'New session'}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-tertiary">
          {rev != null ? `Situation Canvas · rev ${rev}` : 'Situation Canvas · awaiting first render'}
        </div>
      </div>
      <div className={`shrink-0 font-mono text-[10.5px] tracking-wide ${isBusy ? 'text-accent' : 'text-positive'}`}>
        {isBusy ? 'COMPOSING…' : 'LIVE'}
      </div>
    </div>
  )
}
