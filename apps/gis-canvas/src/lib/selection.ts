import { isDataHandle } from './data-plane'
import type { CanvasDoc, ComponentNode } from './types'

// Distinctness is checked over at most this many rows. Table and map fetch
// different page sizes (1000 vs 5000) from the same handle; capping the sample
// means both resolve the key over the SAME leading rows and always agree on it.
const ID_SAMPLE = 1000

/** Shared row identity. When rows are given, the first schema column whose values
 * are distinct across the leading rows (so it actually identifies a row — the
 * first column is often a constant label like a vessel name). Falls back to the
 * first column, else 'id'. */
export function resolveIdField(schema: { name: string }[] | undefined, rows?: Record<string, unknown>[]): string {
  const cols = schema ?? []
  if (rows && rows.length) {
    const n = Math.min(rows.length, ID_SAMPLE)
    for (const c of cols) {
      const seen = new Set<string>()
      let distinct = true
      for (let i = 0; i < n; i++) {
        const v = String(rows[i][c.name])
        if (seen.has(v)) { distinct = false; break }
        seen.add(v)
      }
      if (distinct) return c.name
    }
  }
  return cols[0]?.name ?? 'id'
}

/** Map each data-source handle to the ids of nodes bound to it — a table's
 * `bindings.source` and each data:// handle in a map's `bindings.layers`. */
export function collectNodesBySource(doc: CanvasDoc | null): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!doc) return out
  const add = (source: unknown, id: string) => {
    if (typeof source !== 'string' || !source) return
    ;(out[source] ??= []).push(id)
  }
  const walk = (node: ComponentNode) => {
    const src = node.bindings?.source
    add(Array.isArray(src) ? src[0] : src, node.id)
    const layers = node.bindings?.layers
    for (const layer of Array.isArray(layers) ? layers : []) if (isDataHandle(layer)) add(layer, node.id)
    for (const kid of node.children ?? []) walk(kid)
    for (const kids of Object.values(node.slots ?? {})) for (const kid of kids) walk(kid)
  }
  for (const c of doc.components ?? []) walk(c)
  for (const o of doc.overlays ?? []) walk(o)
  return out
}
