import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HandlerProvider } from '../HandlerContext'
import { TabsMolecule } from './TabsMolecule'
import { COMPONENT_REGISTRY } from '../registry'
import type { CanvasActions } from '../../lib/handlers'
import type { ComponentNode } from '../../lib/types'

function actionsMock(over: Partial<CanvasActions> = {}): CanvasActions {
  return { setLocalState() {}, reportInteraction: vi.fn(), sendPrompt() {}, fetchData: vi.fn(), ...over }
}

const node: ComponentNode = {
  id: 'insp',
  type: 'tabs',
  props: { tabs: [{ id: 'overview', label: 'Overview' }, { id: 'props', label: 'Properties' }] },
  slots: {
    overview: [{ id: 'a', type: 'stat', props: { label: 'X', value: 1 } }],
    props: [{ id: 'b', type: 'stat', props: { label: 'Y', value: 2 } }]
  }
}

const renderChild = (n: ComponentNode) => <div key={n.id} data-testid={`child-${n.id}`}>{n.id}</div>

describe('TabsMolecule', () => {
  it('is registered under type "tabs"', () => {
    expect(COMPONENT_REGISTRY.tabs).toBe(TabsMolecule)
  })

  it('renders a trigger per tab and shows the first tab panel by default', () => {
    render(
      <HandlerProvider actions={actionsMock()}>
        <TabsMolecule node={node} renderChild={renderChild} />
      </HandlerProvider>
    )
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Properties' })).toBeInTheDocument()
    expect(screen.getByTestId('child-a')).toBeInTheDocument()
    expect(screen.queryByTestId('child-b')).toBeNull()
  })

  it('switches panels and reports the active tab on change', () => {
    const reportInteraction = vi.fn()
    render(
      <HandlerProvider actions={actionsMock({ reportInteraction })}>
        <TabsMolecule node={node} renderChild={renderChild} />
      </HandlerProvider>
    )
    // NOTE: @radix-ui/react-tabs activates a tab on mousedown/focus, not click.
    // Using fireEvent.click here would not switch the panel (verified in Task 2).
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Properties' }))
    expect(screen.getByTestId('child-b')).toBeInTheDocument()
    expect(reportInteraction).toHaveBeenCalledWith('insp', { active: 'props' })
  })

  it('renders a graceful placeholder when no tabs are defined', () => {
    render(
      <HandlerProvider actions={actionsMock()}>
        <TabsMolecule node={{ id: 'empty', type: 'tabs', props: { tabs: [] } }} renderChild={() => null} />
      </HandlerProvider>
    )
    expect(screen.getByText(/no tabs/i)).toBeInTheDocument()
  })

  it('renders the placeholder when props.tabs is not an array', () => {
    render(
      <HandlerProvider actions={actionsMock()}>
        <TabsMolecule node={{ id: 'bad', type: 'tabs', props: { tabs: 5 as unknown as [] } }} renderChild={() => null} />
      </HandlerProvider>
    )
    expect(screen.getByText(/no tabs/i)).toBeInTheDocument()
  })
})
