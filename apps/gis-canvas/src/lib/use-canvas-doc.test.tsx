import { act, renderHook } from '@testing-library/react'
import { useCanvasDoc } from './use-canvas-doc'

type Handler = (event: { type?: string; payload?: unknown }) => void

function fakeClient() {
  const handlers = new Map<string, Handler[]>()
  return {
    on(type: string, handler: Handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler])
      return () => undefined
    },
    emit(type: string, event: { type?: string; payload?: unknown }) {
      for (const h of handlers.get(type) ?? []) h(event)
    }
  }
}

const doc = {
  canvasVersion: 1, rev: 1,
  layout: { type: 'grid', cols: 12 },
  components: [{ id: 's1', type: 'stat', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 }, props: { label: 'H', value: 1 } }]
}

test('updates doc when a canvas envelope arrives on tool.complete', () => {
  const client = fakeClient()
  const { result } = renderHook(() => useCanvasDoc(client))
  expect(result.current.doc).toBeNull()
  act(() => {
    client.emit('tool.complete', {
      type: 'tool.complete',
      payload: { result: JSON.stringify({ gis_canvas: true, ok: true, rev: 1, doc }) }
    })
  })
  expect(result.current.doc?.rev).toBe(1)
  expect(result.current.errors).toEqual([])
})

test('surfaces errors from ok:false envelopes without clearing the doc', () => {
  const client = fakeClient()
  const { result } = renderHook(() => useCanvasDoc(client))
  act(() => {
    client.emit('tool.complete', {
      type: 'tool.complete',
      payload: { result: JSON.stringify({ gis_canvas: true, ok: true, rev: 1, doc }) }
    })
    client.emit('tool.complete', {
      type: 'tool.complete',
      payload: { result: JSON.stringify({ gis_canvas: true, ok: false, rev: 1, errors: ['stale base_rev'] }) }
    })
  })
  expect(result.current.doc?.rev).toBe(1) // still rendered
  expect(result.current.errors).toEqual(['stale base_rev'])
})

test('ignores unrelated tool results', () => {
  const client = fakeClient()
  const { result } = renderHook(() => useCanvasDoc(client))
  act(() => {
    client.emit('tool.complete', { type: 'tool.complete', payload: { result: '{"success":true}' } })
  })
  expect(result.current.doc).toBeNull()
})

test('exposes setDoc so a stored canvas can be installed without an agent turn', () => {
  const { result } = renderHook(() => useCanvasDoc(fakeClient()))
  expect(result.current.doc).toBeNull()
  act(() => result.current.setDoc({ canvasVersion: 1, rev: 7, layout: { type: 'grid', cols: 12 }, components: [] }))
  expect(result.current.doc?.rev).toBe(7)
})
