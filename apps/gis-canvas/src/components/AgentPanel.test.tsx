import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPanel } from './AgentPanel'
import type { BuildStep, TimelineEvent, Turn } from '../lib/activity'

const step: BuildStep = { id: 1, label: 'data_query', status: 'done', args: { sql: 'x' } }
const turns: Turn[] = [{
  id: 0,
  prompt: 'show me positions',
  reasoning: [{ id: 2, text: 'I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.' }],
  trace: [step],
  items: [
    { kind: 'reasoning', id: 2, text: 'I need to show the last 20 positions, and first, I should discover the dataset for these vessel positions.' },
    { kind: 'step', id: 1, step },
  ],
  answers: [],
  isBusy: false
}]
const timeline: TimelineEvent[] = [{ id: 2, kind: 'reasoning', text: 'my plan' }, { id: 1, kind: 'tool', step }]

function renderPanel() {
  return render(
    <AgentPanel open onClose={() => {}} turns={turns} timeline={timeline} errors={[]} connected onSend={() => {}} />
  )
}

describe('AgentPanel', () => {
  it('exposes reasoning with a derived heading via a turn thinking disclosure', () => {
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
  it('shows a pinned approval card and responds with the chosen scope', () => {
    const onRespond = vi.fn()
    render(
      <AgentPanel open onClose={() => {}} turns={turns} timeline={timeline} errors={[]} connected onSend={() => {}}
        approval={{ command: 'python - <<EOF' }} onRespond={onRespond} />
    )
    expect(screen.getByText(/Approval needed/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    expect(onRespond).toHaveBeenCalledWith('once')
  })
})
