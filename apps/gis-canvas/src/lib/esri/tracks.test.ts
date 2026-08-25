import { resolveTrackFields } from './tracks'
import type { MockField } from '../mock-data'

const AIS: MockField[] = [
  { name: 'MMSI', type: 'string' },
  { name: 'BaseDateTime', type: 'string' },
  { name: 'LAT', type: 'number' },
  { name: 'LON', type: 'number' },
  { name: 'COG', type: 'number' }
]

describe('resolveTrackFields', () => {
  test('detects time / trackId / heading / lat / lng by alias', () => {
    expect(resolveTrackFields(AIS)).toEqual({
      timeField: 'BaseDateTime', trackIdField: 'MMSI', headingField: 'COG', latField: 'LAT', lngField: 'LON'
    })
  })

  test('explicit overrides win over alias detection', () => {
    const r = resolveTrackFields(AIS, { timeField: 'BaseDateTime', trackIdField: 'COG' })
    expect(r.trackIdField).toBe('COG')
    expect(r.timeField).toBe('BaseDateTime')
  })

  test('no time-like field leaves timeField undefined', () => {
    const r = resolveTrackFields([{ name: 'name', type: 'string' }, { name: 'lat', type: 'number' }, { name: 'lng', type: 'number' }])
    expect(r.timeField).toBeUndefined()
    expect(r.latField).toBe('lat')
    expect(r.lngField).toBe('lng')
  })

  const VESSEL: MockField[] = [
    { name: 'mmsi', type: 'string' }, { name: 'vessel_name', type: 'string' }, { name: 'ts', type: 'string' },
    { name: 'lat', type: 'number' }, { name: 'lng', type: 'number' }, { name: 'cog', type: 'number' }
  ]

  test('an override naming a non-existent column falls back to alias detection', () => {
    // An agent that guesses the wrong field names (timeField:'timestamp', trackIdField:'vessel',
    // headingField:'heading' — none of which exist) must not silently break the render.
    const r = resolveTrackFields(VESSEL, { timeField: 'timestamp', trackIdField: 'vessel', headingField: 'heading', latField: 'lat', lngField: 'lng' })
    expect(r.timeField).toBe('ts')       // detected, not the bogus 'timestamp'
    expect(r.trackIdField).toBe('mmsi')  // detected, not the bogus 'vessel'
    expect(r.headingField).toBe('cog')   // detected, not the bogus 'heading'
    expect(r.latField).toBe('lat')
    expect(r.lngField).toBe('lng')
  })

  test('an override matching a real column (case-insensitively) resolves to the actual column name', () => {
    const r = resolveTrackFields(VESSEL, { timeField: 'TS', trackIdField: 'vessel_name' })
    expect(r.timeField).toBe('ts')            // matched case-insensitively → actual column
    expect(r.trackIdField).toBe('vessel_name') // honored over the 'mmsi' default
  })
})

import { buildTrackGroups, bearingBetween, timeExtentOf } from './tracks'
import type { TrackFields } from './tracks'

const FIELDS: TrackFields = { timeField: 'ts', trackIdField: 'mmsi', headingField: 'cog', latField: 'lat', lngField: 'lng' }

describe('bearingBetween', () => {
  test('due north is ~0°, due east is ~90°', () => {
    expect(Math.round(bearingBetween(0, 0, 0, 1))).toBe(0)
    expect(Math.round(bearingBetween(0, 0, 1, 0))).toBe(90)
  })
})

describe('buildTrackGroups', () => {
  const rows = [
    { mmsi: 'A', ts: '2026-01-01T02:00Z', lat: 2, lng: 0, cog: 10 },
    { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 20 }, // earlier — must sort before the row above
    { mmsi: 'B', ts: '2026-01-01T00:30Z', lat: 5, lng: 5, cog: 33 }
  ]

  test('groups by trackId and time-orders each group ascending', () => {
    const g = buildTrackGroups(rows, FIELDS)
    expect(g.map(x => x.trackId)).toEqual(['A', 'B'])
    const a = g.find(x => x.trackId === 'A')!
    expect(a.points.map(p => p.attributes.__time)).toEqual([Date.parse('2026-01-01T00:00Z'), Date.parse('2026-01-01T02:00Z')])
    expect(a.path).toEqual([[0, 0], [0, 2]])
  })

  test('assigns colorIndex from baseColorIndex in group order', () => {
    const g = buildTrackGroups(rows, FIELDS, 3)
    expect(g.map(x => x.colorIndex)).toEqual([3, 4])
  })

  test('stamps SR on every point geometry and keeps __oid at the source row index', () => {
    const g = buildTrackGroups(rows, FIELDS)
    const a = g.find(x => x.trackId === 'A')!
    expect(a.points.every(p => p.geometry.spatialReference.wkid === 4326)).toBe(true)
    // source rows 0 and 1 are track A → __oid 1 and 2 (order by time, values preserved)
    expect(a.points.map(p => p.attributes.__oid).sort()).toEqual([1, 2])
  })

  test('drops rows with unparseable time and non-finite coords', () => {
    const bad = [
      { mmsi: 'A', ts: 'not-a-date', lat: 1, lng: 1, cog: 0 },
      { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: Number.NaN, lng: 1, cog: 0 },
      { mmsi: 'A', ts: '2026-01-01T01:00Z', lat: 1, lng: 1, cog: 0 }
    ]
    const g = buildTrackGroups(bad, FIELDS)
    expect(g).toHaveLength(1)
    expect(g[0].points).toHaveLength(1)
    expect(g[0].points[0].attributes.__oid).toBe(3) // third source row survived
  })

  test('derives heading from successive positions when no heading field', () => {
    const noHeadFields: TrackFields = { ...FIELDS, headingField: undefined }
    const g = buildTrackGroups(
      [
        { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0 },
        { mmsi: 'A', ts: '2026-01-01T01:00Z', lat: 0, lng: 1 } // moved due east
      ],
      noHeadFields
    )
    expect(Math.round(Number(g[0].points[0].attributes.heading))).toBe(90)
  })

  test('single observation yields a point but no line (path length < 2)', () => {
    const g = buildTrackGroups([{ mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 5 }], FIELDS)
    expect(g[0].points).toHaveLength(1)
    expect(g[0].path.length).toBeLessThan(2)
  })

  test('a single group when no trackId field', () => {
    const g = buildTrackGroups(
      [{ ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 5 }, { ts: '2026-01-01T01:00Z', lat: 1, lng: 1, cog: 5 }],
      { timeField: 'ts', headingField: 'cog', latField: 'lat', lngField: 'lng' }
    )
    expect(g).toHaveLength(1)
    expect(g[0].trackId).toBe('')
  })

  test('returns [] when no time field is resolved', () => {
    expect(buildTrackGroups(rows, { latField: 'lat', lngField: 'lng' })).toEqual([])
  })

  test('the resolved heading field (default alias "heading") is not shadowed by its own raw column in rest', () => {
    // The raw column is a numeric STRING (as real tabular data often is) while the
    // computed attribute is coerced to a number via Number(row[headingField]) — if
    // `rest` (spread AFTER the computed key) still carries the raw column, the
    // string clobbers the number even though they "look" the same.
    const g = buildTrackGroups(
      [{ mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, heading: '77' }],
      { timeField: 'ts', trackIdField: 'mmsi', headingField: 'heading', latField: 'lat', lngField: 'lng' }
    )
    const attrs = g[0].points[0].attributes as Record<string, unknown>
    expect(attrs.heading).toBe(77) // normalized number, not the raw '77' string
    expect(typeof attrs.heading).toBe('number')
  })

  test('an overridden headingField is excluded from rest so it cannot shadow the computed heading', () => {
    const g = buildTrackGroups(
      [{ mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, course: '123' }],
      { timeField: 'ts', trackIdField: 'mmsi', headingField: 'course', latField: 'lat', lngField: 'lng' }
    )
    const attrs = g[0].points[0].attributes as Record<string, unknown>
    expect(attrs.heading).toBe(123) // normalized number, not the raw '123' string
    expect(attrs.course).toBeUndefined() // the resolved heading source column is excluded from rest
  })
})

describe('timeExtentOf', () => {
  test('returns min/max __time across all groups, or null when empty', () => {
    const g = buildTrackGroups(
      [
        { mmsi: 'A', ts: '2026-01-01T00:00Z', lat: 0, lng: 0, cog: 0 },
        { mmsi: 'B', ts: '2026-01-01T05:00Z', lat: 1, lng: 1, cog: 0 }
      ],
      FIELDS
    )
    expect(timeExtentOf(g)).toEqual({ start: Date.parse('2026-01-01T00:00Z'), end: Date.parse('2026-01-01T05:00Z') })
    expect(timeExtentOf([])).toBeNull()
  })
})
