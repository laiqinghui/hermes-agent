# gis-canvas (Hermes plugin)

Backend for the generative GIS canvas, packaged as a **Hermes plugin** (`register(ctx)` entry point)
so it loads additively with **zero core-registration edits**. Pairs with the `apps/gis-canvas`
frontend.

Status: **Phase 1 (skeleton canvas) implemented** — tools `render_view`/`update_view`/`canvas_get_state`
registered via `register(ctx)`; docs validated against `schema/canvas.schema.json` + catalog and stored
rev-stamped per session. Spec: `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` · Plan:
`apps/gis-canvas/docs/plans/2026-07-02-phase1-skeleton-canvas.md` · Tests: `tests/plugins/gis_canvas/`.
Enable: add `gis-canvas` to `plugins.enabled` in `~/.hermes/config.yaml`.

## What this plugin will register (all additive via PluginContext)
- **Tools** (`ctx.register_tool`): `render_view`, `update_view`, `canvas_get_state`, `data_query`
  — the agent authors/patches the server-side canvas document; results ride the existing
  `tool.complete` event to the frontend (the `close_terminal` precedent). Every write is validated
  against the catalog JSON Schema before it touches the canvas (invalid → structured error back to
  the agent, never a broken render).
- **Hooks** (`ctx.register_hook`): inject the compact `<canvas>` state summary each turn (hybrid
  awareness); handle the inbound `canvas.interaction` (user selection/filter/extent) via
  `pre_gateway_dispatch` if it can short-circuit — otherwise a one-line fenced edit in
  `tui_gateway/server.py`.
- **Data broker**: protocol-agnostic `DataSource` interface → `DataHandle` (kind `service` = native
  ArcGIS FeatureServer URL passthrough; kind `rows` = tabular/GeoJSON cached server-side, TTL'd,
  paged). A2A vs MCP transport to the Enterprise Data Agent is an implementation choice behind the
  interface. Bulk geodata NEVER enters the LLM context — the agent sees only {schema, rowCount,
  sample, handle}.

## Fork discipline
Same as `apps/gis-canvas/README.md`: all code stays in this dir + `apps/gis-canvas/`; never edit
core; commit prefix `gis:`. See that README for remotes/branches/sync.
