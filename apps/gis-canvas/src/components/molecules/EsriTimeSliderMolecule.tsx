import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { EsriFrame } from './EsriFrame'
import type { MoleculeProps } from '../registry'

export function EsriTimeSliderMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  const el = useRef<HTMLElement | null>(null)
  const stops = typeof node.props?.stops === 'number' ? node.props.stops : undefined

  // Ensure the arcgis-time-slider custom element is registered.
  useEffect(() => { void loadEsri() }, [])

  // `stops` is a property (object), not a plain attribute — set it on the element.
  useEffect(() => {
    if (el.current && stops != null) (el.current as unknown as { stops: unknown }).stops = { count: stops }
  }, [stops])

  return (
    <EsriFrame title="Timeline">
      {/* @ts-expect-error custom element */}
      <arcgis-time-slider
        ref={el}
        {...(ref ? { 'reference-element': ref } : {})}
        mode="time-window"
        play-rate="1000"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </EsriFrame>
  )
}
