/**
 * Minimal, dependency-free markdown renderer for agent-authored `note` bodies.
 *
 * Emits React elements only — never dangerouslySetInnerHTML — so any HTML in the
 * source is escaped structurally by React rather than by a sanitizer we would have
 * to trust with model-written text. Supported subset: h1-h3, paragraphs, bold,
 * italic, inline code, ordered/unordered lists, horizontal rule. Links, images,
 * raw HTML and tables are deliberately unsupported (tables belong in a data-table
 * with props.rows; omitting links keeps javascript: URLs out entirely).
 */
import { createElement, type ReactNode } from 'react'

// Emphasis must not be space-padded, so prose arithmetic ("2 * 3 * 4") is left alone.
// Lookahead/lookbehind require the delimiters to hug their content, as real markdown does.
const INLINE = /(`[^`]+`|\*\*(?!\s)[^*]+(?<!\s)\*\*|\*(?![\s*])[^*\n]*?(?<![\s*])\*)/g
const HEADING = /^(#{1,3})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
const ORDERED = /^\s*\d+\.\s+(.*)$/
const RULE = /^\s*-{3,}\s*$/

const H_CLASS: Record<number, string> = {
  1: 'mt-1 mb-2 font-display text-base font-semibold text-primary',
  2: 'mt-3 mb-1.5 font-display text-sm font-semibold text-primary',
  3: 'mt-2 mb-1 font-display text-[13px] font-semibold text-secondary'
}

export function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyPrefix}-${n++}`
    if (tok.startsWith('`')) {
      out.push(createElement('code', { key, className: 'rounded bg-surface-raised px-1 font-mono text-[0.9em]' }, tok.slice(1, -1)))
    } else if (tok.startsWith('**')) {
      out.push(createElement('strong', { key, className: 'font-semibold text-primary' }, tok.slice(2, -2)))
    } else {
      out.push(createElement('em', { key }, tok.slice(1, -1)))
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function renderMarkdown(src: string): ReactNode[] {
  const lines = (src ?? '').split('\n')
  const out: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let k = 0

  const flushPara = () => {
    if (!para.length) return
    const key = `p-${k++}`
    out.push(createElement('p', { key, className: 'mb-2' }, renderInline(para.join(' '), key)))
    para = []
  }
  const flushList = () => {
    if (!list) return
    const key = `l-${k++}`
    const items = list.items.map((t, i) =>
      createElement('li', { key: `${key}-${i}`, className: 'mb-0.5' }, renderInline(t, `${key}-${i}`))
    )
    out.push(createElement(list.ordered ? 'ol' : 'ul', {
      key, className: list.ordered ? 'mb-2 list-decimal pl-5' : 'mb-2 list-disc pl-5'
    }, items))
    list = null
  }
  const flush = () => { flushPara(); flushList() }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { flush(); continue }

    const h = HEADING.exec(line)
    if (h) {
      flush()
      const key = `h-${k++}`
      out.push(createElement(`h${h[1].length}`, { key, className: H_CLASS[h[1].length] }, renderInline(h[2], key)))
      continue
    }

    // checked before BULLET: '---' has no space after the dash so it cannot match a bullet
    if (RULE.test(line)) {
      flush()
      out.push(createElement('hr', { key: `hr-${k++}`, className: 'my-3 border-hairline' }))
      continue
    }

    const b = BULLET.exec(line)
    if (b) {
      flushPara()
      if (list?.ordered) flushList()
      if (!list) list = { ordered: false, items: [] }
      list.items.push(b[1])
      continue
    }

    const o = ORDERED.exec(line)
    if (o) {
      flushPara()
      if (list && !list.ordered) flushList()
      if (!list) list = { ordered: true, items: [] }
      list.items.push(o[1])
      continue
    }

    flushList()
    para.push(line.trim())
  }
  flush()
  return out
}
