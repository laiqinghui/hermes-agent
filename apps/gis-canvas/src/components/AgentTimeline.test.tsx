import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentTimeline } from './AgentTimeline'
import type { TimelineEvent } from '../lib/activity'

describe('AgentTimeline', () => {
  it('renders reasoning, tool, and message events in order', () => {
    const timeline: TimelineEvent[] = [
      { id: 1, kind: 'reasoning', text: 'thinking about it' },
      { id: 2, kind: 'tool', step: { id: 2, label: 'query', status: 'done', result: { rows: 1 } } },
      { id: 3, kind: 'message', role: 'agent', text: 'here you go' }
    ]
    render(<AgentTimeline timeline={timeline} />)
    expect(screen.getByText(/thinking about it/)).toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText(/here you go/)).toBeInTheDocument()
  })
  it('shows an empty hint when there are no events', () => {
    render(<AgentTimeline timeline={[]} />)
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
  })
})
