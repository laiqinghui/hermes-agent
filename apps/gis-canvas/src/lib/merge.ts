// apps/gis-canvas/src/lib/merge.ts
import type { CanvasDoc, ComponentNode } from './types'

export type Overrides = Record<string, Record<string, unknown>>

function mergeNode(node: ComponentNode, ov: Overrides): ComponentNode {
  const patch = ov[node.id]
  // Shallow spread: an un-overridden node shares the server doc's `state` object by reference.
  // Safe today (nothing mutates node.state in place). If a molecule ever does, clone state here.
  const next: ComponentNode = { ...node }
  if (patch) next.state = { ...(node.state ?? {}), ...patch }
  if (node.children) next.children = node.children.map(k => mergeNode(k, ov))
  if (node.slots) {
    next.slots = Object.fromEntries(
      Object.entries(node.slots).map(([slot, kids]) => [slot, kids.map(k => mergeNode(k, ov))])
    )
  }
  return next
}

/** Return a doc clone with each node's state shallow-merged with overrides[node.id]. */
export function mergeOverrides(doc: CanvasDoc, overrides: Overrides): CanvasDoc {
  return { ...doc, components: doc.components.map(n => mergeNode(n, overrides)) }
}
