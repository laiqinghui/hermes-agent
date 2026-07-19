import type { Edge, CanvasDoc } from './types'

const ROLE_EDGE: Record<string, Edge> = {
  'data-table': 'bottom',
  'esri:feature-table': 'bottom',
  'esri:legend': 'right',
  stat: 'left',
  select: 'top',   // thin control → top toolbar rail
  card: 'left',    // content container → full-height rail (not a 10% top strip)
}

/** Role→edge fallback for a docked molecule (also the auto-shell rail assignment). */
export function edgeForType(type: string): Edge {
  return ROLE_EDGE[type] ?? 'bottom'
}

/**
 * Pure, guarded transform: exactly one `esri:map` and NO component sets `layer` →
 * promote the map to `base` and dock every other top-level molecule to its role edge
 * (place-all; `z` = document index for stable tiling along the rail). On any
 * inconsistency return the SAME doc reference unchanged (grid mode / agent-controlled).
 * Never mutates the input.
 */
export function applyAutoShell(doc: CanvasDoc): CanvasDoc {
  const comps = doc.components
  if (comps.some(c => c.layer)) return doc
  const maps = comps.filter(c => c.type === 'esri:map')
  if (maps.length !== 1) return doc
  const mapId = maps[0].id
  const next = comps.map((c, i) =>
    c.id === mapId
      ? { ...c, layer: 'base' as const }
      : { ...c, layer: 'dock' as const, edge: edgeForType(c.type), z: i }
  )
  return { ...doc, components: next }
}
