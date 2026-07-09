import type { MockSource, MockField } from '../mock-data'

export interface EsriFieldSpec { name: string; alias: string; type: 'oid' | 'string' | 'double' }
export interface EsriGraphic {
  geometry: { type: 'point'; x: number; y: number }
  attributes: Record<string, string | number>
}

const OID = '__oid'

const LAT_ALIASES = ['lat', 'latitude', 'latitudedegrees', 'lat_dd', 'y']
const LNG_ALIASES = ['lng', 'lon', 'long', 'longitude', 'longitudedegrees', 'lon_dd', 'x']

/**
 * Detect the latitude/longitude field names in a schema case-insensitively,
 * from a set of common aliases. Real Denodo retrieval rows can arrive with
 * field names like `Latitude`/`Longitude` rather than the mock's `lat`/`lng`.
 */
export function detectGeoFields(schema: MockField[]): { latField?: string; lngField?: string } {
  const byLower = new Map<string, string>()
  for (const f of schema) {
    if (!byLower.has(f.name.toLowerCase())) byLower.set(f.name.toLowerCase(), f.name)
  }

  const findFirst = (aliases: string[]): string | undefined => {
    for (const alias of aliases) {
      const match = byLower.get(alias)
      if (match !== undefined) return match
    }
    return undefined
  }

  return { latField: findFirst(LAT_ALIASES), lngField: findFirst(LNG_ALIASES) }
}

export function fieldsFromSchema(schema: MockField[]): EsriFieldSpec[] {
  const { latField, lngField } = detectGeoFields(schema)
  const fields: EsriFieldSpec[] = [{ name: OID, alias: OID, type: 'oid' }]
  for (const f of schema) {
    if (f.name === latField || f.name === lngField) continue // geometry, not attributes
    fields.push({ name: f.name, alias: f.name, type: f.type === 'number' ? 'double' : 'string' })
  }
  return fields
}

/** Build ESRI-shaped point graphics from a geo mock source (rows with lat/lng or aliases thereof). */
export function graphicsFromMockSource(source: MockSource): EsriGraphic[] {
  const { latField, lngField } = detectGeoFields(source.schema ?? [])
  const latKey = latField ?? 'lat'
  const lngKey = lngField ?? 'lng'
  return source.rows.map((row, i) => {
    const typedRow = row as Record<string, string | number>
    const { [latKey]: latVal, [lngKey]: lngVal, ...rest } = typedRow
    return {
      geometry: { type: 'point', x: Number(lngVal), y: Number(latVal) },
      attributes: { [OID]: i + 1, ...rest }
    }
  })
}
