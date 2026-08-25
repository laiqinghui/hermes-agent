import { typeForSource, findRowByKey, resolveEntity, type SourceData } from './ontology'
import type { Ontology } from './types'

const ONT: Ontology = {
  vessel: { source: 'mock://vessels', id: 'mmsi', title: 'vessel_name', props: ['flag', 'status'],
            links: { operator: { to: 'operator', field: 'operator_id' } } },
  operator: { source: 'mock://operators', id: 'op_id', title: 'name', props: ['country'],
              links: { vessels: { to: 'vessel', field: 'operator_id', reverse: true } } }
}

// vessel_name is distinct here, so resolveIdField picks it as the selection key — NOT mmsi.
const VESSELS: SourceData = {
  schema: [{ name: 'vessel_name' }, { name: 'mmsi' }, { name: 'flag' }, { name: 'status' }, { name: 'operator_id' }],
  rows: [
    { vessel_name: 'WONDER VEGA', mmsi: '563123000', flag: 'SG', status: 'under way', operator_id: 'OP1' },
    { vessel_name: 'ORION PEARL', mmsi: '440111222', flag: 'KR', status: 'moored', operator_id: 'OP2' }
  ]
}

describe('typeForSource', () => {
  test('maps a source handle to its declared entity type', () => {
    expect(typeForSource(ONT, 'mock://operators')).toBe('operator')
    expect(typeForSource(ONT, 'mock://unknown')).toBeUndefined()
    expect(typeForSource(undefined, 'mock://vessels')).toBeUndefined()
  })
})

describe('findRowByKey', () => {
  test('finds the row by the resolveIdField key (vessel_name here, not mmsi)', () => {
    const r = findRowByKey(VESSELS, 'ORION PEARL')
    expect(r?.mmsi).toBe('440111222')
  })
})

describe('resolveEntity', () => {
  test('bridges a selection key to a typed entity (ref.id = ontology id, ref.key = selection key)', () => {
    const res = resolveEntity(ONT, 'vessel', VESSELS, 'WONDER VEGA')!
    expect(res.entity.ref).toEqual({ type: 'vessel', source: 'mock://vessels', id: '563123000', key: 'WONDER VEGA' })
    expect(res.entity.title).toBe('WONDER VEGA')
    expect(res.entity.typeLabel).toBe('vessel')
    expect(res.entity.provenance).toEqual({ source: 'mock://vessels' })
    expect(res.entity.props).toEqual([{ label: 'flag', value: 'SG' }, { label: 'status', value: 'under way' }])
    expect(res.row.mmsi).toBe('563123000')
  })

  test('defaults props to all non-id/title columns when props omitted', () => {
    const ont2: Ontology = { vessel: { source: 'mock://vessels', id: 'mmsi', title: 'vessel_name' } }
    const res = resolveEntity(ont2, 'vessel', VESSELS, 'WONDER VEGA')!
    expect(res.entity.props.map(p => p.label)).toEqual(['flag', 'status', 'operator_id'])
  })

  test('renders a missing value as an em dash', () => {
    const data: SourceData = { schema: [{ name: 'mmsi' }, { name: 'flag' }], rows: [{ mmsi: 'X' }] }
    const ont2: Ontology = { vessel: { source: 'mock://vessels', id: 'mmsi', props: ['flag'] } }
    expect(resolveEntity(ont2, 'vessel', data, 'X')!.entity.props).toEqual([{ label: 'flag', value: '—' }])
  })

  test('returns null when the key matches no row or the type is unknown', () => {
    expect(resolveEntity(ONT, 'vessel', VESSELS, 'NOPE')).toBeNull()
    expect(resolveEntity(ONT, 'ghost', VESSELS, 'WONDER VEGA')).toBeNull()
  })
})

import { resolveLinks } from './ontology'

const OPERATORS: SourceData = {
  schema: [{ name: 'op_id' }, { name: 'name' }, { name: 'country' }],
  rows: [{ op_id: 'OP1', name: 'ACME MARINE', country: 'SG' }, { op_id: 'OP2', name: 'BOREAS LINES', country: 'KR' }]
}
const SOURCES = { 'mock://vessels': VESSELS, 'mock://operators': OPERATORS }

describe('resolveLinks', () => {
  test('forward link resolves the single target entity with its title + selection key', () => {
    const focal = VESSELS.rows[0] // WONDER VEGA, operator_id OP1
    const groups = resolveLinks(ONT, 'vessel', focal, SOURCES)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'operator', to: 'operator' })
    expect(groups[0].entities).toHaveLength(1)
    expect(groups[0].entities[0].title).toBe('ACME MARINE')
    // operator source: op_id is the only distinct column -> resolveIdField picks op_id -> key 'OP1'
    expect(groups[0].entities[0].ref).toEqual({ type: 'operator', source: 'mock://operators', id: 'OP1', key: 'OP1' })
  })

  test('reverse link scans the other source for rows pointing back', () => {
    const focal = OPERATORS.rows[0] // OP1 -> owns WONDER VEGA (operator_id OP1)
    const groups = resolveLinks(ONT, 'operator', focal, SOURCES)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'vessels', to: 'vessel' })
    expect(groups[0].entities.map(e => e.title)).toEqual(['WONDER VEGA'])
    // vessels source: vessel_name distinct -> selection key is the name
    expect(groups[0].entities[0].ref.key).toBe('WONDER VEGA')
    expect(groups[0].entities[0].ref.id).toBe('563123000')
  })

  test('omits a link whose target source is not loaded', () => {
    const focal = VESSELS.rows[0]
    expect(resolveLinks(ONT, 'vessel', focal, { 'mock://vessels': VESSELS })).toEqual([])
  })

  test('omits a forward link that resolves to no target row', () => {
    const focal = { vessel_name: 'GHOST', mmsi: 'Z', operator_id: 'NOPE' }
    expect(resolveLinks(ONT, 'vessel', focal, SOURCES)).toEqual([])
  })
})
