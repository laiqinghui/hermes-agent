import { useEffect, useRef } from 'react'
import { loadEsri } from '../../lib/esri/loader'
import { buildLayer } from '../../lib/esri/layers'
import { useCanvasActions } from '../HandlerContext'
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
      for (const r of layerRefs) {
        try {
          const layer = buildLayer(r, esri)
          view?.map.add(layer)
        } catch (e) { console.error('layer build failed', r, e) }
      }
      // selection: click → hitTest → write objectIds to state.selection (reactive interaction)
      clickHandle = esri.reactiveUtils.on(() => el, 'arcgisViewClick', async (event: unknown) => {
        const hit = await (el as Record<string, unknown> & { hitTest?(e: unknown): Promise<{ results: unknown[] }> }).hitTest?.(event)
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
  return (
    // @ts-expect-error — arcgis-map is a custom element (typed loosely for React)
    <arcgis-map
      ref={ref}
      id={`esri-map-${node.id}`}
      basemap={basemap}
      {...(center ? { center } : {})}
      {...(props.zoom != null ? { zoom: String(props.zoom) } : {})}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}
