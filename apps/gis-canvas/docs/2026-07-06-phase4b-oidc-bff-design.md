# Phase 4b — Real OIDC/Keycloak Auth + Live Denodo Data Agent (BFF)

**Status:** Design (approved for planning) · **Date:** 2026-07-06 · **Supersedes 4b-blocked note in** `ONBOARDING.md`

Phase 4a wired the GIS canvas to a Data Agent over A2A using a **static sandbox token**. Phase 4b
replaces that with **real per-user authentication**: the user logs in via Keycloak (OIDC), and their
own Bearer token is forwarded to the live Data Agent so **Denodo VDP enforces that user's real
row/column entitlements**. The full enterprise stack (Keycloak, Data Agent, Denodo AI SDK, Denodo VDP)
is already running in Docker on this machine, so 4b is no longer infra-blocked.

---

## 1. Goal & non-goals

**Goal.** A logged-in user drives the canvas; `data_discover`/`data_query` retrieve **real Denodo data**
scoped to that user's identity; rows render on map/table exactly as in 4a. Tokens never touch the
browser's JavaScript and never enter the LLM context.

**Non-goals (YAGNI for this milestone).**
- Multi-replica/Redis session store — in-memory (single-process BFF) is sufficient for dev.
- Production TLS/reverse-proxy hardening (documented, not implemented).
- Changing the render path, the broker, or the §14 data invariant.
- Multi-tenant concurrency guarantees beyond "one interactive user at a time" on this dev box.

---

## 2. Architecture

One new process (**BFF sidecar**), a small plugin change, and **zero** new edits to
`tui_gateway/server.py` (the existing fenced block stays as-is).

```
Browser (SPA :5174) ──WS JSON-RPC──▶ Hermes gateway :9119 ──▶ gis-canvas plugin
   │  auth (login, httpOnly sid cookie)                             │ data_query(session_id)
   ▼                                                                ▼
gis-canvas BFF :9109  ◀──────── A2A proxy (X-Canvas-Session) ───────┘
   │  OIDC + per-session token store + silent refresh
   ├──▶ Keycloak  http://dev.com:8080/realms/master  (client gis-canvas-bff)
   └──▶ Data Agent http://localhost:2024 ──▶ AISDK :8008 ──▶ Denodo VDP :9999
```

### Components

| Unit | Type | Responsibility | Depends on |
|---|---|---|---|
| `apps/gis-canvas-bff/` | **new** FastAPI (~200 LoC) | OIDC login/callback/logout/me; per-session token store; silent refresh; **A2A proxy** that attaches the user's Bearer and streams the Data Agent's NDJSON through verbatim | Keycloak, Data Agent |
| `plugins/gis-canvas/` | **edit** | `data_query`/`data_discover` thread `session_id`; in `a2a` mode target the BFF proxy (not `:2024`) and send `X-Canvas-Session` instead of a static token | BFF |
| SPA (`apps/gis-canvas`) | **edit** | Login gate (`/auth/me`), login/logout UI; register `canvas_session` with the BFF at login | BFF |
| Hermes gateway core | **unchanged** | existing `canvas.interaction` / `canvas.data_fetch` fence | — |
| broker, render path | **unchanged** | disk-cached rows, `canvas.data_fetch` paging | — |

---

## 3. The dedicated Keycloak client

Realm **master**, client **`gis-canvas-bff`** (confidential). Import artifact:
`apps/gis-canvas-bff/keycloak/gis-canvas-bff-client.json` (Admin console → Clients → Import client).

Baked in: Authorization Code + **PKCE S256**, Standard flow on, Direct Access Grants on, and the two
mandatory protocol mappers with **Add to access token: ON**:

> **⚠️ NOTE FOR FUTURE REFERENCE — Direct Access Grants (password grant) is intentionally left ON.**
> This is a **dev-only convenience** so tokens can be minted directly via the OAuth password grant for
> setup verification and automated tests (Stage-1 checks, the live e2e), bypassing the browser redirect.
> It is **not used by the BFF's runtime flow** (which is Authorization Code + PKCE). **Disable it before
> any production/shared deployment** — password grant lets any holder of the client secret + a user's
> credentials mint tokens without the interactive flow. Tracked as a production-hardening item (Phase 5).
- `denodo-audience` (`oidc-audience-mapper`) → adds `denodo` to `aud`. Without it VDP returns
  `AUTHENTICATION_UNABLE_TO_CONNECT`.
- `denodo-roles-mapper` (`oidc-usermodel-realm-role-mapper`) → maps **realm roles** into the `roles`
  claim. Without it users get minimal entitlements.

Redirect URI `http://localhost:9109/auth/callback`; web-origin + post-logout `http://localhost:5174`.
Issuer is `http://dev.com:8080/realms/master` — VDP validates `iss` as an exact string, and `dev.com`
already resolves to `127.0.0.1` in the host's hosts file (verified).

**Setup dependency:** the test user must hold the Denodo realm roles (e.g. `selectdata`), else the
`roles` claim is empty.

---

## 4. Auth flow (BFF)

The token store is keyed by the **browser session** (`sid` httpOnly cookie), **not** the canvas
session — because the OIDC redirect reloads the SPA, so any canvas-session id captured before login is
stale afterward (the SPA calls `session.create` again on the post-login reload). A separate
**canvas_session → sid** index is populated by an explicit bind step *after* the post-login
`session.create`, so the server-side tool (which sees only `session_id`) can resolve the right token.

1. SPA on load calls `GET {BFF}/auth/me` with credentials. If 401 → show "Login with Keycloak" →
   navigate to `{BFF}/auth/login`.
2. BFF runs Authorization Code + PKCE + `client_secret` against realm `master`. `/auth/callback`
   validates the `id_token` **once** (RS256 via JWKS; `iss`/`aud`/`exp`), then:
   - stores `{access_token, refresh_token, id_token, expires_at, username, roles}` **keyed by a new
     `sid`**,
   - sets an httpOnly `sid` cookie (`SameSite=Lax`),
   - redirects back to the SPA (`SPA_ORIGIN`).
3. **Bind:** after the post-login reload, the SPA connects, calls `session.create`, then
   `POST {BFF}/auth/bind` **with credentials** and body `{canvas_sessions: [stored_session_id,
   session_id]}`. The BFF maps **each** id → the caller's `sid` (from the cookie). Both ids are bound
   to sidestep the live-vs-stored ambiguity (§6).
4. **Silent refresh:** on every proxied A2A call, if within 60s of expiry, refresh under a per-`sid`
   `asyncio.Lock`; always persist the rotated `refresh_token`.
5. **Logout:** `POST {BFF}/auth/logout` evicts the session (and its canvas_session index entries) and
   returns the Keycloak `end_session` URL with `id_token_hint`; SPA navigates there.

The tokens carry `aud: denodo` + `roles`, so VDP executes queries as that user with their real
row/column security.

---

## 5. Data flow (per-user, real Denodo) — §14 invariant preserved

1. Agent turn calls `data_query(prompt, …)`; handler reads `session_id` from `**kw`
   (`model_tools.py` threads it into `registry.dispatch`).
2. → `A2ADataSource.query(prompt, session_id=…)` → POST `{BFF}/a2a/message` with header
   `X-Canvas-Session: <session_id>` and the prompt.
3. BFF resolves that session's token (refreshing if needed), attaches `Authorization: Bearer`, POSTs
   `message/stream` to `http://localhost:2024/`, and **streams the NDJSON back unchanged**.
4. The plugin's existing `a2a_client.collect()` parses the stream → rows/schema/clarification → broker
   `put()` → `data_query` returns only `{handle, schema, rowCount, sample≤3}`. **Bulk rows never enter
   the agent context** (§14 invariant unchanged).
5. Browser fetches rows via `canvas.data_fetch` from the disk broker, exactly as in 4a.

`data_discover` follows the same path via `{BFF}/a2a/message` (discovery prompt). Clarification
(`input-required`) and multi-turn `context_id` ride through the proxy transparently.

---

## 6. Session keying — the one integration point to verify live

Token lookup at proxy time is `X-Canvas-Session → sid → tokens`. The `canvas_session → sid` index is
populated by `/auth/bind` (§4 step 3). The remaining unknown is **which id the tool receives** in
`**kw` at `data_query` time — the live `session_id` or the `stored_session_id`. `hooks.py` already
looks up the canvas store with the tool's `session_id`, and the SPA keys `canvas.interaction` with
`stored_session_id`, so they *should* coincide — but rather than depend on it, the SPA **binds both**
ids (`[stored_session_id, session_id]`), so whichever the tool presents resolves.

Per the onboarding's "always run the live browser e2e" rule (unit tests load the plugin via a
different path and missed 5 live-only bugs in Phase 2), a one-off verification logs the tool's actual
`session_id` and confirms it matches a bound id. Called out as a known integration risk, not assumed
away.

---

## 7. Coupling trade-off (deliberate, reversible)

With approach **1a (BFF proxies A2A)**, the BFF sits on the **critical data path**: the Data Agent is
reachable by the canvas **only through the BFF**. Consequences:
- A BFF outage means **no data**, not merely no login.
- The Data Agent is now tightly coupled to the gis-canvas gateway/BFF pair.

This is accepted **on purpose** to keep tokens entirely server-side (they never reach the plugin or
browser). **Decoupling path** (documented for later): once real auth is proven, an env switch reverts
the datasource to direct `:2024` (approach 1b: BFF writes a session-keyed token the plugin reads) or
`mock`, making the proxy bypassable. `make_data_source()` keeps `mock` as the default so non-auth work
is never blocked by the BFF.

---

## 8. Config, ports & env

**Ports:** gateway `:9119`, SPA preview `:5174` (existing) + **BFF `:9109`** (new). Infra: Data Agent
`:2024`, Keycloak `:8080`, AISDK `:8008`, VDP `:9999`.

**`apps/gis-canvas-bff/.env`** (git-ignored; `.env.example` committed):
```
KEYCLOAK_ISSUER=http://dev.com:8080/realms/master
KEYCLOAK_CLIENT_ID=gis-canvas-bff
KEYCLOAK_CLIENT_SECRET=<from Keycloak Credentials tab after import>
BFF_REDIRECT_URI=http://localhost:9109/auth/callback
SPA_ORIGIN=http://localhost:5174
POST_LOGOUT_REDIRECT=http://localhost:5174/
SESSION_SECRET=<python -c "import secrets;print(secrets.token_hex(32))">
DATA_AGENT_URL=http://localhost:2024
GIS_BFF_PROXY_SECRET=<python -c "import secrets;print(secrets.token_hex(32))">
```

**Gateway/plugin env:** keep `GIS_DATA_SOURCE=a2a`; add `GIS_BFF_URL=http://localhost:9109` and
`GIS_BFF_PROXY_SECRET=<same value as the BFF>`; the static `DATA_AGENT_AUTH_TOKEN` is unused in a2a
mode. **SPA env:** `VITE_BFF_URL=http://localhost:9109`.

**Proxy trust:** the `/a2a/*` proxy endpoints are internal (gateway → BFF, no browser cookie). They
require header `X-Proxy-Secret: <GIS_BFF_PROXY_SECRET>`; a caller that knows only a `canvas_session`
id cannot mint a token without it. `/auth/*` endpoints are cookie-authenticated (browser) and do not
use this secret.

**CORS/cookie:** SPA (`:5174`) and BFF (`:9109`) are same-site (localhost) → `sid` cookie
`httpOnly; SameSite=Lax`; BFF sets CORS `allow-origin=http://localhost:5174, allow-credentials=true`
for `/auth/me`, `/auth/bind`, `/auth/logout`.

---

## 9. Error handling

| Condition | BFF behavior | Plugin / agent surface |
|---|---|---|
| Not logged in (no session for `X-Canvas-Session`) | proxy → `401` | `data_query` → `{ok:false, needs_auth:true}`; agent asks user to log in |
| Token near expiry | silent refresh (per-session lock; persist rotated refresh) | transparent |
| Data Agent `auth-required` / `401` mid-stream | force-refresh; if it fails, evict session | agent relays "please re-authenticate" |
| **BFF down** (coupling risk) | — | `data_query` → clear `{ok:false}` error; mock/render path unaffected |
| Data Agent `failed` / JSON-RPC error | passthrough | existing `collect()` handling (unchanged) |

---

## 10. Testing

- **BFF unit (pytest, no network):** PKCE challenge; session store keyed by `canvas_session`;
  refresh + rotation (mock token endpoint); `/auth/me` states; proxy attaches `Bearer` and streams
  NDJSON verbatim (mock Data Agent).
- **Plugin unit:** `A2ADataSource` targets `GIS_BFF_URL/a2a` and sends `X-Canvas-Session`; `collect()`
  untouched. Extend the existing suite (keep the 91 backend tests green).
- **Frontend:** login-gate component test; keep the 49 tests green.
- **Live e2e against the real stack (required):** log in as a real Keycloak test user → `discover` +
  `retrieve` hit **real Denodo** → rows render on map/table in the browser. Re-point
  `tests/plugins/gis_canvas/test_a2a_sandbox.py` (currently fails against the real agent because it
  uses sandbox `scenario:` fixtures) to reflect real-agent reality, or gate it behind a sandbox flag.

---

## 11. Change surface

- **New:** `apps/gis-canvas-bff/` — `app.py` (or `main.py`), `.env.example`, `keycloak/` import JSON
  (done), `tests/`, `README.md`.
- **Edit `plugins/gis-canvas/datasource.py`:** `A2ADataSource` gains `session_id`; `make_data_source()`
  reads `GIS_BFF_URL`; auth path sends a session id, not a static token.
- **Edit `plugins/gis-canvas/tools_data.py`:** pass `kw["session_id"]` into the datasource calls.
- **Edit `plugins/gis-canvas/a2a_client.py`:** target the BFF, add `X-Canvas-Session` header (NDJSON
  parsing unchanged).
- **Edit SPA:** `App.tsx` login gate + small `lib/auth.ts` (`/auth/me`, login redirect, logout).
- **`tui_gateway/server.py`:** **no change** (fence unchanged).

Fork discipline: all new/edited code stays under `apps/gis-canvas*` + `plugins/gis-canvas/`. Commit
prefix `gis:`.

---

## 12. Setup checklist (run once, during implementation)

1. Import `gis-canvas-bff` client into realm `master`; copy secret → `apps/gis-canvas-bff/.env`.
2. Ensure a test user exists with the Denodo realm roles; verify token via the password-grant curl
   (expect `aud` ⊇ `denodo`, `roles` non-empty, `iss = http://dev.com:8080/realms/master`).
3. `dev.com` → `127.0.0.1` — **already present** in the hosts file (verified).
4. Run BFF (`:9109`), gateway (`GIS_DATA_SOURCE=a2a GIS_BFF_URL=… :9119`), SPA preview (`:5174`).
5. Live e2e: log in → discover → retrieve → confirm real rows on the map.

---

## 13. Open risks

- **Session-id equivalence** (§6) — the single live-verified assumption.
- **BFF-on-data-path coupling** (§7) — accepted, with a documented decoupling switch.
- **Token-at-rest**: none in 1a (tokens live only in BFF memory). If we later fall back to 1b, revisit
  (session-keyed token on disk is a security smell even in dev).
- **Realm-role assignment** for the test user is external to this codebase; a misconfigured user yields
  empty `roles` and confusing "minimal data" symptoms rather than a hard failure.
