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

/** Lazy-load ESRI (multi-MB). Cached so multiple maps share one import. */
export function loadEsri(): Promise<EsriBag> {
  if (cached) return cached
  cached = (async () => {
    await import('@arcgis/map-components/components/arcgis-map')
    await import('@arcgis/map-components/components/arcgis-legend')
    await import('@arcgis/map-components/components/arcgis-feature-table')
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
