import { categoryColorVar } from './category-color'

test('is deterministic for the same input', () => {
  expect(categoryColorVar('anything')).toBe(categoryColorVar('anything'))
})

test('returns a var(--color-cat-N) reference', () => {
  expect(categoryColorVar('friendly')).toMatch(/^var\(--color-cat-[1-6]\)$/)
})

test('does not throw on undefined or empty input', () => {
  expect(() => categoryColorVar(undefined)).not.toThrow()
  expect(() => categoryColorVar(null)).not.toThrow()
  expect(() => categoryColorVar('')).not.toThrow()
  expect(categoryColorVar('')).toMatch(/^var\(--color-cat-[1-6]\)$/)
})

test('different values usually map to different slots', () => {
  const slots = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(categoryColorVar))
  expect(slots.size).toBeGreaterThan(1)
})
