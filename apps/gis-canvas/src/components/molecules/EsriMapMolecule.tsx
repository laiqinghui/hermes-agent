import { useEffect, useRef, useState } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer, buildRowsLayer, trackLayersFromGroups } from '../../lib/esri/layers'
import { resolveTrackFields, buildTrackGroups, type TrackFields } from '../../lib/esri/tracks'
import { resolveLayerColor } from '../../lib/esri/layer-color'
import { isDataHandle } from '../../lib/data-plane'
import { resolveMockSource } from '../../lib/mock-data'
import { useCanvasActions } from '../HandlerContext'
import { useSelectionActions, useSelectionState } from '../SelectionContext'
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
    render?: 'points' | 'heatmap' | 'track'; spatialFilter?: boolean; basemapToggle?: boolean; basemapAlt?: string
    timeField?: string; trackIdField?: string; headingField?: string; latField?: string; lngField?: string
  }
  const basemap = props.basemap ?? 'osm'
  const render = props.render === 'heatmap' ? 'heatmap' : props.render === 'track' ? 'track' : 'points'
  const baseRender = render === 'heatmap' ? 'heatmap' : 'points' // for the non-track layer builders
  const selActions = useSelectionActions()
  const selState = useSelectionState()
  const selActionsRef = useRef(selActions)
  useEffect(() => { selActionsRef.current = selActions }, [selActions])
  // The primary data layer still drives the map-click hitTest ctx (mapCtx).
  const source = layerRefs.find(isDataHandle) ?? ''
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapCtx = useRef<{ view: any; layer: any; idField: string; keyByOid: Map<number, string> } | null>(null)
  const sketchRef = useRef<HTMLElement | null>(null)
  // Rows for the spatial filter, populated even without a live view (jsdom-testable),
  // unlike mapCtx which needs the real view for highlight/goTo.
  const dataRef = useRef<{ rows: Record<string, unknown>[]; idField: string; lngField: string; latField: string } | null>(null)
  const layersRef = useRef<Array<{ source: string; rows: Record<string, unknown>[]; idField: string; lngField: string; latField: string }>>([])
  const addedLayersRef = useRef<unknown[]>([])
  const [buildTick, setBuildTick] = useState(0)
  const [roles, setRoles] = useState<TrackFields | null>(null)

  const layerMeta = (node.props?.layers as Array<{ title?: string; color?: string }> | undefined) ?? []
  const layersSig = JSON.stringify({ layers: layerRefs, meta: layerMeta, render })

  // View-ready: flip `ready` once the arcgis-map view exists.
  useEffect(() => {
    const el = ref.current as HTMLElement | null
    if (!el) return
    void loadEsri()
    const onReady = () => setReady(true)
    el.addEventListener('arcgisViewReadyChange', onReady)
    return () => el.removeEventListener('arcgisViewReadyChange', onReady)
  }, [node.id])

  // Build (and rebuild) layers whenever the layer set changes. Clears the
  // previously-added layers first so a same-id rev change doesn't go stale/accumulate.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const el = ref.current as (HTMLElement & { view?: { map: { add(l: unknown): void; removeMany(ls: unknown[]): void }; popupEnabled?: boolean } }) | null
    const view = el?.view
    ;(async () => {
      const esri = await loadEsri()
      if (cancelled) return
      if (view && addedLayersRef.current.length) {
        view.map.removeMany(addedLayersRef.current)
        addedLayersRef.current = []
      }
      dataRef.current = null
      layersRef.current = []
      mapCtx.current = null
      setRoles(null)
      let trackColorBase = 0
      let rolesSet = false
      for (let i = 0; i < layerRefs.length; i++) {
        const r = layerRefs[i]
        const meta = layerMeta[i] ?? {}
        const title = meta.title ?? (node.props?.title as string | undefined) ?? r
        const color = meta.color ?? resolveLayerColor(i)
        try {
          if (render === 'track' && (isDataHandle(r) || r.startsWith('mock://'))) {
            let schema: unknown
            let rows: Record<string, unknown>[]
            if (isDataHandle(r)) {
              const page = await actions.fetchData(r, { pageSize: 5000 })
              if (cancelled) return
              schema = page.schema
              rows = page.rows as Record<string, unknown>[]
            } else {
              const src = resolveMockSource(r)
              if (!src) continue
              schema = src.schema
              rows = src.rows as Record<string, unknown>[]
            }
            const fields = resolveTrackFields(schema as never, {
              timeField: props.timeField, trackIdField: props.trackIdField, headingField: props.headingField,
              latField: props.latField, lngField: props.lngField
            })
            if (!rolesSet) { setRoles(fields); rolesSet = true }
            const groups = buildTrackGroups(rows, fields, trackColorBase)
            trackColorBase += groups.length
            const trackLayers = trackLayersFromGroups(groups, esri, schema as never, meta.title ?? title)
            if (view) for (const tl of trackLayers) { view.map.add(tl); addedLayersRef.current.push(tl) }
            continue
          }
          let layer: unknown
          if (isDataHandle(r)) {
            const page = await actions.fetchData(r, { pageSize: 5000 })
            if (cancelled) return
            if (r === source) {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const { latField, lngField } = detectGeoFields(page.schema as never)
              dataRef.current = { rows, idField, lngField: lngField ?? 'lng', latField: latField ?? 'lat' }
            }
            layer = buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, title, baseRender, color)
            {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const { latField, lngField } = detectGeoFields(page.schema as never)
              layersRef.current.push({ source: r, rows, idField, lngField: lngField ?? 'lng', latField: latField ?? 'lat' })
            }
            if (view && r === source) {
              const rows = page.rows as Record<string, unknown>[]
              const idField = resolveIdField(page.schema as { name: string }[], rows)
              const keyByOid = new Map<number, string>()
              rows.forEach((row, idx) => keyByOid.set(idx + 1, String(row[idField])))
              mapCtx.current = { view, layer, idField, keyByOid }
            }
          } else {
            layer = buildLayer(r, esri, baseRender, color)
          }
          if (view) { view.map.add(layer); addedLayersRef.current.push(layer) }
        } catch (e) { console.error('layer build failed', r, e) }
      }
      if (view) view.popupEnabled = false
      if (!cancelled) setBuildTick(t => t + 1)
    })().catch(() => {})
    return () => { cancelled = true }
  }, [ready, layersSig]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // toggle the clicked ids into the PRIMARY source's selection (mapCtx tracks the primary layer)
      const current = selActionsRef.current.get(source)
      const next = ids.reduce<string[]>((acc, id) => acc.includes(id) ? acc.filter(x => x !== id) : [...acc, id], current)
      selActionsRef.current.set(source, next)
    }) as { remove(): void }
    return () => handle.remove()
  }, [ready, buildTick])

  // React to the shared selection: highlight the matching features and recenter.
  useEffect(() => {
    const ctx = mapCtx.current
    const selected = selState[source] ?? []
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
  }, [selState, ready, buildTick])

  // Draw a geofence/radius/polygon → select the contained rows (client-side, over the
  // loaded data source rows). Reuses the shared selection, so a linked table highlights too.
  useEffect(() => {
    const el = sketchRef.current
    if (!ready || !props.spatialFilter || !el) return
    const onCreate = async (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { state?: string; graphic?: { geometry?: unknown } } | undefined
      const graphic = detail?.graphic
      if (detail?.state !== 'complete' || !graphic?.geometry || !layersRef.current.length) return
      const esri = await loadEsri()
      // SR gotcha: the view/sketch draw in Web Mercator; project to geographic (4326)
      // to match the rows-layer points, else contains() matches nothing.
      const geo = esri.webMercatorUtils.webMercatorToGeographic(graphic.geometry)
      const predicate = (lng: number, lat: number) =>
        esri.geometryEngine.contains(geo, new esri.Point({ x: lng, y: lat, spatialReference: { wkid: 4326 } }))
      for (const lc of layersRef.current) {
        const keys = containedKeys(lc.rows, lc.idField, lc.lngField, lc.latField, predicate)
        selActionsRef.current.set(lc.source, keys)
      }
      // Transient: remove the drawn region from the sketch's own graphics layer so
      // it isn't a persisted annotation — the gesture reads as a rubber-band select.
      ;(el as unknown as { layer?: { remove(g: unknown): void } }).layer?.remove(graphic)
    }
    el.addEventListener('arcgisCreate', onCreate)
    return () => el.removeEventListener('arcgisCreate', onCreate)
  }, [ready, props.spatialFilter])

  const center = props.center ? `${props.center[0]}, ${props.center[1]}` : undefined
  const selectedTotal = layersRef.current.reduce((n, lc) => n + (selState[lc.source]?.length ?? 0), 0)
  const selectionSummary = selectedTotal ? `${selectedTotal} selected` : undefined

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
      {render === 'track' && roles ? (
        <div className="absolute top-2 left-2 z-6 flex max-w-[90%] flex-wrap items-center gap-x-2 rounded-gc-sm border border-hairline bg-surface/80 px-2 py-1 font-mono text-[10px] text-tertiary backdrop-blur-sm">
          <span>◇ spatial {roles.latField ?? 'lat'}/{roles.lngField ?? 'lng'}</span>
          <span>◷ temporal {roles.timeField ?? '—'}</span>
          {roles.trackIdField ? <span>⛓ track {roles.trackIdField}</span> : null}
        </div>
      ) : null}
    </EsriFrame>
  )
}
