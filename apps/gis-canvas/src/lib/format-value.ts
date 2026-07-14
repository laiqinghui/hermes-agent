/** Render an arbitrary tool arg/result value as readable text for the trace UI.
 * Strings pass through; objects are pretty-printed JSON; nullish shows a dash.
 * Long output is truncated with an ellipsis marker (default cap 2000 chars). */
export function formatValue(v: unknown, max = 2000): string {
  if (v === null || v === undefined) return '—'
  let s: string
  if (typeof v === 'string') s = v
  else {
    try { s = JSON.stringify(v, null, 2) } catch { s = String(v) }
  }
  return s.length > max ? s.slice(0, max) + '\n… (truncated)' : s
}
