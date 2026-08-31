import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoteMolecule } from './NoteMolecule'
import { COMPONENT_REGISTRY } from '../registry'

const noop = () => null

describe('NoteMolecule', () => {
  it('renders the title and the markdown body', () => {
    render(<NoteMolecule node={{ id: 'n1', type: 'note',
      props: { title: 'Key judgments', body: '## AGNI\n**148-day** silence' } } as any} renderChild={noop} />)
    expect(screen.getByText('Key judgments')).toBeInTheDocument()
    expect(screen.getByText('AGNI').tagName).toBe('H2')
    expect(screen.getByText('148-day').tagName).toBe('STRONG')
  })

  it('renders without a title', () => {
    render(<NoteMolecule node={{ id: 'n2', type: 'note', props: { body: 'plain' } } as any} renderChild={noop} />)
    expect(screen.getByText('plain')).toBeInTheDocument()
  })

  it('does not crash when body is missing', () => {
    render(<NoteMolecule node={{ id: 'n3', type: 'note', props: { title: 'Empty' } } as any} renderChild={noop} />)
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('is registered as the "note" component type', () => {
    expect(COMPONENT_REGISTRY['note']).toBe(NoteMolecule)
  })
})
