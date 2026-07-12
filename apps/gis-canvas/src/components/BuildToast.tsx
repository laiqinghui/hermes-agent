import type { BuildStep } from '../lib/activity'

// Visible whenever the agent is composing, whether or not the overlay is open —
// status stays legible even with the chat surface collapsed to the dock.
export function BuildToast({ show, step }: { show: boolean; step: BuildStep | undefined }) {
  if (!show || !step) return null
  return (
    <div
      className="fixed top-[68px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-hairline-strong bg-surface px-4 py-2 shadow-gc-overlay"
      style={{ animation: 'gc-toast-in .3s ease both' }}
    >
      <span
        aria-hidden
        className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent"
        style={{ animation: 'gc-pulse-dot .9s ease-in-out infinite' }}
      />
      <span className="font-mono text-[11.5px] text-primary">{step.label}</span>
    </div>
  )
}
