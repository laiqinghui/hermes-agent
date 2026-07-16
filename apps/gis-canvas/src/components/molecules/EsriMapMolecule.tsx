import { useEffect, useRef, useState } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer, buildRowsLayer } from '../../lib/esri/layers'
import { isDataHandle } from '../../lib/data-plane'
import { useCanvasActions } from '../HandlerContext'
import { useLinkedSelection } from '../SelectionContext'
import { resolveIdField } from '../../lib/selection'
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
  const props = (node.props ?? {}) as { basemap?: string; center?: [number, number]; zoom?: number }
  const basemap = props.basemap ?? 'osm'
  // Linked selection: the map's data-layer handle is the shared source.
  const source = layerRefs.find(isDataHandle) ?? ''
  const [selected, setSelected] = useLinkedSelection(source)
  const selectedRef = useRef<string[]>(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapCtx = useRef<{ view: any; layer: any; idField: string } | null>(null)

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
            layer = buildRowsLayer({ schema: page.schema as never, rows: page.rows as never }, esri, r)
            if (view && r === source) mapCtx.current = { view, layer, idField: resolveIdField(page.schema as { name: string }[]) }
          } else {
            layer = buildLayer(r, esri)
          }
          if (view) view.map.add(layer)
        } catch (e) { console.error('layer build failed', r, e) }
      }
      if (!cancelled) setReady(true)
      // selection: click → hitTest → write objectIds to state.selection (reactive interaction)
      // arcgisViewClick is a CustomEvent; the screen point is in event.detail (not the event itself)
      clickHandle = esri.reactiveUtils.on(() => el, 'arcgisViewClick', async (event: unknown) => {
        const ctx = mapCtx.current
        if (!ctx) return
        const detail = (event as Record<string, unknown>)?.['detail']
        const hit = await (el as Record<string, unknown> & { hitTest?(e: unknown): Promise<{ results: unknown[] }> }).hitTest?.(detail)
        const ids = (hit?.results ?? [])
          .map((r: unknown) => (r as Record<string, unknown>)?.['graphic'] as Record<string, unknown>)
          .map(g => (g?.['attributes'] as Record<string, unknown> | undefined)?.[ctx.idField])
          .filter((x: unknown) => x != null)
          .map(String)
        if (!ids.length) return
        // toggle the clicked ids into the current shared selection
        const next = ids.reduce<string[]>((acc, id) => acc.includes(id) ? acc.filter(x => x !== id) : [...acc, id], selectedRef.current)
        setSelected(next)
      })
    }

    el.addEventListener('arcgisViewReadyChange', onReady)
    return () => {
      cancelled = true
      el.removeEventListener('arcgisViewReadyChange', onReady)
      clickHandle?.remove()
    }
    // node.id/layers are stable for a given rendered node; actions is stable (useMemo in App)
  }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // React to the shared selection: highlight the matching features and recenter.
  useEffect(() => {
    const ctx = mapCtx.current
    if (!ready || !ctx) return
    let handle: { remove(): void } | null = null
    let cancelled = false
    void ctx.view.whenLayerView(ctx.layer).then(async (lv: { queryFeatures(): Promise<{ features: unknown[] }>; highlight(g: unknown[]): { remove(): void } }) => {
      if (cancelled) return
      const res = await lv.queryFeatures()
      const matched = (res?.features ?? []).filter(
        (f: unknown) => selected.includes(String((f as { attributes?: Record<string, unknown> }).attributes?.[ctx.idField]))
      )
      handle?.remove()
      handle = matched.length ? lv.highlight(matched) : null
      if (matched.length) void ctx.view.goTo(matched, { animate: true }).catch(() => {})
    }).catch(() => {})
    return () => { cancelled = true; handle?.remove() }
  }, [selected, ready])

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
      />
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
