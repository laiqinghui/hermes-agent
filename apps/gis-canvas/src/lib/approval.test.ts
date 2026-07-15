import { describe, it, expect } from 'vitest'
import { approvalFromEvent } from './approval'

describe('approvalFromEvent', () => {
  it('maps the redacted command, description, and pattern keys', () => {
    expect(approvalFromEvent({
      command: 'python - <<EOF',
      description: 'Run a python script',
      pattern_keys: ['execute_code', 'terminal']
    })).toEqual({
      command: 'python - <<EOF',
      description: 'Run a python script',
      patternKeys: ['execute_code', 'terminal']
    })
  })
  it('tolerates a missing/partial payload', () => {
    expect(approvalFromEvent(undefined)).toEqual({ command: '' })
    expect(approvalFromEvent({ command: 'ls' })).toEqual({ command: 'ls' })
  })
  it('ignores non-string pattern keys', () => {
    expect(approvalFromEvent({ command: 'x', pattern_keys: ['a', 2, null] })).toEqual({ command: 'x', patternKeys: ['a'] })
  })
})
