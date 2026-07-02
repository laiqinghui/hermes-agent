import { resolveMockSource } from './mock-data'

test('resolves mock://incidents with schema and rows', () => {
  const src = resolveMockSource('mock://incidents')
  expect(src).not.toBeNull()
  expect(src!.schema.map(f => f.name)).toEqual(['id', 'severity', 'district', 'reported_at'])
  expect(src!.rows.length).toBeGreaterThanOrEqual(8)
})

test('unknown handle returns null', () => {
  expect(resolveMockSource('mock://nope')).toBeNull()
  expect(resolveMockSource('data://q1')).toBeNull()
})
