import { isDataHandle, pageError } from './data-plane'
import { resolveMockSource } from './mock-data'
import type { CanvasActions } from './handlers'
import type { SourceData } from './ontology'

/** Load a source's rows: data:// from the broker (page cap 5000), mock:// locally. */
export async function fetchSourceData(actions: Pick<CanvasActions, 'fetchData'>, source: string): Promise<SourceData> {
  if (isDataHandle(source)) {
    const p = await actions.fetchData(source, { pageSize: 5000 })
    const error = pageError(p)
    if (error) return { schema: [], rows: [], error }
    return { schema: p.schema, rows: p.rows as Array<Record<string, unknown>> }
  }
  const m = resolveMockSource(source)
  return m ? { schema: m.schema, rows: m.rows as Array<Record<string, unknown>> } : { schema: [], rows: [] }
}
