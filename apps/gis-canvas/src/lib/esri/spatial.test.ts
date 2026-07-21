import { describe, it, expect } from 'vitest'
import { containedKeys } from './spatial'

const rows = [
  { id: 'a', lng: -70.1, lat: 41.3 },
  { id: 'b', lng: -70.2, lat: 41.4 },
  { id: 'c', lng: 10, lat: 50 }
]

describe('containedKeys', () => {
  it('returns the id-field keys of rows whose lng/lat satisfy the predicate', () => {
    const keys = containedKeys(rows, 'id', 'lng', 'lat', (lng) => lng < 0) // the two western points
    expect(keys).toEqual(['a', 'b'])
  })

  it('skips rows with non-finite coordinates', () => {
    const bad = [{ id: 'x', lng: 'nope', lat: 41 }, { id: 'y', lng: -70, lat: 41 }]
    expect(containedKeys(bad, 'id', 'lng', 'lat', () => true)).toEqual(['y'])
  })

  it('returns [] when nothing matches', () => {
    expect(containedKeys(rows, 'id', 'lng', 'lat', () => false)).toEqual([])
  })
})
