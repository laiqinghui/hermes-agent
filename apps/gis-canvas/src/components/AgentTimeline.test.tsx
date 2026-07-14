import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AgentTimeline } from './AgentTimeline'
import type { TimelineEvent } from '../lib/activity'

describe('AgentTimeline', () => {
  it('renders reasoning, tool, and message events in order', () => {
    const timeline: TimelineEvent[] = [
      { id: 1, kind: 'reasoning', text: 'thinking about it' },
      { id: 2, kind: 'tool', step: { id: 2, label: 'data_query', status: 'done', result: { rows: 1 } } },
      { id: 3, kind: 'message', role: 'agent', text: 'here you go' }
    ]
    render(<AgentTimeline timeline={timeline} />)
    expect(screen.getAllByText(/thinking about it/).length).toBeGreaterThan(0)
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText(/here you go/)).toBeInTheDocument()
  })
  it('shows an empty hint when there are no events', () => {
    render(<AgentTimeline timeline={[]} />)
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument()
  })
  it('renders an error card', () => {
    render(<AgentTimeline timeline={[{ id: 1, kind: 'error', text: 'boom' }]} />)
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })
  it('right-aligns a user-role message bubble', () => {
    const { container } = render(<AgentTimeline timeline={[{ id: 1, kind: 'message', role: 'user', text: 'hey' }]} />)
    expect(screen.getByText('hey')).toBeInTheDocument()
    expect(container.querySelector('.justify-end')).not.toBeNull()
  })
  it('shows a derived heading on a reasoning card', () => {
    const long = 'I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.'
    render(<AgentTimeline timeline={[{ id: 1, kind: 'reasoning', text: long }]} />)
    // the truncated heading (…-terminated) is distinct from the full body
    expect(screen.getByText(/^I need to show.*…$/)).toBeInTheDocument()
  })
})
