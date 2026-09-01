# Backlog — analysis-product canvas (post SP-A)

SP-A shipped and merged to `gis/main` on 2026-09-01 (21 commits, tip `910ad0baf`).
Everything below was deliberately deferred, not forgotten.

Design: `apps/gis-canvas/docs/2026-08-31-analysis-product-canvas-design.md`
Plan (SP-A, done): `apps/gis-canvas/docs/plans/2026-08-31-analysis-product-canvas-sp-a.md`
Demo/regression check: `apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md`

---

## SP-B — the `finding` component

A generic, domain-agnostic finding, consistent with the codebase's existing stance
(base-agnostic C2 shell, domain-agnostic categorical detection):

```
props: {title, priority?: critical|high|medium|low, confidence?: high|moderate|low,
        evidence?: [{label, value}], body?}
```

**What the 2026-09-01 live run changed about this.** When SP-A shipped, the agent —
given no layout instruction — expressed its findings as an **inline `props.rows`
table** with columns it invented: `rank, vessel, imo, gap_start_utc, gap_end_utc,
duration_days, mmsi_change, identity_note, primary_sensor, secondary_sensor,
tasking_focus`. That is a real, working answer to the same problem.

So the open question is no longer "what should a finding look like" but **"is a
dedicated component better than the table the agent already produces?"** Reasons it
might be: badges scan faster than a `mmsi_change` column; a table row cannot carry
prose; and SP-C needs a per-finding click target. Reasons it might not: the table is
sortable, compact, and cost nothing to build.

**Recommendation:** before building, re-run the demo and look at the rendered table.
Decide from a real artifact rather than the spec's guess.

---

## SP-C — drill-through (select + focus)

Clicking a finding should highlight its evidence rows **and** move the map and
time-slider to the gap. Of the three channels this needs, only one exists:

| Channel | State |
|---|---|
| Selection | **exists** — `SelectionProvider` / `useLinkedSelection` |
| Map focus | **missing** — `STATE_KEYS["esri:map"]` already admits `extent`, so the state slot is there, but nothing consumes it as an *input* |
| Time focus | **missing, and the existing context points the wrong way** — `TimeExtentContext` is publish-only: maps publish their full span, the slider reads it. Requesting a *window* needs a second, opposite channel. |

Largest remaining piece. Depends on SP-B (or on whatever finally serves as the
per-finding click target).

---

## Small defects — worth one focused batch

1. **Dead checkboxes on inline tables.** `DataTableMolecule.tsx:203` renders the
   selection checkbox column unconditionally, but an inline table has no source, so
   `useLinkedSelection('')` is inert (`SelectionContext.tsx:41`). Every
   agent-computed table — including the demo's — shows checkboxes that cannot do
   anything. Fix: hide the column when there is no source, or key inline selection
   off `node.id`.
2. **`auto-shell` does not know `note`.** `ROLE_EDGE` in `auto-shell.ts` has no
   `note` entry, so `edgeForType('note')` falls through to `'bottom'` — the same rail
   as `data-table` — and `dockRect` does not tile same-edge docks, so they would land
   on identical rects. Only reachable when the agent sets no layers. One-line fix
   (`note: 'left'`, as `card` has).
3. **Broker store is unbounded.** The sliding TTL in `broker.py` prunes only on a
   read that finds a handle expired, so handles for canvases nobody reopens
   accumulate indefinitely — and they hold real Denodo result rows (232 files on the
   dev machine at time of writing). Wants a sweeper, or an explicit note that the
   store is unbounded.

---

## Polish — verified harmless, none block anything

- `markdown.ts` `INLINE`: the bold branch allows newlines (`[^*]+`), the italic
  branch does not (`[^*\n]*?`). Unreachable today — `renderMarkdown` pre-joins
  paragraphs with `' '` — but both functions are exported, so a future direct
  multi-line caller would see the asymmetry.
- No explicit test that link/image syntax (`[text](url)`) passes through as literal
  text. True incidentally (no parsing code exists); an explicit test would make the
  stated "no links" security property regression-proof.
- `NoteMolecule.test.tsx` "renders without a title" asserts the body is present but
  not that the title bar is absent.
- Backend non-list-`rows` tests cover `str` and `dict` only; `int`/`bool`/`float`
  take the identical `isinstance` branch untested.
- The non-list-`rows` validator branch fires even when `bindings.source` is present,
  flagging a prop that would never be read. Defensible for model-authored specs.
- `test_validator.py:64` `test_data_table_requires_source_binding` is now a
  misleading name — the rule is source-OR-rows. Still tests the real "neither"
  rejection.
- No test covers `bindings.source = mock://` together with `props.rows`; the
  "bindings wins" guarantee is directly tested only for the `data://` branch.
- `MAX_INLINE_ROWS` is per-component, not per-document, so N inline tables echo
  N×50 rows back into agent context on every render.

---

## Optional — Tier-3 replay DataSource

Every broker handle stores `meta.prompt` beside its rows, so a
`GIS_DATA_SOURCE=replay` could match incoming prompts against the 38 frozen
recordings and replay the whole investigation offline in seconds. Caveat: prompt
matching is brittle — a reworded question misses — so it needs normalized or fuzzy
keys. Worth building only if repeated end-to-end runs are expected;
`scripts/gis_canvas_demo.py` already covers the common case.

---

## Not a development task

`gis/main` is **21 commits ahead of `origin/gis/main`** — SP-A and everything above
is merged locally but **unpushed**. The frozen fixture contains interpretive work
product (shadow-fleet suspicion, imagery tasking windows) over public AIS data, so
pushing is a deliberate call.
