import { describe, it, expect } from 'vitest'
import { buildJudgePrompt } from './judge'
import type { SessionRow } from './sessions'

const row: SessionRow = {
  id: 'tg1', source: 'telegram', title: 'Vessel gaps', preview: 'find gaps',
  message_count: 12, started_at: 1, last_active: 2,
}

describe('buildJudgePrompt', () => {
  it('carries the transcript and names the source session', () => {
    const p = buildJudgePrompt(row, 'USER: find gaps\nASSISTANT: three found')
    expect(p).toContain('three found')
    expect(p).toContain('telegram')
    expect(p).toContain('Vessel gaps')
  })

  it('instructs the model to weight the final messages', () => {
    expect(buildJudgePrompt(row, 'x')).toMatch(/final messages/i)
  })

  it('makes declining an explicit, allowed outcome', () => {
    expect(buildJudgePrompt(row, 'x')).toMatch(/NO CANVAS/i)
  })

  it('marks the transcript as untrusted data, not instructions', () => {
    expect(buildJudgePrompt(row, 'x')).toMatch(/not instructions/i)
  })
})
