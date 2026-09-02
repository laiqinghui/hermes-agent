import { describe, it, expect } from 'vitest'
import { parseVerdict } from './verdict'

describe('parseVerdict', () => {
  it('reads an explicit decline and its reason', () => {
    expect(parseVerdict(['NO CANVAS: this was a debugging session.']))
      .toEqual({ verdict: 'declined', reason: 'this was a debugging session.' })
  })

  it('is case- and whitespace-tolerant about the marker', () => {
    expect(parseVerdict(['  no canvas:  nothing to plot ']).verdict).toBe('declined')
  })

  it('treats anything else as a render', () => {
    expect(parseVerdict(['I have laid out the vessel tracks and the gap table.']).verdict).toBe('rendered')
  })

  it('only honours the marker at the start of an answer', () => {
    // A transcript that merely mentions the phrase must not flip the verdict.
    expect(parseVerdict(['The user said "NO CANVAS: x" earlier, but here is the map.']).verdict).toBe('rendered')
  })

  it('checks every answer, not just the first', () => {
    expect(parseVerdict(['Looking at this…', 'NO CANVAS: chit-chat only']).verdict).toBe('declined')
  })

  it('treats no answer at all as declined', () => {
    expect(parseVerdict([])).toEqual({ verdict: 'declined', reason: 'the agent produced no answer' })
  })
})
