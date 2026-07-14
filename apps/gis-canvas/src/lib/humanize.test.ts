import { describe, it, expect } from 'vitest'
import { humanizeLabel } from './humanize'

describe('humanizeLabel', () => {
  it('title-cases snake_case tool names', () => {
    expect(humanizeLabel('skill_view')).toBe('Skill View')
    expect(humanizeLabel('execute_code')).toBe('Execute Code')
    expect(humanizeLabel('data_query')).toBe('Data Query')
  })
  it('handles kebab-case', () => { expect(humanizeLabel('render-view')).toBe('Render View') })
  it('preserves already-cased keys', () => { expect(humanizeLabel('RowCount')).toBe('RowCount') })
  it('capitalizes a bare lowercase word', () => { expect(humanizeLabel('handle')).toBe('Handle') })
  it('returns empty input unchanged', () => { expect(humanizeLabel('')).toBe('') })
})
