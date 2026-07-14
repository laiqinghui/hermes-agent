import { describe, it, expect } from 'vitest'
import { summarizeValue, fieldCount, isExpandable, toRows } from './summarize-value'

describe('summarizeValue', () => {
  it('shows scalars directly', () => {
    expect(summarizeValue(20)).toBe('20')
    expect(summarizeValue('data://x')).toBe('data://x')
    expect(summarizeValue(true)).toBe('true')
  })
  it('renders nullish as a dash', () => {
    expect(summarizeValue(null)).toBe('—')
    expect(summarizeValue(undefined)).toBe('—')
  })
  it('summarizes an array of objects with a field count', () => {
    expect(summarizeValue([{ name: 'a', type: 't' }, { name: 'b', type: 't' }])).toBe('2 items (2 fields)')
  })
  it('summarizes a scalar array without a field count', () => {
    expect(summarizeValue([1, 2, 3])).toBe('3 items')
  })
  it('summarizes a plain object as a field count', () => {
    expect(summarizeValue({ a: 1, b: 2 })).toBe('2 fields')
  })
  it('truncates long strings', () => {
    const out = summarizeValue('x'.repeat(200))
    expect(out.length).toBeLessThanOrEqual(81)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('fieldCount', () => {
  it('counts object keys and array length; scalars are 0', () => {
    expect(fieldCount({ a: 1, b: 2, c: 3 })).toBe(3)
    expect(fieldCount([1, 2])).toBe(2)
    expect(fieldCount('x')).toBe(0)
  })
})

describe('toRows / isExpandable', () => {
  it('makes a humanized row per object key, preserving order', () => {
    expect(toRows({ RowCount: 20, handle: 'x' })).toEqual([
      { label: 'RowCount', value: 20 },
      { label: 'Handle', value: 'x' }
    ])
  })
  it('makes an indexed row per array element', () => {
    expect(toRows(['a', 'b'])).toEqual([{ label: '[0]', value: 'a' }, { label: '[1]', value: 'b' }])
  })
  it('returns no rows for a scalar', () => { expect(toRows(5)).toEqual([]) })
  it('marks non-empty objects/arrays expandable, scalars not', () => {
    expect(isExpandable({ a: 1 })).toBe(true)
    expect(isExpandable([1])).toBe(true)
    expect(isExpandable(5)).toBe(false)
    expect(isExpandable({})).toBe(false)
  })
})
