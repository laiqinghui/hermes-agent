import { useEffect, useRef, useState } from 'react'
import type { TimelineEvent, Turn } from '../lib/activity'
import type { PendingApproval, ApprovalChoice } from '../lib/approval'
import { AgentTimeline } from './AgentTimeline'
import { TurnView } from './TurnView'
import { ApprovalCard } from './ApprovalCard'

// Domain-neutral defaults — this panel is shared chrome, not tied to any one dataset.
const SUGGESTED_PROMPTS = ['Build a dashboard', 'Summarize the data', 'Add a map']

export function AgentPanel({
  open,
  onClose,
  turns,
  timeline = [],
  errors,
  connected,
  onSend,
  approval = null,
  onRespond
}: {
  open: boolean
  onClose: () => void
  turns: Turn[]
  timeline?: TimelineEvent[]
  errors: string[]
  connected: boolean
  onSend: (text: string) => void
  approval?: PendingApproval | null
  onRespond?: (choice: ApprovalChoice) => void
}) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [inspector, setInspector] = useState(false)

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (!open) return null

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" style={{ animation: 'gc-scrim-in .2s ease both' }} onClick={onClose} />
      <div
        className="fixed bottom-6 left-1/2 z-50 flex max-h-[72vh] w-[min(620px,92vw)] -translate-x-1/2 flex-col overflow-hidden rounded-gc-lg border border-hairline-strong bg-rail shadow-gc-overlay"
        style={{ animation: 'gc-panel-in .28s cubic-bezier(.2,.8,.2,1) both' }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-[7px] w-[7px] shrink-0 rounded-full"
              style={{
                background: connected ? 'var(--color-positive)' : 'var(--color-tertiary)',
                animation: 'gc-pulse-dot 1.6s ease-in-out infinite'
              }}
            />
            <span className="font-display text-[13px] font-semibold text-primary">Agent</span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-tertiary">
              {connected ? 'connected' : 'connecting…'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setInspector(v => !v)}
              aria-pressed={inspector}
              className={`rounded-gc-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-wide ${inspector ? 'border-accent text-accent' : 'border-hairline text-tertiary hover:text-primary'}`}
            >
              Inspector
            </button>
            <button
              onClick={onClose}
              aria-label="Close agent panel"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-gc-sm border border-hairline bg-surface text-[11px] text-secondary hover:text-primary"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto px-4 py-3.5">
          {inspector ? (
            <AgentTimeline timeline={timeline} />
          ) : (
            <>
              {turns.map(turn => <TurnView key={turn.id} turn={turn} />)}

              {errors.map((e, i) => (
                <div key={`err-${i}`} className="rounded-gc-sm border border-negative/40 bg-negative/10 px-2.5 py-1.5 font-mono text-[11px] text-negative">
                  canvas error: {e}
                </div>
              ))}
            </>
          )}
        </div>

        {approval && onRespond ? (
          <div className="shrink-0 border-t border-hairline px-4 py-2.5">
            <ApprovalCard approval={approval} onRespond={onRespond} />
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5 px-4 pb-2.5">
          {SUGGESTED_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => onSend(p)}
              className="rounded-full border border-hairline bg-surface px-2.5 py-1.5 font-sans text-[11px] text-secondary hover:text-primary"
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-hairline px-4 py-3">
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded-gc-sm border border-hairline bg-surface px-2.5 py-2 font-sans text-[12.5px] text-primary outline-none focus:ring-2 focus:ring-accent"
            value={text}
            placeholder="Ask the agent to build a dashboard…"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
          <button
            className="rounded-gc-sm bg-accent px-4 py-2 font-sans text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"
            onClick={submit}
            disabled={!connected}
          >
            Send
          </button>
        </div>
      </div>
    </>
  )
}
