import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CognitionPlane } from './CognitionPlane'
import type { BuildStep, Turn, TurnItem } from '../lib/activity'

const step = (id: number, label: string, extra: Partial<BuildStep> = {}): BuildStep =>
  ({ id, label, status: 'done', ...extra })

const turnWith = (trace: BuildStep[], reasoning?: string): Turn => {
  const items: TurnItem[] = []
  if (reasoning) items.push({ kind: 'reasoning', id: 99, text: reasoning })
  trace.forEach(s => items.push({ kind: 'step', id: s.id, step: s }))
  return {
    id: 1, prompt: 'q',
    reasoning: reasoning ? [{ id: 99, text: reasoning }] : [],
    trace, items, answers: [], isBusy: true,
  }
}

describe('CognitionPlane (spotlight)', () => {
  it('renders nothing when there is no turn or the turn is not busy', () => {
    expect(render(<CognitionPlane turn={undefined} />).container.firstChild).toBeNull()
    expect(render(<CognitionPlane turn={{ ...turnWith([]), isBusy: false }} />).container.firstChild).toBeNull()
  })

  it('leads with the thinking star and shows one narrated current-step card', () => {
    const running = step(3, 'data_query', { status: 'running', args: { table: 'admin.vessel_positions' } })
    render(<CognitionPlane turn={turnWith([running], 'Planning the data query')} />)
    expect(screen.getByTestId('cognition-plane')).toBeInTheDocument()
    expect(screen.getByTestId('thinking-molecule')).toBeInTheDocument()
    // exactly one current-step card, narrated as a human sentence
    expect(screen.getByTestId('current-step')).toHaveTextContent('Queried admin.vessel_positions')
  })

  it('falls back to a Working placeholder when there is no reasoning yet', () => {
    render(<CognitionPlane turn={turnWith([step(3, 'skill_view', { status: 'running' })])} />)
    expect(screen.queryByTestId('thinking-molecule')).toBeNull()
    expect(screen.getByTestId('cognition-working')).toBeInTheDocument()
  })

  it('bounds completed steps to a rail: at most 5 pills plus a "+N earlier" chip — never one card per step', () => {
    const trace: BuildStep[] = []
    for (let i = 1; i <= 8; i++) trace.push(step(i, 'search_files', { result: { total_count: i } }))
    trace.push(step(9, 'data_query', { status: 'running', args: { table: 'x' } }))
    render(<CognitionPlane turn={turnWith(trace, 'thinking')} />)
    // 8 completed steps -> rail shows the last 5 as pills + "+3 earlier"
    expect(screen.getAllByTestId('rail-pill')).toHaveLength(5)
    expect(screen.getByText('+3 earlier')).toBeInTheDocument()
  })
})
