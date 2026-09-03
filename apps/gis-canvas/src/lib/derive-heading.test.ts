import { describe, it, expect } from 'vitest'
import { deriveHeading } from './derive-heading'

describe('deriveHeading', () => {
  it('keeps a short punctuation-light first line as the title', () => {
    expect(deriveHeading('Exploring vessel positions')).toBe('Exploring vessel positions')
  })
  it('uses the first line even when a long body follows on later lines', () => {
    expect(deriveHeading('Considering display options\nI think a table is best...')).toBe('Considering display options')
  })
  it('truncates a long single-paragraph reasoning with an ellipsis', () => {
    const out = deriveHeading('I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.')
    expect(out.length).toBeLessThanOrEqual(61)
    expect(out.endsWith('…')).toBe(true)
    expect(out.startsWith('I need to show')).toBe(true)
  })
  it('returns empty for empty input', () => { expect(deriveHeading('')).toBe('') })
})

test('strips markdown emphasis so the heading reads as plain text', () => {
  expect(deriveHeading('**Identifying required data skills**')).toBe('Identifying required data skills')
  expect(deriveHeading('*Planning* the `data_query` calls')).toBe('Planning the data_query calls')
})
