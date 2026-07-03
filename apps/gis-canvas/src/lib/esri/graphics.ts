import type { MockSource, MockField } from '../mock-data'

export interface EsriFieldSpec { name: string; alias: string; type: 'oid' | 'string' | 'double' }
export interface EsriGraphic {
  geometry: { type: 'point'; x: number; y: number }
  attributes: Record<string, string | number>
}

const OID = '__oid'

export function fieldsFromSchema(schema: MockField[]): EsriFieldSpec[] {
  const fields: EsriFieldSpec[] = [{ name: OID, alias: OID, type: 'oid' }]
  for (const f of schema) {
    if (f.name === 'lng' || f.name === 'lat') continue // geometry, not attributes
    fields.push({ name: f.name, alias: f.name, type: f.type === 'number' ? 'double' : 'string' })
  }
  return fields
}

/** Build ESRI-shaped point graphics from a geo mock source (rows with lng/lat). */
export function graphicsFromMockSource(source: MockSource): EsriGraphic[] {
  return source.rows.map((row, i) => {
    const { lng, lat, ...rest } = row as Record<string, string | number>
    return {
      geometry: { type: 'point', x: Number(lng), y: Number(lat) },
      attributes: { [OID]: i + 1, ...rest }
    }
  })
}
