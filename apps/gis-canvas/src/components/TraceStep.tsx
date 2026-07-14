import { useState } from 'react'
import type { BuildStep } from '../lib/activity'
import { formatValue } from '../lib/format-value'

export function TraceStep({ step }: { step: BuildStep }) {
  const [open, setOpen] = useState(false)
  const hasDetail = step.args !== undefined || step.result !== undefined || !!step.summary
  return (
    <div className="border-b border-hairline last:border-b-0 py-1">
      <button
        type="button"
        onClick={() => hasDetail && setOpen(o => !o)}
        aria-expanded={hasDetail ? open : undefined}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${step.status === 'done' ? 'border-accent bg-accent/15' : 'border-hairline-strong'}`}>
          {step.status === 'done'
            ? <span className="text-[10px] text-accent">✓</span>
            : <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-accent" style={{ animation: 'gc-pulse-dot .9s ease-in-out infinite' }} />}
        </span>
        <span className="font-mono text-[11.5px] text-primary">{step.label}</span>
        {step.context ? <span className="min-w-0 flex-1 truncate font-sans text-[11px] text-tertiary">{step.context}</span> : <span className="flex-1" />}
        {step.durationS != null ? <span className="shrink-0 font-mono text-[10px] text-tertiary">{step.durationS.toFixed(1)}s</span> : null}
        {hasDetail ? <span aria-hidden className="shrink-0 font-mono text-[10px] text-tertiary">{open ? '▾' : '▸'}</span> : null}
      </button>
      {open ? (
        <div className="mt-1 flex flex-col gap-1.5 pl-6">
          {step.summary ? <div className="font-sans text-[11px] text-secondary">{step.summary}</div> : null}
          {step.args !== undefined ? (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">args</div>
              <pre className="overflow-x-auto rounded-gc-sm bg-surface-raised p-2 font-mono text-[10.5px] text-primary">{formatValue(step.args)}</pre>
            </div>
          ) : null}
          {step.result !== undefined ? (
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">result</div>
              <pre className="overflow-x-auto rounded-gc-sm bg-surface-raised p-2 font-mono text-[10.5px] text-primary">{formatValue(step.result)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
