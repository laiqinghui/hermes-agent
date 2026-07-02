import { extractCanvasEnvelope } from './extract'

const doc = {
  canvasVersion: 1, rev: 1,
  layout: { type: 'grid', cols: 12 },
  components: [{ id: 's1', type: 'stat', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 }, props: { label: 'H', value: 1 } }]
}
const envelope = { gis_canvas: true, ok: true, rev: 1, doc }

test('extracts envelope from a JSON-string payload field', () => {
  const event = { type: 'tool.complete', payload: { name: 'render_view', result: JSON.stringify(envelope) } }
  expect(extractCanvasEnvelope(event)?.doc?.rev).toBe(1)
})

test('extracts envelope from an object payload field', () => {
  const event = { type: 'tool.complete', payload: { output: envelope } }
  expect(extractCanvasEnvelope(event)?.ok).toBe(true)
})

test('extracts envelope when the payload itself is the envelope', () => {
  const event = { type: 'tool.complete', payload: envelope }
  expect(extractCanvasEnvelope(event)?.rev).toBe(1)
})

test('extracts error envelopes (ok:false)', () => {
  const errEnv = { gis_canvas: true, ok: false, rev: null, errors: ['bad spec'] }
  const event = { type: 'tool.complete', payload: { result: JSON.stringify(errEnv) } }
  expect(extractCanvasEnvelope(event)?.errors).toEqual(['bad spec'])
})

test('ignores non-canvas tool results', () => {
  const event = { type: 'tool.complete', payload: { result: '{"success": true}' } }
  expect(extractCanvasEnvelope(event)).toBeNull()
})

test('ignores other event types even if payload matches', () => {
  const event = { type: 'message.delta', payload: envelope }
  expect(extractCanvasEnvelope(event)).toBeNull()
})

test('tolerates malformed JSON strings', () => {
  const event = { type: 'tool.complete', payload: { result: '{not json' } }
  expect(extractCanvasEnvelope(event)).toBeNull()
})
