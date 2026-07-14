import type { TimelineEvent } from '../lib/activity'
import { TraceStep } from './TraceStep'
import { deriveHeading } from '../lib/derive-heading'

export function AgentTimeline({ timeline }: { timeline: TimelineEvent[] }) {
  if (!timeline.length) {
    return <div className="py-6 text-center font-sans text-xs text-tertiary">No activity yet.</div>
  }
  return (
    <div className="flex flex-col gap-2">
      {timeline.map(ev => {
        if (ev.kind === 'reasoning') {
          const heading = deriveHeading(ev.text)
          return (
            <div key={ev.id} className="rounded-gc-md border border-hairline bg-surface-raised/50 p-2.5">
              <div className="mb-1 font-mono text-[9.5px] uppercase tracking-wide text-tertiary">thinking</div>
              {heading ? <div className="mb-0.5 font-sans text-[12px] font-semibold text-primary">{heading}</div> : null}
              <div className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-secondary">{ev.text}</div>
            </div>
          )
        }
        if (ev.kind === 'tool') {
          return (
            <div key={ev.id} className="rounded-gc-md border border-hairline bg-surface px-2.5 py-1">
              <TraceStep step={ev.step} />
            </div>
          )
        }
        if (ev.kind === 'error') {
          return (
            <div key={ev.id} className="rounded-gc-sm border border-negative/40 bg-negative/10 px-2.5 py-1.5 font-mono text-[11px] text-negative">
              {ev.text}
            </div>
          )
        }
        return (
          <div key={ev.id} className={ev.role === 'user' ? 'flex justify-end' : 'flex'}>
            <div className={ev.role === 'user'
              ? 'max-w-[86%] rounded-[12px_12px_3px_12px] bg-accent px-3 py-2 font-sans text-[12.5px] text-accent-fg'
              : 'max-w-[86%] rounded-[3px_12px_12px_12px] border border-hairline bg-surface px-3 py-2 font-sans text-[12.5px] text-primary'}>
              {ev.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}
