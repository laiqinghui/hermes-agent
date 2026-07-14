import { humanizeLabel } from './humanize'

const MAX_STR = 80

/** One-line summary of a value for the trace UI: scalars inline, arrays as
 * "N items" (+ "(M fields)" when elements are objects), objects as "N fields". */
export function summarizeValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    const n = v.length
    const base = `${n} item${n === 1 ? '' : 's'}`
    const firstObj = v.find(x => x !== null && typeof x === 'object' && !Array.isArray(x))
    if (firstObj) return `${base} (${Object.keys(firstObj as object).length} fields)`
    return base
  }
  if (typeof v === 'object') {
    const k = Object.keys(v as object).length
    return `${k} field${k === 1 ? '' : 's'}`
  }
  return String(v)
}

/** Top-level field/element count for a header "N items" chip. */
export function fieldCount(v: unknown): number {
  if (Array.isArray(v)) return v.length
  if (v !== null && typeof v === 'object') return Object.keys(v as object).length
  return 0
}

/** Whether a value has rows worth expanding into. */
export function isExpandable(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  return v !== null && typeof v === 'object' && Object.keys(v as object).length > 0
}

export interface ValueRow { label: string; value: unknown }

/** Break a value into labeled child rows: humanized keys for objects,
 * `[i]` indices for arrays, none for scalars. */
export function toRows(v: unknown): ValueRow[] {
  if (Array.isArray(v)) return v.map((value, i) => ({ label: `[${i}]`, value }))
  if (v !== null && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).map(([key, value]) => ({ label: humanizeLabel(key), value }))
  }
  return []
}
