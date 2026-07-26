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
})
