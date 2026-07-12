import { deriveActivity, type ActivityItem } from './activity'

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
