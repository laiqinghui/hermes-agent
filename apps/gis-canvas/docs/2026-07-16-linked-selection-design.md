# GIS Canvas — WS2: Generic Linked Selection

**Design spec.** 2026-07-16. A reusable primitive that links **any** canvas components bound to the
same data source through a shared selection, and surfaces that selection to the agent. Map↔table is
the first application, not a special case. Frontend-only (reuses the existing agent-awareness path).

## Context

Today selection is per-molecule and unlinked:
- `DataTableMolecule` writes `state.rowSelection` (row ids keyed by `idField` = first schema column)
  on a checkbox toggle; `awareness.py` already surfaces `rowSelection` to the agent each turn.
- `EsriMapMolecule` writes `state.selection` (ESRI-generated `__oid`s) on a feature click — a
  *different* identity space that awareness does **not** surface, and that nothing else reacts to.

So a table selection never moves/highlights the map, and vice versa. But the map's features are built
by `buildRowsLayer` from the *same rows* the table fetches (same data handle), and `fieldsFromSchema`
puts every schema field into each feature's attributes — so **the shared row key (`idField` value) is
already present on both the table row and the map feature**. Linking is feasible frontend-side.

## Goal

Any two-or-more components bound to the same data `source` share one selection. Selecting rows in one
highlights/repositions the linked components; the selection is visible to the agent as `rowSelection`
on every participating node. Adding a new linkable component is one hook call — no map/table special
casing.

## Non-goals

No backend/schema/awareness changes (awareness already surfaces `rowSelection`). No control→consumer
linking (a select box filtering a table already exists via `state.filter`/`state.value` — left as-is).
No cross-source linking (linking is by shared source handle). No server-persisted canvas-level
selection object (selection persists via the existing per-node `state.rowSelection`).

## Design

### Identity — `resolveIdField(schema)` (shared)

`lib/selection.ts` exports `resolveIdField(schema: {name:string}[] | undefined): string` — the first
column's `name` (today's table behavior: `schema[0]?.name`), else `'id'`. Table rows key on
`row[idField]`; map features carry `attributes[idField]` (already present). The
shared selected-id set is the set of `String(row[idField])` values. Making this a shared helper keeps
the table and map on the same key (the table currently inlines `schema[0].name`).

### The primitive — `SelectionContext` + `useLinkedSelection`

`src/components/SelectionContext.tsx`:

```tsx
interface SelectionContextValue {
  get(source: string): string[]
  set(source: string, ids: string[]): void
}
```

- Provider holds `selection: Record<string, string[]>` (source handle → selected id list) in state.
- `SelectionProvider` receives two things from `App`: `nodesBySource: Record<string, string[]>`
  (source handle → node ids bound to it, derived from the merged doc) and `onMirror(nodeId, ids)`
  (= `actions.reportInteraction(nodeId, { rowSelection })`).
- `set(source, ids)` updates the context state **and** calls `onMirror(nodeId, ids)` for every node in
  `nodesBySource[source]` — so every linked node's `state.rowSelection` reflects the selection (this
  is what the agent's awareness reads, and what makes "selected in the table" also "selected in the
  map" semantically true).
- `useLinkedSelection(source: string | undefined): [string[], (ids: string[]) => void]` — returns
  `[[], noop]` when `source` is falsy (component not data-bound → not linked); otherwise
  `[ctx.get(source), ids => ctx.set(source, ids)]`.

`App` wraps the canvas: `<SelectionProvider nodesBySource={…} onMirror={…}><HandlerProvider …>
<CanvasGrid/></HandlerProvider></SelectionProvider>`. `nodesBySource` is a `useMemo` over `mergedDoc`
that walks components/overlays collecting each node's `bindings.source` (table) and each data-handle in
`bindings.layers` (map).

### Table — `DataTableMolecule`

- Replace `const selected = node.state?.rowSelection …` with `const [selected, setSelected] =
  useLinkedSelection(source)` (source = `node.bindings?.source`), and `resolveIdField(schema)` for the
  id field.
- `toggle(rowId)` computes `next` and calls `setSelected(next)` (instead of `reportInteraction`
  directly — the provider mirrors to node state).
- Rows whose `String(row[idField])` is in `selected` already get the selected styling; additionally,
  scroll the first selected row into view on selection change (`scrollIntoView({block:'nearest'})`).

### Map — `EsriMapMolecule`

- `const source = <first data-handle in layerRefs>`; `const [selected, setSelected] =
  useLinkedSelection(source)`.
- **Emit:** in the click handler, map hit graphics to `attributes[idField]` (the shared key) instead
  of `__oid`, and `setSelected(nextIds)` (toggle the clicked ids into the current selection).
- **React:** a new effect keyed on `selected` + `ready`: resolve the layer's `layerView`, `highlight`
  the features whose `attributes[idField] ∈ selected`, and `view.goTo(thoseGraphics)` (padded) to
  reposition. Clear the previous highlight handle on change/unmount. Guard everything behind `ready`
  and the ESRI objects being present (no-op in tests / before load).
- The existing bottom-left "N selected" chip reads `selected.length`.
- `resolveIdField` needs the schema; the map already fetches the page (`actions.fetchData`) in the
  ready effect — stash `idField`/the page rows in a ref so the selection-react effect can match
  `attributes[idField]` and find graphics to highlight/goTo.

### Agent context (no change needed)

Because `set()` mirrors `rowSelection` onto every node bound to the source, `awareness.py`'s existing
`_fmt_state` renders `rowSelection=[…]` under **each** linked node. The agent sees, e.g.:

```
- tbl1(esri:data-table) source=data://ab rowSelection=[2025-05-05 23:59:47]
- map1(esri:map) source=data://ab rowSelection=[2025-05-05 23:59:47]
```

so "the user selected this point" is unambiguous across the linked components, and the ids are real
`idField` values the agent can re-query. This is the WS2 cardinal requirement, met with zero backend
change.

## Testing

- `selection.test.ts(x)`: `resolveIdField` (first-column / empty-schema fallback). `useLinkedSelection`
  via a tiny two-consumer harness — same source shares, different sources are independent, `set`
  updates both readers; a falsy source yields `[[], noop]`.
- `SelectionProvider` mirror test: `set('data://x', ['a'])` calls `onMirror` once per node id in
  `nodesBySource['data://x']` with `['a']`.
- `DataTableMolecule` (extend): with the provider seeded, a selected row has the selected styling; a
  checkbox click calls the provider `set`/mirrors `rowSelection`.
- `EsriMapMolecule` (extend): pure matching — given rows + a `selected` set, the ids resolved from
  `attributes[idField]` match the expected graphics (the ESRI `highlight`/`goTo` calls are guarded and
  exercised in live verify, not unit-tested).

## Success criteria

On the live GREY LADY canvas (a map + a linked table over one data handle): clicking a table row
highlights it **and** the map recenters/highlights the matching vessel position; clicking a map
feature highlights it **and** the table row highlights + scrolls into view; the agent, asked "what's
this point?", sees `rowSelection` (the real `idField` value) on both the table and the map. A future
component gains linking by calling `useLinkedSelection(source)`. Existing tests stay green; no backend
changes.
