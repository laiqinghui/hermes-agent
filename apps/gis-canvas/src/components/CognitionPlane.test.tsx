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

  it('leads with the thinking star (reasoning) and shows one compact current-step card', () => {
    const running = step(3, 'data_query', { status: 'running', args: { table: 'admin.vessel_positions' } })
    render(<CognitionPlane turn={turnWith([running], 'Planning the data query')} />)
    expect(screen.getByTestId('cognition-plane')).toBeInTheDocument()
    // reasoning present -> the star renders (not the placeholder); its text types async,
    // so we assert the branch, not the typed content (ThinkingMolecule has its own typing tests)
    expect(screen.getByTestId('thinking-molecule')).toBeInTheDocument()
    expect(screen.queryByTestId('cognition-working')).toBeNull()
    // exactly one current-step card, compact: humanized tool label (the detail lives in the star)
    expect(screen.getByTestId('current-step')).toHaveTextContent('Data Query')
  })

  it('falls the thinking star back to the current step context when there is no reasoning', () => {
    const running = step(3, 'data_query', {
      status: 'running',
      context: 'Retrieve the latest 20 AIS vessel position rows for vessel name GREY LADY',
    })
    render(<CognitionPlane turn={turnWith([running])} />)
    // no reasoning, but a context is present -> the star renders it, not the placeholder
    expect(screen.queryByTestId('cognition-working')).toBeNull()
    expect(screen.getByTestId('thinking-molecule')).toBeInTheDocument()
  })

  it('falls back to the Composing placeholder only when there is neither reasoning nor context', () => {
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
