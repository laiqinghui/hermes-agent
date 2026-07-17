import type { BuildStep, Turn } from '../lib/activity'
import { narrateStep, type StepOutcome } from '../lib/narrate'
import { humanizeLabel } from '../lib/humanize'
import { ThinkingMolecule } from './ThinkingMolecule'

const RAIL_MAX = 5

const OUTCOME_TEXT: Record<StepOutcome, string> = {
  ok: 'text-positive',
  error: 'text-negative',
  running: 'text-accent',
}

// The single active step, narrated in place. A running step gets the sweep.
function CurrentStepCard({ step }: { step: BuildStep }) {
  const n = narrateStep(step)
  return (
    <div
      data-testid="current-step"
      className="relative flex items-center gap-2.5 overflow-hidden rounded-gc-md border border-hairline-strong bg-surface/95 px-3 py-2.5 shadow-gc-overlay backdrop-blur"
    >
      <span className={`shrink-0 font-mono text-[13px] ${OUTCOME_TEXT[n.outcome]}`}>{n.glyph}</span>
      <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-primary">{n.text}</span>
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
      ◆ Working…
    </div>
  )
}

// Narration Spotlight: while busy, exactly three bounded elements — a thinking
// star (or Working placeholder), one in-place current-step card, and a bounded
// breadcrumb rail of completed steps. Never a per-step stack. Unmounts when the
// turn is no longer busy (trail stays recallable via the Inspector).
export function CognitionPlane({ turn }: { turn: Turn | undefined }) {
  if (!turn || !turn.isBusy) return null

  let lastReasoning: { kind: 'reasoning'; id: number; text: string } | undefined
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i]
    if (it.kind === 'reasoning') {
      lastReasoning = it
      break
    }
  }

  let current: BuildStep | undefined
  for (let i = turn.trace.length - 1; i >= 0; i--) {
    if (turn.trace[i].status === 'running') {
      current = turn.trace[i]
      break
    }
  }
  if (!current && turn.trace.length) current = turn.trace[turn.trace.length - 1]

  const done = turn.trace.filter(s => s.status === 'done' && s !== current)

  return (
    <div
      data-testid="cognition-plane"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6 gc-anim-cognition"
    >
      <div className="flex max-h-[86vh] w-[min(66%,520px)] flex-col items-stretch gap-3 overflow-hidden">
        {lastReasoning ? <ThinkingMolecule text={lastReasoning.text} /> : <WorkingPlaceholder />}
        {current ? <CurrentStepCard step={current} /> : null}
        {done.length ? <StepRail steps={done} /> : null}
      </div>
    </div>
  )
}
