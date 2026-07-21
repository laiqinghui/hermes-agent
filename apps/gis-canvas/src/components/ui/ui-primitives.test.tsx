import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Button } from './button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs'

describe('ui primitives', () => {
  it('Button uses the gc- brand utilities (bg-accent / text-accent-fg)', () => {
    render(<Button>Go</Button>)
    const btn = screen.getByRole('button', { name: 'Go' })
    expect(btn.className).toContain('bg-accent')
    expect(btn.className).toContain('text-accent-fg')
  })

  it('Tabs shows the default panel and switches on trigger click', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">panel-a</TabsContent>
        <TabsContent value="b">panel-b</TabsContent>
      </Tabs>
    )
    expect(screen.getByText('panel-a')).toBeInTheDocument()
    expect(screen.queryByText('panel-b')).toBeNull()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'B' }))
    expect(screen.getByText('panel-b')).toBeInTheDocument()
  })
})
