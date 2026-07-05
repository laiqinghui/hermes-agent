# GIS Generative Canvas on Hermes — Onboarding / Machine Hand-off

This is a **fork of Hermes Agent** (`NousResearch/hermes-agent`) that adds a GIS-focused generative-UI
"canvas": the Hermes agent declaratively authors a dashboard (map + tables + controls) that a web
frontend renders, and pulls real data from an Enterprise **Data Agent** over the **A2A** protocol,
brokered server-side so bulk rows never enter the LLM context. Everything project-specific lives in
**`apps/gis-canvas/`** (frontend) and **`plugins/gis-canvas/`** (backend Hermes plugin), plus **one**
comment-fenced block in `tui_gateway/server.py`. This doc gets a fresh machine (macOS or Windows)
productive and hands off to Claude Code.

> **Claude Code, start here:** read this whole file, then `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md`
> (the design spec — §8 data broker, §9 GIS layer, §13 phasing, §19 run notes) and the newest plan under
> `apps/gis-canvas/docs/plans/`. The prior machine's Claude memory does NOT travel — this doc + the
> committed docs are the source of truth.

## Current state (as of Phase 4a)
- **Phases 1–4a are DONE, live-e2e-verified, final-reviewed clean.**
  - **P1 skeleton canvas**, **P2 interaction loop**, **P3 ESRI map + Calcite theming**,
    **P4a data broker + A2A data flow** (sandbox-backed, no auth).
- **Next: Phase 4b** — real OIDC/Keycloak auth (BFF) + live Denodo Data Agent. **Blocked on infra access**
  (Keycloak + Denodo not available yet). The auth-header seam is already in place, so 4b drops in without a
  refactor. **Until infra lands, all further functional iteration runs on mock/sandbox — 4b is the only
  infra-blocked work.** Post-4b roadmap = Phase 5 (harden) + catalog/GIS-depth backlog (see design spec).
- Tests green: **backend 92** (`tests/plugins/gis_canvas`), **frontend 49** (`@hermes/gis-canvas`).
- Plans: `apps/gis-canvas/docs/plans/` — newest is `2026-07-04-phase4a-data-broker.md`.

## Repo / branch / remotes
- **`origin`** = `https://github.com/laiqinghui/hermes-agent` (your fork). **`upstream`** =
  `NousResearch/hermes-agent` (fetch-only; push disabled).
- **`gis/main`** = the long-lived integration/product branch — all work lives here. **`main`** = pristine
  mirror of `upstream/main` (never commit to it).
- **Fork discipline:** all code stays in `apps/gis-canvas/` + `plugins/gis-canvas/`; the ONLY core edit is a
  comment-fenced block in `tui_gateway/server.py` (`# >>> gis-canvas … <<<`) registering
  `@method("canvas.interaction")` and `@method("canvas.data_fetch")`. Commit prefix `gis:`, trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Pin frontend deps in
  `apps/gis-canvas/package.json`, never root.
- **Never `git add -A`:** unrelated foreign changes may sit in `web/`. Stage explicit paths only.
- **Upstream sync (weekly-ish; upstream moves ~110 commits/day):**
  `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main &&
  git checkout gis/main && git merge main` (merge, never rebase the long-lived branch).

---

## Setup on a NEW machine

### 0. Prereqs
- Git, Node.js 20+ (npm workspaces), Python 3.11, Claude Code.
- A Hermes install (official installer) — the frontend talks to a running Hermes **gateway**.
- **Docker Desktop** (for the Data Agent sandbox — Phase 4a data flow; see "Data Agent sandbox" below).

### 1. Clone the fork + get on the branch
```bash
git clone https://github.com/laiqinghui/hermes-agent
cd hermes-agent
git remote add upstream https://github.com/NousResearch/hermes-agent && git remote set-url --push upstream DISABLED
git checkout gis/main
```

### 2. Install Hermes, then point it at THIS repo
The gateway must run *our* code (it has `canvas.interaction` + `canvas.data_fetch` + the plugin). We do this
by editable-installing this repo into the Hermes install's venv (reuses its full dependency set — fast, no
heavy re-download).

**macOS / Linux** (official install → `~/.hermes/hermes-agent/venv`):
```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash   # if not already installed
~/.hermes/hermes-agent/venv/bin/python -m pip install -e "$PWD" --no-deps
# enable the plugin (bundled from this repo): add to ~/.hermes/config.yaml:
#   plugins:
#     enabled:
#       - gis-canvas
```

**Windows (native, PowerShell)** — install lives under `%LOCALAPPDATA%\hermes` (adjust if your installer differs):
```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)   # if not already installed
& "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\python.exe" -m pip install -e "$PWD" --no-deps
# enable the plugin: add `gis-canvas` under `plugins.enabled:` in %LOCALAPPDATA%\hermes\config.yaml
```
> Verify the gateway now runs our code (from a dir OUTSIDE the repo, so cwd doesn't shadow imports):
> `python -c "import tui_gateway.server as s; print('canvas.data_fetch' in open(s.__file__).read())"` → `True`.
> Do NOT add an old `~/.hermes/plugins/gis-canvas` symlink — the editable install makes the repo's
> `plugins/gis-canvas` load as the **bundled** plugin (single source). Revert the repoint anytime with
> `pip install -e <hermes-install-dir>`.

### 3. Frontend + Python test env
```bash
npm install                                   # workspace install (root) — installs devDeps too
# python test venv (backend plugin tests):
python3.11 -m venv .venv && .venv/bin/pip install pytest jsonschema pyyaml httpx     # macOS/Linux
#   Windows: py -3.11 -m venv .venv ; .venv\Scripts\pip install pytest jsonschema pyyaml httpx
```
`httpx` is needed for the live A2A sandbox test (it skips cleanly if the sandbox is down).

### 4. Claude Code hand-off (context7 for library docs)
context7 (used to pull ArcGIS/shadcn docs during planning) is configured per-machine, not in the repo. Re-add:
```bash
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
```

---

## Data Agent sandbox (Phase 4a data flow)
The data broker talks to a **Data Agent** over A2A (JSON-RPC `message/stream`, NDJSON) on **:2024**. For
local dev without Keycloak/Denodo, run the vendor's **sandbox** image (a separate deliverable — see the Data
Agent's `SANDBOX_MODE.md` + `docker-compose.yaml`; it accepts any non-empty Bearer token):
```bash
docker compose up            # sandbox on http://localhost:2024  (agent-card at /.well-known/agent-card.json)
```
> **Caveat (verified):** the sandbox `retrieve` scenario emits dataset *metadata* + text, **not** a
> structured `query_result` rows DataPart. So the sandbox proves the A2A protocol; the **rows→map/table
> render** path is driven by the built-in **`MockDataSource`** (geo rows). Two data-source modes, chosen by
> the `GIS_DATA_SOURCE` env on the gateway: `mock` (default — real rows render) or `a2a` (live adapter).

---

## Run it / test in the browser

There are **two run modes**. The **map + data plane needs the PRODUCTION PREVIEW** — `@arcgis/core` trips
Vite's dev-server transform (design spec §19). Non-map Phase 1/2 components work under `npm run dev`.

**1. Start the Hermes gateway (dashboard) with a pinned dev token + data-source mode:**
```bash
# macOS/Linux — mock rows (default render path):
HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119
# …or route data_discover/data_query through the live sandbox adapter:
HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local GIS_DATA_SOURCE=a2a DATA_AGENT_URL=http://localhost:2024 \
  DATA_AGENT_AUTH_TOKEN=sandbox-test-token hermes dashboard --no-open --port 9119
```
```powershell
# Windows PowerShell (mock):
$env:HERMES_DASHBOARD_SESSION_TOKEN="dev-gis-local"; hermes dashboard --no-open --port 9119
# Windows PowerShell (a2a): set $env:GIS_DATA_SOURCE="a2a"; $env:DATA_AGENT_URL="http://localhost:2024";
#   $env:DATA_AGENT_AUTH_TOKEN="sandbox-test-token" first, then the dashboard line above.
```
Startup takes ~15s (it rebuilds its built-in web UI first) and logs `HERMES_DASHBOARD_READY port=9119`.
Confirm the plugin: `hermes plugins list` shows `gis-canvas`.

> ⚠️ **GOTCHA — run `npm install` AFTER starting the dashboard once.** `hermes dashboard` startup rebuilds
> its built-in web UI and in doing so **prunes root devDependencies** (e.g. `@testing-library/jest-dom`).
> The next `npm run -w @hermes/gis-canvas build` then fails `tsc` with `TS2688 Cannot find type definition
> file for '@testing-library/jest-dom'`. Fix: `npm install` at the repo root to restore devDeps.

**2a. Non-map (Phase 1/2) — dev server is fine:**
```bash
cd apps/gis-canvas && VITE_HERMES_TOKEN=dev-gis-local npm run dev     # http://localhost:5173
```

**2b. Map + data plane (Phase 3/4a) — PRODUCTION PREVIEW (required for the map):**
```bash
# macOS/Linux
VITE_HERMES_TOKEN=dev-gis-local npm run -w @hermes/gis-canvas build \
  && (cd apps/gis-canvas && npx vite preview --port 5174 --host 127.0.0.1)
```
```powershell
# Windows PowerShell
$env:VITE_HERMES_TOKEN="dev-gis-local"; npm run -w "@hermes/gis-canvas" build
cd apps/gis-canvas ; npx vite preview --port 5174 --host 127.0.0.1
```
Open http://localhost:5174 → "Agent ● connected". (No ArcGIS key needed — keyless OSM basemap; set
`VITE_ARCGIS_API_KEY` before the build for premium `arcgis/*` basemaps.)

**3. Sample prompts** (type in the chat panel):
- **Phase 1/2 dashboard:** `Build a dashboard: two stats — high-severity (42) and total incidents (1240) — and a card titled "Incidents" with a data-table bound to mock://incidents.`
- **Reactive filter (no agent turn):** `Add a severity filter select (field severity, options all/high/med/low) that reactively filters the incidents table.` → change the select → table filters client-side.
- **Awareness:** tick a few table checkboxes, then ask `How many rows are selected right now?`
- **Phase 3 map:** `Plot the incidents on a map with a legend.` → click a point → it registers as `state.selection`.
- **Phase 4a data flow:** `Discover what datasets are available.` (→ `data_discover`), then
  `Retrieve the incidents and show them in a data-table and on a map.` (→ `data_query` returns a `data://`
  handle → bound into components → browser pulls rows via `canvas.data_fetch`).

**Tests:**
```
# backend (from repo root):
.venv/bin/pytest tests/plugins/gis_canvas -q          # (Windows: .venv\Scripts\pytest ...)
# frontend:
npm run -w @hermes/gis-canvas test                     # vitest
npm run -w @hermes/gis-canvas build                    # tsc + vite (typecheck)
```
The live A2A test `tests/plugins/gis_canvas/test_a2a_sandbox.py` runs against the sandbox on :2024 and
**skips** if it's down.

---

## Critical gotchas (learned the hard way)
- **Canvas session key = `stored_session_id`.** `session.create` returns both `session_id` (live 8-hex) and
  `stored_session_id` (timestamped). Tools/hook/broker key the canvas doc by `stored_session_id`. The
  frontend sends `stored_session_id` in `canvas.interaction`, the live `session_id` in `prompt.submit`.
- **Plugin import path is `hermes_plugins.gis_canvas`** (loader slug = key with `-`→`_`), NOT
  `plugins.gis_canvas`. The `@method`s in `server.py` import `hermes_plugins.gis_canvas.wire`.
- **The broker is disk-backed** (one JSON per `data://` handle under `HERMES_GIS_DATA_DIR`, default
  `~/.hermes/gis_canvas_data`) — on purpose, because `data_query` (tool context) and `canvas.data_fetch`
  (gateway context) can run in different processes. Same rationale as the canvas doc `store.py`.
- **Map needs the production preview, not `npm run dev`** (`@arcgis/core` + Vite dev; spec §19).
- **`hermes dashboard` prunes root devDeps** → `npm install` after (see the ⚠️ above).
- **Always run the live browser e2e**, not just unit tests: unit tests load the plugin via a different path
  and missed 5 live-only bugs in Phase 2 (import path, schema forbidding `handlers`, frontend session-key,
  select object-options, tool-desc gaps). Playwright e2e scripts are throwaway (regenerate in a scratch dir;
  they connect to `ws://127.0.0.1:9119/api/ws?token=dev-gis-local` and drive the preview on :5174).
- **The §14 data invariant:** `data_query`'s agent-visible result is only `{handle, schema, rowCount,
  sample≤3}` — never bulk rows. Rows live only on the data plane (broker ↔ browser).
- **Do NOT change the Hermes model.** It's `gpt-5.4` via `openai-codex` — leave as-is.
