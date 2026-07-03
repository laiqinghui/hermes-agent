/// <reference types="vite/client" />

// Ambient declarations for ArcGIS map-components custom elements.
// React does not know these elements; we declare them as any so the @ts-expect-error
// in EsriMapMolecule.tsx is the single suppression point (strict TS compliance).
declare namespace JSX {
  interface IntrinsicElements {
    'arcgis-map': any
    'arcgis-legend': any
    'arcgis-feature-table': any
  }
}
