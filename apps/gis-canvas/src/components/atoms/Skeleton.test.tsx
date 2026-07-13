import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Skeleton } from './Skeleton'

describe('Skeleton', () => {
  it('renders a single shimmer block by default', () => {
    render(<Skeleton />)
    const el = screen.getByTestId('skeleton')
    expect(el).toHaveClass('gc-skeleton')
  })

  it('renders N line rows when rows is given', () => {
    render(<Skeleton rows={4} />)
    const container = screen.getByTestId('skeleton')
    expect(container.querySelectorAll('.gc-skeleton')).toHaveLength(4)
  })
})
