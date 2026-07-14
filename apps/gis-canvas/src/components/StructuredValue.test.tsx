import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StructuredValue } from './StructuredValue'

describe('StructuredValue', () => {
  it('renders scalar fields as label + summary', () => {
    render(<StructuredValue value={{ RowCount: 20, Handle: 'data://x' }} />)
    expect(screen.getByText('RowCount')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText('Handle')).toBeInTheDocument()
    expect(screen.getByText('data://x')).toBeInTheDocument()
  })
  it('summarizes a nested array of objects and expands it on click', () => {
    const sample = [
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
      { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }
    ]
    render(<StructuredValue value={{ Sample: sample }} />)
    expect(screen.getByText('3 items (6 fields)')).toBeInTheDocument()
    expect(screen.queryByText('[0]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sample/i }))
    expect(screen.getByText('[0]')).toBeInTheDocument()
  })
  it('renders a top-level scalar directly', () => {
    render(<StructuredValue value={42} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })
})
