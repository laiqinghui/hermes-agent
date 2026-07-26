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
  },
  'mock://vessel-track': {
    schema: [
      { name: 'mmsi', type: 'string' },
      { name: 'vessel_name', type: 'string' },
      { name: 'ts', type: 'string' },
      { name: 'lat', type: 'number' },
      { name: 'lng', type: 'number' },
      { name: 'cog', type: 'number' }
    ],
    rows: [
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T00:00:00Z', lat: 1.230, lng: 103.700, cog: 75 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T01:00:00Z', lat: 1.245, lng: 103.760, cog: 72 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T02:00:00Z', lat: 1.268, lng: 103.815, cog: 66 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T03:00:00Z', lat: 1.300, lng: 103.860, cog: 55 },
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', ts: '2026-01-05T04:00:00Z', lat: 1.345, lng: 103.895, cog: 40 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T00:00:00Z', lat: 1.420, lng: 104.020, cog: 250 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T01:00:00Z', lat: 1.395, lng: 103.955, cog: 245 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T02:00:00Z', lat: 1.360, lng: 103.900, cog: 235 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T03:00:00Z', lat: 1.318, lng: 103.855, cog: 228 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', ts: '2026-01-05T04:00:00Z', lat: 1.270, lng: 103.820, cog: 220 }
    ]
  }
}

export function resolveMockSource(handle: string): MockSource | null {
  return SOURCES[handle] ?? null
}
