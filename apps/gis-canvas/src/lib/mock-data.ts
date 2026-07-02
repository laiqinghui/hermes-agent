/** Phase-1 stand-in for the data plane: mock:// handles resolved client-side. */
export interface MockField { name: string; type: 'string' | 'number' }
export interface MockSource { schema: MockField[]; rows: Array<Record<string, string | number>> }

const SOURCES: Record<string, MockSource> = {
  'mock://incidents': {
    schema: [
      { name: 'id', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'district', type: 'string' },
      { name: 'reported_at', type: 'string' }
    ],
    rows: [
      { id: 'f_82', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T09:14Z' },
      { id: 'f_91', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T08:47Z' },
      { id: 'f_63', severity: 'med', district: 'Riverside', reported_at: '2026-07-01T08:02Z' },
      { id: 'f_57', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T07:51Z' },
      { id: 'f_44', severity: 'low', district: 'Midtown', reported_at: '2026-07-01T07:20Z' },
      { id: 'f_31', severity: 'med', district: 'Midtown', reported_at: '2026-07-01T06:58Z' },
      { id: 'f_29', severity: 'high', district: 'Riverside', reported_at: '2026-07-01T06:31Z' },
      { id: 'f_18', severity: 'low', district: 'Downtown', reported_at: '2026-07-01T06:05Z' }
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
