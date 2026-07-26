import { resolveMockSource, type MockSource, type MockField } from '../mock-data'
import { graphicsFromMockSource, fieldsFromSchema } from './graphics'
import { resolveLayerColor } from './layer-color'
import type { TrackGroup } from './tracks'

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
  esri: { FeatureLayer: new (o: unknown) => unknown; HeatmapRenderer?: new (o: unknown) => unknown },
  title?: string,
  render: 'points' | 'heatmap' = 'points',
  color = '#e0685b'
): unknown {
  const renderer =
    render === 'heatmap' && esri.HeatmapRenderer
      ? new esri.HeatmapRenderer({
          radius: 18,
          colorStops: [
            { ratio: 0, color: 'rgba(13,140,130,0)' },
            { ratio: 0.4, color: 'rgba(13,140,130,0.55)' },
            { ratio: 1, color: 'rgba(224,104,91,0.9)' }
          ]
        })
      : {
          type: 'simple',
          symbol: { type: 'simple-marker', color, size: 8, outline: { color: '#fff', width: 1 } }
        }
  return new esri.FeatureLayer({
    source: graphicsFromMockSource(source),
    fields: fieldsFromSchema(source.schema),
    objectIdField: '__oid',
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer,
    popupTemplate: { title: 'Feature {__oid}', content: 'Row {__oid}' },
    title: title ?? 'layer'
  })
}

/** `esri` is the lazily-loaded module bag: { FeatureLayer }. Returns a FeatureLayer instance.
 * data:// handles must be fetched first (see buildRowsLayer) — they throw here. */
export function buildLayer(
  ref: string,
  esri: { FeatureLayer: new (o: unknown) => unknown; HeatmapRenderer?: new (o: unknown) => unknown },
  render: 'points' | 'heatmap' = 'points',
  color = '#e0685b'
): unknown {
  const parsed = parseLayerRef(ref)
  if (parsed.kind === 'service') {
    return new esri.FeatureLayer({ url: parsed.url })
  }
  if (parsed.kind === 'handle') {
    throw new Error(`data:// layer must be fetched before building: ${ref}`)
  }
  const source = resolveMockSource(ref)
  if (!source) throw new Error(`unknown mock source: ${ref}`)
  return buildRowsLayer(source, esri, parsed.name, render, color)
}

/** Turn pure TrackGroups into ESRI client-side FeatureLayers: a track line
 * (when there are >=2 vertices) + a heading-rotated, time-aware point layer,
 * per group, each colored by its colorIndex. */
export function trackLayersFromGroups(
  groups: TrackGroup[],
  esri: { FeatureLayer: new (o: unknown) => unknown },
  schema: MockField[],
  titlePrefix?: string
): unknown[] {
  const out: unknown[] = []
  // point fields = the source (non-geo) fields + synthetic __time (date) + heading (double)
  const baseFields = fieldsFromSchema(schema)
  const hasHeading = baseFields.some(f => f.name === 'heading')
  const pointFields = [
    ...baseFields,
    { name: '__time', alias: '__time', type: 'date' as const },
    ...(hasHeading ? [] : [{ name: 'heading', alias: 'heading', type: 'double' as const }])
  ]

  for (const g of groups) {
    const color = resolveLayerColor(g.colorIndex)
    const name = g.trackId ? `${titlePrefix ?? 'track'} · ${g.trackId}` : (titlePrefix ?? 'track')

    if (g.path.length >= 2) {
      out.push(new esri.FeatureLayer({
        source: [{
          geometry: { type: 'polyline', paths: [g.path], spatialReference: { wkid: 4326 } },
          attributes: { __oid: 1 }
        }],
        fields: [{ name: '__oid', alias: '__oid', type: 'oid' }],
        objectIdField: '__oid',
        geometryType: 'polyline',
        spatialReference: { wkid: 4326 },
        renderer: { type: 'simple', symbol: { type: 'simple-line', color, width: 2 } },
        title: `${name} · line`
      }))
    }

    out.push(new esri.FeatureLayer({
      source: g.points,
      fields: pointFields,
      objectIdField: '__oid',
      geometryType: 'point',
      spatialReference: { wkid: 4326 },
      timeInfo: { startField: '__time' },
      renderer: {
        type: 'simple',
        symbol: { type: 'simple-marker', style: 'triangle', color, size: 10, outline: { color: '#fff', width: 1 } },
        visualVariables: [{ type: 'rotation', field: 'heading', rotationType: 'geographic' }]
      },
      title: name
    }))
  }
  return out
}
