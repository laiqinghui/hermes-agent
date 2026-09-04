import { describe, it, expect } from 'vitest'
import { packTranscript } from './transcript-pack'
import type { MessageRow } from './sessions'

const row = (role: string, content: string): MessageRow =>
  ({ role, content, tool_calls: null, tool_name: null, reasoning: null, reasoning_content: null, timestamp: 0 })

describe('packTranscript', () => {
  it('passes a short transcript through whole', () => {
    const out = packTranscript([row('user', 'hello'), row('assistant', 'hi there')])
    expect(out).toContain('hello')
    expect(out).toContain('hi there')
    expect(out).not.toContain('omitted')
  })

  it('keeps the head and the tail and elides the middle when over budget', () => {
    const rows = [
      row('user', 'THE ORIGINAL ASK'),
      ...Array.from({ length: 200 }, (_, i) => row('assistant', `filler ${i} ${'x'.repeat(200)}`)),
      row('assistant', 'THE FINAL CONCLUSION'),
    ]
    const out = packTranscript(rows, 2000)
    expect(out).toContain('THE ORIGINAL ASK')
    expect(out).toContain('THE FINAL CONCLUSION')
    expect(out).toMatch(/omitted/i)
    expect(out.length).toBeLessThanOrEqual(2400) // budget + elision marker slack
  })

  it('never drops the tail in favour of the head', () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, i) => row('user', `head ${i} ${'y'.repeat(300)}`)),
      row('assistant', 'THE FINAL CONCLUSION'),
    ]
    const out = packTranscript(rows, 800)
    expect(out).toContain('THE FINAL CONCLUSION')
  })

  it('names the tools used in the elided middle', () => {
    const rows = [
      row('user', 'ask'),
      ...Array.from({ length: 100 }, () => ({ ...row('assistant', 'x'.repeat(300)), tool_name: 'data_query' })),
      row('assistant', 'done'),
    ]
    const out = packTranscript(rows, 900)
    expect(out).toContain('data_query')
  })

  it('handles an empty transcript', () => {
    expect(packTranscript([])).toBe('')
  })
})
