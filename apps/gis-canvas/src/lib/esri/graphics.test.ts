import { graphicsFromMockSource, fieldsFromSchema, detectGeoFields } from './graphics'
import { resolveMockSource } from '../mock-data'
import type { MockSource, MockField } from '../mock-data'

test('builds point graphics with oid + attributes from a geo mock source', () => {
  const g = graphicsFromMockSource(resolveMockSource('mock://incidents')!)
  expect(g.length).toBeGreaterThanOrEqual(8)
  expect(g[0].geometry.type).toBe('point')
  expect(typeof g[0].geometry.x).toBe('number')
  expect(g[0].attributes.__oid).toBe(1)
  expect(g[0].attributes.severity).toBeDefined()
})

test('fieldsFromSchema includes an oid field', () => {
  const f = fieldsFromSchema(resolveMockSource('mock://incidents')!.schema)
  expect(f.find(x => x.type === 'oid')?.name).toBe('__oid')
})

const REAL_DENODO_SCHEMA: MockField[] = [
  { name: 'Vessel Name', type: 'string' },
  { name: 'Latitude', type: 'number' },
  { name: 'Longitude', type: 'number' }
]

const REAL_DENODO_SOURCE: MockSource = {
  schema: REAL_DENODO_SCHEMA,
  rows: [{ 'Vessel Name': 'SARAH ANNE JUDD', Latitude: 38.58939, Longitude: -90.20013 }]
}

const DEGREES_SCHEMA: MockField[] = [
  { name: 'vessel', type: 'string' },
  { name: 'latitudedegrees', type: 'number' },
  { name: 'longitudedegrees', type: 'number' }
]

describe('detectGeoFields', () => {
  test('detects title-case Latitude/Longitude', () => {
    expect(detectGeoFields(REAL_DENODO_SCHEMA)).toEqual({ latField: 'Latitude', lngField: 'Longitude' })
  })

  test('detects latitudedegrees/longitudedegrees', () => {
    expect(detectGeoFields(DEGREES_SCHEMA)).toEqual({ latField: 'latitudedegrees', lngField: 'longitudedegrees' })
  })

  test('detects mock-style lat/lng', () => {
    expect(detectGeoFields(resolveMockSource('mock://incidents')!.schema)).toEqual({ latField: 'lat', lngField: 'lng' })
  })
})

test('graphicsFromMockSource plots real Denodo rows with title-case Latitude/Longitude fields', () => {
  const g = graphicsFromMockSource(REAL_DENODO_SOURCE)
  expect(g.length).toBe(1)
  expect(g[0].geometry.x).toBe(-90.20013)
  expect(g[0].geometry.y).toBe(38.58939)
  expect(g[0].attributes['Vessel Name']).toBe('SARAH ANNE JUDD')
  expect(g[0].attributes.__oid).toBe(1)
  expect(g[0].attributes.Latitude).toBeUndefined()
  expect(g[0].attributes.Longitude).toBeUndefined()
})

test('graphicsFromMockSource stamps each point geometry with a wgs84 spatialReference', () => {
  // Without an explicit SR on the geometry, ESRI mis-computes a client FeatureLayer's
  // extent (varying points → [0,0]) and the layer fails to render.
  const g = graphicsFromMockSource(REAL_DENODO_SOURCE)
  expect(g[0].geometry.spatialReference).toEqual({ wkid: 4326 })
})

test('graphicsFromMockSource skips rows with a non-finite coordinate, keeping __oid at the source row index', () => {
  // A single NaN point geometry poisons the whole client-side FeatureLayer (null
  // extent → nothing renders), so rows without a finite lng/lat are dropped.
  const src: MockSource = {
    schema: REAL_DENODO_SCHEMA,
    rows: [
      { 'Vessel Name': 'A', Latitude: 1.5, Longitude: 103.0 },
      { 'Vessel Name': 'B', Latitude: 1.6 }, // Longitude missing → Number(undefined)=NaN → skipped
      { 'Vessel Name': 'C', Latitude: 1.7, Longitude: 104.2 }
    ]
  }
  const g = graphicsFromMockSource(src)
  expect(g.length).toBe(2)
  expect(g.map(x => x.attributes.__oid)).toEqual([1, 3])
  expect(g.every(x => Number.isFinite(x.geometry.x) && Number.isFinite(x.geometry.y))).toBe(true)
})

test('graphicsFromMockSource still works for mock-style lowercase lat/lng (regression)', () => {
  const g = graphicsFromMockSource(resolveMockSource('mock://incidents')!)
  expect(g[0].geometry.x).toBe(-122.676)
  expect(g[0].geometry.y).toBe(45.523)
  expect(g[0].attributes.lat).toBeUndefined()
  expect(g[0].attributes.lng).toBeUndefined()
})

test('fieldsFromSchema excludes detected Latitude/Longitude but keeps other fields', () => {
  const f = fieldsFromSchema(REAL_DENODO_SCHEMA)
  expect(f.find(x => x.name === 'Vessel Name')).toBeDefined()
  expect(f.find(x => x.name === '__oid')).toBeDefined()
  expect(f.find(x => x.name === 'Latitude')).toBeUndefined()
  expect(f.find(x => x.name === 'Longitude')).toBeUndefined()
})
