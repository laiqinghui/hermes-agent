import { useState } from 'react'
import { renderMarkdown } from '../lib/markdown'
import type { Turn } from '../lib/activity'
import { TraceStep } from './TraceStep'
import { deriveHeading } from '../lib/derive-heading'

// A single reasoning entry: the derived heading is always visible; clicking
// reveals the full body. Renders inline within FORMULATING CANVAS, before the
// step it triggered — the Hermes "Thinking → step → Thinking → step" cadence.
function ThinkingRow({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const heading = deriveHeading(text)
  return (
    <div className="rounded-gc-md border border-hairline bg-surface-raised/50">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <span className="font-mono text-[9.5px] uppercase tracking-wide text-tertiary">Thinking</span>
        <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-secondary">{heading}</span>
        <span aria-hidden className="text-tertiary">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="px-3 pb-2.5 font-sans text-[12px] leading-relaxed text-secondary">{renderMarkdown(text)}</div>
      ) : null}
    </div>
  )
}

// One conversation turn: the user's prompt, its interleaved reasoning + tool
// trace (FORMULATING CANVAS), and the agent's answer(s) — so each follow-up
// question starts a fresh block instead of piling into a session-wide trace.
export function TurnView({ turn }: { turn: Turn }) {
  return (
    <>
      {turn.prompt !== undefined ? (
        <div className="flex justify-end">
          <div className="max-w-[86%] rounded-[12px_12px_3px_12px] bg-accent px-3 py-2 font-sans text-[12.5px] leading-relaxed text-accent-fg">
            {turn.prompt}
          </div>
        </div>
      ) : null}

      {turn.items.length ? (
        <div className="rounded-gc-md border border-hairline bg-surface p-3">
          <div className="mb-1.5 font-mono text-[9.5px] tracking-[.1em] text-tertiary">FORMULATING CANVAS</div>
          <div className="flex flex-col gap-1.5">
            {turn.items.map(it =>
              it.kind === 'reasoning'
                ? <ThinkingRow key={`r${it.id}`} text={it.text} />
                : <TraceStep key={`s${it.id}`} step={it.step} />
            )}
          </div>
        </div>
      ) : null}

      {turn.answers.map((a, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-gc-sm border border-hairline bg-surface font-display text-[11px] font-bold text-accent">
            H
          </span>
          <div className="max-w-[86%] rounded-[3px_12px_12px_12px] border border-hairline bg-surface px-3 py-2 font-sans text-[12.5px] leading-relaxed text-primary">
            {renderMarkdown(a)}
          </div>
        </div>
      ))}
    </>
  )
}
