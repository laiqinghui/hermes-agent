import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { renderMarkdown } from './markdown'

function md(src: string) {
  return render(<div data-testid="md">{renderMarkdown(src)}</div>)
}

describe('renderMarkdown', () => {
  it('renders headings h1-h3', () => {
    md('# One\n## Two\n### Three')
    expect(screen.getByText('One').tagName).toBe('H1')
    expect(screen.getByText('Two').tagName).toBe('H2')
    expect(screen.getByText('Three').tagName).toBe('H3')
  })

  it('renders paragraphs, joining wrapped lines', () => {
    md('alpha\nbravo\n\ncharlie')
    expect(screen.getByText('alpha bravo').tagName).toBe('P')
    expect(screen.getByText('charlie').tagName).toBe('P')
  })

  it('renders bold, italic and inline code', () => {
    md('a **bold** b *ital* c `code` d')
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('ital').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
  })

  it('renders unordered and ordered lists', () => {
    const { container } = md('- one\n- two\n\n1. first\n2. second')
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(screen.getByText('one').tagName).toBe('LI')
  })

  it('renders a horizontal rule', () => {
    const { container } = md('a\n\n---\n\nb')
    expect(container.querySelectorAll('hr')).toHaveLength(1)
  })

  it('renders raw HTML as literal text, never as elements', () => {
    const { container } = md('<script>alert(1)</script>\n\n<b>x</b>')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.textContent).toContain('<b>x</b>')
  })

  it('leaves unmatched and space-padded emphasis markers as text', () => {
    // '2 * 3 * 4' is arithmetic, not emphasis: a naive /\*[^*\n]+\*/ turns "3" into <em>.
    const { container } = md('2 * 3 * 4 and ** unclosed')
    expect(container.querySelector('strong')).toBeNull()
    expect(container.querySelector('em')).toBeNull()
    expect(container.textContent).toContain('2 * 3 * 4')
    expect(container.textContent).toContain('** unclosed')
  })

  it('still emphasises single characters', () => {
    const { container } = md('*a* and **b**')
    expect(container.querySelector('em')?.textContent).toBe('a')
    expect(container.querySelector('strong')?.textContent).toBe('b')
  })

  it('returns nothing for empty input', () => {
    const { container } = md('')
    expect(container.querySelector('[data-testid="md"]')?.children).toHaveLength(0)
  })
})
