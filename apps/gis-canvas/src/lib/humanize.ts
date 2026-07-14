/** Human-readable label from an identifier. Splits on `_`/`-`/whitespace and
 * Title-cases each token, preserving tokens that are already Cased:
 * `skill_view` → "Skill View", `RowCount` → "RowCount", `handle` → "Handle".
 * Used for both tool names and object keys. Empty input is returned unchanged. */
export function humanizeLabel(s: string): string {
  if (!s) return s
  return s
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}
