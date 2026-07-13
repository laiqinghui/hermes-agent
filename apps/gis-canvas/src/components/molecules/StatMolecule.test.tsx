import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatMolecule } from './StatMolecule'

describe('StatMolecule', () => {
  it('renders value inside a size-container with clamped/truncating value text', () => {
    render(<StatMolecule node={{ id: 's', type: 'stat', props: { label: 'Latest', value: '2025-05-05 23:59:47 UTC-ish' } } as any} renderChild={() => null} />)
    const value = screen.getByText('2025-05-05 23:59:47 UTC-ish')
    expect(value.className).toMatch(/truncate|overflow-hidden|\[font-size:/)
    // root establishes a container
    const root = value.closest('[data-molecule="stat"]')
    expect(root).not.toBeNull()
  })
})
