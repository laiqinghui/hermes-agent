import { render } from '@testing-library/react'
import { vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'

vi.mock('../../lib/esri/loader', () => ({ loadEsri: async () => ({}) }))

import { EsriTimeSliderMolecule } from './EsriTimeSliderMolecule'

test('renders an arcgis-time-slider bound to the map via reference-element', () => {
  const node: ComponentNode = { id: 'ts1', type: 'esri:time-slider', bindings: { mapRef: 'map1' } }
  const { container } = render(<EsriTimeSliderMolecule node={node} renderChild={() => null} />)
  const el = container.querySelector('arcgis-time-slider')
  expect(el).toBeTruthy()
  expect(el?.getAttribute('reference-element')).toBe('#esri-map-map1')
})

test('omits reference-element when no mapRef is bound', () => {
  const node: ComponentNode = { id: 'ts2', type: 'esri:time-slider' }
  const { container } = render(<EsriTimeSliderMolecule node={node} renderChild={() => null} />)
  expect(container.querySelector('arcgis-time-slider')?.getAttribute('reference-element')).toBeNull()
})
