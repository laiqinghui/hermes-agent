import { EsriFrame } from './EsriFrame'
import type { MoleculeProps } from '../registry'

export function EsriLayerListMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  return (
    <EsriFrame title="Layers">
      {/* @ts-expect-error custom element */}
      <arcgis-layer-list {...(ref ? { 'reference-element': ref } : {})} style={{ display: 'block', width: '100%', height: '100%' }} />
    </EsriFrame>
  )
}
