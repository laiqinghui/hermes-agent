import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPanel } from './AgentPanel'
import type { BuildStep, TimelineEvent, ReasoningItem } from '../lib/activity'

const trace: BuildStep[] = [{ id: 1, label: 'data_query', status: 'done', args: { sql: 'x' } }]
const reasoning: ReasoningItem[] = [{ id: 2, text: 'I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.' }]
const timeline: TimelineEvent[] = [{ id: 2, kind: 'reasoning', text: 'my plan' }, { id: 1, kind: 'tool', step: trace[0] }]

function renderPanel() {
  return render(
    <AgentPanel open onClose={() => {}} messages={[]} trace={trace} reasoning={reasoning} timeline={timeline} errors={[]} connected onSend={() => {}} />
  )
}

describe('AgentPanel', () => {
  it('exposes reasoning with a derived heading via the thinking disclosure', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /thinking/i }))
    expect(screen.getByText(/^I need to show.*…$/)).toBeInTheDocument()
  })
  it('toggles to the inspector timeline', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /inspector/i }))
    // timeline renders the tool step name
    expect(screen.getAllByText('Data Query').length).toBeGreaterThan(0)
  })
})
