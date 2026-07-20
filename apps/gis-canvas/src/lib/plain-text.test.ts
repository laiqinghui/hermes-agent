import { describe, it, expect } from 'vitest'
import { stripInlineMarkdown } from './plain-text'

describe('stripInlineMarkdown', () => {
  it('unwraps bold/italic/code emphasis', () => {
    expect(stripInlineMarkdown('**Planning the query**')).toBe('Planning the query')
    expect(stripInlineMarkdown('__bold__ and _italic_')).toBe('bold and italic')
    expect(stripInlineMarkdown('use `data_query` now')).toBe('use data_query now')
    expect(stripInlineMarkdown('a *word* here')).toBe('a word here')
  })
  it('leaves plain text and mid-word underscores untouched', () => {
    expect(stripInlineMarkdown('Retrieve latest 20 positions')).toBe('Retrieve latest 20 positions')
    expect(stripInlineMarkdown('vessel_positions table')).toBe('vessel_positions table')
  })
})
