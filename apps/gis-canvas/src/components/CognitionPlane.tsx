import { useEffect, useRef, useState } from 'react'
import type { BuildStep, Turn } from '../lib/activity'
import { narrateStep, type StepOutcome } from '../lib/narrate'
import { humanizeLabel } from '../lib/humanize'
import { useDwell } from '../lib/use-dwell'
import { ThinkingMolecule } from './ThinkingMolecule'

const RAIL_MAX = 5
const DWELL_MS = 1200

// Seconds since `resetKey` last changed, ticking every second while `active`.
// A client-side live timer for the running step (the stream carries no elapsed
// for an in-flight step; duration_s only arrives on completion).
function useElapsedSeconds(resetKey: string, active: boolean): number {
  const [secs, setSecs] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    setSecs(0)
  }, [resetKey])
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setSecs(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [active, resetKey])
  return secs
}

const OUTCOME_TEXT: Record<StepOutcome, string> = {
  ok: 'text-positive',
  error: 'text-negative',
  running: 'text-accent',
}

// The single active step, shown compactly (the rich intent lives in the
// thinking star above). A running step gets the sweep.
function CurrentStepCard({ step }: { step: BuildStep }) {
  const n = narrateStep(step)
  const running = n.outcome === 'running'
  const secs = useElapsedSeconds(String(step.id), running)
  return (
    <div
      data-testid="current-step"
      className="relative flex items-center gap-2.5 overflow-hidden rounded-gc-md border border-hairline-strong bg-surface/95 px-3 py-2.5 shadow-gc-overlay backdrop-blur"
    >
      <span className={`shrink-0 font-mono text-[13px] ${OUTCOME_TEXT[n.outcome]}`}>{n.glyph}</span>
      <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-primary">
        {humanizeLabel(step.label)}
        {n.tail ? <span className="text-tertiary"> · {n.tail}</span> : null}
      </span>
      {running && secs > 0 ? (
        <span className="shrink-0 font-mono text-[10.5px] text-tertiary">{secs}s</span>
      ) : null}
      {n.outcome === 'running' ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-2/5 gc-anim-dock-sweep"
          style={{ background: 'linear-gradient(90deg,transparent,color-mix(in oklab,var(--color-accent) 20%,transparent),transparent)' }}
        />
      ) : null}
    </div>
  )
}

// Completed steps as a bounded, single-row breadcrumb: at most RAIL_MAX recent
// pills on the right, older collapsed into a "+N earlier" chip on the left.
function StepRail({ steps }: { steps: BuildStep[] }) {
  const shown = steps.slice(-RAIL_MAX)
  const hidden = steps.length - shown.length
  return (
    <div className="flex items-center justify-end gap-1.5 overflow-hidden">
      {hidden > 0 ? (
        <span className="shrink-0 font-mono text-[9px] text-tertiary">+{hidden} earlier</span>
      ) : null}
      {shown.map(s => {
        const n = narrateStep(s)
        return (
          <span
            key={s.id}
            data-testid="rail-pill"
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-hairline bg-surface/80 px-2 py-1 font-mono text-[9px] text-secondary"
          >
            <span className={OUTCOME_TEXT[n.outcome]}>{n.glyph}</span>
            {humanizeLabel(s.label)}
          </span>
        )
      })}
    </div>
  )
}

function WorkingPlaceholder() {
  return (
    <div
      data-testid="cognition-working"
      className="w-full rounded-gc-lg border border-accent/40 bg-surface/90 px-4 py-3.5 font-mono text-[11px] uppercase tracking-[.14em] text-accent shadow-gc-overlay backdrop-blur"
    >
      ◆ Composing…
    </div>
  )
}

// Narration Spotlight: while busy, exactly three bounded elements — a thinking
// star (or Working placeholder), one in-place current-step card, and a bounded
// breadcrumb rail of completed steps. Never a per-step stack. Unmounts when the
// turn is no longer busy (trail stays recallable via the Inspector).
export function CognitionPlane({ turn }: { turn: Turn | undefined }) {
  // Raw values are computed with null guards so the pacing hook below can run
  // unconditionally (Rules of Hooks) — the early return happens after it.
  const items = turn?.items ?? []
  const trace = turn?.trace ?? []

  let lastReasoning: { kind: 'reasoning'; id: number; text: string } | undefined
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === 'reasoning') {
      lastReasoning = it
      break
    }
  }

  let current: BuildStep | undefined
  for (let i = trace.length - 1; i >= 0; i--) {
    if (trace[i].status === 'running') {
      current = trace[i]
      break
    }
  }
  if (!current && trace.length) current = trace[trace.length - 1]

  const done = trace.filter(s => s.status === 'done' && s !== current)

  // The star types the agent's reasoning when it emits any; otherwise it falls
  // back to the current step's `context` — the agent's own description of what
  // it is doing (the rich text the dock shows) — so it is never a bare placeholder.
  const thinkingText = lastReasoning?.text ?? current?.context

  // Pace the cognition frame: hold each (thought + current step + rail) for a
  // readable minimum, coalescing rapid updates to the latest so nothing flashes
  // by. Keyed on the active step + thinking text (the things that visibly change).
  const busy = !!turn?.isBusy
  const frameKey = busy ? `${current?.id ?? 'none'}|${thinkingText ?? ''}` : '∅'
  const frame = useDwell({ thinkingText, current, done }, frameKey, DWELL_MS)

  if (!turn || !turn.isBusy) return null

  return (
    <div
      data-testid="cognition-plane"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6 gc-anim-cognition"
    >
      <div className="flex max-h-[86vh] w-[min(66%,520px)] flex-col items-stretch gap-3 overflow-hidden">
        {frame.thinkingText ? <ThinkingMolecule text={frame.thinkingText} /> : <WorkingPlaceholder />}
        {frame.current ? <CurrentStepCard step={frame.current} /> : null}
        {frame.done.length ? <StepRail steps={frame.done} /> : null}
      </div>
    </div>
  )
}
