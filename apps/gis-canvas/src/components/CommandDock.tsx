import type { ChatMessage, BuildStep } from '../lib/activity'
import { humanizeLabel } from '../lib/humanize'

export function CommandDock({
  latest,
  onOpen,
  busy = false,
  step,
}: {
  latest: ChatMessage | undefined
  onOpen: () => void
  busy?: boolean
  step?: BuildStep
}) {
  const live = busy && step
  return (
    <button
      onClick={onOpen}
      className="fixed bottom-6 left-1/2 z-30 flex w-[min(560px,90vw)] -translate-x-1/2 items-center gap-2.5 overflow-hidden rounded-full border border-hairline-strong bg-rail px-2.5 py-2.5 text-left shadow-gc-overlay"
      style={{ animation: 'gc-dock-in .35s cubic-bezier(.2,.8,.2,1) both' }}
    >
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-hairline bg-surface font-display text-xs font-bold text-accent">
        H
      </span>
      {live ? (
        <span data-testid="dock-ticker" className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-accent">{humanizeLabel(step!.label)}</span>
          {step!.context ? (
            <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-tertiary">· {step!.context}</span>
          ) : null}
          {typeof step!.durationS === 'number' ? (
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-tertiary">{step!.durationS.toFixed(1)}s</span>
          ) : null}
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-secondary">
            {latest?.text ?? 'Ask the agent to build a dashboard…'}
          </span>
          <span className="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-tertiary">/</span>
        </>
      )}
      {live ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-2/5"
          style={{ background: 'linear-gradient(90deg,transparent,color-mix(in oklab,var(--color-accent) 22%,transparent),transparent)', animation: 'gc-dock-sweep 1.6s linear infinite' }}
        />
      ) : null}
    </button>
  )
}
