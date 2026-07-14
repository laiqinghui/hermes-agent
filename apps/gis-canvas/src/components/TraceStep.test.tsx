import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceStep } from './TraceStep'

describe('TraceStep', () => {
  const step = { id: 1, label: 'query', status: 'done' as const, context: 'running vql', args: { sql: 'SELECT 1' }, result: { rows: 3 }, durationS: 1.2 }
  it('shows the name and context collapsed, hides args/result until expanded', () => {
    render(<TraceStep step={step} />)
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText(/running vql/)).toBeInTheDocument()
    expect(screen.queryByText(/SELECT 1/)).not.toBeInTheDocument()
  })
  it('reveals args and result on click', () => {
    render(<TraceStep step={step} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/SELECT 1/)).toBeInTheDocument()
    expect(screen.getByText(/"rows": 3/)).toBeInTheDocument()
  })
})
