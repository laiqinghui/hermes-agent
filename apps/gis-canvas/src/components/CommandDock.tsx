import type { ChatMessage } from '../lib/activity'

export function CommandDock({ latest, onOpen }: { latest: ChatMessage | undefined; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="fixed bottom-6 left-1/2 z-30 flex w-[min(560px,90vw)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-hairline-strong bg-rail px-2.5 py-2.5 text-left shadow-gc-overlay"
      style={{ animation: 'gc-dock-in .35s cubic-bezier(.2,.8,.2,1) both' }}
    >
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-hairline bg-surface font-display text-xs font-bold text-accent">
        H
      </span>
      <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-secondary">
        {latest?.text ?? 'Ask the agent to build a dashboard…'}
      </span>
      <span className="shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-tertiary">/</span>
    </button>
  )
}
