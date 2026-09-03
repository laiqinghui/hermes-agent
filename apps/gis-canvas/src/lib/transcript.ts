import type { BuildStep, Turn, TurnItem } from './activity'
import type { MessageRow } from './sessions'

interface ToolCall {
  id?: string
  name: string
  args?: unknown
}

/** Best-effort JSON: providers store tool arguments and results as strings that
 * are usually — but not always — JSON. Non-JSON stays text rather than being
 * dropped, because a plain-text result is still worth showing. */
function maybeJson(raw: string): unknown {
  const t = raw.trim()
  if (!t) return undefined
  if (!/^[[{]/.test(t)) return raw
  try {
    return JSON.parse(t)
  } catch {
    return raw
  }
}

/** Parse a `tool_calls` JSON blob. The column is written by several providers
 * with slightly different shapes, and a malformed blob must never break the
 * replay — an unreadable blob contributes no calls. */
function toolCalls(raw: string | null | undefined): ToolCall[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((c: Record<string, unknown>) => {
        const fn = (c.function ?? {}) as Record<string, unknown>
        const name = String(fn.name ?? c.name ?? '').trim()
        const rawArgs = fn.arguments ?? c.arguments
        return {
          id: typeof c.id === 'string' ? c.id : undefined,
          name,
          args: typeof rawArgs === 'string' ? maybeJson(rawArgs) : rawArgs,
        }
      })
      .filter(c => c.name)
  } catch {
    return []
  }
}

/** Replay a stored transcript as the Turn[] the cognition UI already renders.
 *
 * Best-effort by design: providers differ in what they persist. A transcript
 * with no reasoning yields turns with empty `reasoning` — the panel says so.
 * Reasoning is NEVER synthesised to fill the gap.
 *
 * Tool rows are the RESULT of an earlier call, not steps of their own: they are
 * paired back onto their call (by `tool_call_id`, else by the most recent
 * unresolved call of the same name) so a step shows its args and its result the
 * way a live step does. A result that pairs with nothing still becomes its own
 * step rather than being lost. */
export function transcriptToTurns(rows: MessageRow[]): Turn[] {
  const turns: Turn[] = []
  let current: Turn | null = null
  let seq = 0
  // Calls awaiting their result, for the current turn.
  let pending: Array<{ id?: string; name: string; step: BuildStep }> = []

  const open = (prompt?: string): Turn => {
    const t: Turn = { id: turns.length, prompt, reasoning: [], trace: [], items: [], answers: [], isBusy: false }
    turns.push(t)
    pending = []
    return t
  }

  const addStep = (label: string, args?: unknown): BuildStep => {
    const step: BuildStep = { id: seq++, label, status: 'done' }
    if (args !== undefined) step.args = args
    current!.trace.push(step)
    current!.items.push({ kind: 'step', id: step.id, step })
    return step
  }

  for (const r of rows) {
    const text = (r.content ?? '').trim()

    if (r.role === 'user') {
      current = open(text || undefined)
      continue
    }

    const reasoning = (r.reasoning ?? r.reasoning_content ?? '').trim()
    const calls = toolCalls(r.tool_calls)
    const named = (r.tool_name ?? '').trim()

    if (!text && !reasoning && !calls.length && !named) continue
    if (!current) current = open(undefined)

    if (reasoning) {
      const item = { id: seq++, text: reasoning }
      current.reasoning.push(item)
      current.items.push({ kind: 'reasoning', ...item } as TurnItem)
    }

    for (const c of calls) {
      pending.push({ id: c.id, name: c.name, step: addStep(c.name, c.args) })
    }

    // A tool row carries a call's OUTPUT. Pair it back onto the call so the step
    // renders args + result together, like a live one.
    if (r.role === 'tool') {
      const byId = r.tool_call_id ? pending.findIndex(p => p.id === r.tool_call_id) : -1
      const idx = byId >= 0 ? byId : pending.findIndex(p => p.name === named && p.step.result === undefined)
      const target = idx >= 0 ? pending.splice(idx, 1)[0].step : named ? addStep(named) : null
      if (target && text) target.result = maybeJson(text)
      continue
    }

    if (text) current.answers.push(text)
  }

  return turns
}
