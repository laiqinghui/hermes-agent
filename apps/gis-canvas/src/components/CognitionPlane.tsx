import type { Turn } from '../lib/activity'
import { describeStep, type StepMolecule } from '../lib/cognition'
import { ThinkingMolecule } from './ThinkingMolecule'

const SHAPE_ACCENT: Record<StepMolecule['shape'], string> = {
  error: 'border-negative/50 text-negative',
  'geo-rows': 'border-accent/50 text-accent',
  rows: 'border-hairline-strong text-secondary',
  stat: 'border-hairline-strong text-secondary',
  text: 'border-hairline text-tertiary',
}

function StepChip({ molecule }: { molecule: StepMolecule }) {
  return (
    <div className={`rounded-gc-md border bg-surface/90 px-3 py-2 shadow-gc-overlay backdrop-blur ${SHAPE_ACCENT[molecule.shape]}`}>
      <div className="font-mono text-[9px] uppercase tracking-wide">{molecule.title}</div>
      <div className="mt-0.5 font-sans text-[12px] text-primary">{molecule.summary}</div>
    </div>
  )
}

// Ephemeral cognition overlay for the current (busy) turn: the latest reasoning
// as a typewriter, plus a molecule per completed step. Unmounts when the turn is
// no longer busy — the full trail stays recallable via the Inspector.
export function CognitionPlane({ turn }: { turn: Turn | undefined }) {
  if (!turn || !turn.isBusy) return null

  let lastReasoning: { kind: 'reasoning'; id: number; text: string } | undefined
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const it = turn.items[i]
    if (it.kind === 'reasoning') { lastReasoning = it; break }
  }
  const doneSteps = turn.trace.filter(s => s.status === 'done')

  return (
    <div
      data-testid="cognition-plane"
      className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6 gc-anim-cognition"
    >
      <div className="flex w-[min(64%,460px)] flex-col items-stretch gap-3">
        {lastReasoning ? <ThinkingMolecule text={lastReasoning.text} /> : null}
        {doneSteps.length ? (
          <div className="flex flex-wrap justify-center gap-2">
            {doneSteps.map(s => <StepChip key={s.id} molecule={describeStep(s)} />)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
