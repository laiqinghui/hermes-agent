import { describe, it, expect } from 'vitest'
import { transcriptToTurns } from './transcript'
import type { MessageRow } from './sessions'

const row = (r: Partial<MessageRow> & { role: string }): MessageRow =>
  ({ content: null, tool_calls: null, tool_name: null, reasoning: null, reasoning_content: null, timestamp: 0, ...r })

describe('transcriptToTurns', () => {
  it('pairs a user prompt with the assistant answer', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'where are the gaps?' }),
      row({ role: 'assistant', content: 'three gaps found' }),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0].prompt).toBe('where are the gaps?')
    expect(turns[0].answers).toEqual(['three gaps found'])
    expect(turns[0].isBusy).toBe(false)
  })

  it('starts a new turn at each user message', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'first' }),
      row({ role: 'assistant', content: 'a1' }),
      row({ role: 'user', content: 'second' }),
      row({ role: 'assistant', content: 'a2' }),
    ])
    expect(turns.map(t => t.prompt)).toEqual(['first', 'second'])
    expect(turns[1].answers).toEqual(['a2'])
  })

  it('carries reasoning from either reasoning column', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', reasoning: 'thinking hard' }),
      row({ role: 'assistant', reasoning_content: 'still thinking' }),
    ])
    expect(turns[0].reasoning.map(r => r.text)).toEqual(['thinking hard', 'still thinking'])
  })

  it('turns tool_calls into trace steps', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', tool_calls: JSON.stringify([
        { function: { name: 'data_query', arguments: '{"sql":"select 1"}' } },
        { function: { name: 'render_view' } },
      ]) }),
    ])
    expect(turns[0].trace.map(s => s.label)).toEqual(['data_query', 'render_view'])
    expect(turns[0].trace.every(s => s.status === 'done')).toBe(true)
  })

  it('falls back to tool_name when tool_calls is absent', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'tool', tool_name: 'data_discover', content: 'ok' }),
    ])
    expect(turns[0].trace.map(s => s.label)).toEqual(['data_discover'])
  })

  it('degrades honestly when no reasoning was ever persisted', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', content: 'a' }),
    ])
    expect(turns[0].reasoning).toEqual([])
    expect(turns[0].answers).toEqual(['a'])
  })

  it('skips malformed tool_calls instead of throwing', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', tool_calls: 'not json', content: 'a' }),
    ])
    expect(turns[0].trace).toEqual([])
    expect(turns[0].answers).toEqual(['a'])
  })

  it('keeps assistant output that precedes any user message', () => {
    const turns = transcriptToTurns([row({ role: 'assistant', content: 'system opener' })])
    expect(turns).toHaveLength(1)
    expect(turns[0].prompt).toBeUndefined()
    expect(turns[0].answers).toEqual(['system opener'])
  })

  it('ignores empty content and returns no turns for an empty transcript', () => {
    expect(transcriptToTurns([])).toEqual([])
    expect(transcriptToTurns([row({ role: 'assistant', content: '' })])).toEqual([])
  })

  it('orders items so reasoning and steps interleave as recorded', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', reasoning: 'first think' }),
      row({ role: 'assistant', tool_calls: JSON.stringify([{ function: { name: 'data_query' } }]) }),
    ])
    expect(turns[0].items.map(i => i.kind)).toEqual(['reasoning', 'step'])
  })
})

describe('transcriptToTurns step details', () => {
  it('carries tool arguments through so the step can be expanded', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', tool_calls: JSON.stringify([
        { id: 'c1', function: { name: 'data_query', arguments: '{"sql":"select 1"}' } },
      ]) }),
    ])
    expect(turns[0].trace[0].args).toEqual({ sql: 'select 1' })
  })

  it('attaches a tool result to the call it belongs to, by tool_call_id', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', tool_calls: JSON.stringify([
        { id: 'c1', function: { name: 'data_query', arguments: '{"sql":"select 1"}' } },
      ]) }),
      row({ role: 'tool', tool_call_id: 'c1', tool_name: 'data_query', content: '{"rows":3}' }),
    ])
    // One step, not two: the tool row is the RESULT of the call, not another step.
    expect(turns[0].trace).toHaveLength(1)
    expect(turns[0].trace[0].result).toEqual({ rows: 3 })
  })

  it('keeps a non-JSON tool result as text rather than dropping it', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', tool_calls: JSON.stringify([{ id: 'c1', function: { name: 'skill_view' } }]) }),
      row({ role: 'tool', tool_call_id: 'c1', content: 'plain text result' }),
    ])
    expect(turns[0].trace[0].result).toBe('plain text result')
  })

  it('falls back to the most recent unresolved call of the same name when there is no id', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', tool_calls: JSON.stringify([{ function: { name: 'data_query' } }]) }),
      row({ role: 'tool', tool_name: 'data_query', content: 'ok' }),
    ])
    expect(turns[0].trace).toHaveLength(1)
    expect(turns[0].trace[0].result).toBe('ok')
  })

  it('still shows an orphan tool result as its own step rather than losing it', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'tool', tool_name: 'data_discover', content: 'ok' }),
    ])
    expect(turns[0].trace.map(s => s.label)).toEqual(['data_discover'])
    expect(turns[0].trace[0].result).toBe('ok')
  })

  it('leaves args undefined when the call carried none', () => {
    const turns = transcriptToTurns([
      row({ role: 'user', content: 'q' }),
      row({ role: 'assistant', tool_calls: JSON.stringify([{ function: { name: 'skill_view' } }]) }),
    ])
    expect(turns[0].trace[0].args).toBeUndefined()
  })
})
