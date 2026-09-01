import { resolveIdField } from './selection'
import type { Ontology, EntityType } from './types'

export interface EntityRef { type: string; source: string; id: string; key: string }
export interface ResolvedEntity {
  ref: EntityRef
  title: string
  typeLabel: string
  props: Array<{ label: string; value: string }>
  provenance: { source: string }
}
export interface SourceData {
  schema: { name: string }[]
  rows: Array<Record<string, unknown>>
  /** Set when the data plane refused the handle (e.g. expired), so a consumer can say
   *  why the entity is missing rather than claiming no match was found. */
  error?: string
}

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

export interface RelatedEntity { ref: EntityRef; title: string }
export interface LinkGroup { name: string; to: string; entities: RelatedEntity[] }

function makeRelated(type: string, et: EntityType, row: Record<string, unknown>, idField: string): RelatedEntity {
  const idVal = String(row[et.id] ?? '')
  const title = et.title != null ? String(row[et.title] ?? '') : ''
  return { ref: { type, source: et.source, id: idVal, key: String(row[idField] ?? '') }, title: title || idVal }
}

/** Resolve a focal row's declared links to related entities. `sources` holds the
 * already-fetched data for every source a link may reach. */
export function resolveLinks(
  ontology: Ontology,
  focalType: string,
  focalRow: Record<string, unknown>,
  sources: Record<string, SourceData>
): LinkGroup[] {
  const et = ontology[focalType]
  if (!et?.links) return []
  const focalId = String(focalRow[et.id] ?? '')
  const groups: LinkGroup[] = []
  for (const [name, link] of Object.entries(et.links)) {
    const targetType = ontology[link.to]
    if (!targetType) continue
    const tdata = sources[targetType.source]
    if (!tdata) continue // target source not loaded → omit
    const tIdField = resolveIdField(tdata.schema, tdata.rows)
    const entities: RelatedEntity[] = []
    if (link.reverse) {
      for (const r of tdata.rows) {
        if (String(r[link.field] ?? '') === focalId) entities.push(makeRelated(link.to, targetType, r, tIdField))
      }
    } else {
      const targetVal = String(focalRow[link.field] ?? '')
      if (targetVal) {
        const r = tdata.rows.find(x => String(x[targetType.id] ?? '') === targetVal)
        if (r) entities.push(makeRelated(link.to, targetType, r, tIdField))
      }
    }
    if (entities.length) groups.push({ name, to: link.to, entities })
  }
  return groups
}
