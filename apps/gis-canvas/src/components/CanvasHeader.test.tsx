import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CanvasHeader } from './CanvasHeader'

describe('CanvasHeader', () => {
  it('shows the session title as the heading', () => {
    render(<CanvasHeader rev={4} isBusy={false} title="AIS Gap Analysis" />)
    expect(screen.getByText('AIS Gap Analysis')).toBeInTheDocument()
    expect(screen.getByText(/Situation Canvas · rev 4/)).toBeInTheDocument()
  })

  it('falls back to New session when the title is unknown', () => {
    render(<CanvasHeader rev={undefined} isBusy={false} title={undefined} />)
    expect(screen.getByText('New session')).toBeInTheDocument()
    expect(screen.getByText(/awaiting first render/)).toBeInTheDocument()
  })

  it('still reports the composing state', () => {
    render(<CanvasHeader rev={1} isBusy title="X" />)
    expect(screen.getByText('COMPOSING…')).toBeInTheDocument()
  })
})
