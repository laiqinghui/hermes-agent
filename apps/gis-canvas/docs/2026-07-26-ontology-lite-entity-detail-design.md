# Ontology-Lite + Entity-Detail — Design (SP1, cluster A flagship)

**Status:** Approved (brainstorm complete, 2026-07-26)
**Branch:** `gis/ontology-lite` (base `gis/main` @ `496729540`)
**Program:** GIS Canvas C2/Gotham registry — SP1 (cluster A, Entity/Object intelligence). Builds on the tabular data plane (`data_query` → data:// handles, mock:// dev sources), linked selection (SelectionContext), and the molecule registry.

## Goal

Give the agent and canvas an **ontology-lite** notion of ENTITIES — typed objects with an id, title, properties, and **relationships** — layered over the flat tabular data plane, plus an **`entity-detail`** object-profile molecule that is selection-driven and lets an analyst drill from an entity to its related entities and back.

## Scope

**In scope (full ontology-lite):**
- A top-level `ontology` block in the canvas doc (agent-declared, keyed by entity type).
- A pure client resolution layer (rows → typed entities; forward + reverse link resolution; selection↔ontology-id bridge).
- An `entity-detail` molecule: header, key properties, provenance, relationships (clickable related-entity chips), breadcrumb.
- Selection-driven focus + in-place pivot (link click re-focuses the panel AND updates shared selection so map/table follow).
- Agent guidance + mock ontology data (`mock://vessels` ↔ `mock://operators`).

**Out of scope (deferred, YAGNI):**
- Node-link **graph** visualization molecule (its own later SP).
- Server-side relationship/entity queries or new handle kinds (agent-declared over rows only).
- Multi-entity focus (several entities at once) — single focal entity this round.
- Reverse links beyond the loaded page (≤5000 rows) — same bound as geofence.

## Architecture

Zero backend/data-plane change. The agent declares an ontology; the client resolves entities and links over the existing data plane (rows fetched by handle client-side, exactly like maps/tables).

### The `ontology` doc block

A sibling of `layout` in the canvas doc, declared once, keyed by entity **type**:

```
ontology: {
  vessel:   { source:'data://v', id:'mmsi', title:'vessel_name',
              props:['flag','length_m','status'],
              links:{ operator:{ to:'operator', field:'operator_id' } } },
  operator: { source:'data://o', id:'op_id', title:'name',
              props:['country','fleet_size'],
              links:{ vessels:{ to:'vessel', field:'operator_id', reverse:true } } }
}
```

- `source` — the data:// (or mock://) handle whose rows are this type's entities.
- `id` — column that identifies an entity (used for **link matching** + display).
- `title` — column for the display label.
- `props` — columns to show in the detail (optional; default: all non-id columns, capped).
- `links` — named relationships: `{ to:<type>, field:<column>, reverse?:boolean }`. Forward (default): `field` on THIS type's row holds the target entity's `id`. Reverse (`reverse:true`): find rows of the OTHER type whose `field` points back at this entity's `id`.

### Pure resolution layer — `lib/ontology.ts` (ESRI-free, jsdom-testable)

- `types`: `Ontology`, `EntityType`, `EntityRef = { type, source, id }`, `ResolvedEntity = { ref, title, typeLabel, props: {label,value}[], provenance }`.
- `typeForSource(ontology, source): string | undefined` — which type owns a source.
- `resolveFocalEntity(ontology, type, rows, selectionKey): ResolvedEntity | null` — bridge: match `selectionKey` (a `resolveIdField` key) against the source's `resolveIdField` key to find the focal row, then read ontology `id`/`title`/`props`.
- `resolveLinks(ontology, focalRow, focalType, sourcesRows): LinkGroup[]` — forward: target row where `target[targetId] === focalRow[field]`; reverse: target rows where `row[field] === focalRow[focalId]`. Each resolved target carries its title + the `selectionKey` to set on pivot (its `resolveIdField` key).
- Missing target row / source not loaded / bad field → that link (or group) omitted, never throws.

### Only `entity-detail` is entity-aware

Maps and tables stay row-based and interoperate through the EXISTING SelectionContext. `entity-detail` reads the current selection + the doc `ontology` to know the focal entity; a pivot writes selection so map/table highlight follows. No change to map/table/selection internals.

## The `entity-detail` molecule

Dockable object-profile panel (`type:'entity-detail'`), styled on `gc-`/`.gc-hud`. No `bindings.source` — driven by selection + the doc `ontology`. Optional `props.type` to prefer one type when a selection is ambiguous. Five stacked regions:

1. **Header** — type badge (`VESSEL`), entity title (`WONDER VEGA`), `id` as secondary mono.
2. **Key properties** — definition list of `props` (label → value) from the focal row; missing → `—`.
3. **Provenance** — the source handle + originating query prompt (broker stores `meta={prompt}` per handle).
4. **Relationships** — grouped by link name; each related entity a clickable chip showing the target's title (cross-source, via ontology). Forward + reverse both render; a link resolving to nothing is hidden.
5. **Breadcrumb** — the pivot trail (`‹ Operator ACME / Vessel VEGA`), walkable back.

**Empty/edge states (SP2 lesson — never a silent blank):** no selection → quiet "Select an entity" placeholder; selection whose source isn't in the ontology → "not an ontology entity" hint; focal id resolving to no row → a small diagnostic.

## Interaction & state model

`entity-detail` holds `focusStack: EntityRef[]` (local state):

- **Selection → focus.** On shared-selection change, find the first selected source the ontology maps to a type, read its selected key, resolve to an entity, set as focus ROOT (reset stack). Clicking a table row / map point drives the panel.
- **Link chip → pivot.** Push the target `EntityRef` onto the stack (re-focus) AND `useSelectionActions().set(targetSource, [targetKey])` so map/table highlight follows. Breadcrumb pops back.

**Selection↔ontology-id bridge.** Selection stores `resolveIdField` keys (a heuristic — first distinct column), which may differ from ontology `id`. `entity-detail` resolves the focal row by matching the selected key against the source's `resolveIdField` key (same function map/table used — guaranteed alignment). Ontology `id` is used only for link matching + display. On pivot, compute the target row's `resolveIdField` key so the highlight lands. All in pure `lib/ontology.ts`.

**Fetching.** Fetch each needed source once by handle (existing `fetchData`, `pageSize` 5000), memoized per source for the panel's lifetime. Reverse-link scan is over the loaded page (bounded).

**Freshness.** Re-resolve on selection change and on `doc.rev` change (ontology can change between renders), mirroring the map's rebuild discipline.

## Agent guidance + mock data

**Mock ontology data** (`mock-data.ts`):
- `mock://vessels` — `mmsi, vessel_name, flag, length_m, status, operator_id, lat, lng` (several vessels; `operator_id` = FK).
- `mock://operators` — `op_id, name, country, fleet_size` (a few operators; some own multiple vessels → exercises reverse links).

**Guidance in `_CATALOG_HELP` / `render_view` description** (worked-example-first):
1. The `ontology` block — declaring types (`source`/`id`/`title`/`props`/`links`), with the SP2 lesson verbatim: field names must be ACTUAL columns from the source schema; if unsure, inspect the schema — never invent names.
2. The `entity-detail` molecule — one line: no `bindings.source`; driven by selection + the doc `ontology`; dock like the legend.
3. A worked C2 example — a vessels map/table `base` + a linked data-table + an `entity-detail` dock + the `ontology` wiring `vessel`↔`operator`.
4. When to use — "when the user asks about a specific object / its details / what it's connected to, add an `entity-detail` and declare the `ontology`."

Agent flow: *classify entities → declare the `ontology` (types + links) → author map/table + `entity-detail` dock*.

## Registry & schema sync

- **`entity-detail` molecule** → schema `type` enum; `types.ts` `MOLECULE_TYPES` (+ `types.test.ts` assertion); validator `CATALOG` + `STATE_KEYS`; `registry.tsx`; `_CATALOG_HELP`.
- **Top-level `ontology`** → JSON schema (object of type-entries; each entry requires `source`+`id`); `types.ts` `CanvasDoc`; validator light pass — each entry needs `source`+`id`; every `links[].to` must name a declared type (a dangling link is a validation error).

## Testing (TDD)

- **`lib/ontology.ts` (pure — the bulk):** typeForSource; resolveFocalEntity via `resolveIdField` bridge; forward-link lookup; reverse-link scan; cross-source resolution; missing-target/bad-field/unloaded-source fallbacks; pivot-key computation.
- **`entity-detail` molecule (mocked fetch, jsdom):** renders header/props/provenance/relationships from a focal selection; link chip click pushes focus AND sets shared selection (assert via a selection probe, like SP2); breadcrumb back; empty / non-ontology / no-row states.
- **Python:** validator accepts a valid `ontology` doc, rejects a dangling `links.to`; guidance keywords present.
- Full FE + plugin suites + prod build stay green.

## Live-verify gate (deferred, per finishing-a-development-branch)

The selection↔entity bridge and cross-source fetch/pivot are exercised most truthfully against the live map/table + real Denodo. Held as the merge gate, same discipline as SP2/SP3.

## Risks

- **selection-key vs ontology-id mismatch** — mitigated by the `resolveIdField` bridge (primary design risk; heavily unit-tested).
- **cross-source fetch cost** — one fetch per referenced source, memoized; reverse scan bounded to the loaded page.
- **agent mis-declares field names** — client tolerates where it can (fallbacks) + guidance steers; not silently blank (diagnostic states), per SP2.
