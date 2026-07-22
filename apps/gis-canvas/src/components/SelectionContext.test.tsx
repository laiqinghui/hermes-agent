import { describe, it, expect, vi, test } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SelectionProvider, useLinkedSelection, useSelectionActions, useSelectionState } from './SelectionContext'

function Consumer({ source, label }: { source: string; label: string }) {
  const [sel, setSel] = useLinkedSelection(source)
  return (
    <div>
      <span data-testid={`${label}-sel`}>{sel.join(',')}</span>
      <button onClick={() => setSel(['a'])}>{label}-set</button>
    </div>
  )
}

describe('SelectionContext', () => {
  it('shares selection between consumers of the same source and mirrors to bound nodes', () => {
    const onMirror = vi.fn()
    render(
      <SelectionProvider nodesBySource={{ s: ['n1', 'n2'] }} onMirror={onMirror}>
        <Consumer source="s" label="x" />
        <Consumer source="s" label="y" />
        <Consumer source="other" label="z" />
      </SelectionProvider>
    )
    fireEvent.click(screen.getByText('x-set'))
    expect(screen.getByTestId('x-sel')).toHaveTextContent('a')
    expect(screen.getByTestId('y-sel')).toHaveTextContent('a') // linked (same source)
    expect(screen.getByTestId('z-sel')).toHaveTextContent('')  // independent (different source)
    expect(onMirror).toHaveBeenCalledWith('n1', ['a'])
    expect(onMirror).toHaveBeenCalledWith('n2', ['a'])
  })
  it('no-ops safely without a provider', () => {
    render(<Consumer source="s" label="x" />)
    fireEvent.click(screen.getByText('x-set')) // must not throw
    expect(screen.getByTestId('x-sel')).toHaveTextContent('')
  })
})

function MultiProbe() {
  const actions = useSelectionActions()
  const state = useSelectionState()
  return (
    <div>
      <button onClick={() => { actions.set('data://a', ['1']); actions.set('data://b', ['2', '3']) }}>set-two</button>
      <span data-testid="sig">{Object.entries(state).map(([k, v]) => `${k}:${v.join(',')}`).join('|')}</span>
    </div>
  )
}

test('useSelectionActions writes multiple sources; useSelectionState reflects them', () => {
  render(
    <SelectionProvider nodesBySource={{}} onMirror={() => {}}>
      <MultiProbe />
    </SelectionProvider>
  )
  fireEvent.click(screen.getByText('set-two'))
  expect(screen.getByTestId('sig').textContent).toBe('data://a:1|data://b:2,3')
})
