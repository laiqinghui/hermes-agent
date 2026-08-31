# Analysis-product canvas — design (cluster A, SP4)

Status: **design approved 2026-08-31; SP-A specified here, SP-B/SP-C captured as backlog.**

## Problem

On 2026-08-31 a shadow-fleet investigation ran ~2h against Denodo and produced a complete
intelligence product: four suspects, per-vessel AIS gaps with validated boundaries, imagery
tasking windows, a ranked prioritization, a sensor recommendation and a caveat. The agent then
rendered a canvas containing **none of it** — only the source tables it had retrieved.

Both artifacts are frozen in `tests/fixtures/gis-canvas/session-2026-08-31/`:
`analysis-product.md` (what the agent concluded) versus `render-spec-before.json` (what it
drew). The distance between those two files is this project.

The cause is not planning judgement. It is that **the canvas has nowhere to put analysis**:

- `card` renders a title plus child components — it has no body text.
- `stat` is a single truncated label/value.
- `data-table` reads rows only from a `data://` handle or `mock://`, and `bindings` accepts
  strings only (`schema/canvas.schema.json`), so rows the agent computed cannot be expressed.
- `_CATALOG_HELP` (`tools_canvas.py:132`) explicitly instructs: *"NEVER inline data rows — bind
  data via bindings.source handles only."*

So every table on a canvas must correspond 1:1 with a retrieval, and no prose can appear at
all. A source-data review canvas is the only reachable output. Prompt tuning alone cannot fix
this — which is why this is a capability change, not a guidance change.

Grounding is **not** a constraint. Although `data_query` returns only `rowCount`, `schema` and
`sample[:3]`, the session shows the agent routing around it with narrow queries — the ~16
sequential one-row "single latest / single earliest" calls between 15:24 and 15:40 are gap
boundaries being validated individually. The analysis is already in context at `render_view`
time. Nothing new needs to be fetched; it only needs somewhere to go.

## Scope and decomposition

Three sub-projects. Each leaves a usable canvas, and the primitives stay general so nothing is
stranded if we stop early.

| | Sub-project | Delivers |
|---|---|---|
| **SP-A** | Expression primitives | `note` + inline `props.rows` + guidance rewrite. Renders the whole briefing as a static analysis product. |
| **SP-B** | Finding component | Generic `finding` (priority/confidence badges, evidence rows) — findings become scannable objects. |
| **SP-C** | Drill-through | Click a finding → select evidence rows **and** focus map extent + time window. |

**This document specifies SP-A.** SP-A is ~80% of the perceived value for ~30% of the work, and
it de-risks the rest: once a real briefing is on screen, SP-B's finding format is an informed
decision rather than a guess.

---

# SP-A — Expression primitives

## 1. `note` component

```json
{"id": "kj", "type": "note", "layer": "base",
 "props": {"title": "Key judgments", "body": "## AGNI\n**148-day** silence...\n\n- Early SAR: ..."}}
```

`props.body` renders a **safe markdown subset**: `#`–`###`, paragraphs, `**bold**`, `*italic*`,
`` `code` ``, ordered/unordered lists, `---`. Deliberately excluded: links, images, raw HTML,
and tables. Tables belong in the inline `data-table` below; omitting links keeps `javascript:`
URLs out of agent-authored content entirely.

**Implementation: a ~100-line in-house renderer (`src/lib/markdown.ts`), not a dependency.**

- It emits **React elements, never `dangerouslySetInnerHTML`** — escaping is structural, not a
  sanitizer we have to trust with model-authored text.
- This app has already been burnt by dependency bundling (the `@polymer` / `@vaadin` Rolldown
  exclusions in `vite.config.ts`); a new dep tree carries real, demonstrated risk here.
- Cost, stated plainly: we own ~100 lines of parser and its tests.

## 2. `data-table` inline rows

```json
{"id": "gaps", "type": "data-table", "layer": "dock", "edge": "bottom",
 "props": {"title": "AIS gaps & tasking windows",
           "rows": [{"vessel": "AGNI", "gap": "A", "days": 148.0, "mmsi_change": "no"}]}}
```

- `bindings.source` **keeps precedence** when present, so all existing behaviour is untouched;
  inline `props.rows` is the fallback path.
- Schema inferred from the first row (number vs string) unless `props.schema` is supplied,
  mirroring `_infer_type` in `datasource.py`.
- **Cap: 50 rows.** `render_view` returns the full `doc` in its tool result, so inline rows echo
  back into the agent's context on every render. The session's gap tables run 4–12 rows and its
  tasking windows ~27, so 50 is comfortable while keeping docs small.

## 3. Guidance rewrite (`tools_canvas.py`)

### 3a. Amend the inline-rows prohibition — do not delete it

The rule exists to stop bulk retrieved rows being dumped into the spec, defeating the data
plane. It becomes conditional:

> Never inline **retrieved** rows — bulk data stays on the data plane behind a `data://` handle.
> **Do** inline rows you **derived yourself** (gap windows, rankings, computed summaries): they
> have no handle, and they are small.

The retrieved/derived distinction is load-bearing; the 50-row cap is its backstop.

### 3b. `COMPOSITION` → `ANALYSIS PRODUCT`

Today's text is the direct cause of the symptom — *"Hero the primary view: for geospatial rows
render an esri:map as base; for a tabular-only result make the main data-table the base"* — it
says hero **the data**. The replacement says hero **the answer**:

1. The canvas is the deliverable: it must answer the question, not display what was retrieved.
2. `layer:'base'` is the analysis product — a `note` of key judgments and/or a derived table of
   findings — **not** the raw retrieved table.
3. Anything worth writing in a chat answer (judgments, rankings, recommendations, caveats)
   belongs on the canvas as `note` components.
4. Computed tables go in inline `props.rows`; retrieved tables stay bound to handles.
5. Demote source data to `dock`/`tabs`. Do not render a source table merely because it was
   retrieved.
6. Carry caveats and limitations as their own `note` whenever the analysis has them.

Plus a worked briefing example modelled on the fixture: judgments as `base`, gap/tasking table
docked bottom, caveats docked right, suspects + coverage behind a `tabs` rail.

## 4. Changes by file

| File | Change |
|---|---|
| `plugins/gis-canvas/schema/canvas.schema.json` | add `note` to the component type enum |
| `plugins/gis-canvas/validator.py` | `CATALOG["note"]` (`required_props:["body"]`); relax `data-table` `required_bindings:["source"]` to source **or** `props.rows`; enforce the 50-row cap. Also add `STATE_KEYS["note"] = set()` for explicitness — `interaction.py:32` reads `STATE_KEYS.get(type, set())`, so omitting it behaves identically; `note` has no user-owned state either way. |
| `apps/gis-canvas/src/lib/markdown.ts` | new subset renderer |
| `apps/gis-canvas/src/components/molecules/NoteMolecule.tsx` | new |
| `apps/gis-canvas/src/components/registry.tsx` | register `note` |
| `apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx` | inline-rows path |
| `plugins/gis-canvas/tools_canvas.py` | `_CATALOG_HELP` amendment + `ANALYSIS PRODUCT` section + worked example |

The only existing rule SP-A loosens is `data-table`'s required binding. The validator must
still reject a table with **neither** source nor rows, so a malformed spec fails loudly instead
of rendering an empty grid — the exact failure mode that cost a debugging session on 31 Aug.

## 5. Testing

Built on the frozen fixture so no Denodo access is needed.

**Tier 1 — golden-fixture rendering test (offline, deterministic, CI).** Author the target
analysis-product canvas from `analysis-product.md` plus the fixture handles; assert the
validator accepts it and it renders: prose notes, the inline gap/tasking table, source tables
demoted to tabs. This is SP-A's acceptance test and doubles as the executable definition of
"what good looks like".

**Tier 2 — one-turn agent render (verifies the guidance).** Seed a single agent turn with
`analysis-product.md` and the live handle list, asking only for the final canvas. One
`render_view`, ~zero Denodo calls, minutes not hours. Tier 1 cannot verify this, because the
fixture is hand-authored; only Tier 2 shows the planner's behaviour actually changed.

**Unit tests.**

- `markdown.ts` — each construct; plus an explicit test that `<script>alert(1)</script>` renders
  as literal text, not an element.
- `NoteMolecule` — title + body; missing body.
- `DataTableMolecule` — inline rows render; numeric schema inference; `bindings.source` still
  wins when both are present.
- `validator` — `note` requires `body`; `data-table` with neither source nor rows rejected;
  >50 inline rows rejected; `note` passes the JSON schema.
- **Guidance regression** — assert `_CATALOG_HELP` no longer contains the absolute
  "NEVER inline data rows" string, so the contradiction cannot silently return.

No automated test can prove the agent *behaves* differently; that is Tier 2's job.

---

# Backlog

## SP-B — `finding` component

Generic and domain-agnostic, consistent with the codebase's existing stance (base-agnostic C2
shell, domain-agnostic categorical detection):

```
props: {title, priority?: critical|high|medium|low, confidence?: high|moderate|low,
        evidence?: [{label, value}], body?}
```

Renders as a badge-headed card with a key-value evidence block. The 31 Aug gaps map onto it
directly (`priority: 'critical'` for AGNI's 148-day silence; evidence rows for last/first AIS,
duration, MMSI transition, boundary positions).

## SP-C — Drill-through (select + focus)

Clicking a finding highlights its evidence rows **and** moves the map and time-slider to the
gap. Of the three channels this needs, only one exists:

- **Selection — exists.** `SelectionProvider` / `useLinkedSelection`.
- **Map focus — new.** `STATE_KEYS["esri:map"]` already admits `extent`, so the state slot is
  there, but nothing consumes it as an input.
- **Time focus — new, and the existing context points the wrong way.** `TimeExtentContext` is
  publish-only: maps publish their full span and the slider reads it. Requesting a *window*
  needs a second, opposite channel.

Deferred deliberately: it is the largest piece, and it should be designed against a real
findings rail rather than an imagined one.

## Tier 3 test harness — replay DataSource

Every handle stores `meta.prompt` beside its rows, so a `GIS_DATA_SOURCE=replay` could match
incoming prompts against the 38 recordings and replay the whole investigation offline in
seconds. Honest caveat: prompt matching is brittle — a reworded question misses — so it needs
normalized or fuzzy keys. Worth building only if repeated end-to-end runs are expected.

## Risks

- **The agent ignores the new guidance.** Most likely failure. Tier 2 is the detector; the
  `_CATALOG_HELP` contradiction (3a) is the most probable single cause and is fixed first.
- **Markdown subset too thin.** If briefings routinely need links or tables, revisit — tables
  are already covered by inline rows, and links can be added later behind a scheme allowlist.
- **50-row cap too tight** for a large tasking product. Raise deliberately, with the
  context-echo cost in mind; do not remove.
