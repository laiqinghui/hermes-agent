import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/** A map's full temporal span, in epoch milliseconds. */
export interface MapTimeExtent { start: number; end: number }

interface TimeExtentContextValue {
  publish: (mapId: string, extent: MapTimeExtent | null) => void
  state: Record<string, MapTimeExtent>
}

const EMPTY_STATE: Record<string, MapTimeExtent> = {}
const NOOP: TimeExtentContextValue = { publish: () => {}, state: EMPTY_STATE }
const Ctx = createContext<TimeExtentContextValue>(NOOP)

/** Shares each track map's derived full time extent (keyed by the map's node id)
 * so a separate esri:time-slider can set its own fullTimeExtent — the bare
 * web component does not auto-derive an extent from client-synthesized layers. */
export function TimeExtentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Record<string, MapTimeExtent>>({})
  const publish = useCallback((mapId: string, extent: MapTimeExtent | null) => {
    setState(prev => {
      if (extent == null) {
        if (!(mapId in prev)) return prev // no-op: avoid a needless state identity change
        const next = { ...prev }
        delete next[mapId]
        return next
      }
      const cur = prev[mapId]
      if (cur && cur.start === extent.start && cur.end === extent.end) return prev // unchanged
      return { ...prev, [mapId]: extent }
    })
  }, [])
  const value = useMemo(() => ({ publish, state }), [publish, state])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Publish a map's full time extent (or null to clear). The returned function is
 * stable across renders, so a producer effect can depend on it safely. */
export function useTimeExtentPublisher(): (mapId: string, extent: MapTimeExtent | null) => void {
  return useContext(Ctx).publish
}

/** Subscribe to a map's published full time extent, by the map's node id. */
export function useMapTimeExtent(mapId: string | undefined): MapTimeExtent | null {
  const { state } = useContext(Ctx)
  return mapId ? state[mapId] ?? null : null
}
