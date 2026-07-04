import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer, buildRowsLayer } from '../../lib/esri/layers'
import { isDataHandle } from '../../lib/data-plane'
import { useCanvasActions } from '../HandlerContext'
import type { MoleculeProps } from '../registry'

export function EsriFeatureTableMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const ref = useRef<HTMLElement | null>(null)
  const layerHandle = Array.isArray(node.bindings?.layer) ? node.bindings!.layer[0] : node.bindings?.layer as string | undefined
  const mapRef = node.bindings?.mapRef as string | undefined

  useEffect(() => {
    let cancelled = false
    const el = ref.current as (HTMLElement & Record<string, any>) | null
    if (!el || !layerHandle) return
    ;(async () => {
      const esri = await loadEsri()
      if (cancelled) return
      try {
        if (isDataHandle(layerHandle)) {
          const page = await actions.fetchData(layerHandle, { pageSize: 5000 })
          if (cancelled) return
          el.layer = buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, layerHandle)
        } else {
          el.layer = buildLayer(layerHandle, esri)
        }
      } catch (e) { console.error('feature-table layer failed', e) }
    })()
    const onSel = (e: any) => {
      const ids = (e?.detail?.added ?? []).map((f: any) => f?.attributes?.__oid ?? f?.getObjectId?.()).filter((x: unknown) => x != null)
      if (ids.length) actions.reportInteraction(node.id, { selection: ids })
    }
    el.addEventListener('arcgisSelectionChange', onSel)
    return () => { cancelled = true; el.removeEventListener('arcgisSelectionChange', onSel) }
  }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refEl = mapRef ? `#esri-map-${mapRef}` : undefined
  return (
    // @ts-expect-error custom element
    <arcgis-feature-table ref={ref} {...(refEl ? { 'reference-element': refEl } : {})} style={{ display: 'block', width: '100%', height: '100%' }} />
  )
}
