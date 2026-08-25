import { resolveIdField } from './selection'
import type { Ontology } from './types'

export interface EntityRef { type: string; source: string; id: string; key: string }
export interface ResolvedEntity {
  ref: EntityRef
  title: string
  typeLabel: string
  props: Array<{ label: string; value: string }>
  provenance: { source: string }
}
export interface SourceData { schema: { name: string }[]; rows: Array<Record<string, unknown>> }

/** The entity type whose `source` is this handle, if any. */
export function typeForSource(ontology: Ontology | undefined, source: string): string | undefined {
  if (!ontology) return undefined
  for (const [type, et] of Object.entries(ontology)) if (et.source === source) return type
  return undefined
}

/** The row identified by a selection `key`, matched against the source's resolveIdField key. */
export function findRowByKey(data: SourceData, key: string): Record<string, unknown> | undefined {
  const idField = resolveIdField(data.schema, data.rows)
  return data.rows.find(r => String(r[idField]) === key)
}

/** Resolve a typed entity from a selection key. ref.id is the ontology id (for link
 * matching + display); ref.key is the selection key (resolveIdField). Returns the raw
 * row too, so the caller can resolve links from it. */
export function resolveEntity(
  ontology: Ontology, type: string, data: SourceData, key: string
): { entity: ResolvedEntity; row: Record<string, unknown> } | null {
  const et = ontology[type]
  if (!et) return null
  const row = findRowByKey(data, key)
  if (!row) return null
  const idVal = String(row[et.id] ?? key)
  const title = et.title != null ? String(row[et.title] ?? '') : ''
  const propNames = et.props ?? data.schema.map(f => f.name).filter(n => n !== et.id && n !== et.title)
  const props = propNames.map(n => ({ label: n, value: row[n] == null ? '—' : String(row[n]) }))
  return {
    entity: { ref: { type, source: et.source, id: idVal, key }, title: title || idVal, typeLabel: type, props, provenance: { source: et.source } },
    row
  }
}
