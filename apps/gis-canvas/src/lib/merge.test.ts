// apps/gis-canvas/src/lib/merge.test.ts
import { mergeOverrides } from './merge'
import type { CanvasDoc } from './types'

const doc: CanvasDoc = {
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
  components: [
    { id: 'sev', type: 'select', props: { field: 'severity', options: ['all', 'high'] }, state: { value: 'all' } },
    { id: 'c1', type: 'card', props: { title: 'x' },
      slots: { content: [{ id: 'tbl1', type: 'data-table', bindings: { source: 'mock://incidents' } }] } }
  ]
}

test('overlays override state on matching nodes (incl nested)', () => {
  const merged = mergeOverrides(doc, { sev: { value: 'high' }, tbl1: { rowSelection: ['f_82'] } })
  expect(merged.components[0].state).toEqual({ value: 'high' })
  expect(merged.components[1].slots!.content[0].state).toEqual({ rowSelection: ['f_82'] })
})

test('does not mutate the input doc', () => {
  const before = JSON.stringify(doc)
  mergeOverrides(doc, { sev: { value: 'high' } })
  expect(JSON.stringify(doc)).toBe(before)
})

test('nodes without overrides keep their state', () => {
  const merged = mergeOverrides(doc, {})
  expect(merged.components[0].state).toEqual({ value: 'all' })
})
