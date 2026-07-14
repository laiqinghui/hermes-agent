import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceStep } from './TraceStep'
import type { BuildStep } from '../lib/activity'

const step: BuildStep = {
  id: 1, label: 'data_query', status: 'done', context: 'From admin.vessel_positions',
  args: { sql: 'SELECT 1' }, result: { RowCount: 20, Handle: 'data://x' }, durationS: 1.2
}

describe('TraceStep', () => {
  it('shows a humanized name, field count, and context collapsed', () => {
    render(<TraceStep step={step} />)
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText('2 items')).toBeInTheDocument()
    expect(screen.getByText(/From admin.vessel_positions/)).toBeInTheDocument()
    expect(screen.queryByText('RowCount')).not.toBeInTheDocument()
  })
  it('reveals structured rows (not a JSON blob) on click', () => {
    render(<TraceStep step={step} />)
    fireEvent.click(screen.getAllByRole('button')[0])
    expect(screen.getByText('RowCount')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
    expect(screen.getByText(/SELECT 1/)).toBeInTheDocument()
    expect(screen.queryByText(/"RowCount": 20/)).not.toBeInTheDocument()
  })
})
