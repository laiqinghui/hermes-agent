import { render, screen, waitFor } from '@testing-library/react'
import { CanvasGrid } from './CanvasGrid'
import type { CanvasDoc } from '../lib/types'
import { HandlerProvider } from './HandlerContext'
import type { CanvasActions } from '../lib/handlers'

function renderWithActions(d: CanvasDoc, actions: Partial<CanvasActions> = {}) {
  const full: CanvasActions = {
    setLocalState: () => {},
    reportInteraction: () => {},
    sendPrompt: () => {},
    fetchData: async () => ({ ok: true, rows: [], schema: [], total: 0, page: 0, pageSize: 0 }),
    ...actions
  }
  return render(
    <HandlerProvider actions={full}>
      <CanvasGrid doc={d} />
    </HandlerProvider>
  )
}

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
    id: 'x1', type: 'future:widget',
    area: { col: 1, colSpan: 3, row: 2, rowSpan: 2 }
  })
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('unknown-tile')).toHaveTextContent('future:widget')
})

test('top-level placement maps to grid CSS', () => {
  render(<CanvasGrid doc={doc()} />)
  const cell = screen.getByTestId('cell-s1')
  expect(cell.style.gridColumn).toBe('1 / span 3')
  expect(cell.style.gridRow).toBe('1 / span 1')
})

test('select renders options and reports interaction on change', () => {
  const reports: string[] = []
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 'sev', type: 'select', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
        props: { field: 'severity', options: ['all', 'high', 'low'] }, state: { value: 'all' },
        handlers: { onChange: { kind: 'reactive', controls: 'tbl1.filter.severity' } } }
    ]
  }
  renderWithActions(d, { reportInteraction: (id, patch) => reports.push(`${id}:${JSON.stringify(patch)}`) })
  const select = screen.getByRole('combobox')
  select.dispatchEvent(new Event('change', { bubbles: true }))
  // change to 'high'
  ;(select as HTMLSelectElement).value = 'high'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  expect(reports).toContain('tbl1:{"filter":{"severity":"high"}}')
})

test('data-table filters rows by state.filter', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 'tbl1', type: 'data-table', area: { col: 1, colSpan: 12, row: 1, rowSpan: 4 },
        bindings: { source: 'mock://incidents' }, state: { filter: { severity: 'low' } } }
    ]
  }
  renderWithActions(d)
  // only 'low' severity rows: f_44, f_18 present; a 'high' row absent
  expect(screen.getByText('f_44')).toBeInTheDocument()
  expect(screen.queryByText('f_82')).not.toBeInTheDocument()
})

test('auto-shell: a lone map renders a full-bleed base with dock rails', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 's1', type: 'stat', props: { label: 'Vessels', value: 20 } },
      { id: 'm1', type: 'esri:map', bindings: { layers: 'mock://incidents' } },
      { id: 't1', type: 'data-table', bindings: { source: 'mock://incidents' } },
    ],
  }
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('canvas-base')).toBeInTheDocument()
  expect(screen.getByTestId('dock-left')).toBeInTheDocument()   // stat
  expect(screen.getByTestId('dock-bottom')).toBeInTheDocument() // table
  expect(screen.getByTestId('panel-s1')).toBeInTheDocument()
  expect(screen.queryByTestId('cell-s1')).toBeNull()
  expect(screen.getByText('Vessels')).toBeInTheDocument()
})

test('explicit dock + float layers are honored', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 'm1', type: 'esri:map', layer: 'base', bindings: { layers: 'mock://x' } },
      { id: 't1', type: 'data-table', layer: 'dock', edge: 'bottom', bindings: { source: 'mock://incidents' } },
      { id: 'st', type: 'stat', layer: 'float', anchor: 'top-left', props: { label: 'N', value: 3 } },
    ],
  }
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('canvas-base')).toBeInTheDocument()
  expect(screen.getByTestId('panel-t1')).toBeInTheDocument()
  expect(screen.getByTestId('float-st')).toBeInTheDocument()
})

test('no base -> unchanged flat grid (regression: grid cell + CSS preserved)', () => {
  render(<CanvasGrid doc={doc()} />)
  const cell = screen.getByTestId('cell-s1')
  expect(cell.style.gridColumn).toBe('1 / span 3')
  expect(screen.queryByTestId('canvas-base')).toBeNull()
})

test('marks a freshly-rendered tile with the entrance class', async () => {
  // Regression guard for the entering-state fix: the entrance class must
  // survive intervening re-renders (it's cleared only on animationend, not
  // on a per-render diff), so this asserts it's present via waitFor.
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1,
    layout: { type: 'grid', cols: 12, rowHeight: 80, gap: 8 },
    components: [
      { id: 'e1', type: 'stat', area: { col: 1, colSpan: 4, row: 1, rowSpan: 1 }, props: { label: 'x', value: 1 } }
    ]
  }
  render(<CanvasGrid doc={d} />)
  await waitFor(() => expect(screen.getByTestId('cell-e1').className).toContain('gc-tile-enter'))
})
