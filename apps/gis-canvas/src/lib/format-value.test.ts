import { describe, it, expect } from 'vitest'
import { formatValue } from './format-value'

describe('formatValue', () => {
  it('passes strings through', () => { expect(formatValue('hello')).toBe('hello') })
  it('pretty-prints objects', () => { expect(formatValue({ a: 1 })).toBe('{\n  "a": 1\n}') })
  it('renders null/undefined as a dash', () => {
    expect(formatValue(null)).toBe('—')
    expect(formatValue(undefined)).toBe('—')
  })
  it('truncates very long values with an ellipsis marker', () => {
    const out = formatValue('x'.repeat(5000), 100)
    expect(out.length).toBeLessThan(140)
    expect(out).toContain('…')
  })
})
