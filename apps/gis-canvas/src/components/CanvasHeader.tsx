// Frontend-only header for the canvas area. CanvasDoc has no title field
// (see lib/types.ts) — this is generic chrome, not bound to agent-authored data.
export function CanvasHeader({ rev, isBusy }: { rev: number | undefined; isBusy: boolean }) {
  return (
    <div className="mb-3.5 flex shrink-0 items-end justify-between">
      <div>
        <div className="font-display text-[19px] font-semibold text-primary">Situation Canvas</div>
        <div className="mt-0.5 font-mono text-[11px] text-tertiary">
          {rev != null ? `rev ${rev}` : 'awaiting first render'}
        </div>
      </div>
      <div className={`font-mono text-[10.5px] tracking-wide ${isBusy ? 'text-accent' : 'text-positive'}`}>
        {isBusy ? 'COMPOSING…' : 'LIVE'}
      </div>
    </div>
  )
}
