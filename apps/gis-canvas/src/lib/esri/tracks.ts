import { detectGeoFields } from './graphics'
import type { EsriGraphic } from './graphics'
import type { MockField } from '../mock-data'

const TIME_ALIASES = ['timestamp', 'time', 'ts', 'basedatetime', 'datetime', 'reported_at', 'date']
const TRACKID_ALIASES = ['trackid', 'mmsi', 'imo', 'icao24', 'callsign', 'tailnumber', 'vessel_name', 'vessel', 'entity_id', 'id']
const HEADING_ALIASES = ['heading', 'course', 'cog', 'bearing']

export interface TrackFields {
  timeField?: string
  trackIdField?: string
  headingField?: string
  latField?: string
  lngField?: string
}

export interface TrackFieldOverrides {
  timeField?: string
  trackIdField?: string
  headingField?: string
  latField?: string
  lngField?: string
}

function detectByAlias(schema: MockField[], aliases: string[]): string | undefined {
  const byLower = new Map<string, string>()
  for (const f of schema) {
    if (!byLower.has(f.name.toLowerCase())) byLower.set(f.name.toLowerCase(), f.name)
  }
  for (const a of aliases) {
    const m = byLower.get(a)
    if (m !== undefined) return m
  }
  return undefined
}

/**
 * Resolve the field roles a track needs. Explicit overrides (Agent-declared)
 * always win; otherwise fall back to case-insensitive alias detection so a
 * plain data source still renders. lat/lng reuse detectGeoFields.
 */
export function resolveTrackFields(schema: MockField[], overrides: TrackFieldOverrides = {}): TrackFields {
  const geo = detectGeoFields(schema)
  return {
    timeField: overrides.timeField ?? detectByAlias(schema, TIME_ALIASES),
    trackIdField: overrides.trackIdField ?? detectByAlias(schema, TRACKID_ALIASES),
    headingField: overrides.headingField ?? detectByAlias(schema, HEADING_ALIASES),
    latField: overrides.latField ?? geo.latField,
    lngField: overrides.lngField ?? geo.lngField
  }
}

export interface TrackGroup {
  trackId: string
  colorIndex: number
  points: EsriGraphic[]
  path: Array<[number, number]>
}

/** Initial great-circle bearing from point 1 to point 2, in degrees (0–360, 0 = north). */
export function bearingBetween(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const p1 = toRad(lat1)
  const p2 = toRad(lat2)
  const dl = toRad(lng2 - lng1)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

interface RawPoint { oid: number; t: number; x: number; y: number; heading?: number; rest: Record<string, string | number> }

/**
 * Group tabular rows into time-ordered tracks. Requires fields.timeField (else []).
 * Rows with an unparseable timestamp or a non-finite coordinate are dropped
 * (never coerced). Each point carries __oid (source row index + 1), __time
 * (epoch ms) and heading (field value, else derived bearing along the path).
 */
export function buildTrackGroups(
  rows: Array<Record<string, unknown>>,
  fields: TrackFields,
  baseColorIndex = 0
): TrackGroup[] {
  const { timeField, trackIdField, headingField } = fields
  if (!timeField) return []
  const latKey = fields.latField ?? 'lat'
  const lngKey = fields.lngField ?? 'lng'

  const groups = new Map<string, RawPoint[]>()
  rows.forEach((row, i) => {
    const t = Date.parse(String(row[timeField]))
    if (!Number.isFinite(t)) return
    const x = Number(row[lngKey])
    const y = Number(row[latKey])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const gid = trackIdField != null ? String(row[trackIdField]) : ''
    const rest: Record<string, string | number> = {}
    for (const [k, v] of Object.entries(row)) {
      if (k === latKey || k === lngKey || k === timeField) continue
      if (typeof v === 'string' || typeof v === 'number') rest[k] = v
    }
    const h = headingField != null ? Number(row[headingField]) : Number.NaN
    const arr = groups.get(gid)
    const point: RawPoint = { oid: i + 1, t, x, y, heading: Number.isFinite(h) ? h : undefined, rest }
    if (arr) arr.push(point)
    else groups.set(gid, [point])
  })

  const out: TrackGroup[] = []
  let gi = 0
  for (const [trackId, raws] of groups) {
    raws.sort((a, b) => a.t - b.t)
    const points: EsriGraphic[] = raws.map((r, j) => {
      let heading = r.heading
      if (heading == null) {
        if (raws.length < 2) heading = 0
        else if (j < raws.length - 1) heading = bearingBetween(r.x, r.y, raws[j + 1].x, raws[j + 1].y)
        else heading = bearingBetween(raws[j - 1].x, raws[j - 1].y, r.x, r.y)
      }
      return {
        geometry: { type: 'point', x: r.x, y: r.y, spatialReference: { wkid: 4326 } },
        attributes: { __oid: r.oid, __time: r.t, heading, ...r.rest }
      }
    })
    out.push({ trackId, colorIndex: baseColorIndex + gi, points, path: raws.map(r => [r.x, r.y] as [number, number]) })
    gi++
  }
  return out
}

/** Epoch-ms [start,end] spanning every point across all groups; null if empty. */
export function timeExtentOf(groups: TrackGroup[]): { start: number; end: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const g of groups) {
    for (const p of g.points) {
      const t = Number(p.attributes.__time)
      if (t < min) min = t
      if (t > max) max = t
    }
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { start: min, end: max } : null
}
