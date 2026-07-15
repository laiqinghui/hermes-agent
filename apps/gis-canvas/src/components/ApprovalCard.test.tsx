import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApprovalCard } from './ApprovalCard'

const approval = { command: 'python - <<EOF\nprint(1)\nEOF', description: 'Run a python script', patternKeys: ['execute_code'] }

describe('ApprovalCard', () => {
  it('shows the command and description', () => {
    render(<ApprovalCard approval={approval} onRespond={() => {}} />)
    expect(screen.getByText(/Run a python script/)).toBeInTheDocument()
    expect(screen.getByText(/print\(1\)/)).toBeInTheDocument()
  })
  it('calls onRespond with the chosen scope', () => {
    const onRespond = vi.fn()
    render(<ApprovalCard approval={approval} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }))
    fireEvent.click(screen.getByRole('button', { name: /approve for session/i }))
    fireEvent.click(screen.getByRole('button', { name: /^deny$/i }))
    expect(onRespond.mock.calls.map(c => c[0])).toEqual(['once', 'session', 'deny'])
  })
})
