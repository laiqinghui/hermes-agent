import { useEffect, useRef, useState } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer, buildRowsLayer } from '../../lib/esri/layers'
import { isDataHandle } from '../../lib/data-plane'
import { useCanvasActions } from '../HandlerContext'
import { useLinkedSelection } from '../SelectionContext'
import { resolveIdField } from '../../lib/selection'
import { detectGeoFields } from '../../lib/esri/graphics'
import { containedKeys } from '../../lib/esri/spatial'
import { EsriFrame } from './EsriFrame'
import { Skeleton } from '../atoms/Skeleton'
import type { MoleculeProps } from '../registry'

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  return typeof v === 'string' ? [v] : []
}

export function EsriMapMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const ref = useRef<HTMLElement | null>(null)
  const [ready, setReady] = useState(false)
  const layerRefs = asArray(node.bindings?.layers)
  const props = (node.props ?? {}) as {
    basemap?: string; center?: [number, number]; zoom?: number
    render?: 'points' | 'heatmap'; spatialFilter?: boolean; basemapToggle?: boolean; basemapAlt?: string
  }
  const basemap = props.basemap ?? 'osm'
  const render = props.render === 'heatmap' ? 'heatmap' : 'points'
  // Linked selection: the map's data-layer handle is the shared source.
  const source = layerRefs.find(isDataHandle) ?? ''
  const [selected, setSelected] = useLinkedSelection(source)
  const selectedRef = useRef<string[]>(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])
  const setSelectedRef = useRef(setSelected)
  useEffect(() => { setSelectedRef.current = setSelected }, [setSelected])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapCtx = useRef<{ view: any; layer: any; idField: string; keyByOid: Map<number, string> } | null>(null)
  const sketchRef = useRef<HTMLElement | null>(null)
  // Rows for the spatial filter, populated even without a live view (jsdom-testable),
  // unlike mapCtx which needs the real view for highlight/goTo.
  const dataRef = useRef<{ rows: Record<string, unknown>[]; idField: string; lngField: string; latField: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    let clickHandle: { remove(): void } | null = null
    const el = ref.current as (HTMLElement & Record<string, unknown>) | null
    if (!el) return

    // Trigger ESRI load immediately so the custom element gets defined before the ready event
    void loadEsri()

    const onReady = async () => {
      const esri = await loadEsri()
      if (cancelled) return
      const view = el.view as { map: { add(layer: unknown): void } } | undefined
      if (!view) console.warn('esri:map view not ready; layers not added', node.id)
      for (const r of layerRefs) {
        try {
          let layer: unknown
          if (isDataHandle(r)) {
            const page = await actions.fetchData(r, { pageSize: 5000 })
            if (cancelled) return
            // The legend shows the layer title — prefer the map's human title
            // over the raw data:// handle (Phase C lets the agent title layers).
            const layerTitle = (node.props?.title as string | undefined) ?? r
            if (r === source) {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const { latField, lngField } = detectGeoFields(page.schema as never)
              dataRef.current = { rows, idField, lngField: lngField ?? 'lng', latField: latField ?? 'lat' }
            }
            layer = buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, layerTitle, render)
            if (view && r === source) {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              // __oid is i+1 (see graphicsFromMockSource). Map it to the shared row key,
              // because ESRI hitTest graphics carry only the objectId, not the fields.
              const keyByOid = new Map<number, string>()
              rows.forEach((row, i) => keyByOid.set(i + 1, String(row[idField])))
              mapCtx.current = { view, layer, idField, keyByOid }
            }
          } else {
            layer = buildLayer(r, esri, render)
          }
          if (view) view.map.add(layer)
        } catch (e) { console.error('layer build failed', r, e) }
      }
      // A click on the map is a selection here, not an info request — disable the popup.
      if (view) (view as unknown as { popupEnabled?: boolean }).popupEnabled = false
      if (!cancelled) setReady(true)
    }

    el.addEventListener('arcgisViewReadyChange', onReady)
    return () => {
      cancelled = true
      el.removeEventListener('arcgisViewReadyChange', onReady)
    }
    // node.id/layers are stable for a given rendered node; actions is stable (useMemo in App)
  }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Map click → shared selection. Kept in its own ready-keyed effect (not inside the
  // one-time onReady) so it (re)attaches whenever the view is ready — including after
  // an HMR reload, and always in production.
  useEffect(() => {
    const ctx = mapCtx.current
    if (!ready || !ctx) return
    const handle = ctx.view.on('click', async (e: unknown) => {
      // ESRI hitTest graphics carry only the objectId (__oid), not the fields,
      // so map __oid → the shared row key instead of reading attributes[idField].
      const hit = await ctx.view.hitTest(e, { include: [ctx.layer] }) as { results?: unknown[] }
      const ids = (hit?.results ?? [])
        .map((r: unknown) => (r as Record<string, unknown>)?.['graphic'] as Record<string, unknown>)
        .map(g => (g?.['attributes'] as Record<string, unknown> | undefined)?.['__oid'])
        .filter((x: unknown) => x != null)
        .map(oid => ctx.keyByOid?.get(Number(oid)))
        .filter((x: unknown): x is string => x != null)
      if (!ids.length) return
      // toggle the clicked ids into the current shared selection
      const next = ids.reduce<string[]>((acc, id) => acc.includes(id) ? acc.filter(x => x !== id) : [...acc, id], selectedRef.current)
      setSelectedRef.current(next)
    }) as { remove(): void }
    return () => handle.remove()
  }, [ready])

  // React to the shared selection: highlight the matching features and recenter.
  useEffect(() => {
    const ctx = mapCtx.current
    if (!ready || !ctx || !selected.length) return // nothing selected → prior cleanup already cleared the highlight
    let handle: { remove(): void } | null = null
    let cancelled = false
    ;(async () => {
      // Query the LAYER (not the layerView) so we get every matching feature WITH
      // geometry, regardless of the current viewport — a layerView query is
      // extent-limited and omits geometry by default, so goTo() would no-op.
      const res = await ctx.layer.queryFeatures({ where: '1=1', returnGeometry: true, outFields: ['*'] })
      if (cancelled) return
      const matched = (res?.features ?? []).filter(
        (f: { attributes?: Record<string, unknown> }) => selected.includes(String(f.attributes?.[ctx.idField]))
      )
      const lv = await ctx.view.whenLayerView(ctx.layer)
      if (cancelled) return
      handle = matched.length ? lv.highlight(matched) : null
      if (matched.length) {
        const zoom = matched.length === 1 ? Math.max(Number(ctx.view.zoom) || 0, 13) : undefined
        await ctx.view.goTo(zoom ? { target: matched, zoom } : matched, { animate: true })
      }
    })().catch(() => {})
    return () => { cancelled = true; handle?.remove() }
  }, [selected, ready])

  // Draw a geofence/radius/polygon → select the contained rows (client-side, over the
  // loaded data source rows). Reuses the shared selection, so a linked table highlights too.
  useEffect(() => {
    const el = sketchRef.current
    if (!ready || !props.spatialFilter || !el) return
    const onCreate = async (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { state?: string; graphic?: { geometry?: unknown } } | undefined
      const data = dataRef.current
      if (detail?.state !== 'complete' || !detail.graphic?.geometry || !data) return
      const esri = await loadEsri()
      // SR gotcha: the view/sketch draw in Web Mercator; project to geographic (4326)
      // to match the rows-layer points, else contains() matches nothing.
      const geo = esri.webMercatorUtils.webMercatorToGeographic(detail.graphic.geometry)
      const predicate = (lng: number, lat: number) =>
        esri.geometryEngine.contains(geo, new esri.Point({ x: lng, y: lat, spatialReference: { wkid: 4326 } }))
      const keys = containedKeys(data.rows, data.idField, data.lngField, data.latField, predicate)
      setSelectedRef.current(keys)
    }
    // Clearing/deleting the drawn fence must also clear the shared selection,
    // else a linked table stays highlighted with no fence on the map.
    const onDelete = () => { setSelectedRef.current([]) }
    el.addEventListener('arcgisCreate', onCreate)
    el.addEventListener('arcgisDelete', onDelete)
    return () => {
      el.removeEventListener('arcgisCreate', onCreate)
      el.removeEventListener('arcgisDelete', onDelete)
    }
  }, [ready, props.spatialFilter])

  const center = props.center ? `${props.center[0]}, ${props.center[1]}` : undefined
  const selectionSummary = selected.length ? `${selected.length} selected` : undefined

  return (
    <EsriFrame title={(node.props?.title as string | undefined) ?? 'Map'} meta={basemap} corners>
      {/* @ts-expect-error — arcgis-map is a custom element (typed loosely for React) */}
      <arcgis-map
        ref={ref}
        id={`esri-map-${node.id}`}
        basemap={basemap}
        {...(center ? { center } : {})}
        {...(props.zoom != null ? { zoom: String(props.zoom) } : {})}
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        {props.spatialFilter ? (
          /* @ts-expect-error custom element */
          <arcgis-sketch ref={sketchRef} slot="top-right" creation-mode="single" />
        ) : null}
        {props.basemapToggle ? (
          /* @ts-expect-error custom element */
          <arcgis-basemap-toggle slot="bottom-right" next-basemap={props.basemapAlt ?? 'satellite'} />
        ) : null}
        {/* @ts-expect-error — arcgis-map closing tag (custom element typed loosely for React) */}
      </arcgis-map>
      {!ready ? (
        <div data-testid="map-skeleton" className="absolute inset-0 z-10 transition-opacity duration-300">
          <Skeleton className="h-full w-full" />
        </div>
      ) : null}
      {selectionSummary ? (
        <div className="absolute bottom-2 left-2 z-6 flex flex-col gap-0.5 rounded-gc-sm border border-hairline bg-surface/80 px-2 py-1 backdrop-blur-sm">
          <span className="font-mono text-[9px] uppercase tracking-wide text-tertiary">Selected</span>
          <span className="font-mono text-[11px] font-medium text-accent">{selectionSummary}</span>
        </div>
      ) : null}
    </EsriFrame>
  )
}
