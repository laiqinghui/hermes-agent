import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('resolves the @/ alias and merges conflicting tailwind classes (last wins)', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
  it('drops falsy values and keeps non-conflicting classes', () => {
    expect(cn('text-primary', false && 'hidden', 'font-mono')).toBe('text-primary font-mono')
  })
})
