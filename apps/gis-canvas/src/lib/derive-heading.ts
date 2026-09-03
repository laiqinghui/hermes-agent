import { stripInlineMarkdown } from './plain-text'

const MAX = 60

/** A short title derived from a reasoning body (the gateway sends no heading).
 * The first line if it is short and reads like a title; otherwise a
 * word-boundary truncation of the first line with an ellipsis. '' for empty.
 *
 * Emphasis is stripped: models routinely open a reasoning block with a bold
 * title, and a heading is plain text by definition — it is truncated and shown
 * in a single line, so markup would only ever leak through as literal `**`. */
export function deriveHeading(text: string): string {
  const t = (text ?? '').trim()
  if (!t) return ''
  const firstLine = stripInlineMarkdown(t.split(/\r?\n/)[0]).trim()
  if (firstLine.length <= MAX && !/[.!?]/.test(firstLine)) return firstLine
  if (firstLine.length <= MAX) return firstLine.replace(/[.!?]+$/, '')
  const cut = firstLine.slice(0, MAX)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut
  return base.trim() + '…'
}
