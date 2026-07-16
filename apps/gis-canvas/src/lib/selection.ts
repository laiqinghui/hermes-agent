import { isDataHandle } from './data-plane'
import type { CanvasDoc, ComponentNode } from './types'

/** Shared row identity: the first schema column's name (today's table behavior). */
export function resolveIdField(schema: { name: string }[] | undefined): string {
  return schema?.[0]?.name ?? 'id'
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
