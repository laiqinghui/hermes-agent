import type { Imagery, ImageryScene } from './types'

/** Resolve the scene ids a map heroes (props.imagery.scenes) against the doc's
 * `imagery` block, preserving the requested order. Unknown ids are dropped: the
 * validator rejects them at author time, so reaching one here means a stale
 * client, which should degrade rather than throw. */
export function resolveScenes(imagery: Imagery | undefined, ids: string[]): ImageryScene[] {
  const byId = new Map((imagery?.scenes ?? []).map(s => [s.id, s]))
  return ids
    .map(id => byId.get(id))
    .filter((s): s is ImageryScene => s != null)
}

/** WGS84 bbox -> a single closed clockwise polygon ring (ESRI's outer-ring winding).
 * Returns null for anything unusable — a non-finite coordinate poisons an entire
 * ESRI layer, so a bad footprint must be dropped, not drawn. */
export function bboxToRings(bbox: number[]): number[][][] | null {
  if (!Array.isArray(bbox) || bbox.length !== 4) return null
  const [minLon, minLat, maxLon, maxLat] = bbox
  if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null
  if (!(minLon < maxLon) || !(minLat < maxLat)) return null
  return [[
    [minLon, minLat], [minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]
  ]]
}
