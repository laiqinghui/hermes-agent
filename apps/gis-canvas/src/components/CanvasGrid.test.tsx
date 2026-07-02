import { render, screen } from '@testing-library/react'
import { CanvasGrid } from './CanvasGrid'
import type { CanvasDoc } from '../lib/types'

function doc(): CanvasDoc {
  return {
    canvasVersion: 1,
    rev: 1,
    layout: { type: 'grid', cols: 12, rowHeight: 80, gap: 8 },
    components: [
      {
        id: 's1', type: 'stat',
        area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
        props: { label: 'High severity', value: 42 }
      },
      {
        id: 'c1', type: 'card',
        area: { col: 4, colSpan: 8, row: 1, rowSpan: 3 },
        props: { title: 'Incidents' },
        slots: {
          content: [{ id: 't1', type: 'data-table', bindings: { source: 'mock://incidents' } }],
          footer: [{ id: 's2', type: 'stat', props: { label: 'Total', value: 8 } }]
        }
      }
    ]
  }
}

test('renders stat molecule with label and value', () => {
  render(<CanvasGrid doc={doc()} />)
  expect(screen.getByText('High severity')).toBeInTheDocument()
  expect(screen.getByText('42')).toBeInTheDocument()
})

test('renders card with title and nested slot children', () => {
  render(<CanvasGrid doc={doc()} />)
  expect(screen.getByText('Incidents')).toBeInTheDocument()
  expect(screen.getByText('Total')).toBeInTheDocument() // footer slot child
})

test('data-table renders rows from mock source', () => {
  render(<CanvasGrid doc={doc()} />)
  expect(screen.getByText('f_82')).toBeInTheDocument()
  expect(screen.getAllByText('Downtown').length).toBeGreaterThanOrEqual(3)
})

test('data-table respects props.columns subset', () => {
  const d = doc()
  const table = d.components[1].slots!.content[0]
  table.props = { columns: ['id', 'severity'] }
  render(<CanvasGrid doc={d} />)
  expect(screen.getByText('f_82')).toBeInTheDocument()
  expect(screen.queryByText('Downtown')).not.toBeInTheDocument()
})

test('unknown component type renders fallback tile, not a crash', () => {
  const d = doc()
  d.components.push({
    id: 'x1', type: 'esri:map',
    area: { col: 1, colSpan: 3, row: 2, rowSpan: 2 }
  })
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('unknown-tile')).toHaveTextContent('esri:map')
})

test('top-level placement maps to grid CSS', () => {
  render(<CanvasGrid doc={doc()} />)
  const cell = screen.getByTestId('cell-s1')
  expect(cell.style.gridColumn).toBe('1 / span 3')
  expect(cell.style.gridRow).toBe('1 / span 1')
})
