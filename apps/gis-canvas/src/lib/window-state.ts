import type { CanvasDoc, ComponentNode } from './types'

/** A window is in exactly one of these; absent from the store means 'open'. */
export type WindowState = 'open' | 'shaded' | 'minimized'

/** The hero (base-layer map) is the view everything else annotates, so it is
 * never minimizable. Mirrors the base-layer exception in FreeCanvas.beginGesture,
 * which likewise refuses to raise the map above the panels. */
export function canMinimize(node: ComponentNode): boolean {
  return node.layer !== 'base'
}

/** Window header / taskbar chip label. */
export function humanTitle(node: ComponentNode): string {
  const t = (node.props?.title as string | undefined)?.trim()
  return t || node.type.replace(/^esri:/, '').replace(/[-_]/g, ' ')
}

/** Per-molecule content fingerprint. Canvas docs are small LLM-authored
 * structures, so a stringify per revision is cheap — and unlike object identity
 * it survives the merge layer rebuilding every node on each rev. */
export function signatures(doc: CanvasDoc): Record<string, string> {
  const out: Record<string, string> = {}
  for (const c of doc.components) out[c.id] = JSON.stringify(c)
  return out
}

/** Ids present in `next` whose content differs from `prev` (additions included;
 * removals are not reported — the caller prunes those separately). */
export function changedIds(prev: Record<string, string>, next: Record<string, string>): string[] {
  return Object.keys(next).filter(id => prev[id] !== next[id])
}
