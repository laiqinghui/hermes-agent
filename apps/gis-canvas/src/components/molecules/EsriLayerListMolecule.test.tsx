import { render } from '@testing-library/react'
import { vi, expect, test } from 'vitest'
vi.mock('../../lib/esri/loader', () => ({ loadEsri: async () => ({}) }))
import { EsriLayerListMolecule } from './EsriLayerListMolecule'
import { COMPONENT_REGISTRY } from '../registry'
import type { ComponentNode } from '../../lib/types'

test('layer-list points its reference-element at the mapRef map', () => {
  const node: ComponentNode = { id: 'll1', type: 'esri:layer-list', bindings: { mapRef: 'map1' } }
  const { container } = render(<EsriLayerListMolecule node={node} renderChild={() => null} />)
  expect(container.querySelector('arcgis-layer-list')?.getAttribute('reference-element')).toBe('#esri-map-map1')
})

test('esri:layer-list is registered', () => {
  expect(COMPONENT_REGISTRY['esri:layer-list']).toBeTruthy()
})
