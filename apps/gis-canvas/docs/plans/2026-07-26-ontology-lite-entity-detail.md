# Ontology-Lite + Entity-Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer an agent-declared "ontology-lite" (typed entities + relationships) over the flat tabular data plane, and add a selection-driven `entity-detail` object-profile molecule that drills through relationships.

**Architecture:** The agent declares a top-level `ontology` block (types → `{source,id,title,props,links}`). A pure `lib/ontology.ts` promotes rows→entities and resolves forward/reverse links, bridging selection keys (`resolveIdField`) to ontology ids. An `OntologyContext` feeds the doc's ontology to the new `entity-detail` molecule, which is driven by the existing SelectionContext and pivots in-place (a link click re-focuses the panel and writes the shared selection). Zero backend/data-plane change.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), the existing data plane (`fetchData` by handle / `resolveMockSource`), SelectionContext, Python 3 + pytest + jsonschema (canvas validator/catalog).

## Global Constraints

- **Zero backend/data-plane change.** The ontology is agent-declared and resolved client-side over the existing plane: data:// via `actions.fetchData(handle, { pageSize: 5000 })`, mock:// via `resolveMockSource`.
- **Selection stays `resolveIdField`-keyed.** Never assume the ontology `id` equals the selection key. `entity-detail` bridges them: find the focal row by matching the selection key against the source's `resolveIdField` key; use ontology `id` only for link matching + display.
- **Every entity reference carries `{ type, source, id, key }`** — `id` = ontology id (link matching/display), `key` = `resolveIdField` selection key (row lookup + selection highlight).
- **Never a silent blank (SP2 lesson):** no selection, non-ontology source, and no-matching-row are explicit on-panel diagnostics, not empty renders.
- **Reverse links scan the loaded page only** (≤5000 rows) — same bound as the geofence.
- **Provenance = the source handle** this round. The originating query prompt lives in broker `meta` server-side and surfacing it needs a data-plane change — deferred (noted in Task 3 + self-review).
- **Registry sync:** `entity-detail` (new molecule type) → schema `type` enum, `MOLECULE_TYPES` (+ `types.test.ts`), validator `CATALOG` + `STATE_KEYS`, `registry.tsx`, `_CATALOG_HELP`. Top-level `ontology` → JSON schema (root property + `$defs`), `types.ts` `CanvasDoc`, validator pass (each entry needs `source`+`id`; every `links[].to` must name a declared type).
- **Worked-examples-first** agent guidance; field names must be **actual columns** from the source schema (SP2 lesson) — never invent names.
- **TDD, DRY, YAGNI, frequent commits.**

**Commands (repo root `c:\workspace\analyst\hermes-agent`):**
- FE single file: `cd apps/gis-canvas && npx vitest run src/lib/ontology.test.ts`
- FE full suite: `cd apps/gis-canvas && npm test`
- FE typecheck: `cd apps/gis-canvas && npm run typecheck`
- FE prod build: `cd apps/gis-canvas && npm run build`
- Python plugin tests: `python -m pytest tests/plugins/gis_canvas/ -q`

---

## File Structure

**New files**
- `apps/gis-canvas/src/lib/ontology.ts` — pure: entity/link resolution over rows (no React, no ESRI).
- `apps/gis-canvas/src/lib/ontology.test.ts` — unit tests.
- `apps/gis-canvas/src/lib/source-fetch.ts` — `fetchSourceData(actions, source)` (data:// or mock:// → `{schema, rows}`).
- `apps/gis-canvas/src/components/OntologyContext.tsx` — provider + `useOntology()`.
- `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.tsx` — the molecule.
- `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.test.tsx` — tests.

**Modified files**
- `apps/gis-canvas/src/lib/types.ts` — `Ontology`/`EntityType`/`LinkDef` types; `CanvasDoc.ontology?`; `MOLECULE_TYPES += 'entity-detail'`.
- `apps/gis-canvas/src/lib/types.test.ts` — `MOLECULE_TYPES` assertion.
- `apps/gis-canvas/src/components/registry.tsx` — register `entity-detail`.
- `apps/gis-canvas/src/App.tsx` — mount `OntologyProvider` with `mergedDoc.ontology`.
- `apps/gis-canvas/src/lib/mock-data.ts` — `mock://vessels` + `mock://operators`.
- `plugins/gis-canvas/schema/canvas.schema.json` — `type` enum += `entity-detail`; root `ontology` property + `$defs`.
- `plugins/gis-canvas/validator.py` — `CATALOG` + `STATE_KEYS` for `entity-detail`; ontology validation pass.
- `plugins/gis-canvas/tools_canvas.py` — `_CATALOG_HELP` + `render_view` example.
- `tests/plugins/gis_canvas/test_validator.py` — `entity-detail` + `ontology` tests.
- `tests/plugins/gis_canvas/test_tools.py` — guidance test.

---

### Task 1: Ontology types + focal-entity resolution (pure)

**Files:**
- Modify: `apps/gis-canvas/src/lib/types.ts`
- Create: `apps/gis-canvas/src/lib/ontology.ts`
- Test: `apps/gis-canvas/src/lib/ontology.test.ts`

**Interfaces:**
- Consumes: `resolveIdField(schema, rows)` from `./selection` (existing).
- Produces (in `types.ts`): `interface LinkDef { to: string; field: string; reverse?: boolean }`, `interface EntityType { source: string; id: string; title?: string; props?: string[]; links?: Record<string, LinkDef> }`, `type Ontology = Record<string, EntityType>`, and `CanvasDoc.ontology?: Ontology`.
- Produces (in `ontology.ts`): `interface EntityRef { type: string; source: string; id: string; key: string }`, `interface ResolvedEntity { ref: EntityRef; title: string; typeLabel: string; props: Array<{ label: string; value: string }>; provenance: { source: string } }`, `interface SourceData { schema: { name: string }[]; rows: Array<Record<string, unknown>> }`, `typeForSource(ontology, source): string | undefined`, `findRowByKey(data, key): Record<string, unknown> | undefined`, `resolveEntity(ontology, type, data, key): { entity: ResolvedEntity; row: Record<string, unknown> } | null`.

- [ ] **Step 1: Add the ontology types to `types.ts`**

In `apps/gis-canvas/src/lib/types.ts`, add `'entity-detail'` to `MOLECULE_TYPES` (before `'esri:feature-table'`):

```ts
export const MOLECULE_TYPES = ['card', 'stat', 'data-table', 'select', 'tabs', 'esri:map', 'esri:legend', 'esri:layer-list', 'esri:time-slider', 'entity-detail', 'esri:feature-table'] as const
```

Add these interfaces (near the other exported interfaces, e.g. after `Handler`):

```ts
export interface LinkDef { to: string; field: string; reverse?: boolean }
export interface EntityType { source: string; id: string; title?: string; props?: string[]; links?: Record<string, LinkDef> }
export type Ontology = Record<string, EntityType>
```

And add `ontology` to `CanvasDoc`:

```ts
export interface CanvasDoc {
  canvasVersion: 1
  rev: number
  layout: GridLayout
  components: ComponentNode[]
  overlays?: ComponentNode[]
  focus?: string
  ontology?: Ontology
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/gis-canvas/src/lib/ontology.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/ontology.test.ts`
Expected: FAIL — cannot find module `./ontology`.

- [ ] **Step 4: Write the implementation**

Create `apps/gis-canvas/src/lib/ontology.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/ontology.test.ts`
Expected: PASS. Then `npm run typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add apps/gis-canvas/src/lib/types.ts apps/gis-canvas/src/lib/ontology.ts apps/gis-canvas/src/lib/ontology.test.ts
git commit -m "feat(gis-canvas): ontology types + focal-entity resolution (selection-key bridge)"
```

---

### Task 2: Link resolution — forward + reverse (pure)

**Files:**
- Modify: `apps/gis-canvas/src/lib/ontology.ts`
- Test: `apps/gis-canvas/src/lib/ontology.test.ts`

**Interfaces:**
- Consumes: `EntityRef`, `SourceData`, `resolveIdField` (Task 1); `Ontology`, `EntityType` from `./types`.
- Produces: `interface RelatedEntity { ref: EntityRef; title: string }`, `interface LinkGroup { name: string; to: string; entities: RelatedEntity[] }`, `resolveLinks(ontology, focalType, focalRow, sources): LinkGroup[]` where `sources: Record<string, SourceData>` maps a source handle → its already-fetched data. Forward link: the one target row whose ontology `id` equals `focalRow[link.field]`. Reverse link: every target row whose `link.field` equals the focal entity's ontology id. Each `RelatedEntity.ref.key` is the target row's `resolveIdField` key (for selection highlight). A link whose target type is undeclared, target source not in `sources`, or which resolves to nothing produces no group.

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/lib/ontology.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/lib/ontology.test.ts`
Expected: FAIL — `resolveLinks` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `apps/gis-canvas/src/lib/ontology.ts` (add `EntityType` to the existing `./types` import):

```ts
import type { EntityType } from './types'

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/gis-canvas && npx vitest run src/lib/ontology.test.ts`
Expected: PASS (all Task 1 + Task 2 tests). Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/ontology.ts apps/gis-canvas/src/lib/ontology.test.ts
git commit -m "feat(gis-canvas): forward + reverse link resolution over the ontology"
```

---

### Task 3: OntologyContext + entity-detail molecule CORE (header/props/provenance) + registry sync

**Files:**
- Create: `apps/gis-canvas/src/lib/source-fetch.ts`
- Create: `apps/gis-canvas/src/components/OntologyContext.tsx`
- Create: `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.tsx`
- Create: `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.test.tsx`
- Modify: `apps/gis-canvas/src/components/registry.tsx`
- Modify: `apps/gis-canvas/src/App.tsx`
- Modify: `apps/gis-canvas/src/lib/types.test.ts`
- Modify: `plugins/gis-canvas/schema/canvas.schema.json`
- Modify: `plugins/gis-canvas/validator.py`
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: `resolveEntity`, `typeForSource`, `type SourceData` (Tasks 1-2); `useSelectionState` (existing); `useCanvasActions` (existing); `type Ontology` (`./types`).
- Produces: `OntologyProvider` + `useOntology(): Ontology | undefined`; `fetchSourceData(actions, source): Promise<SourceData>`; the `entity-detail` molecule rendering header/props/provenance from the current selection; `entity-detail` valid as a molecule type end-to-end.

- [ ] **Step 1: Write the failing tests**

Front-end — create `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.test.tsx`:

```ts
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { ComponentNode } from '../../lib/types'
import { HandlerProvider } from '../HandlerContext'
import { SelectionProvider, useSelectionActions } from '../SelectionContext'
import { OntologyProvider } from '../OntologyContext'
import type { CanvasActions } from '../../lib/handlers'
import { EntityDetailMolecule } from './EntityDetailMolecule'

const ONT = {
  vessel: { source: 'data://vessels', id: 'mmsi', title: 'vessel_name', props: ['flag', 'status'],
            links: { operator: { to: 'operator', field: 'operator_id' } } },
  operator: { source: 'data://operators', id: 'op_id', title: 'name', props: ['country'] }
}
const vesselsPage = {
  ok: true, total: 1, page: 0, pageSize: 5000,
  schema: [{ name: 'vessel_name', type: 'string' }, { name: 'mmsi', type: 'string' }, { name: 'flag', type: 'string' }, { name: 'status', type: 'string' }, { name: 'operator_id', type: 'string' }],
  rows: [{ vessel_name: 'WONDER VEGA', mmsi: '563123000', flag: 'SG', status: 'under way', operator_id: 'OP1' }]
}
const node: ComponentNode = { id: 'ed', type: 'entity-detail' }

function SelectVessel() {
  const a = useSelectionActions()
  return <button onClick={() => a.set('data://vessels', ['WONDER VEGA'])}>sel</button>
}

test('shows a placeholder when nothing is selected', () => {
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData: vi.fn() }
  render(
    <OntologyProvider ontology={ONT}>
      <SelectionProvider nodesBySource={{}} onMirror={() => {}}>
        <HandlerProvider actions={actions}><EntityDetailMolecule node={node} renderChild={() => null} /></HandlerProvider>
      </SelectionProvider>
    </OntologyProvider>
  )
  expect(screen.getByText(/select an entity/i)).toBeInTheDocument()
})

test('renders the focal entity header, props and provenance from the selection', async () => {
  const fetchData = vi.fn().mockResolvedValue(vesselsPage)
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  render(
    <OntologyProvider ontology={ONT}>
      <SelectionProvider nodesBySource={{}} onMirror={() => {}}>
        <HandlerProvider actions={actions}>
          <SelectVessel />
          <EntityDetailMolecule node={node} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    </OntologyProvider>
  )
  screen.getByText('sel').click()
  await waitFor(() => expect(screen.getByText('WONDER VEGA')).toBeInTheDocument())
  expect(screen.getByText(/vessel/i)).toBeInTheDocument()       // type badge
  expect(screen.getByText('under way')).toBeInTheDocument()      // a prop value
  expect(screen.getByText(/data:\/\/vessels/)).toBeInTheDocument() // provenance
})
```

Python — append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def test_entity_detail_valid_doc_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append({"id": "ed", "type": "entity-detail", "layer": "dock", "edge": "right"})
    assert plugin.validator.validate_doc(doc) == []


def test_entity_detail_state_keys_registered(plugin):
    assert "entity-detail" in plugin.validator.STATE_KEYS
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EntityDetailMolecule.test.tsx`
Expected: FAIL — modules `../OntologyContext` / `./EntityDetailMolecule` not found.

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k entity_detail`
Expected: FAIL — `entity-detail` rejected by schema enum / missing from `STATE_KEYS`.

- [ ] **Step 3: Write the implementation**

**(a)** Create `apps/gis-canvas/src/lib/source-fetch.ts`:

```ts
import { isDataHandle } from './data-plane'
import { resolveMockSource } from './mock-data'
import type { CanvasActions } from './handlers'
import type { SourceData } from './ontology'

/** Load a source's rows: data:// from the broker (page cap 5000), mock:// locally. */
export async function fetchSourceData(actions: Pick<CanvasActions, 'fetchData'>, source: string): Promise<SourceData> {
  if (isDataHandle(source)) {
    const p = await actions.fetchData(source, { pageSize: 5000 })
    return { schema: p.schema, rows: p.rows as Array<Record<string, unknown>> }
  }
  const m = resolveMockSource(source)
  return m ? { schema: m.schema, rows: m.rows as Array<Record<string, unknown>> } : { schema: [], rows: [] }
}
```

**(b)** Create `apps/gis-canvas/src/components/OntologyContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { Ontology } from '../lib/types'

const Ctx = createContext<Ontology | undefined>(undefined)

/** Feeds the canvas doc's top-level `ontology` to entity-aware molecules. */
export function OntologyProvider({ ontology, children }: { ontology?: Ontology; children: ReactNode }) {
  return <Ctx.Provider value={ontology}>{children}</Ctx.Provider>
}

export function useOntology(): Ontology | undefined {
  return useContext(Ctx)
}
```

**(c)** Create `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useCanvasActions } from '../HandlerContext'
import { useSelectionState } from '../SelectionContext'
import { useOntology } from '../OntologyContext'
import { fetchSourceData } from '../../lib/source-fetch'
import { typeForSource, resolveEntity, type SourceData } from '../../lib/ontology'
import type { MoleculeProps } from '../registry'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface">
      <div className="flex shrink-0 items-center border-b border-hairline px-3 py-2">
        <span className="font-display text-xs font-semibold uppercase tracking-wide text-primary">Entity</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </div>
  )
}
const Hint = ({ text }: { text: string }) => <div className="flex h-full items-center justify-center text-center font-sans text-xs text-tertiary">{text}</div>

export function EntityDetailMolecule({ node }: MoleculeProps) {
  const ontology = useOntology()
  const selection = useSelectionState()
  const actions = useCanvasActions()

  // First ontology-mapped source with a selected key drives the panel (last-selected key).
  const focal = useMemo(() => {
    for (const [source, keys] of Object.entries(selection)) {
      if (!keys?.length) continue
      const type = typeForSource(ontology, source)
      if (type) return { source, type, key: keys[keys.length - 1] }
    }
    return null
  }, [selection, ontology])

  const [data, setData] = useState<SourceData | null>(null)
  useEffect(() => {
    if (!focal) { setData(null); return }
    let cancelled = false
    setData(null)
    fetchSourceData(actions, focal.source).then(d => { if (!cancelled) setData(d) }).catch(() => { if (!cancelled) setData({ schema: [], rows: [] }) })
    return () => { cancelled = true }
  }, [focal?.source, actions])

  const resolved = useMemo(() => (focal && data ? resolveEntity(ontology!, focal.type, data, focal.key) : null), [ontology, focal, data])

  const anySelection = Object.values(selection).some(k => k?.length)
  if (!focal) return <Frame><Hint text={anySelection ? 'Selection is not an ontology entity' : 'Select an entity to see its details'} /></Frame>
  if (!data) return <Frame><Hint text="Loading…" /></Frame>
  if (!resolved) return <Frame><Hint text={`No matching ${focal.type} for "${focal.key}"`} /></Frame>

  const e = resolved.entity
  return (
    <Frame>
      <div className="mb-3">
        <span className="rounded-full border border-hairline bg-surface-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">{e.typeLabel}</span>
        <div className="mt-1 font-display text-sm font-semibold text-primary">{e.title}</div>
        <div className="font-mono text-[11px] text-tertiary">{e.ref.id}</div>
      </div>
      <dl className="mb-3 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1">
        {e.props.map(p => (
          <div key={p.label} className="contents">
            <dt className="truncate font-mono text-[11px] uppercase tracking-wide text-tertiary">{p.label}</dt>
            <dd className="truncate text-xs text-primary">{p.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-hairline pt-2">
        <div className="font-mono text-[9px] uppercase tracking-wide text-tertiary">Provenance</div>
        <div className="truncate font-mono text-[11px] text-secondary">{e.provenance.source}</div>
      </div>
    </Frame>
  )
}
```

**(d)** `apps/gis-canvas/src/components/registry.tsx` — import and register (direct, no lazy — no heavy deps). Add the import near the other molecule imports:

```tsx
import { EntityDetailMolecule } from './molecules/EntityDetailMolecule'
```

and inside `COMPONENT_REGISTRY`, after the `tabs` entry:

```tsx
  'entity-detail': EntityDetailMolecule,
```

**(e)** `apps/gis-canvas/src/App.tsx` — import the provider and wrap. Add the import beside the other providers:

```tsx
import { OntologyProvider } from './components/OntologyContext'
```

and wrap `CanvasGrid` (inside `TimeExtentProvider`, mirroring it):

```tsx
            <TimeExtentProvider>
              <OntologyProvider ontology={mergedDoc.ontology}>
                <HandlerProvider actions={actions}>
                  <LayoutProvider store={layout}>
                    <CanvasGrid doc={mergedDoc} />
                  </LayoutProvider>
                </HandlerProvider>
              </OntologyProvider>
            </TimeExtentProvider>
```

**(f)** `apps/gis-canvas/src/lib/types.test.ts` — extend the `MOLECULE_TYPES` `toEqual([...])` assertion to include `'entity-detail'` in the same position as in `types.ts` (before `'esri:feature-table'`). (Read the file; add the one string to the expected array — do not weaken the assertion.)

**(g)** `plugins/gis-canvas/schema/canvas.schema.json` — add `"entity-detail"` to the `type` enum (the `componentNode.properties.type.enum` array), before `"esri:feature-table"`:

```json
        "type": { "enum": ["card", "stat", "data-table", "select", "tabs", "esri:map", "esri:legend", "esri:layer-list", "esri:time-slider", "entity-detail", "esri:feature-table"] },
```

**(h)** `plugins/gis-canvas/validator.py` — add a `CATALOG` entry (after `esri:time-slider`) and a `STATE_KEYS` entry:

```python
    "entity-detail": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": [],
    },
```

```python
    "entity-detail": set(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EntityDetailMolecule.test.tsx`
Expected: PASS (2 tests).

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k entity_detail`
Expected: PASS (2 tests).

Run: `cd apps/gis-canvas && npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/source-fetch.ts apps/gis-canvas/src/components/OntologyContext.tsx apps/gis-canvas/src/components/molecules/EntityDetailMolecule.tsx apps/gis-canvas/src/components/molecules/EntityDetailMolecule.test.tsx apps/gis-canvas/src/components/registry.tsx apps/gis-canvas/src/App.tsx apps/gis-canvas/src/lib/types.test.ts plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "feat(gis-canvas): entity-detail molecule core + OntologyContext + registry sync"
```

---

### Task 4: entity-detail relationships — link chips, in-place pivot, breadcrumb

**Files:**
- Modify: `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.tsx`
- Test: `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.test.tsx`

**Interfaces:**
- Consumes: `resolveLinks`, `type LinkGroup`, `type EntityRef` (Task 2); `useSelectionActions` (existing); everything from Task 3.
- Produces: relationships section (grouped clickable chips), a local `focusStack: EntityRef[]`, breadcrumb navigation, and pivot behavior — a chip click pushes the target ref, writes `selectionActions.set(target.source, [target.key])`, and re-focuses the panel; the displayed entity is the stack top when the stack is non-empty, else the selection-derived focal.

- [ ] **Step 1: Write the failing test**

Append to `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.test.tsx`:

```ts
import { useSelectionState as useSelState } from '../SelectionContext'

const operatorsPage = {
  ok: true, total: 2, page: 0, pageSize: 5000,
  schema: [{ name: 'op_id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'country', type: 'string' }],
  rows: [{ op_id: 'OP1', name: 'ACME MARINE', country: 'SG' }]
}

function SelProbe() {
  const s = useSelState()
  return <span data-testid="sel">{Object.entries(s).map(([k, v]) => `${k}=${(v ?? []).join(',')}`).sort().join('|')}</span>
}

test('shows a related-entity chip and pivots to it on click (updates focus + shared selection)', async () => {
  const fetchData = vi.fn().mockImplementation((h: string) => Promise.resolve(h === 'data://vessels' ? vesselsPage : operatorsPage))
  const actions: CanvasActions = { setLocalState() {}, reportInteraction() {}, sendPrompt() {}, fetchData }
  render(
    <OntologyProvider ontology={ONT}>
      <SelectionProvider nodesBySource={{}} onMirror={() => {}}>
        <HandlerProvider actions={actions}>
          <SelProbe />
          <SelectVessel />
          <EntityDetailMolecule node={node} renderChild={() => null} />
        </HandlerProvider>
      </SelectionProvider>
    </OntologyProvider>
  )
  screen.getByText('sel').click()
  // related operator chip appears
  const chip = await screen.findByRole('button', { name: /ACME MARINE/i })
  chip.click()
  // panel re-focuses on the operator (its country prop shows) ...
  await waitFor(() => expect(screen.getByText('SG')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByText('ACME MARINE')).toBeInTheDocument())
  // ... and the shared selection now includes the operator (so a table/map would highlight it)
  await waitFor(() => expect(screen.getByTestId('sel').textContent).toContain('data://operators=OP1'))
  // breadcrumb offers a way back
  expect(screen.getByRole('button', { name: /back|‹|vessel/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EntityDetailMolecule.test.tsx`
Expected: FAIL — no relationship chip / no pivot (relationships not implemented).

- [ ] **Step 3: Write the implementation**

Rewrite `apps/gis-canvas/src/components/molecules/EntityDetailMolecule.tsx` to add the pivot stack, multi-source fetch, links, chips, and breadcrumb. Replace the file body (keep the `Frame`/`Hint` helpers) with:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useCanvasActions } from '../HandlerContext'
import { useSelectionState, useSelectionActions } from '../SelectionContext'
import { useOntology } from '../OntologyContext'
import { fetchSourceData } from '../../lib/source-fetch'
import { typeForSource, resolveEntity, resolveLinks, type SourceData, type EntityRef } from '../../lib/ontology'
import type { MoleculeProps } from '../registry'

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-gc-md border border-hairline bg-surface">
      <div className="flex shrink-0 items-center border-b border-hairline px-3 py-2">
        <span className="font-display text-xs font-semibold uppercase tracking-wide text-primary">Entity</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </div>
  )
}
const Hint = ({ text }: { text: string }) => <div className="flex h-full items-center justify-center text-center font-sans text-xs text-tertiary">{text}</div>

export function EntityDetailMolecule({ node }: MoleculeProps) {
  const ontology = useOntology()
  const selection = useSelectionState()
  const selActions = useSelectionActions()
  const actions = useCanvasActions()
  const [stack, setStack] = useState<EntityRef[]>([])

  // Selection-derived focal (first ontology-mapped source with a selected key).
  const selFocal = useMemo(() => {
    for (const [source, keys] of Object.entries(selection)) {
      if (!keys?.length) continue
      const type = typeForSource(ontology, source)
      if (type) return { type, source, key: keys[keys.length - 1] } as { type: string; source: string; key: string }
    }
    return null
  }, [selection, ontology])

  // A new selection resets the pivot stack (new drill root).
  const selKey = selFocal ? `${selFocal.source}:${selFocal.key}` : ''
  useEffect(() => { setStack([]) }, [selKey])

  // Displayed target: stack top if present, else the selection focal.
  const focus = stack.length ? { type: stack[stack.length - 1].type, source: stack[stack.length - 1].source, key: stack[stack.length - 1].key } : selFocal

  // Fetch the focal source + all sources its type's links can reach; memoize per source.
  const [sources, setSources] = useState<Record<string, SourceData>>({})
  useEffect(() => {
    if (!focus || !ontology) return
    const et = ontology[focus.type]
    const needed = new Set<string>([focus.source])
    for (const l of Object.values(et?.links ?? {})) { const t = ontology[l.to]; if (t) needed.add(t.source) }
    let cancelled = false
    Promise.all([...needed].map(async s => [s, await fetchSourceData(actions, s)] as const))
      .then(pairs => { if (!cancelled) setSources(prev => ({ ...prev, ...Object.fromEntries(pairs) })) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [focus?.type, focus?.source, ontology, actions])

  const data = focus ? sources[focus.source] : undefined
  const resolved = useMemo(() => (focus && data && ontology ? resolveEntity(ontology, focus.type, data, focus.key) : null), [ontology, focus, data])
  const links = useMemo(() => (resolved && ontology ? resolveLinks(ontology, focus!.type, resolved.row, sources) : []), [resolved, ontology, focus, sources])

  const anySelection = Object.values(selection).some(k => k?.length)
  if (!focus) return <Frame><Hint text={anySelection ? 'Selection is not an ontology entity' : 'Select an entity to see its details'} /></Frame>
  if (!data) return <Frame><Hint text="Loading…" /></Frame>
  if (!resolved) return <Frame><Hint text={`No matching ${focus.type} for "${focus.key}"`} /></Frame>

  const e = resolved.entity
  const pivot = (ref: EntityRef) => {
    setStack(s => [...s, ref])
    selActions.set(ref.source, [ref.key])
  }
  const popTo = (i: number) => setStack(s => s.slice(0, i))

  return (
    <Frame>
      {stack.length ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 font-mono text-[10px] text-tertiary">
          <button onClick={() => popTo(0)} className="hover:text-accent">‹ {selFocal?.type ?? 'root'}</button>
          {stack.slice(0, -1).map((r, i) => (
            <button key={i} onClick={() => popTo(i + 1)} className="hover:text-accent">/ {r.title || r.id}</button>
          ))}
        </div>
      ) : null}
      <div className="mb-3">
        <span className="rounded-full border border-hairline bg-surface-raised px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">{e.typeLabel}</span>
        <div className="mt-1 font-display text-sm font-semibold text-primary">{e.title}</div>
        <div className="font-mono text-[11px] text-tertiary">{e.ref.id}</div>
      </div>
      <dl className="mb-3 grid grid-cols-[minmax(0,7rem)_1fr] gap-x-2 gap-y-1">
        {e.props.map(p => (
          <div key={p.label} className="contents">
            <dt className="truncate font-mono text-[11px] uppercase tracking-wide text-tertiary">{p.label}</dt>
            <dd className="truncate text-xs text-primary">{p.value}</dd>
          </div>
        ))}
      </dl>
      {links.length ? (
        <div className="mb-3 border-t border-hairline pt-2">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-tertiary">Relationships</div>
          {links.map(g => (
            <div key={g.name} className="mb-1.5">
              <div className="font-mono text-[10px] text-tertiary">{g.name}</div>
              <div className="flex flex-wrap gap-1">
                {g.entities.map(r => (
                  <button
                    key={`${r.ref.source}:${r.ref.key}`}
                    onClick={() => pivot(r.ref)}
                    className="rounded-gc-sm border border-hairline bg-surface-raised px-1.5 py-0.5 text-xs text-primary hover:border-accent hover:text-accent"
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="border-t border-hairline pt-2">
        <div className="font-mono text-[9px] uppercase tracking-wide text-tertiary">Provenance</div>
        <div className="truncate font-mono text-[11px] text-secondary">{e.provenance.source}</div>
      </div>
    </Frame>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/gis-canvas && npx vitest run src/components/molecules/EntityDetailMolecule.test.tsx`
Expected: PASS (all 3 tests). Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/EntityDetailMolecule.tsx apps/gis-canvas/src/components/molecules/EntityDetailMolecule.test.tsx
git commit -m "feat(gis-canvas): entity-detail relationships, in-place pivot + breadcrumb"
```

---

### Task 5: Ontology validation (schema + validator)

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json`
- Modify: `plugins/gis-canvas/validator.py`
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: the existing `validate_doc(doc) -> list[str]` structure (schema errors first, then catalog walk).
- Produces: an `ontology` doc field accepted by the schema, plus a validator pass — each ontology entry must have `source` and `id`; every `links[].to` must name a declared type (a dangling `to` is an error).

- [ ] **Step 1: Write the failing tests**

Append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def _ontology_doc():
    doc = _minimal_doc()
    doc["ontology"] = {
        "vessel": {"source": "data://v", "id": "mmsi", "title": "vessel_name",
                   "links": {"operator": {"to": "operator", "field": "operator_id"}}},
        "operator": {"source": "data://o", "id": "op_id", "title": "name"},
    }
    return doc


def test_valid_ontology_doc_passes(plugin):
    assert plugin.validator.validate_doc(_ontology_doc()) == []


def test_ontology_entry_requires_source_and_id(plugin):
    doc = _ontology_doc()
    del doc["ontology"]["operator"]["id"]
    errors = plugin.validator.validate_doc(doc)
    assert any("operator" in e and "id" in e for e in errors)


def test_ontology_link_to_must_name_a_declared_type(plugin):
    doc = _ontology_doc()
    doc["ontology"]["vessel"]["links"]["operator"]["to"] = "ghost"
    errors = plugin.validator.validate_doc(doc)
    assert any("ghost" in e for e in errors)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k ontology`
Expected: FAIL — `ontology` is rejected by the schema (root `additionalProperties: false`), so even the valid doc fails until the schema allows it and the validator pass exists.

- [ ] **Step 3: Write the implementation**

**(a)** `plugins/gis-canvas/schema/canvas.schema.json` — add an `ontology` property to the root `properties` (after `"focus"`), and an `entityType` definition in `$defs`. Root `properties`:

```json
    "focus": { "type": "string" },
    "ontology": {
      "type": "object",
      "additionalProperties": { "$ref": "#/$defs/entityType" }
    }
```

Add to `$defs` (alongside `area`, `componentNode`):

```json
    "entityType": {
      "type": "object",
      "required": ["source", "id"],
      "additionalProperties": false,
      "properties": {
        "source": { "type": "string" },
        "id": { "type": "string" },
        "title": { "type": "string" },
        "props": { "type": "array", "items": { "type": "string" } },
        "links": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "required": ["to", "field"],
            "additionalProperties": false,
            "properties": {
              "to": { "type": "string" },
              "field": { "type": "string" },
              "reverse": { "type": "boolean" }
            }
          }
        }
      }
    }
```

**(b)** `plugins/gis-canvas/validator.py` — after the schema-error early return and before/after the component walk, add an ontology cross-check. Insert this block inside `validate_doc`, right before `return errors` (after the component/overlay walks):

```python
    ontology = doc.get("ontology") or {}
    for type_name, entry in ontology.items():
        # schema already guarantees source+id shape; this catches dangling link targets
        for link_name, link in (entry.get("links") or {}).items():
            target = link.get("to")
            if target not in ontology:
                errors.append(
                    f"ontology '{type_name}'.links.{link_name}: 'to' references undeclared type '{target}'"
                )
```

Note: the `source`+`id` requirement is enforced by the JSON schema (`entityType.required`), so `test_ontology_entry_requires_source_and_id` passes via a schema error (message contains the path `ontology/operator` and `id`). The dangling-`to` check is the catalog-level rule above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q -k ontology`
Expected: PASS (3 tests). Then the full file: `python -m pytest tests/plugins/gis_canvas/test_validator.py -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "feat(gis-canvas): validate top-level ontology (source/id + link targets)"
```

---

### Task 6: Mock ontology data + agent guidance

**Files:**
- Modify: `apps/gis-canvas/src/lib/mock-data.ts`
- Modify: `plugins/gis-canvas/tools_canvas.py`
- Test: `tests/plugins/gis_canvas/test_tools.py`

**Interfaces:**
- Consumes: `resolveMockSource` (existing) — the two new handles resolve through it so the whole drill works without Denodo.
- Produces: `mock://vessels` + `mock://operators` sources; catalog guidance documenting the `ontology` block + `entity-detail` molecule + a worked example.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugins/gis_canvas/test_tools.py`:

```python
def test_tool_guidance_documents_ontology_and_entity_detail(plugin):
    text = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"] + plugin.tools_canvas._CATALOG_HELP
    for kw in ("entity-detail", "ontology", "links", "reverse"):
        assert kw in text, f"ontology guidance missing {kw!r}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/plugins/gis_canvas/test_tools.py -q -k ontology`
Expected: FAIL — guidance keywords absent.

- [ ] **Step 3: Write the implementation**

**(a)** `apps/gis-canvas/src/lib/mock-data.ts` — add two sources inside `SOURCES` (after `mock://vessel-track`). `operator_id` links vessels → operators; OP1 owns two vessels (exercises reverse links):

```ts
  'mock://vessels': {
    schema: [
      { name: 'mmsi', type: 'string' }, { name: 'vessel_name', type: 'string' }, { name: 'flag', type: 'string' },
      { name: 'length_m', type: 'number' }, { name: 'status', type: 'string' }, { name: 'operator_id', type: 'string' },
      { name: 'lat', type: 'number' }, { name: 'lng', type: 'number' }
    ],
    rows: [
      { mmsi: '563123000', vessel_name: 'WONDER VEGA', flag: 'SG', length_m: 229, status: 'under way', operator_id: 'OP1', lat: 1.264, lng: 103.84 },
      { mmsi: '440111222', vessel_name: 'ORION PEARL', flag: 'KR', length_m: 183, status: 'moored', operator_id: 'OP2', lat: 1.29, lng: 103.85 },
      { mmsi: '563998000', vessel_name: 'SILVER TERN', flag: 'SG', length_m: 199, status: 'under way', operator_id: 'OP1', lat: 1.31, lng: 103.79 }
    ]
  },
  'mock://operators': {
    schema: [
      { name: 'op_id', type: 'string' }, { name: 'name', type: 'string' },
      { name: 'country', type: 'string' }, { name: 'fleet_size', type: 'number' }
    ],
    rows: [
      { op_id: 'OP1', name: 'ACME MARINE', country: 'SG', fleet_size: 12 },
      { op_id: 'OP2', name: 'BOREAS LINES', country: 'KR', fleet_size: 7 }
    ]
  },
```

**(b)** `plugins/gis-canvas/tools_canvas.py` — extend `_CATALOG_HELP`. Immediately after the spatio-temporal segment's closing `"…OMIT the field props and they are auto-detected."` fragment, insert a new concatenated segment (mind the leading/trailing spaces at both seams — the fragment starts and ends with a space, like the surrounding literals):

```python
    " ONTOLOGY & ENTITIES: to give the user an object profile, declare a top-level `ontology` "
    "(a sibling of `layout`/`components`) keyed by entity TYPE: ontology:{ vessel:{source:'data://v', "
    "id:'mmsi', title:'vessel_name', props:['flag','status'], links:{operator:{to:'operator', "
    "field:'operator_id'}}}, operator:{source:'data://o', id:'op_id', title:'name', "
    "links:{vessels:{to:'vessel', field:'operator_id', reverse:true}}} }. `source` = the handle whose "
    "rows are that type's entities; `id`/`title`/`props` MUST be ACTUAL columns of that source (never "
    "invent names); `links` name relationships (forward: this row's `field` holds the target's id; "
    "reverse:true: scan the other type for rows whose `field` points back). Then author an "
    "`entity-detail` molecule (no bindings.source — it is driven by the current selection + the "
    "`ontology`; dock it like the legend). Selecting a row/point shows that entity; clicking a related "
    "entity pivots the panel AND selects it on the map/table. Use it when the user asks about a specific "
    "object, its details, or what it is connected to. `mock://vessels` + `mock://operators` are linked "
    "dev sources for ontology demos."
```

**(c)** `plugins/gis-canvas/tools_canvas.py` — add a worked example to `RENDER_VIEW_SCHEMA["description"]`. Immediately after the spatio-temporal track example block (ends `"…sweeps the platforms along their courses."`), insert:

```python
        " Ontology example (object profile + drill): {canvasVersion:1, layout:{type:'grid',cols:12}, "
        "ontology:{ vessel:{source:'mock://vessels', id:'mmsi', title:'vessel_name', "
        "props:['flag','status','length_m'], links:{operator:{to:'operator', field:'operator_id'}}}, "
        "operator:{source:'mock://operators', id:'op_id', title:'name', props:['country','fleet_size'], "
        "links:{vessels:{to:'vessel', field:'operator_id', reverse:true}}} }, components:[ "
        "{id:'tbl', type:'data-table', layer:'base', props:{title:'Vessels'}, "
        "bindings:{source:'mock://vessels'}}, {id:'ed', type:'entity-detail', layer:'dock', edge:'right', "
        "size:{w:26,h:100}} ]} — select a vessel row to profile it; click its operator to pivot, and the "
        "operator shows its vessels (reverse link)."
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/plugins/gis_canvas/test_tools.py -q`
Expected: PASS (existing + the new ontology-guidance test).

Run the full FE suite to confirm the mock additions break nothing: `cd apps/gis-canvas && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/mock-data.ts plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_tools.py
git commit -m "feat(gis-canvas): vessels/operators mock + ontology & entity-detail agent guidance"
```

---

## Final Verification (after all tasks)

- [ ] **Full front-end suite:** `cd apps/gis-canvas && npm test` → all green.
- [ ] **Front-end typecheck + production build:** `cd apps/gis-canvas && npm run build` → succeeds.
- [ ] **Python plugin suite:** `python -m pytest tests/plugins/gis_canvas/ -q` → all green.

## Deferred live-verify gate (per finishing-a-development-branch)

The selection↔entity bridge and cross-source fetch/pivot are exercised most truthfully against the live map/table + real Denodo (jsdom tests use mocked fetch). This is the merge gate — hold for the user's live check, same discipline as SP2/SP3.

---

## Self-Review

**Spec coverage:**
- Top-level `ontology` block → Task 1 (types) + Task 5 (schema/validator).
- Pure resolution (rows→entities, forward/reverse links, selection↔id bridge) → Tasks 1-2, heavily unit-tested.
- `entity-detail` (header/props/provenance/relationships/breadcrumb) → Tasks 3 (core) + 4 (relationships/pivot).
- Selection-driven + in-place pivot + selection write → Task 4.
- Agent guidance + mock data → Task 6. Registry sync (`entity-detail` 6-place + `ontology` schema/validator) → Tasks 3 + 5.
- SP2 lessons carried: never-silent-blank (explicit Hints in Tasks 3/4), field-names-must-be-real-columns (guidance Task 6). Empty/non-ontology/no-row states → Task 3.

**Spec item intentionally narrowed (flagged for executor & reviewers):** the spec's provenance region lists "source handle **and** originating query prompt." The prompt lives in broker `meta` server-side and the client `data_fetch` response does not carry it; surfacing it needs a data-plane change, which the spec's own "zero backend change" constraint forbids this round. Provenance therefore shows the **source handle** only; the prompt is deferred (a small follow-up that adds `meta` to `data_fetch`). This is a plan-vs-spec narrowing — if a reviewer wants the prompt, it's a separate backend task.

**Placeholder scan:** none — every code step carries complete code.

**Type consistency:** `EntityRef {type,source,id,key}`, `ResolvedEntity`, `SourceData`, `RelatedEntity {ref,title}`, `LinkGroup {name,to,entities}`, and the functions `typeForSource`/`findRowByKey`/`resolveEntity`/`resolveLinks` are used identically across Tasks 1-4. `resolveEntity` returns `{entity,row}` (the `row` feeds `resolveLinks` in Task 4). `Ontology`/`EntityType`/`LinkDef` live in `types.ts` and are imported by `ontology.ts`. The molecule reads the ontology via `useOntology()` (context fed `mergedDoc.ontology`), never from the node.
