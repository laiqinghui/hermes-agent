import type { BuildStep } from './activity'
import { humanizeLabel } from './humanize'
import { describeStep } from './cognition'

/** Outcome of a step for the cognition UI: running (in flight), error, or ok. */
export type StepOutcome = 'ok' | 'error' | 'running'

export interface StepNarration {
  /** Human sentence, e.g. "Queried admin.vessel_positions · 20 rows". */
  text: string
  outcome: StepOutcome
  /** '✓' ok · '✕' error · '·' running. */
  glyph: string
}

const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

const firstStr = (o: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const k of keys) {
    const s = str(o[k])
    if (s) return s
  }
  return undefined
}

const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const hostOf = (u: string): string => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}

function outcomeOf(step: BuildStep): StepOutcome {
  if (step.status === 'running') return 'running'
  return describeStep(step).shape === 'error' ? 'error' : 'ok'
}

/** A concise result tail (error summary or row count), or '' when neither applies. */
function resultTail(step: BuildStep): string {
  const d = describeStep(step)
  if (d.shape === 'error') return d.summary
  if (typeof d.rowCount === 'number') return `${d.rowCount} row${d.rowCount === 1 ? '' : 's'}`
  return ''
}

export function narrateStep(step: BuildStep): StepNarration {
  const outcome = outcomeOf(step)
  const glyph = outcome === 'error' ? '✕' : outcome === 'running' ? '·' : '✓'
  const a = rec(step.args)
  const r = rec(step.result)
  const tail = resultTail(step)
  const withTail = (head: string) => (tail ? `${head} · ${tail}` : head)

  let text: string
  switch (step.label) {
    case 'skill_view':
      text = `Read skill · ${firstStr(a, ['name', 'skill', 'skill_name']) ?? '—'}`
      break
    case 'data_query':
      text = withTail(`Queried ${firstStr(a, ['table', 'view', 'dataset', 'from', 'source']) ?? 'data'}`)
      break
    case 'search_files': {
      const n = typeof r.total_count === 'number' ? (r.total_count as number) : undefined
      text = n !== undefined ? `Searched files · ${n} match${n === 1 ? '' : 'es'}` : 'Searched files'
      break
    }
    case 'read_file': {
      const p = firstStr(a, ['path', 'file', 'filename'])
      text = `Read ${p ? basename(p) : '—'}`
      break
    }
    case 'execute_code':
      text = `Ran ${firstStr(a, ['language', 'lang']) ?? 'code'}`
      break
    case 'terminal': {
      const cmd = firstStr(a, ['command', 'cmd'])
      text = `Ran ${cmd ? cmd.split(/\s+/)[0] : 'command'}`
      break
    }
    case 'render_view':
      text = 'Rendered the canvas'
      break
    case 'browser_navigate': {
      const u = firstStr(a, ['url', 'href'])
      text = `Opened ${u ? hostOf(u) : 'page'}`
      break
    }
    default:
      text = withTail(humanizeLabel(step.label))
  }

  return { text, outcome, glyph }
}
