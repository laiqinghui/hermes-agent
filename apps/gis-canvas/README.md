# gis-canvas (frontend)

Generative GIS **canvas** frontend for Hermes — a single grid canvas the Hermes agent fills
declaratively from a whitelisted component catalog (shadcn molecules + ESRI ArcGIS map/table/legend).
This is a standalone workspace app (sibling to `apps/desktop`) that connects to the Hermes **gateway**
over the existing WebSocket + JSON-RPC transport. Canvas = session (single-user, single-client,
reconnectable).

Status: **Phase 1 (skeleton canvas) implemented.** Spec:
`apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` · Plan:
`apps/gis-canvas/docs/plans/2026-07-02-phase1-skeleton-canvas.md`

Run it: `HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119`,
then `cd apps/gis-canvas && VITE_HERMES_TOKEN=dev-gis-local npm run dev` → http://localhost:5173.
Enable the plugin first: add `gis-canvas` to `plugins.enabled` in `~/.hermes/config.yaml`.
Backend tests: `.venv/bin/pytest tests/plugins/gis_canvas` (or `uv run pytest tests/plugins/gis_canvas`).
Frontend: `npm run -w @hermes/gis-canvas test`.

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
