/** Phase-1 stand-in for the data plane: mock:// handles resolved client-side. */
export interface MockField { name: string; type: 'string' | 'number' }
export interface MockSource { schema: MockField[]; rows: Array<Record<string, string | number>> }

export const PUBLIC_FEATURESERVER =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Major_Cities/FeatureServer/0'

const SOURCES: Record<string, MockSource> = {
  'mock://incidents': {
    schema: [
      { name: 'id', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'district', type: 'string' },
      { name: 'reported_at', type: 'string' },
      { name: 'lng', type: 'number' },
      { name: 'lat', type: 'number' }
    ],
    rows: [
      { id: 'f_82', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T09:14Z', lng: -122.676, lat: 45.523 },
      { id: 'f_91', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T08:47Z', lng: -122.678, lat: 45.521 },
      { id: 'f_63', severity: 'med',  district: 'Riverside', reported_at: '2026-07-01T08:02Z', lng: -122.660, lat: 45.500 },
      { id: 'f_57', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T07:51Z', lng: -122.673, lat: 45.525 },
      { id: 'f_44', severity: 'low',  district: 'Midtown',  reported_at: '2026-07-01T07:20Z', lng: -122.640, lat: 45.530 },
      { id: 'f_31', severity: 'med',  district: 'Midtown',  reported_at: '2026-07-01T06:58Z', lng: -122.638, lat: 45.528 },
      { id: 'f_29', severity: 'high', district: 'Riverside', reported_at: '2026-07-01T06:31Z', lng: -122.662, lat: 45.498 },
      { id: 'f_18', severity: 'low',  district: 'Downtown', reported_at: '2026-07-01T06:05Z', lng: -122.675, lat: 45.519 }
    ]
  },
  'mock://districts': {
    schema: [
      { name: 'district', type: 'string' },
      { name: 'population', type: 'number' }
    ],
    rows: [
      { district: 'Downtown', population: 51200 },
      { district: 'Riverside', population: 23800 },
      { district: 'Midtown', population: 33400 },
      { district: 'Harbor', population: 12100 }
    ]
  }
}

export function resolveMockSource(handle: string): MockSource | null {
  return SOURCES[handle] ?? null
}
