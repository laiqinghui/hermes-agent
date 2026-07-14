import { useEffect, useRef, useState } from 'react'
import type { BuildStep, ChatMessage, ReasoningItem, TimelineEvent } from '../lib/activity'
import { TraceStep } from './TraceStep'
import { AgentTimeline } from './AgentTimeline'
import { deriveHeading } from '../lib/derive-heading'

// Domain-neutral defaults — this panel is shared chrome, not tied to any one dataset.
const SUGGESTED_PROMPTS = ['Build a dashboard', 'Summarize the data', 'Add a map']

export function AgentPanel({
  open,
  onClose,
  messages,
  trace,
  reasoning = [],
  timeline = [],
  errors,
  connected,
  onSend
}: {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  trace: BuildStep[]
  reasoning?: ReasoningItem[]
  timeline?: TimelineEvent[]
  errors: string[]
  connected: boolean
  onSend: (text: string) => void
}) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [inspector, setInspector] = useState(false)
  const [showThinking, setShowThinking] = useState(false)

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
              {messages.map(m => (
                <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex items-start gap-2'}>
                  {m.role === 'agent' ? (
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-gc-sm border border-hairline bg-surface font-display text-[11px] font-bold text-accent">
                      H
                    </span>
                  ) : null}
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[86%] rounded-[12px_12px_3px_12px] bg-accent px-3 py-2 font-sans text-[12.5px] leading-relaxed text-accent-fg'
                        : 'max-w-[86%] rounded-[3px_12px_12px_12px] border border-hairline bg-surface px-3 py-2 font-sans text-[12.5px] leading-relaxed text-primary'
                    }
                  >
                    {m.text}
                  </div>
                </div>
              ))}

              {reasoning.length ? (
                <div className="rounded-gc-md border border-hairline bg-surface-raised/50">
                  <button
                    type="button"
                    onClick={() => setShowThinking(s => !s)}
                    aria-expanded={showThinking}
                    className="flex w-full items-center justify-between px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-tertiary"
                  >
                    <span>Thinking ({reasoning.length})</span>
                    <span aria-hidden>{showThinking ? '▾' : '▸'}</span>
                  </button>
                  {showThinking ? (
                    <div className="flex flex-col gap-2 px-3 pb-2.5">
                      {reasoning.map(r => {
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

              {trace.length ? (
                <div className="rounded-gc-md border border-hairline bg-surface p-3">
                  <div className="mb-1 font-mono text-[9.5px] tracking-[.1em] text-tertiary">FORMULATING CANVAS</div>
                  {trace.map(step => <TraceStep key={step.id} step={step} />)}
                </div>
              ) : null}

              {errors.map((e, i) => (
                <div key={`err-${i}`} className="rounded-gc-sm border border-negative/40 bg-negative/10 px-2.5 py-1.5 font-mono text-[11px] text-negative">
                  canvas error: {e}
                </div>
              ))}
            </>
          )}
        </div>

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
