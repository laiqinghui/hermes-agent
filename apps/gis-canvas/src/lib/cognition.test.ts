import { describe, it, expect } from 'vitest'
import { describeStep } from './cognition'
import type { BuildStep } from './activity'

const mk = (label: string, result: unknown, extra: Partial<BuildStep> = {}): BuildStep =>
  ({ id: 1, label, status: 'done', result, ...extra })

describe('describeStep', () => {
  it('humanizes the tool label into the title', () => {
    expect(describeStep(mk('data_query', { rows: [] })).title).toBe('Data Query')
  })

  it('detects a bare array of rows', () => {
    const m = describeStep(mk('list', [{ a: 1 }, { a: 2 }]))
    expect(m.shape).toBe('rows')
    expect(m.rowCount).toBe(2)
    expect(m.summary).toBe('2 rows')
  })

  it('finds rows nested under sample/rows/data/records', () => {
    expect(describeStep(mk('q', { sample: [{ a: 1 }] })).shape).toBe('rows')
    expect(describeStep(mk('q', { rows: [{ a: 1 }, { a: 2 }] })).rowCount).toBe(2)
  })

  it('detects geospatial rows via lat/lng aliases (case-insensitive)', () => {
    const m = describeStep(mk('positions', { sample: [{ Latitude: 41.3, Longitude: -70.1, Speed: 24.7 }] }))
    expect(m.shape).toBe('geo-rows')
  })

  it('classifies an error result', () => {
    const m = describeStep(mk('data_query', { error: 'timeout' }))
    expect(m.shape).toBe('error')
    expect(m.summary).toBe('timeout')
  })

  it('classifies a scalar / small object as a stat', () => {
    expect(describeStep(mk('count', 42)).shape).toBe('stat')
    expect(describeStep(mk('meta', { rev: 3 })).shape).toBe('stat')
  })

  it('falls back to text (using summary/label) when there is no structured result', () => {
    const m = describeStep(mk('render_view', undefined, { summary: 'Rendered' }))
    expect(m.shape).toBe('text')
    expect(m.summary).toBe('Rendered')
  })
})
