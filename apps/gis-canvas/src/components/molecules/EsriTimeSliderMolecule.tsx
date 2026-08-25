import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { useMapTimeExtent } from '../TimeExtentContext'
import { EsriFrame } from './EsriFrame'
import type { MoleculeProps } from '../registry'

export function EsriTimeSliderMolecule({ node }: MoleculeProps) {
  const mapRef = (node.bindings?.mapRef as string | undefined) ?? ''
  const ref = mapRef ? `#esri-map-${mapRef}` : undefined
  const el = useRef<HTMLElement | null>(null)
  const stops = typeof node.props?.stops === 'number' ? node.props.stops : undefined
  // cumulative-from-start reads as track playback (the trail reveals over time);
  // overridable to 'time-window'/'instant' via props.mode.
  const mode = typeof node.props?.mode === 'string' ? node.props.mode : 'cumulative-from-start'
  const extent = useMapTimeExtent(mapRef)

  // Ensure the arcgis-time-slider custom element is registered.
  useEffect(() => { void loadEsri() }, [])

  // Apply the linked map's full time extent. The bare web component does NOT derive
  // an extent from client-synthesized time-aware layers (it shows "No time extent"),
  // so set fullTimeExtent explicitly, seed the window to the full span, and give it
  // play stops. fullTimeExtent/timeExtent/stops are element properties, not attributes.
  useEffect(() => {
    if (!el.current || !extent) return
    let cancelled = false
    loadEsri()
      .then(esri => {
        if (cancelled || !el.current) return
        const target = el.current as unknown as { fullTimeExtent: unknown; timeExtent: unknown; stops: unknown }
        const start = new Date(extent.start)
        const end = new Date(extent.end)
        target.fullTimeExtent = new esri.TimeExtent({ start, end })
        target.timeExtent = new esri.TimeExtent({ start, end })
        target.stops = { count: stops ?? 50 }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [extent, stops])

  return (
    <EsriFrame title="Timeline">
      {/* @ts-expect-error custom element */}
      <arcgis-time-slider
        ref={el}
        {...(ref ? { 'reference-element': ref } : {})}
        mode={mode}
        play-rate="1000"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </EsriFrame>
  )
}
