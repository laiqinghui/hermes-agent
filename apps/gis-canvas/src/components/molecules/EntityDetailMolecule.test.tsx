import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'
import { HandlerProvider } from '../HandlerContext'
import { SelectionProvider, useSelectionActions } from '../SelectionContext'
import { OntologyProvider } from '../OntologyContext'
import type { CanvasActions } from '../../lib/handlers'
import { EntityDetailMolecule } from './EntityDetailMolecule'

const ONT = {
  vessel: { source: 'data://vessels', id: 'mmsi', title: 'vessel_name', props: ['flag', 'status'],
            links: { operator: { to: 'operator', field: 'operator_id' } } },
  operator: { source: 'data://operators', id: 'op_id', title: 'name', props: ['country'] }
}
const vesselsPage = {
  ok: true, total: 1, page: 0, pageSize: 5000,
  schema: [{ name: 'vessel_name', type: 'string' }, { name: 'mmsi', type: 'string' }, { name: 'flag', type: 'string' }, { name: 'status', type: 'string' }, { name: 'operator_id', type: 'string' }],
  rows: [{ vessel_name: 'WONDER VEGA', mmsi: '563123000', flag: 'SG', status: 'under way', operator_id: 'OP1' }]
}
const node: ComponentNode = { id: 'ed', type: 'entity-detail' }

function SelectVessel() {
  const a = useSelectionActions()
  return <button onClick={() => a.set('data://vessels', ['WONDER VEGA'])}>sel</button>
}

test('shows a placeholder when nothing is selected', () => {
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData: vi.fn() }
  render(
    <OntologyProvider ontology={ONT}>
      <SelectionProvider nodesBySource={{}} onMirror={() => {}}>
        <HandlerProvider actions={actions}><EntityDetailMolecule node={node} renderChild={() => null} /></HandlerProvider>
      </SelectionProvider>
    </OntologyProvider>
  )
  expect(screen.getByText(/select an entity/i)).toBeInTheDocument()
})

test('renders the focal entity header, props and provenance from the selection', async () => {
  const fetchData = vi.fn().mockResolvedValue(vesselsPage)
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  render(
    <OntologyProvider ontology={ONT}>
      <SelectionProvider nodesBySource={{}} onMirror={() => {}}>
        <HandlerProvider actions={actions}>
          <SelectVessel />
          <EntityDetailMolecule node={node} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    </OntologyProvider>
  )
  screen.getByText('sel').click()
  await waitFor(() => expect(screen.getByText('WONDER VEGA')).toBeInTheDocument())
  expect(screen.getByText('vessel')).toBeInTheDocument()         // type badge (exact)
  expect(screen.getByText('under way')).toBeInTheDocument()      // a prop value
  expect(screen.getByText(/data:\/\/vessels/)).toBeInTheDocument() // provenance
})
