import { resolveMockSource, type MockSource } from '../mock-data'
import { graphicsFromMockSource, fieldsFromSchema } from './graphics'

export type LayerRef =
  | { kind: 'rows'; name: string }
  | { kind: 'service'; url: string }
  | { kind: 'handle'; handle: string }

export function parseLayerRef(ref: string): LayerRef {
  if (ref.startsWith('data://')) return { kind: 'handle', handle: ref }
  if (ref.startsWith('mock://')) return { kind: 'rows', name: ref.slice('mock://'.length) }
  return { kind: 'service', url: ref }
}

/** Build a client-side FeatureLayer from a rows source (mock:// or a fetched data:// page).
 * Geometry is synthesized from lng/lat columns — Data Agent / Denodo rows are tabular. */
export function buildRowsLayer(
  source: MockSource,
  esri: { FeatureLayer: new (o: unknown) => unknown },
  title?: string
): unknown {
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
    popupTemplate: { title: 'Feature {__oid}', content: 'Row {__oid}' },
    title: title ?? 'layer'
  })
}

/** `esri` is the lazily-loaded module bag: { FeatureLayer }. Returns a FeatureLayer instance.
 * data:// handles must be fetched first (see buildRowsLayer) — they throw here. */
export function buildLayer(ref: string, esri: { FeatureLayer: new (o: unknown) => unknown }): unknown {
  const parsed = parseLayerRef(ref)
  if (parsed.kind === 'service') {
    return new esri.FeatureLayer({ url: parsed.url })
  }
  if (parsed.kind === 'handle') {
    throw new Error(`data:// layer must be fetched before building: ${ref}`)
  }
  const source = resolveMockSource(ref)
  if (!source) throw new Error(`unknown mock source: ${ref}`)
  return buildRowsLayer(source, esri, parsed.name)
}
