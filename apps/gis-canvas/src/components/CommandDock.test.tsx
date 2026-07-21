import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommandDock } from './CommandDock'

describe('CommandDock', () => {
  it('shows the prompt pill when idle', () => {
    render(<CommandDock latest={undefined} onOpen={() => {}} />)
    expect(screen.getByText(/ask the agent to compose the situation picture/i)).toBeInTheDocument()
    expect(screen.queryByTestId('dock-ticker')).toBeNull()
  })

  it('shows a live ticker with the humanized current step when busy', () => {
    render(
      <CommandDock
        latest={undefined}
        onOpen={() => {}}
        busy
        step={{ id: 1, label: 'data_query', status: 'running', context: 'retrieving latest 20 rows', durationS: 31.3 }}
      />
    )
    expect(screen.getByTestId('dock-ticker')).toBeInTheDocument()
    expect(screen.getByText('Data Query')).toBeInTheDocument()
    expect(screen.getByText(/retrieving latest 20 rows/)).toBeInTheDocument()
    expect(screen.getByText('31.3s')).toBeInTheDocument()
  })
})
