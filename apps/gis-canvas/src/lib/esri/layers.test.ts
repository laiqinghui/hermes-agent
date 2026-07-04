import { parseLayerRef, buildLayer, buildRowsLayer } from './layers'

test('parseLayerRef distinguishes rows vs service', () => {
  expect(parseLayerRef('mock://incidents')).toEqual({ kind: 'rows', name: 'incidents' })
  expect(parseLayerRef('https://x/FeatureServer/0')).toEqual({ kind: 'service', url: 'https://x/FeatureServer/0' })
})

test('parseLayerRef classifies data:// as handle', () => {
  expect(parseLayerRef('data://ab12')).toEqual({ kind: 'handle', handle: 'data://ab12' })
})

test('buildRowsLayer builds a FeatureLayer from a fetched page shape', () => {
  const calls: any[] = []
  const esri = { FeatureLayer: class { constructor(o: any) { calls.push(o) } } }
  const layer: any = buildRowsLayer(
    { schema: [{ name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }], rows: [{ lng: -122.6, lat: 45.5 }] },
    esri as any,
    'incidents'
  )
  expect(layer).toBeInstanceOf(esri.FeatureLayer)
  expect(calls[0].geometryType).toBe('point')
  expect(calls[0].objectIdField).toBe('__oid')
})

test('buildLayer(handle) throws — must be fetched first', () => {
  const esri = { FeatureLayer: class { constructor(_o: any) {} } }
  expect(() => buildLayer('data://ab12', esri as any)).toThrow()
})

test('buildLayer(service) constructs FeatureLayer from url via the injected esri bag', () => {
  const calls: any[] = []
  const esri = { FeatureLayer: class { constructor(o: any) { calls.push(o) } } }
  buildLayer('https://x/FeatureServer/0', esri as any)
  expect(calls[0].url).toBe('https://x/FeatureServer/0')
})

test('buildLayer(rows) constructs a client-side FeatureLayer with source graphics', () => {
  const calls: any[] = []
  const esri = { FeatureLayer: class { constructor(o: any) { calls.push(o) } } }
  buildLayer('mock://incidents', esri as any)
  expect(Array.isArray(calls[0].source)).toBe(true)
  expect(calls[0].objectIdField).toBe('__oid')
  expect(calls[0].geometryType).toBe('point')
})
