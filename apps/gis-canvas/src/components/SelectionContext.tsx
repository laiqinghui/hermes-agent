import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface SelectionContextValue {
  get: (source: string) => string[]
  set: (source: string, ids: string[]) => void
}

const NOOP: SelectionContextValue = { get: () => [], set: () => {} }
const Ctx = createContext<SelectionContextValue>(NOOP)

/** Holds selection keyed by data source and mirrors every change onto the
 * `rowSelection` state of each node bound to that source (via onMirror), so the
 * agent's canvas awareness reflects it. */
export function SelectionProvider({
  nodesBySource,
  onMirror,
  children
}: {
  nodesBySource: Record<string, string[]>
  onMirror: (nodeId: string, ids: string[]) => void
  children: ReactNode
}) {
  const [selection, setSelection] = useState<Record<string, string[]>>({})
  const get = useCallback((source: string) => selection[source] ?? [], [selection])
  const set = useCallback((source: string, ids: string[]) => {
    setSelection(prev => ({ ...prev, [source]: ids }))
    for (const nodeId of nodesBySource[source] ?? []) onMirror(nodeId, ids)
  }, [nodesBySource, onMirror])
  const value = useMemo(() => ({ get, set }), [get, set])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Linked selection for a data source. A falsy source (component not data-bound)
 * yields an empty, inert selection. */
export function useLinkedSelection(source: string | undefined): [string[], (ids: string[]) => void] {
  const ctx = useContext(Ctx)
  const selected = source ? ctx.get(source) : []
  const setSelected = useCallback((ids: string[]) => { if (source) ctx.set(source, ids) }, [ctx, source])
  return [selected, setSelected]
}
