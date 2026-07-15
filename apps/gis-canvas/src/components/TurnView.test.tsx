import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TurnView } from './TurnView'
import type { Turn } from '../lib/activity'

const turn: Turn = {
  id: 1,
  prompt: 'show me the positions',
  reasoning: [{ id: 2, text: 'Exploring vessel positions' }],
  trace: [{ id: 3, label: 'data_query', status: 'done', result: { RowCount: 20 } }],
  answers: ['Displayed 20 positions.'],
  isBusy: false
}

describe('TurnView', () => {
  it('renders the prompt, the FORMULATING CANVAS with its steps, and the answer', () => {
    render(<TurnView turn={turn} />)
    expect(screen.getByText('show me the positions')).toBeInTheDocument()
    expect(screen.getByText(/FORMULATING CANVAS/)).toBeInTheDocument()
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText('Displayed 20 positions.')).toBeInTheDocument()
  })
  it('reveals reasoning via its own Thinking disclosure', () => {
    render(<TurnView turn={turn} />)
    expect(screen.queryByText('Exploring vessel positions')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /thinking/i }))
    expect(screen.getAllByText('Exploring vessel positions').length).toBeGreaterThan(0)
  })
})
