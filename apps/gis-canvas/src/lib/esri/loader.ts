export interface EsriBag {
  esriConfig: { apiKey?: string; assetsPath?: string }
  FeatureLayer: new (o: unknown) => unknown
  reactiveUtils: { on: (getter: () => unknown, event: string, cb: (e: unknown) => void) => { remove(): void } }
}

// @arcgis/core loads Web Workers/WASM/assets at runtime from esriConfig.assetsPath.
// The npm package's default path is not served by our dev/build, so client-side
// FeatureLayer workers fail to parse ("Unexpected token"). Point assets at the
// versioned CDN (keyless — assets are public). Bump on @arcgis/core major/minor upgrades.
const ARCGIS_ASSETS_CDN = 'https://js.arcgis.com/4.34/@arcgis/core/assets'

let cached: Promise<EsriBag> | null = null
let featureTableCached: Promise<void> | null = null

/** Lazy-load ESRI core + map/legend components (multi-MB). Cached so multiple
 * maps share one import.
 *
 * NOTE: the `arcgis-feature-table` component is deliberately NOT imported here.
 * It is the only ESRI web component that pulls the @vaadin/grid -> @polymer/polymer
 * subtree, whose `dom-module.js` Vite's dep optimizer mis-emits (browser rejects
 * `static import(...)` with "Unexpected token '('"). Loading it eagerly made that
 * failure reject loadEsri() and blank out the map even on canvases with no
 * feature-table. It now loads on demand via loadFeatureTable(). */
export function loadEsri(): Promise<EsriBag> {
  if (cached) return cached
  cached = (async () => {
    await import('@arcgis/map-components/components/arcgis-map')
    await import('@arcgis/map-components/components/arcgis-legend')
    const [{ default: esriConfig }, { default: FeatureLayer }, reactiveUtils] = await Promise.all([
      import('@arcgis/core/config.js'),
      import('@arcgis/core/layers/FeatureLayer.js'),
      import('@arcgis/core/core/reactiveUtils.js')
    ])
    esriConfig.assetsPath = ARCGIS_ASSETS_CDN
    const key = (import.meta.env as Record<string, string | undefined>).VITE_ARCGIS_API_KEY
    if (key) esriConfig.apiKey = key
    return { esriConfig, FeatureLayer, reactiveUtils } as unknown as EsriBag
  })()
  return cached
}

/** Register the `arcgis-feature-table` custom element on demand. Kept separate
 * from loadEsri() so its heavy @vaadin/@polymer dependency subtree only loads
 * when a feature-table molecule is actually on the canvas. */
export function loadFeatureTable(): Promise<void> {
  if (featureTableCached) return featureTableCached
  featureTableCached = import('@arcgis/map-components/components/arcgis-feature-table').then(() => undefined)
  return featureTableCached
}
