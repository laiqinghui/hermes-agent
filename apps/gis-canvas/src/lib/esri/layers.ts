import { resolveMockSource } from '../mock-data'
import { graphicsFromMockSource, fieldsFromSchema } from './graphics'

export type LayerRef =
  | { kind: 'rows'; name: string }
  | { kind: 'service'; url: string }

export function parseLayerRef(ref: string): LayerRef {
  if (ref.startsWith('mock://')) return { kind: 'rows', name: ref.slice('mock://'.length) }
  return { kind: 'service', url: ref }
}

/** `esri` is the lazily-loaded module bag: { FeatureLayer }. Returns a FeatureLayer instance. */
export function buildLayer(ref: string, esri: { FeatureLayer: new (o: unknown) => unknown }): unknown {
  const parsed = parseLayerRef(ref)
  if (parsed.kind === 'service') {
    return new esri.FeatureLayer({ url: parsed.url })
  }
  const source = resolveMockSource(ref)
  if (!source) throw new Error(`unknown mock source: ${ref}`)
  return new esri.FeatureLayer({
    source: graphicsFromMockSource(source),
    fields: fieldsFromSchema(source.schema),
    objectIdField: '__oid',
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: { type: 'simple-marker', color: '#e0685b', size: 8, outline: { color: '#fff', width: 1 } }
    },
    popupTemplate: { title: 'Incident {__oid}', content: 'Severity: {severity} — {district}' },
    title: parsed.name
  })
}
