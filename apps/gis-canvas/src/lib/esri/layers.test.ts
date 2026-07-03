import { parseLayerRef, buildLayer } from './layers'

test('parseLayerRef distinguishes rows vs service', () => {
  expect(parseLayerRef('mock://incidents')).toEqual({ kind: 'rows', name: 'incidents' })
  expect(parseLayerRef('https://x/FeatureServer/0')).toEqual({ kind: 'service', url: 'https://x/FeatureServer/0' })
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
