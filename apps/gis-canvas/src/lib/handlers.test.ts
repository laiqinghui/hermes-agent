// apps/gis-canvas/src/lib/handlers.test.ts
import { runHandler, type CanvasActions } from './handlers'
import type { ComponentNode, Handler } from './types'

function spyActions() {
  const calls: string[] = []
  const actions: CanvasActions = {
    reportInteraction: (id, patch) => calls.push(`report:${id}:${JSON.stringify(patch)}`),
    setLocalState: (id, patch) => calls.push(`local:${id}:${JSON.stringify(patch)}`),
    sendPrompt: text => calls.push(`prompt:${text}`)
  }
  return { actions, calls }
}

const node: ComponentNode = { id: 'sev', type: 'select', props: { field: 'severity' } }

test('set handler reports interaction to the target', () => {
  const { actions, calls } = spyActions()
  const h: Handler = { kind: 'set', target: 'tbl1', key: 'rowSelection', value: ['f_82'] }
  runHandler(h, node, actions, { value: undefined })
  expect(calls).toContain('report:tbl1:{"rowSelection":["f_82"]}')
})

test('reactive handler writes the event value into the controls path (id.key.subkey)', () => {
  const { actions, calls } = spyActions()
  const h: Handler = { kind: 'reactive', controls: 'tbl1.filter.severity' }
  runHandler(h, node, actions, { value: 'high' })
  // writes {filter:{severity:'high'}} onto tbl1, and records it
  expect(calls).toContain('report:tbl1:{"filter":{"severity":"high"}}')
})

test('agent handler sends the prompt', () => {
  const { actions, calls } = spyActions()
  const h: Handler = { kind: 'agent', prompt: 'Summarize selection' }
  runHandler(h, node, actions, { value: undefined })
  expect(calls).toContain('prompt:Summarize selection')
})
