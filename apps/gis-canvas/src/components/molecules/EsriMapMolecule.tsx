import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer, buildRowsLayer } from '../../lib/esri/layers'
import { isDataHandle } from '../../lib/data-plane'
import { useCanvasActions } from '../HandlerContext'
import { EsriFrame } from './EsriFrame'
import type { MoleculeProps } from '../registry'

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[]
  return typeof v === 'string' ? [v] : []
}

export function EsriMapMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const ref = useRef<HTMLElement | null>(null)
  const layerRefs = asArray(node.bindings?.layers)
  const props = (node.props ?? {}) as { basemap?: string; center?: [number, number]; zoom?: number }
  const basemap = props.basemap ?? 'osm'

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
          } else {
            layer = buildLayer(r, esri)
          }
          if (view) view.map.add(layer)
        } catch (e) { console.error('layer build failed', r, e) }
      }
      // selection: click → hitTest → write objectIds to state.selection (reactive interaction)
      // arcgisViewClick is a CustomEvent; the screen point is in event.detail (not the event itself)
      clickHandle = esri.reactiveUtils.on(() => el, 'arcgisViewClick', async (event: unknown) => {
        const detail = (event as Record<string, unknown>)?.['detail']
        const hit = await (el as Record<string, unknown> & { hitTest?(e: unknown): Promise<{ results: unknown[] }> }).hitTest?.(detail)
        const ids = (hit?.results ?? [])
          .map((r: unknown) => (r as Record<string, unknown>)?.['graphic'] as Record<string, unknown>)
          .map((g) => (g?.['attributes'] as Record<string, unknown> | undefined)?.['__oid'] ?? (g?.['getObjectId'] as (() => unknown) | undefined)?.())
          .filter((x: unknown) => x != null)
        actions.reportInteraction(node.id, { selection: ids })
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

  const center = props.center ? `${props.center[0]}, ${props.center[1]}` : undefined
  const selection = node.state?.selection as unknown[] | undefined
  const selectionSummary = Array.isArray(selection) && selection.length
    ? `${selection.length} selected`
    : undefined

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
      {selectionSummary ? (
        <div className="absolute bottom-2 left-2 z-6 flex flex-col gap-0.5 rounded-gc-sm border border-hairline bg-surface/80 px-2 py-1 backdrop-blur-sm">
          <span className="font-mono text-[9px] uppercase tracking-wide text-tertiary">Selected</span>
          <span className="font-mono text-[11px] font-medium text-accent">{selectionSummary}</span>
        </div>
      ) : null}
    </EsriFrame>
  )
}
