import { useEffect, useState } from 'react'

// Typewriter over the agent's current reasoning text. Pure client animation —
// the agent emits reasoning on the token stream; it never calls a tool for this.
export function ThinkingMolecule({ text, speedMs = 18 }: { text: string; speedMs?: number }) {
  const [shown, setShown] = useState(0)

  // Restart whenever text (or speed) changes, then self-schedule each tick
  // directly off the previous timer's callback (rather than via a render
  // effect keyed on `shown`) so the whole reveal can fire within a single
  // fake-timer advance in tests, and ticks aren't gated behind a render.
  useEffect(() => {
    setShown(0)
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(text.length); return }
    let cancelled = false
    let i = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      if (cancelled) return
      i += 1
      setShown(i)
      if (i < text.length) timer = setTimeout(tick, speedMs)
    }
    if (text.length > 0) timer = setTimeout(tick, speedMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, speedMs])

  return (
    <div
      data-testid="thinking-molecule"
      className="w-full rounded-gc-lg border border-accent/40 bg-surface/90 px-4 py-3.5 shadow-gc-overlay backdrop-blur"
    >
      <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[.14em] text-accent">◆ Thinking</div>
      <div className="min-h-[2.6em] max-h-[38vh] overflow-hidden whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-primary">
        {text.slice(0, shown)}
        <span aria-hidden className="gc-caret text-accent">▍</span>
      </div>
    </div>
  )
}
