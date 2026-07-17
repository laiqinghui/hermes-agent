import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CognitionPlane } from './CognitionPlane'
import type { Turn } from '../lib/activity'

const busyTurn: Turn = {
  id: 1,
  prompt: 'q',
  reasoning: [{ id: 2, text: 'Planning the data query' }],
  trace: [{ id: 3, label: 'data_query', status: 'done', result: { rows: [{ a: 1 }, { a: 2 }] } }],
  items: [
    { kind: 'reasoning', id: 2, text: 'Planning the data query' },
    { kind: 'step', id: 3, step: { id: 3, label: 'data_query', status: 'done', result: { rows: [{ a: 1 }, { a: 2 }] } } },
  ],
  answers: [],
  isBusy: true,
}

describe('CognitionPlane', () => {
  it('renders nothing when there is no turn', () => {
    const { container } = render(<CognitionPlane turn={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when the turn is not busy', () => {
    const { container } = render(<CognitionPlane turn={{ ...busyTurn, isBusy: false }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the thinking molecule and a step molecule when busy', () => {
    render(<CognitionPlane turn={busyTurn} />)
    expect(screen.getByTestId('cognition-plane')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-molecule')).toBeInTheDocument()
    // step molecule shows the humanized title + row summary
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText('2 rows')).toBeInTheDocument()
  })
})
