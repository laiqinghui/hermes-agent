import type { Anchor, CanvasDoc } from './types'

const ROLE_ANCHOR: Record<string, Anchor> = {
  stat: 'top-left',
  'esri:legend': 'top-right',
  'data-table': 'bottom',
  'esri:feature-table': 'bottom',
  select: 'top',
  card: 'top',
}

/** Role→anchor fallback for a floated molecule (also the auto-hero zoning). */
export function anchorForType(type: string): Anchor {
  return ROLE_ANCHOR[type] ?? 'bottom'
}

/**
 * Pure, guarded transform: if the doc has exactly one `esri:map` and NO component
 * sets `layer`, promote the map to `base` and float every other top-level molecule
 * into its role zone (place-all — nothing dropped; `z` = document index for stable
 * tiling). On any inconsistency return the SAME doc reference unchanged (grid mode
 * / agent-controlled). Never mutates the input.
 */
export function applyAutoHero(doc: CanvasDoc): CanvasDoc {
  const comps = doc.components
  if (comps.some(c => c.layer)) return doc
  const maps = comps.filter(c => c.type === 'esri:map')
  if (maps.length !== 1) return doc
  const mapId = maps[0].id
  const next = comps.map((c, i) =>
    c.id === mapId
      ? { ...c, layer: 'base' as const }
      : { ...c, layer: 'float' as const, anchor: anchorForType(c.type), z: i }
  )
  return { ...doc, components: next }
}
