import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TurnView } from './TurnView'
import type { Turn } from '../lib/activity'

const step = { id: 3, label: 'data_query', status: 'done' as const, result: { RowCount: 20 } }
const turn: Turn = {
  id: 1,
  prompt: 'show me the positions',
  reasoning: [{ id: 2, text: 'Exploring vessel positions before querying' }],
  trace: [step],
  items: [
    { kind: 'reasoning', id: 2, text: 'Exploring vessel positions before querying' },
    { kind: 'step', id: 3, step },
  ],
  answers: ['Displayed 20 positions.'],
  isBusy: false,
}

describe('TurnView', () => {
  it('renders the prompt, the FORMULATING CANVAS with its steps, and the answer', () => {
    render(<TurnView turn={turn} />)
    expect(screen.getByText('show me the positions')).toBeInTheDocument()
    expect(screen.getByText(/FORMULATING CANVAS/)).toBeInTheDocument()
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText('Displayed 20 positions.')).toBeInTheDocument()
  })

  it('shows a per-step Thinking row (heading visible) and reveals the body on click', () => {
    render(<TurnView turn={turn} />)
    // derived heading is always visible; full body hidden until expanded
    expect(screen.getByText('Exploring vessel positions before querying')).toBeInTheDocument()
    // body text (same string here) toggles: at least one Thinking toggle exists
    const toggle = screen.getByRole('button', { name: /thinking/i })
    expect(toggle).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.getAllByText('Exploring vessel positions before querying').length).toBeGreaterThan(0)
  })

  it('orders the reasoning row before the step it triggered', () => {
    const { container } = render(<TurnView turn={turn} />)
    const html = container.innerHTML
    expect(html.indexOf('Thinking')).toBeLessThan(html.indexOf('Data Query'))
  })
})
