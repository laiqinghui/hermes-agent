export interface Verdict {
  verdict: 'rendered' | 'declined'
  reason: string
}

/** Read the judging turn's answers. "NO CANVAS: <reason>" at the START of an
 * answer is a decline; anything else means the agent chose to render.
 *
 * Start-anchored on purpose: a transcript that merely quotes the phrase must
 * not be able to flip the verdict. */
export function parseVerdict(answers: string[]): Verdict {
  for (const a of answers) {
    const t = a.trim()
    if (/^no canvas\s*:/i.test(t)) {
      return { verdict: 'declined', reason: t.replace(/^no canvas\s*:/i, '').trim() }
    }
  }
  if (!answers.length) return { verdict: 'declined', reason: 'the agent produced no answer' }
  return { verdict: 'rendered', reason: '' }
}
