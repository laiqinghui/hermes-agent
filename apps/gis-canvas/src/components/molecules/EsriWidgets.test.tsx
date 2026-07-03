import { render } from '@testing-library/react'
import { vi } from 'vitest'
vi.mock('../../lib/esri/loader', () => ({ loadEsri: async () => ({ esriConfig: {}, FeatureLayer: class {}, reactiveUtils: { on: () => ({ remove() {} }) } }) }))
vi.mock('../../lib/esri/layers', () => ({ parseLayerRef: (r: string) => ({ kind: 'rows', name: r }), buildLayer: (r: string) => ({ r }) }))
import { EsriLegendMolecule } from './EsriLegendMolecule'
import type { ComponentNode } from '../../lib/types'

test('legend points its reference-element at the mapRef map', () => {
  const node: ComponentNode = { id: 'lg1', type: 'esri:legend', bindings: { mapRef: 'map1' } }
  const { container } = render(<EsriLegendMolecule node={node} renderChild={() => null} />)
  expect(container.querySelector('arcgis-legend')?.getAttribute('reference-element')).toBe('#esri-map-map1')
})
