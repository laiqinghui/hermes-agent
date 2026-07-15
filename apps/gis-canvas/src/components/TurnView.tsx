import { useState } from 'react'
import type { Turn } from '../lib/activity'
import { TraceStep } from './TraceStep'
import { deriveHeading } from '../lib/derive-heading'

// One conversation turn: the user's prompt, its reasoning (Thinking), its tool
// trace (FORMULATING CANVAS), and the agent's answer(s) — so each follow-up
// question starts a fresh block instead of piling into a session-wide trace.
export function TurnView({ turn }: { turn: Turn }) {
  const [showThinking, setShowThinking] = useState(false)
  return (
    <>
      {turn.prompt !== undefined ? (
        <div className="flex justify-end">
          <div className="max-w-[86%] rounded-[12px_12px_3px_12px] bg-accent px-3 py-2 font-sans text-[12.5px] leading-relaxed text-accent-fg">
            {turn.prompt}
          </div>
        </div>
      ) : null}

      {turn.reasoning.length ? (
        <div className="rounded-gc-md border border-hairline bg-surface-raised/50">
          <button
            type="button"
            onClick={() => setShowThinking(s => !s)}
            aria-expanded={showThinking}
            className="flex w-full items-center justify-between px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-tertiary"
          >
            <span>Thinking ({turn.reasoning.length})</span>
            <span aria-hidden>{showThinking ? '▾' : '▸'}</span>
          </button>
          {showThinking ? (
            <div className="flex flex-col gap-2 px-3 pb-2.5">
              {turn.reasoning.map(r => {
                const heading = deriveHeading(r.text)
                return (
                  <div key={r.id}>
                    {heading ? <div className="font-sans text-[12px] font-semibold text-primary">{heading}</div> : null}
                    <div className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-secondary">{r.text}</div>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {turn.trace.length ? (
        <div className="rounded-gc-md border border-hairline bg-surface p-3">
          <div className="mb-1 font-mono text-[9.5px] tracking-[.1em] text-tertiary">FORMULATING CANVAS</div>
          {turn.trace.map(step => <TraceStep key={step.id} step={step} />)}
        </div>
      ) : null}

      {turn.answers.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-gc-sm border border-hairline bg-surface font-display text-[11px] font-bold text-accent">
            H
          </span>
          <div className="max-w-[86%] rounded-[3px_12px_12px_12px] border border-hairline bg-surface px-3 py-2 font-sans text-[12.5px] leading-relaxed text-primary">
            {a}
          </div>
        </div>
      ))}
    </>
  )
}
