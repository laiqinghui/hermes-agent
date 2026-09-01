# Fixture — 31 Aug 2026 shadow-fleet AIS-gap session

A frozen capture of one real GIS-canvas investigation, kept so the analysis-product work can
be tested **without re-running a ~2h Denodo investigation**. The expensive part of that
session was the investigation (dozens of 75–115s Denodo round-trips); rendering a canvas from
its results is a single `render_view` call. These artifacts let us replay the second part
alone.

Snapshotted on 2026-08-31 because broker handles expire (24h TTL) — the live copies under
`~/.hermes/gis_canvas_data/` would have been swept on 01 Sep.

## Contents

| Path | What it is |
|---|---|
| `handles/*.json` | 38 broker payloads (`{schema, rows, meta.prompt}`) — every `data_query` of the session, 165 rows total |
| `handles-manifest.json` | Index: handle → mint time, rowCount, columns, originating prompt. Reconstructs the investigation timeline. |
| `canvas-doc-before.json` | The persisted canvas doc the session actually produced |
| `render-spec-before.json` | The `render_view` spec of that canvas — the "source-data review" failure mode |
| `analysis-product.md` | The agent's own final answer — judgments, gap tables, tasking windows, prioritization, caveats. The **target content**. |

## Why it exists

`render-spec-before.json` and `analysis-product.md` are the *same session*. The agent produced
a full intelligence product, then rendered a canvas showing only the source tables it had
retrieved — because no component could hold prose or agent-computed rows. The gap between
those two files is exactly the problem the analysis-product work closes.

Note `render-spec-before.json` binds `data://73d41e22` and `data://43387491`, which are **not**
in `handles/` — they were destroyed by the pre-fix 1h TTL before this snapshot. Equivalent
data from earlier in the same session survives: `f4e4262d` (suspects, 4 rows) and `6f46982c`
(coverage, 4 rows). Treat `6f46982c` with care: it was captured before the multi-block CSV
parser fix and carries the *shadow-fleet* schema rather than coverage columns.

## Use

- **Golden-fixture rendering test (offline, CI):** author the target canvas from
  `analysis-product.md` + these handles; assert the validator accepts it and it renders.
- **One-turn agent render:** seed an agent turn with `analysis-product.md` and the handle list,
  and ask only for the final canvas — verifies the guidance change with ~zero Denodo calls.
- Handle payloads are also a ready corpus of real Denodo shapes (aggregates, 1-row boundary
  queries, monthly rollups) for parser and table tests.

## Provenance / sensitivity

Derived from a Denodo demo platform over public AIS sources (NOAA / MPA) and public sanctions
lists. The *analysis* — shadow-fleet suspicion and imagery tasking recommendations — is
interpretive work product, so treat this directory as internal to the repo and do not
republish it outside.

## Running the demo

Full procedure, including how to start each service and how to revert afterwards:
**`apps/gis-canvas/docs/RUNBOOK-shadow-fleet-demo.md`**. Quick version:

The broker expires handles after 24h, so the demo self-destructs unless the cache is
re-seeded. `scripts/gis_canvas_demo.py` restores every handle here into
`~/.hermes/gis_canvas_data/` with a fresh mtime, preserving handle ids so the prompt's
`data://f4e4262d` etc. keep resolving:

```bash
python scripts/gis_canvas_demo.py           # restore + print the prompt
python scripts/gis_canvas_demo.py --check   # status only; exit 1 if the demo is broken
```

Then paste `demo-prompt.md` into the canvas chat. The analysis travels in the prompt, so
the turn costs one `render_view` and no Denodo round-trips.

Requires the gateway running with `GIS_DATA_SOURCE=a2a` (it never queries Denodo, but the
plugin must be loaded), and the SPA on `:5174`.

## Related

Design: `apps/gis-canvas/docs/2026-08-31-analysis-product-canvas-design.md`
