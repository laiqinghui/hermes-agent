# gis-canvas (frontend)

Generative GIS **canvas** frontend for Hermes — a single grid canvas the Hermes agent fills
declaratively from a whitelisted component catalog (shadcn molecules + ESRI ArcGIS map/table/legend).
This is a standalone workspace app (sibling to `apps/desktop`) that connects to the Hermes **gateway**
over the existing WebSocket + JSON-RPC transport. Canvas = session (single-user, single-client,
reconnectable).

Status: **Phase 3 (ESRI GIS layer) implemented & verified.** Phase 1 (declarative canvas) + Phase 2 (interaction loop) + Phase 3 (ESRI `esri:map` / `esri:legend` / `esri:feature-table`; client-side FeatureLayer from mock geo rows + public FeatureServer service URL; keyless OpenStreetMap basemap by default, optional `VITE_ARCGIS_API_KEY` for premium basemaps; Calcite→shadcn theming). Spec: `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` (see §9, §18, §19) · Plans under `apps/gis-canvas/docs/plans/`.

Run it:
- **Gateway**: `HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119` (enable `gis-canvas` plugin in `~/.hermes/config.yaml` under `plugins.enabled`).
- **Frontend (map needs preview)**: `VITE_HERMES_TOKEN=dev-gis-local npm run -w @hermes/gis-canvas build && (cd apps/gis-canvas && npx vite preview --port 5174 --host 127.0.0.1)` → open http://localhost:5174.
- **Note**: `npm run dev` still works for non-map components (Phases 1–2); only the ESRI map needs the preview build (see spec §19).
- **Tests** — Backend: `.venv/bin/pytest tests/plugins/gis_canvas` (or `uv run pytest tests/plugins/gis_canvas`). Frontend: `npm run -w @hermes/gis-canvas test`.

## Fork discipline (READ BEFORE EDITING)

This is a **monorepo fork** of `NousResearch/hermes-agent`, which merges upstream ~weekly
(upstream moves ~110 commits/day). To keep merges conflict-free:

1. **All GIS code lives in `apps/gis-canvas/` and `plugins/gis-canvas/` only.** Never edit Hermes
   core files. New paths never conflict on merge.
2. If a core edit ever becomes unavoidable (e.g. an inbound gateway JSON-RPC method that the
   `pre_gateway_dispatch` hook can't handle), keep it to a **single comment-fenced line**:
   `# >>> gis-canvas <<<` … `# <<< gis-canvas >>>`.
3. **Pin ArcGIS / TanStack / shadcn deps in this app's `package.json`, never the root.**
4. **Prefix every commit `gis:`** so our history stays filterable and extractable.

## Remotes / branches
- `upstream` = NousResearch/hermes-agent (fetch only; push disabled)
- `origin` = laiqinghui/hermes-agent (our fork)
- `main` = pristine mirror of `upstream/main` (never commit here)
- `gis/main` = integration branch (all GIS work); feature branches `gis/<feature>` off it
- Weekly sync: `git fetch upstream && git checkout main && git merge --ff-only upstream/main &&
  git push origin main && git checkout gis/main && git merge main`

## Planned stack (see spec)
React 19 + Vite + Tailwind + shadcn/ui + `@arcgis/map-components` (+ `@arcgis/core`, lazy-loaded).
Calcite design tokens themed to match shadcn. Built with the `ui-ux-pro-max` skills.
