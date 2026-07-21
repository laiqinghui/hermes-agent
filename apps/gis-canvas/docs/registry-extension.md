# Adding a molecule type to the GIS canvas registry

A molecule `type` is declared in several places that MUST stay in sync. Follow
these steps in order; the `tabs` molecule (2026-07-21) is the reference example.

1. **Schema enum** — add the type to the `type` enum in
   `plugins/gis-canvas/schema/canvas.schema.json`.
2. **TS mirror** — add it to `MOLECULE_TYPES` in
   `apps/gis-canvas/src/lib/types.ts`.
3. **Validator** — add a `CATALOG` entry in `plugins/gis-canvas/validator.py`
   (`container`, `slots`, optional `dynamic_slots`, `required_props`,
   `required_bindings`) and, if it carries live state, a `STATE_KEYS` entry.
   Add any per-type rule alongside the existing slot/area checks.
4. **Registry** — map `type -> component` in
   `apps/gis-canvas/src/components/registry.tsx` (lazy-wrap heavy/ESRI molecules).
5. **Agent catalog** — describe the type + one example in `_CATALOG_HELP` in
   `plugins/gis-canvas/tools_canvas.py`. The agent only knows types documented here.
6. **Component** — implement the molecule in
   `apps/gis-canvas/src/components/molecules/`, composing `../ui/` primitives
   (which are styled on gc- utilities — see `src/components/ui/README.md`).
7. **Tests** — a registry render/behavior test (FE) and validator accept/reject
   tests (Python); add a `render_view` acceptance test for the tool path.
8. **Awareness** — if the type carries live state, format it in `_fmt_state` in
   `plugins/gis-canvas/awareness.py` so the agent sees it each turn.

## Slot models

- **Fixed slots** (e.g. `card` → `{content, footer}`): list them in the
  `CATALOG` entry's `slots` set.
- **Dynamic slots** (e.g. `tabs`): set `dynamic_slots: True` and drive valid slot
  names from props — the validator asserts slot keys are a subset of the
  data-declared ids (for `tabs`, `props.tabs[].id`).
