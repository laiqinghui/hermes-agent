import { useCallback, useMemo, useRef, useState } from 'react'
import type { WindowState } from './window-state'

export interface WindowStateStore {
  states: Record<string, WindowState>
  updated: Set<string>
  get: (id: string) => WindowState
  toggleShade: (id: string) => void
  minimize: (id: string) => void
  restore: (id: string) => void
  markUpdated: (id: string) => void
  /** Prune dead ids AND record the focus candidates. One call so the two lists
   * can never drift apart. */
  sync: (minimizableIds: string[]) => void
  toggleFocus: () => void
  reset: () => void
  minimizedIds: string[]
  canFocus: boolean
  isFocused: boolean
  isEmpty: boolean
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** Ephemeral, session-only window visibility keyed by molecule id. Never
 * persisted, never sent to the gateway, and — exactly like the layout override
 * store — NOT reset on doc.rev: minimizing is a user decision that outlives the
 * agent's revisions. Only sync (molecule removed) and reset (user) clear it. */
export function useWindowStateStore(): WindowStateStore {
  const [states, setStates] = useState<Record<string, WindowState>>({})
  const [updated, setUpdated] = useState<Set<string>>(new Set())
  // Candidates live in state, not a ref: isFocused is derived in the useMemo
  // below, and a ref change would not re-run it when the agent adds a panel.
  const [candidates, setCandidates] = useState<string[]>([])

  const statesRef = useRef(states); statesRef.current = states
  const candRef = useRef(candidates); candRef.current = candidates

  const get = useCallback((id: string) => statesRef.current[id] ?? 'open', [])

  const setOne = useCallback((id: string, s: WindowState) => {
    setStates(prev => ((prev[id] ?? 'open') === s ? prev : { ...prev, [id]: s }))
  }, [])

  const clearUpdated = useCallback((id: string) => {
    setUpdated(prev => {
      if (!prev.has(id)) return prev
      const next = new Set(prev); next.delete(id); return next
    })
  }, [])

  const toggleShade = useCallback((id: string) => {
    setStates(prev => ({ ...prev, [id]: (prev[id] ?? 'open') === 'shaded' ? 'open' : 'shaded' }))
  }, [])

  const minimize = useCallback((id: string) => setOne(id, 'minimized'), [setOne])

  const restore = useCallback((id: string) => { setOne(id, 'open'); clearUpdated(id) }, [setOne, clearUpdated])

  const markUpdated = useCallback((id: string) => {
    setUpdated(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  // Runs from a useEffect on every doc change — every updater below MUST return
  // the previous reference when nothing changed, or the effect loops forever.
  const sync = useCallback((ids: string[]) => {
    setCandidates(prev => (sameList(prev, ids) ? prev : ids))
    const valid = new Set(ids)
    setStates(prev => {
      const next: Record<string, WindowState> = {}
      let changed = false
      for (const [id, s] of Object.entries(prev)) { if (valid.has(id)) next[id] = s; else changed = true }
      return changed ? next : prev
    })
    setUpdated(prev => {
      const next = new Set([...prev].filter(id => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [])

  const toggleFocus = useCallback(() => {
    const ids = candRef.current
    if (!ids.length) return
    const allMinimized = ids.every(id => (statesRef.current[id] ?? 'open') === 'minimized')
    setStates(prev => {
      const next = { ...prev }
      for (const id of ids) next[id] = allMinimized ? 'open' : 'minimized'
      return next
    })
    if (allMinimized) setUpdated(prev => (prev.size ? new Set() : prev))
  }, [])

  const reset = useCallback(() => {
    setStates(prev => (Object.keys(prev).length ? {} : prev))
    setUpdated(prev => (prev.size ? new Set() : prev))
  }, [])

  return useMemo(() => {
    const minimizedIds = Object.keys(states).filter(id => states[id] === 'minimized')
    return {
      states, updated, get, toggleShade, minimize, restore, markUpdated, sync, toggleFocus, reset,
      minimizedIds,
      canFocus: candidates.length > 0,
      isFocused: candidates.length > 0 && candidates.every(id => states[id] === 'minimized'),
      isEmpty: Object.values(states).every(s => s === 'open'),
    }
  }, [states, updated, candidates, get, toggleShade, minimize, restore, markUpdated, sync, toggleFocus, reset])
}
