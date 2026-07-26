import { detectGeoFields } from './graphics'
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
