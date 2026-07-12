import { EsriFrame } from './EsriFrame'
import type { MoleculeProps } from '../registry'

export function EsriLegendMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  return (
    <EsriFrame title="Legend">
      {/* @ts-expect-error custom element */}
      <arcgis-legend {...(ref ? { 'reference-element': ref } : {})} style={{ display: 'block', width: '100%', height: '100%' }} />
    </EsriFrame>
  )
}
