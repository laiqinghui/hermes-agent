import { activityItemFromEvent, deriveActivity, type ActivityItem } from './activity'

test('derives a user/agent message thread from you + message.complete, ignoring deltas', () => {
  const items: ActivityItem[] = [
    { id: 1, kind: 'you', text: 'build a dashboard' },
    { id: 2, kind: 'message.delta', text: 'Buil' },
    { id: 3, kind: 'message.delta', text: 'ding' },
    { id: 4, kind: 'message.complete', text: 'Built a dashboard with 3 tiles.' }
  ]
  const { messages } = deriveActivity(items)
  expect(messages).toEqual([
    { id: 1, role: 'user', text: 'build a dashboard' },
    { id: 4, role: 'agent', text: 'Built a dashboard with 3 tiles.' }
  ])
})

test('pairs tool.start/tool.complete by tool_id and marks them done', () => {
  const items: ActivityItem[] = [
    { id: 1, kind: 'tool.start', text: 'render_view', toolId: 'a' },
    { id: 2, kind: 'tool.start', text: 'render_view', toolId: 'b' },
    { id: 3, kind: 'tool.complete', text: 'render_view', toolId: 'a' }
  ]
  const { trace, isBusy } = deriveActivity(items)
  expect(trace).toEqual([
    { id: 1, label: 'render_view', status: 'done' },
    { id: 2, label: 'render_view', status: 'running' }
  ])
  expect(isBusy).toBe(true)
})

test('falls back to FIFO name-based pairing when tool_id is absent', () => {
  const items: ActivityItem[] = [
    { id: 1, kind: 'tool.start', text: 'data_query' },
    { id: 2, kind: 'tool.complete', text: 'data_query' }
  ]
  const { trace, isBusy } = deriveActivity(items)
  expect(trace).toEqual([{ id: 1, label: 'data_query', status: 'done' }])
  expect(isBusy).toBe(false)
})

test('isBusy is false once every started tool has completed', () => {
  const items: ActivityItem[] = [
    { id: 1, kind: 'tool.start', text: 'x', toolId: '1' },
    { id: 2, kind: 'tool.complete', text: 'x', toolId: '1' }
  ]
  expect(deriveActivity(items).isBusy).toBe(false)
})

test('trace is capped at the most recent 8 steps', () => {
  const items: ActivityItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: i, kind: 'tool.start', text: `step${i}`, toolId: String(i)
  }))
  expect(deriveActivity(items).trace).toHaveLength(8)
  expect(deriveActivity(items).trace[0].label).toBe('step2')
})

describe('activityItemFromEvent', () => {
  it('captures structured tool.complete fields', () => {
    const it0 = activityItemFromEvent('tool.complete', {
      tool_id: 't1', name: 'search_files', context: 'searching', args: { q: 'x' }, result: { hits: 2 }, summary: '2 hits', duration_s: 1.5
    })
    expect(it0).toMatchObject({ kind: 'tool.complete', toolId: 't1', name: 'search_files', context: 'searching', summary: '2 hits', durationS: 1.5 })
    expect(it0.args).toEqual({ q: 'x' })
    expect(it0.result).toEqual({ hits: 2 })
  })
  it('captures reasoning text', () => {
    expect(activityItemFromEvent('reasoning.available', { text: 'thinking...' })).toMatchObject({ kind: 'reasoning.available', text: 'thinking...' })
  })
})

describe('deriveActivity reasoning + timeline', () => {
  const mk = (kind: string, payload: Record<string, unknown>, id: number): ActivityItem => ({ id, ...activityItemFromEvent(kind, payload) })
  it('collects reasoning and enriches completed tool steps', () => {
    const items: ActivityItem[] = [
      mk('reasoning.available', { text: 'plan' }, 1),
      mk('tool.start', { tool_id: 'a', name: 'query' }, 2),
      mk('tool.complete', { tool_id: 'a', name: 'query', args: { sql: 'x' }, result: { rows: 3 }, duration_s: 2 }, 3)
    ]
    const d = deriveActivity(items)
    expect(d.reasoning).toEqual([{ id: 1, text: 'plan' }])
    const step = d.trace.find(s => s.label === 'query')!
    expect(step.status).toBe('done')
    expect(step.args).toEqual({ sql: 'x' })
    expect(step.durationS).toBe(2)
  })
  it('builds a chronological timeline interleaving reasoning, tool, message', () => {
    const items: ActivityItem[] = [
      { id: 1, kind: 'you', text: 'hi' },
      mk('reasoning.available', { text: 'plan' }, 2),
      mk('tool.start', { tool_id: 'a', name: 'query' }, 3),
      mk('tool.complete', { tool_id: 'a', name: 'query', result: { rows: 1 } }, 4),
      mk('message.complete', { text: 'done' }, 5)
    ]
    const d = deriveActivity(items)
    expect(d.timeline.map(e => e.kind)).toEqual(['message', 'reasoning', 'tool', 'message'])
    const toolEvent = d.timeline.find(e => e.kind === 'tool')!
    expect(toolEvent.kind === 'tool' && toolEvent.step.result).toEqual({ rows: 1 })
  })
})

describe('deriveActivity turns', () => {
  const mk = (kind: string, payload: Record<string, unknown>, id: number): ActivityItem => ({ id, ...activityItemFromEvent(kind, payload) })
  it('exposes a per-turn chronological items sequence interleaving reasoning and steps', () => {
    const items: ActivityItem[] = [
      { id: 1, kind: 'you', text: 'q1' },
      mk('reasoning.available', { text: 'Identifying data agent' }, 2),
      mk('tool.start', { tool_id: 'a', name: 'skill_view' }, 3),
      mk('tool.complete', { tool_id: 'a', name: 'skill_view', result: { ok: true } }, 4),
      mk('reasoning.available', { text: 'Planning the query' }, 5),
      mk('tool.start', { tool_id: 'b', name: 'data_query' }, 6),
      mk('tool.complete', { tool_id: 'b', name: 'data_query', result: { rows: 20 } }, 7),
    ]
    const d = deriveActivity(items)
    const turn = d.turns[0]
    expect(turn.items.map(i => i.kind)).toEqual(['reasoning', 'step', 'reasoning', 'step'])
    // step entries share the enriched BuildStep object (so tool.complete result is visible)
    const firstStep = turn.items[1]
    expect(firstStep.kind === 'step' && firstStep.step.label).toBe('skill_view')
    const lastStep = turn.items[3]
    expect(lastStep.kind === 'step' && lastStep.step.status).toBe('done')
    expect(lastStep.kind === 'step' && lastStep.step.result).toEqual({ rows: 20 })
  })
  it('segments activity into one turn per user prompt', () => {
    const items: ActivityItem[] = [
      { id: 1, kind: 'you', text: 'q1' },
      mk('reasoning.available', { text: 'thinking 1' }, 2),
      mk('tool.start', { tool_id: 'a', name: 'skill_view' }, 3),
      mk('tool.complete', { tool_id: 'a', name: 'skill_view' }, 4),
      mk('message.complete', { text: 'answer 1' }, 5),
      { id: 6, kind: 'you', text: 'q2' },
      mk('tool.start', { tool_id: 'b', name: 'data_query' }, 7)
    ]
    const d = deriveActivity(items)
    expect(d.turns.length).toBe(2)
    expect(d.turns[0].prompt).toBe('q1')
    expect(d.turns[0].reasoning.map(r => r.text)).toEqual(['thinking 1'])
    expect(d.turns[0].trace.map(s => s.label)).toEqual(['skill_view'])
    expect(d.turns[0].answers).toEqual(['answer 1'])
    expect(d.turns[0].isBusy).toBe(false)
    expect(d.turns[1].prompt).toBe('q2')
    expect(d.turns[1].trace.map(s => s.label)).toEqual(['data_query'])
    expect(d.turns[1].reasoning).toEqual([])
    expect(d.turns[1].isBusy).toBe(true)
  })
  it('has no turns for an empty log', () => {
    expect(deriveActivity([]).turns).toEqual([])
  })
})
