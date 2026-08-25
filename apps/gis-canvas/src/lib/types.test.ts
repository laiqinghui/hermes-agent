import { MOLECULE_TYPES } from './types'
import type { CanvasDoc } from './types'

test('catalog includes all registered molecule types', () => {
  expect([...MOLECULE_TYPES]).toEqual(['card', 'stat', 'data-table', 'select', 'tabs', 'esri:map', 'esri:legend', 'esri:layer-list', 'esri:time-slider', 'entity-detail', 'esri:feature-table'])
})

test('a canonical doc typechecks', () => {
  const doc: CanvasDoc = {
    canvasVersion: 1,
    rev: 1,
    layout: { type: 'grid', cols: 12, rowHeight: 80, gap: 8 },
    components: [
      { id: 's1', type: 'stat', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 }, props: { label: 'High', value: 42 } }
    ]
  }
  expect(doc.rev).toBe(1)
})
