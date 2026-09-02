import type { BuildStep, Turn, TurnItem } from './activity'
import type { MessageRow } from './sessions'

/** Parse a `tool_calls` JSON blob into step labels. The column is written by
 * several providers with slightly different shapes, and a malformed blob must
 * never break the replay — an unreadable blob contributes no steps. */
function toolLabels(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((c: Record<string, unknown>) => {
        const fn = c.function as Record<string, unknown> | undefined
        return String(fn?.name ?? c.name ?? '').trim()
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Replay a stored transcript as the Turn[] the cognition UI already renders.
 *
 * Best-effort by design: providers differ in what they persist. A transcript
 * with no reasoning yields turns with empty `reasoning` — the panel says so.
 * Reasoning is NEVER synthesised to fill the gap. */
export function transcriptToTurns(rows: MessageRow[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null
  let seq = 0

  const open = (prompt?: string): Turn => {
    const t: Turn = { id: turns.length, prompt, reasoning: [], trace: [], items: [], answers: [], isBusy: false }
    turns.push(t)
    return t
  }

  for (const r of rows) {
    const text = (r.content ?? '').trim()

    if (r.role === 'user') {
      current = open(text || undefined)
      continue
    }

    const reasoning = (r.reasoning ?? r.reasoning_content ?? '').trim()
    const labels = toolLabels(r.tool_calls)
    const named = (r.tool_name ?? '').trim()
    const steps = labels.length ? labels : named ? [named] : []

    // Nothing worth showing — don't manufacture an empty turn for it.
    if (!text && !reasoning && !steps.length) continue

    if (!current) current = open(undefined)

    if (reasoning) {
      const item = { id: seq++, text: reasoning }
      current.reasoning.push(item)
      current.items.push({ kind: 'reasoning', ...item } as TurnItem)
    }
    for (const label of steps) {
      const step: BuildStep = { id: seq++, label, status: 'done' }
      current.trace.push(step)
      current.items.push({ kind: 'step', id: step.id, step })
    }
    // A tool result row carries its payload in `content`; that belongs to the
    // step, not to the agent's answer to the user.
    if (text && r.role !== 'tool') current.answers.push(text)
  }

  return turns
}
