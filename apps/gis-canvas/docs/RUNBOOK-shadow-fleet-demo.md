# Runbook — shadow-fleet analysis-product demo

How to run the GIS-canvas demo, and how to put the machine back afterwards.

The demo renders a finished intelligence product — key judgments, a computed AIS-gap
tasking table, caveats, with source data demoted to a rail — from one agent turn. **It
makes no Denodo queries**: the analysis travels in the prompt and the data handles are
restored from a frozen fixture. A run costs one `render_view`, about a minute.

It doubles as the regression check for the `render_view` agent guidance: if a future
change makes the agent hero source data again instead of the analysis, this is what
catches it.

- Prompt: `tests/fixtures/gis-canvas/session-2026-08-31/demo-prompt.md`
- Data: `tests/fixtures/gis-canvas/session-2026-08-31/handles/` (38 handles, 165 rows)
- Restore script: `scripts/gis_canvas_demo.py`
- Background: `apps/gis-canvas/docs/2026-08-31-analysis-product-canvas-design.md`

---

> **Interpreter.** `python` on PATH (3.13) runs the demo script fine — it is stdlib-only.
> The repo's own venv, `.\.venv\Scripts\python.exe` (3.11), also works and is what the test
> suites use. Note `python3` is **not** available on this machine; it hits the Microsoft
> Store shim.

---

## 1. Preflight

```bash
python scripts/gis_canvas_demo.py --check
```

Exits non-zero if the demo would be broken. Handles expire after 24h, so expect
`EXPIRED` or `MISSING` unless you ran it recently — that is normal, step 3 fixes it.

Ports (all on localhost):

| Port | Service | Needed for |
|---|---|---|
| 9109 | gis-canvas BFF | SPA auth; the demo makes no calls through it, but the SPA needs a session |
| 9119 | Hermes gateway | loads the `gis-canvas` plugin; serves the canvas over WS |
| 5174 | gis-canvas SPA | the canvas UI (strict port — BFF redirect/CORS are pinned to it) |
| 8080 | Keycloak (WSL/docker) | login |

```powershell
foreach ($p in 9109,9119,5174,8080) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { "$p UP" } else { "$p down" } }
```

Denodo (`:2024`) and the AI SDK container are **not** required.

---

## 2. Start anything that is down

Order matters only in that the gateway should come up before you load the SPA.

**BFF (`:9109`)** — reads its own `apps/gis-canvas-bff/.env`:

```powershell
Set-Location C:\workspace\analyst\hermes-agent\apps\gis-canvas-bff
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 9109
```

Healthy when `GET /auth/me` returns **401** (not a connection error) before you log in.

**Gateway (`:9119`)** — must be launched from **PowerShell**. Setting the env vars in bash
and backgrounding the child does not propagate `GIS_BFF_PROXY_SECRET`, and the BFF then
403s every proxy call:

```powershell
$secret = (Get-Content 'C:\workspace\analyst\hermes-agent\apps\gis-canvas-bff\.env' | Select-String '^GIS_BFF_PROXY_SECRET=').ToString() -replace 'GIS_BFF_PROXY_SECRET=',''
$env:GIS_BFF_PROXY_SECRET = $secret
$env:GIS_DATA_SOURCE = 'a2a'
$env:GIS_BFF_URL = 'http://localhost:9109'
$env:HERMES_DASHBOARD_SESSION_TOKEN = 'dev-gis-local'
& 'C:\Users\UserAdmin\AppData\Local\hermes\hermes-agent\venv\Scripts\hermes.exe' dashboard --no-open --port 9119
```

`GIS_DATA_SOURCE=a2a` is required even though the demo never queries Denodo — the plugin's
`make_data_source()` defaults to `mock`, and `mock` ignores the `data://` handles the demo
binds.

Takes ~15–20s (it rebuilds its web UI). It runs from the repo via an editable install, so
it picks up `plugins/gis-canvas/` changes **only on restart** — Python does not hot-reload.

**SPA (`:5174`)** — from the **repo root**, not `apps/gis-canvas` (the `vite` binary is
hoisted to the root `node_modules/.bin` by npm workspaces):

```bash
npm run dev --workspace @hermes/gis-canvas
```

Needs a git-ignored `apps/gis-canvas/.env.local` with `VITE_BFF_URL=http://localhost:9109`
and `VITE_HERMES_TOKEN=dev-gis-local`. Vite HMR does pick up frontend edits live.

---

## 3. Run the demo

```bash
python scripts/gis_canvas_demo.py
```

Restores all 38 handles with fresh timestamps and prints the prompt. Handle ids are
preserved, so `data://f4e4262d` and friends keep resolving.

Then, at `http://localhost:5174`:

1. Log in if prompted.
2. Paste the printed prompt into the chat.
3. Wait for the render (one `render_view`; no Denodo round-trips).

### What a correct result looks like

- **Base layer is the *answer*** — a `note` with key judgments as prose, not a source table.
- **A computed table** of AIS-gap rankings and tasking guidance. These rows exist in no
  database; the agent derived them and authored them inline.
- **Caveats in their own note.**
- **All five retrieved handles demoted** to a tabs rail or dock.

If the agent heroes a source table instead, the guidance has regressed — see
`plugins/gis-canvas/tools_canvas.py`, the `ANALYSIS PRODUCT` block.

### Notes

- The exact layout varies between runs; the agent chooses it. Judge the four properties
  above, not pixel positions.
- Inline (agent-computed) tables render a checkbox column that does nothing — linked
  selection needs a source handle. Known cosmetic issue.
- A `float` component authored *before* the docks can be hidden beneath them: seed `z` is
  assigned by array index, not by layer. Known, unfixed.

---

## 4. Revert to a normal environment

The demo is close to non-destructive. It touches three things, in descending order of
how much you would care.

**a. Broker cache** — 38 handles added to `~/.hermes/gis_canvas_data/`.

They expire on their own after 24h. To clear immediately:

```bash
python - <<'EOF'
import json, pathlib
fixture = pathlib.Path('tests/fixtures/gis-canvas/session-2026-08-31/handles')
cache = pathlib.Path.home() / '.hermes' / 'gis_canvas_data'
removed = 0
for f in fixture.glob('*.json'):
    p = cache / f.name
    if p.exists():
        p.unlink(); removed += 1
print(f'removed {removed} demo handles from {cache}')
EOF
```

Only removes files the fixture owns, so handles from your own sessions are left alone.
Measured on this machine at time of writing: 38 demo handles removed, **194 of your own
preserved**. **Do not** blanket-delete the directory — it holds live query results from
real work.

**b. Canvas document** — the demo turn creates a new session doc in `~/.hermes/gis_canvas/`
(named `<timestamp>_<id>.json`). Harmless: docs are per-session, and the SPA only ever
displays one pushed over the WS. Delete the timestamped file if you want it gone.

**c. Gateway data source** — the gateway is running with `GIS_DATA_SOURCE=a2a`.

That is also the setting for **real Denodo work**, so if that is your normal mode, there is
nothing to revert. Only if you normally run on `mock` do you need to restart the gateway
with `$env:GIS_DATA_SOURCE = 'mock'` (and then the demo's `data://` handles will no longer
resolve).

**Nothing else persists.** Window drag/resize overrides are in-memory only — a page refresh
or the **Reset layout** button clears them. Only the theme is stored in `localStorage`.

### Restarting the gateway

Required after any change under `plugins/gis-canvas/`.

```powershell
Get-CimInstance Win32_Process -Filter "name='hermes.exe'" | Where-Object { $_.CommandLine -like '*dashboard*' } | Select-Object ProcessId, CreationDate
taskkill /PID <pid> /T /F
```

**`/T` kills the whole process tree**, which includes any TUI slash-worker sessions running
under the gateway. Those sessions are lost. Check before you run it if you have work open
elsewhere.

Then relaunch with the PowerShell block in step 2.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Canvas blank, "No canvas yet" | The SPA only accepts a doc pushed via a `tool.complete` WS event. It never reads the store from disk — **seeding a file by hand cannot work**. Run a real agent turn. |
| Tables show `0 rows` | Handles expired. `python scripts/gis_canvas_demo.py --check`, then restore. |
| `render_view` rejects `note` / `props.rows` | Gateway is running pre-change plugin code. Restart it. |
| BFF returns 403 on every proxy call | Gateway was launched without `GIS_BFF_PROXY_SECRET` propagating — start it from PowerShell, not bash. |
| `vite: not recognized` | You ran `npm run dev` inside `apps/gis-canvas`. Use the workspace flag from the repo root. |
| Frontend tests fail with `document is not defined` | You ran vitest from the repo root. Use `npm test --workspace @hermes/gis-canvas`. |
