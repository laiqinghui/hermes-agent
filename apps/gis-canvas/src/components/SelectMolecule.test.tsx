import { render, screen, fireEvent } from '@testing-library/react'
import { SelectMolecule } from './molecules/SelectMolecule'
import type { CanvasDoc } from '../lib/types'
import { HandlerProvider } from './HandlerContext'
import type { CanvasActions } from '../lib/handlers'

function renderWithActions(d: { id: string; type: string; props?: Record<string, unknown>; handlers?: Record<string, any>; state?: Record<string, unknown> }, actions: Partial<CanvasActions> = {}) {
  const full: CanvasActions = {
    setLocalState: () => {},
    reportInteraction: () => {},
    sendPrompt: () => {},
    fetchData: async () => ({ ok: true, rows: [], schema: [], total: 0, page: 0, pageSize: 0 }),
    ...actions
  }
  return render(
    <HandlerProvider actions={full}>
      <SelectMolecule node={d as any} renderChild={() => null} />
    </HandlerProvider>
  )
}

test('select with object options renders labels and reports interaction', () => {
  const reports: Array<{ id: string; patch: any }> = []
  const node = {
    id: 'severity-select',
    type: 'select',
    props: {
      field: 'severity',
      options: [
        { label: 'All', value: 'all' },
        { label: 'High', value: 'high' }
      ]
    }
  }

  renderWithActions(node, {
    reportInteraction: (id, patch) => reports.push({ id, patch })
  })

  // Assert: renders without throwing and shows option labels
  expect(screen.getByText('All')).toBeInTheDocument()
  expect(screen.getByText('High')).toBeInTheDocument()

  // Assert: selecting 'high' calls reportInteraction with {value:'high'}
  const select = screen.getByRole('combobox') as HTMLSelectElement
  fireEvent.change(select, { target: { value: 'high' } })

  expect(reports).toContainEqual({
    id: 'severity-select',
    patch: { value: 'high' }
  })
})
