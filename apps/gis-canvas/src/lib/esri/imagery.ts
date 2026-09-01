import type { ImageryScene } from '../types'
import { bboxToRings } from '../imagery'

/** The lazily-loaded raster module bag (see loadImagery in ./loader). */
export interface ImageryBag {
  ImageryTileLayer: new (o: unknown) => unknown
  RasterStretchRenderer: new (o: unknown) => unknown
}

const DEFAULT_RGB_BANDS = [0, 1, 2]
const DEFAULT_SAR_BANDS = [0]

/** One ImageryTileLayer per scene, streaming the COG by HTTP range request.
 *
 * Optical visual/TCI assets are already 8-bit RGB and need no stretch. SAR is
 * single-band and high-dynamic-range: without a percent-clip stretch it paints a
 * uniform black rectangle — and SAR is the primary sensor the shadow-fleet
 * workflow recommends for confirming presence during AIS silence. */
export function buildImageryLayer(scene: ImageryScene, esri: ImageryBag): unknown {
  if (scene.sensor === 'sar') {
    return new esri.ImageryTileLayer({
      url: scene.url,
      title: scene.title,
      bandIds: scene.bandIds ?? DEFAULT_SAR_BANDS,
      renderer: new esri.RasterStretchRenderer({
        stretchType: 'percent-clip',
        minPercent: 0.5,
        maxPercent: 0.5,
        dra: true
      })
    })
  }
  return new esri.ImageryTileLayer({
    url: scene.url,
    title: scene.title,
    bandIds: scene.bandIds ?? DEFAULT_RGB_BANDS
  })
}

/** A single client-side polygon layer outlining every candidate scene's bbox, so
 * coverage can be judged against the target before pulling a 170MB COG. Returns
 * null when nothing is drawable — the caller must not add an empty layer. */
export function buildFootprintLayer(
  scenes: ImageryScene[],
  esri: { FeatureLayer: new (o: unknown) => unknown },
  title = 'Imagery footprints'
): unknown | null {
  const graphics = scenes
    .map(scene => ({ scene, rings: bboxToRings(scene.bbox) }))
    .filter((g): g is { scene: ImageryScene; rings: number[][][] } => g.rings != null)
    .map((g, i) => ({
      // SP3b: geometry MUST carry an explicit spatialReference, else the layer
      // gets a [0,0] extent and never renders.
      geometry: { type: 'polygon', rings: g.rings, spatialReference: { wkid: 4326 } },
      attributes: {
        __oid: i + 1,
        scene_id: g.scene.id,
        title: g.scene.title,
        datetime: g.scene.datetime,
        sensor: g.scene.sensor
      }
    }))
  if (!graphics.length) return null
  return new esri.FeatureLayer({
    source: graphics,
    fields: [
      { name: '__oid', alias: '__oid', type: 'oid' },
      { name: 'scene_id', alias: 'Scene', type: 'string' },
      { name: 'title', alias: 'Title', type: 'string' },
      { name: 'datetime', alias: 'Acquired', type: 'string' },
      { name: 'sensor', alias: 'Sensor', type: 'string' }
    ],
    objectIdField: '__oid',
    geometryType: 'polygon',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: {
        type: 'simple-fill',
        color: [0, 0, 0, 0],
        outline: { color: '#e0b45b', width: 1.5 }
      }
    },
    popupTemplate: { title: '{title}', content: '{sensor} — {datetime}' },
    title
  })
}
