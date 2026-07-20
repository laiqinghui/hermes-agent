import { useCallback, useMemo, useRef, useState } from 'react'
import type { WindowRect } from './types'

export interface LayoutStore {
  overrides: Record<string, WindowRect>
  get: (id: string) => WindowRect | undefined
  set: (id: string, rect: WindowRect) => void
  prune: (validIds: string[]) => void
  reset: () => void
  isEmpty: boolean
}

/** Ephemeral, session-only layout overrides keyed by molecule id. Never persisted,
 * never sent to the gateway, and — unlike interaction Overrides — NOT reset on
 * doc.rev; only prune (id removed) and reset (user) clear entries. */
export function useLayoutStore(): LayoutStore {
  const [overrides, setOverrides] = useState<Record<string, WindowRect>>({})
  const ref = useRef(overrides); ref.current = overrides

  const get = useCallback((id: string) => ref.current[id], [])
  const set = useCallback((id: string, rect: WindowRect) => {
    setOverrides(prev => ({ ...prev, [id]: rect }))
  }, [])
  const prune = useCallback((validIds: string[]) => {
    const valid = new Set(validIds)
    setOverrides(prev => {
      const next: Record<string, WindowRect> = {}
      let changed = false
      for (const [id, r] of Object.entries(prev)) { if (valid.has(id)) next[id] = r; else changed = true }
      return changed ? next : prev
    })
  }, [])
  const reset = useCallback(() => setOverrides({}), [])

  return useMemo(
    () => ({ overrides, get, set, prune, reset, isEmpty: Object.keys(overrides).length === 0 }),
    [overrides, get, set, prune, reset],
  )
}
