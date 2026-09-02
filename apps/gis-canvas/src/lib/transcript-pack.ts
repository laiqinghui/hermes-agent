import type { MessageRow } from './sessions'

const DEFAULT_BUDGET = 12000
/** Share of the budget reserved for the tail. The render decision hinges on
 * how the session ENDED — an analysis states its conclusions last — so the
 * tail is the part that must never be sacrificed. */
const TAIL_SHARE = 0.6

function line(r: MessageRow): string {
  const who = r.role === 'user' ? 'USER' : r.role === 'tool' ? 'TOOL' : 'ASSISTANT'
  const tool = (r.tool_name ?? '').trim()
  const body = (r.content ?? r.reasoning ?? r.reasoning_content ?? '').trim()
  return `${who}${tool ? ` (${tool})` : ''}: ${body}`
}

function take(rows: MessageRow[], budget: number, fromEnd: boolean): { text: string; used: number; kept: number } {
  const out: string[] = []
  let used = 0
  const seq = fromEnd ? [...rows].reverse() : rows
  for (const r of seq) {
    const l = line(r)
    if (used + l.length > budget) break
    out.push(l)
    used += l.length + 1
  }
  if (fromEnd) out.reverse()
  return { text: out.join('\n'), used, kept: out.length }
}

/** Render a transcript for the judging model: the opening exchange (what was
 * actually asked), the closing exchange verbatim, and a summary of what was
 * elided in between. */
export function packTranscript(rows: MessageRow[], budget: number = DEFAULT_BUDGET): string {
  if (!rows.length) return ''

  const whole = rows.map(line).join('\n')
  if (whole.length <= budget) return whole

  const tail = take(rows, Math.floor(budget * TAIL_SHARE), true)
  const headRows = rows.slice(0, Math.max(0, rows.length - tail.kept))
  const head = take(headRows, Math.max(0, budget - tail.used), false)

  const elided = rows.length - head.kept - tail.kept
  const tools = [...new Set(rows.map(r => (r.tool_name ?? '').trim()).filter(Boolean))]

  const marker = `\n… ${Math.max(0, elided)} messages omitted${
    tools.length ? `; tools used throughout: ${tools.join(', ')}` : ''
  } …\n`

  return `${head.text}${marker}${tail.text}`
}
