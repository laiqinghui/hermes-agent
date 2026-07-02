# GIS Generative Canvas on Hermes — Onboarding / Machine Hand-off

This is a **fork of Hermes Agent** (`NousResearch/hermes-agent`) that adds a GIS-focused generative-UI
"canvas": the Hermes agent declaratively authors a dashboard (map + tables + controls) that a web
frontend renders. Everything project-specific lives in **`apps/gis-canvas/`** (frontend) and
**`plugins/gis-canvas/`** (backend Hermes plugin), plus **one** fenced line-block in
`tui_gateway/server.py`. This doc gets a fresh machine (macOS or Windows) productive and hands off to
Claude Code.

## Current state
- **Phase 1 (skeleton canvas)** and **Phase 2 (interaction loop)** are DONE, live-e2e-verified, and
  final-reviewed clean. **Phase 3 (ESRI map + Calcite theming)** is next.
- Design spec: `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` (see §18 for the Phase-3
  backlog). Plans: `apps/gis-canvas/docs/plans/2026-07-02-phase1-skeleton-canvas.md`,
  `…/2026-07-02-phase2-interaction-loop.md`.

## Repo / branch / remotes
- **`origin`** = `https://github.com/laiqinghui/hermes-agent` (your fork). **`upstream`** =
  `NousResearch/hermes-agent` (fetch-only; push disabled).
- **`gis/main`** = the long-lived integration/product branch — all work lives here. **`main`** = pristine
  mirror of `upstream/main` (never commit to it).
- **Fork discipline:** all code stays in `apps/gis-canvas/` + `plugins/gis-canvas/`; the ONLY core edit is a
  comment-fenced `@method("canvas.interaction")` in `tui_gateway/server.py`. Commit prefix `gis:`. Pin
  frontend deps in `apps/gis-canvas/package.json`, never root.
- **Upstream sync (weekly-ish; upstream moves ~110 commits/day):**
  `git fetch upstream && git checkout main && git merge --ff-only upstream/main && git push origin main &&
  git checkout gis/main && git merge main` (merge, never rebase the long-lived branch).

---

## Setup on a NEW machine

### 0. Prereqs
- Git, Node.js 20+ (npm workspaces), Python 3.11, and Claude Code.
- A Hermes install (the official installer) — the frontend talks to a running Hermes **gateway**.

### 1. Clone the fork + get on the branch
```bash
git clone https://github.com/laiqinghui/hermes-agent
cd hermes-agent
git remote add upstream https://github.com/NousResearch/hermes-agent && git remote set-url --push upstream DISABLED
git checkout gis/main
```

### 2. Install Hermes, then point it at THIS repo
The gateway must run *our* code (it has `canvas.interaction` + the plugin). We do this by editable-installing
this repo into the Hermes install's venv (reuses its full dependency set — fast, no heavy re-download).

**macOS / Linux** (official install → `~/.hermes/hermes-agent/venv`):
```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash   # if not already installed
~/.hermes/hermes-agent/venv/bin/python -m pip install -e "$PWD" --no-deps
# enable the plugin (bundled from this repo):
#   add to ~/.hermes/config.yaml:
#     plugins:
#       enabled:
#         - gis-canvas
```

**Windows (native, PowerShell)** — install lives under `%LOCALAPPDATA%\hermes`:
```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)   # if not already installed
# editable-install this repo into Hermes's venv (adjust the venv path if the installer differs):
& "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\python.exe" -m pip install -e "$PWD" --no-deps
# enable the plugin: add `gis-canvas` under `plugins.enabled:` in the Hermes config
#   (native Windows config is under %LOCALAPPDATA%\hermes\config.yaml)
```
> Verify the gateway now runs our code (from a dir OUTSIDE the repo, so cwd doesn't shadow imports):
> `python -c "import tui_gateway.server as s; print('canvas.interaction' in open(s.__file__).read())"` → `True`.
> Do NOT add the old `~/.hermes/plugins/gis-canvas` symlink — the editable install makes the repo's
> `plugins/gis-canvas` load as the **bundled** plugin (single source). Revert the repoint anytime with
> `pip install -e <hermes-install-dir>`.

### 3. Frontend + Python test env
```bash
npm install                                   # workspace install (root)
# python test venv (backend plugin tests):
python3.11 -m venv .venv && .venv/bin/pip install pytest jsonschema pyyaml   # macOS/Linux
#   Windows: py -3.11 -m venv .venv ; .venv\Scripts\pip install pytest jsonschema pyyaml
```

### 4. Claude Code hand-off (context7 for library docs)
context7 (used to pull ArcGIS/shadcn docs during planning) is configured per-machine, not in the repo. Re-add it:
```bash
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
```
Then open this ONBOARDING's share link (see below) in Claude Code on the new machine to resume with full context.

---

## Run it / test in the browser

**1. Start the Hermes gateway (dashboard) with a pinned dev token:**
```bash
# macOS/Linux
HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119
```
```powershell
# Windows PowerShell
$env:HERMES_DASHBOARD_SESSION_TOKEN="dev-gis-local"; hermes dashboard --no-open --port 9119
```
Wait for `HERMES_DASHBOARD_READY port=9119`. Confirm the plugin: `hermes plugins list` shows `gis-canvas` enabled.

**2. Start the frontend dev server (separate terminal):**
```bash
# macOS/Linux
cd apps/gis-canvas && VITE_HERMES_TOKEN=dev-gis-local npm run dev
```
```powershell
# Windows PowerShell
cd apps/gis-canvas ; $env:VITE_HERMES_TOKEN="dev-gis-local"; npm run dev
```
Open the printed URL (default http://localhost:5173). You should see "Agent ● connected".

**3. Sample prompts** (type in the chat panel):
- Build: `Build a dashboard: two stats — high-severity incidents (42) and total incidents (1240) — and a card titled "Incidents" with a data-table bound to mock://incidents.`
- Interactive: `Add a severity filter: a select (field severity, options all/high/med/low) that reactively filters the incidents table by severity.`
  → then change the select in the UI: the table filters **client-side, no agent turn**.
- Selection + awareness: tick a few table checkboxes, then ask `How many rows are selected in the incidents table right now?` → the agent answers from the live canvas state (via the awareness hook).
- Patch: `Change the high-severity stat to 57.` → the agent patches the canvas (update_view).

> Data is currently **mock** (`mock://incidents`, `mock://districts`, resolved client-side). Real data
> (Enterprise Data Agent via A2A) + the ESRI map arrive in later phases.

**Tests:** backend `\.venv/bin/pytest tests/plugins/gis_canvas` · frontend `npm run -w @hermes/gis-canvas test` · build `npm run -w @hermes/gis-canvas build`.

---

## Critical gotchas (learned the hard way — see project memory too)
- **Canvas session key = `stored_session_id`.** `session.create` returns both `session_id` (live 8-hex) and
  `stored_session_id` (timestamped). The agent/tools/awareness-hook key the canvas doc by
  `stored_session_id`. The frontend sends `stored_session_id` in `canvas.interaction` but the live
  `session_id` in `prompt.submit`. Don't conflate them.
- **Plugin import path is `hermes_plugins.gis_canvas`** (loader slug = key with `-`→`_`), NOT
  `plugins.gis_canvas`. The `@method` in `server.py` imports `hermes_plugins.gis_canvas.wire`.
- **Always run the live browser e2e**, not just unit tests: unit tests load the plugin via a different path
  and missed 5 live-only bugs in Phase 2 (import path, schema forbidding `handlers`, frontend session-key,
  select object-options, tool-desc gaps).
- **Do NOT change the Hermes model.** It's `gpt-5.4` via `openai-codex` — leave as-is.
