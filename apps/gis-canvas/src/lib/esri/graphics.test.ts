import { graphicsFromMockSource, fieldsFromSchema } from './graphics'
import { resolveMockSource } from '../mock-data'

test('builds point graphics with oid + attributes from a geo mock source', () => {
  const g = graphicsFromMockSource(resolveMockSource('mock://incidents')!)
  expect(g.length).toBeGreaterThanOrEqual(8)
  expect(g[0].geometry.type).toBe('point')
  expect(typeof g[0].geometry.x).toBe('number')
  expect(g[0].attributes.__oid).toBe(1)
  expect(g[0].attributes.severity).toBeDefined()
})

test('fieldsFromSchema includes an oid field', () => {
  const f = fieldsFromSchema(resolveMockSource('mock://incidents')!.schema)
  expect(f.find(x => x.type === 'oid')?.name).toBe('__oid')
})
