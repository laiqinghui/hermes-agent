import type { BuildStep } from './activity'
import { humanizeLabel } from './humanize'
import { summarizeValue } from './summarize-value'

/** Cognition-molecule shape, detected from a step's result DATA shape — never
 * from the tool name. New tools whose results are rows/geo-rows/scalars get the
 * right molecule automatically; novel/other values become a compact 'stat' —
 * only an absent result (null/undefined) falls back to 'text'. */
export type CognitionShape = 'error' | 'geo-rows' | 'rows' | 'stat' | 'text'

export interface StepMolecule {
  shape: CognitionShape
  title: string
  summary: string
  rowCount?: number
}

// Same alias sets as detectGeoFields (kept local: this reads arbitrary row
// objects, not a typed schema).
const LAT = new Set(['lat', 'latitude', 'latitudedegrees', 'lat_dd', 'y'])
const LNG = new Set(['lng', 'lon', 'long', 'longitude', 'longitudedegrees', 'lon_dd', 'x'])

const isRowObject = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x)

/** Find a rows array either as the result itself or under a common key. */
function findRows(result: unknown): Record<string, unknown>[] | undefined {
  if (Array.isArray(result) && result.length > 0 && result.every(isRowObject)) {
    return result as Record<string, unknown>[]
  }
  if (isRowObject(result)) {
    for (const key of ['rows', 'sample', 'data', 'records']) {
      const v = result[key]
      if (Array.isArray(v) && v.length > 0 && v.every(isRowObject)) {
        return v as Record<string, unknown>[]
      }
    }
  }
  return undefined
}

function hasGeo(rows: Record<string, unknown>[]): boolean {
  const keys = Object.keys(rows[0] ?? {}).map(k => k.toLowerCase())
  return keys.some(k => LAT.has(k)) && keys.some(k => LNG.has(k))
}

export function describeStep(step: BuildStep): StepMolecule {
  const title = humanizeLabel(step.label)
  const result = step.result

  if (isRowObject(result) && result.error != null) {
    return { shape: 'error', title, summary: summarizeValue(result.error) }
  }

  const rows = findRows(result)
  if (rows) {
    const n = rows.length
    return {
      shape: hasGeo(rows) ? 'geo-rows' : 'rows',
      title,
      summary: `${n} row${n === 1 ? '' : 's'}`,
      rowCount: n,
    }
  }

  if (result === null || result === undefined) {
    return { shape: 'text', title, summary: step.summary ?? '—' }
  }
  // Any other value (scalar or a non-row object) → a compact stat.
  return { shape: 'stat', title, summary: summarizeValue(result) }
}
