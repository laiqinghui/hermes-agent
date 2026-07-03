export interface EsriBag {
  esriConfig: { apiKey?: string }
  FeatureLayer: new (o: unknown) => unknown
  reactiveUtils: { on: (getter: () => unknown, event: string, cb: (e: unknown) => void) => { remove(): void } }
}

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
    const key = (import.meta.env as Record<string, string | undefined>).VITE_ARCGIS_API_KEY
    if (key) esriConfig.apiKey = key
    return { esriConfig, FeatureLayer, reactiveUtils } as unknown as EsriBag
  })()
  return cached
}
