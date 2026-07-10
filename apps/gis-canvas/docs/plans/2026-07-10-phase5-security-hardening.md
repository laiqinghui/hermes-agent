# Phase 5 — BFF Security Hardening Implementation Plan

> **For agentic workers:** subagent-driven, TDD, per-task review. Checkbox steps.

**Goal:** Close the security-hardening backlog from the Phase 4b final review — all in the BFF (`apps/gis-canvas-bff/`): env-driven cookie `secure`, OIDC `nonce`, JWKS cache TTL, `/auth/me` roles from the access token, HTTP-401 mid-stream refresh+retry, and `_locks` cleanup.

**Architecture:** No new components. Three coherent commits over `app/config.py`, `app/oidc.py`, `app/main.py` and their tests. Behavior-preserving except where hardening changes it; all existing BFF/plugin/frontend suites stay green.

**Tech Stack:** FastAPI + authlib + httpx + itsdangerous; pytest + respx + `TestClient`.

## Global Constraints

- All changes under `apps/gis-canvas-bff/`. Zero edits to `tui_gateway/server.py`, the plugin, or the SPA.
- Tokens live only in the BFF; the browser holds only the httpOnly `sid` cookie. No secret in the diff (`.env` git-ignored; only `.env.example` placeholders).
- Commit prefix `gis:`; trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never `git add -A`.
- BFF tests: `apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests -q` (must stay green: currently 19). Tests are hermetic — `tests/conftest.py` hard-sets env before `app` import; ADD new env vars there too.
- Design decisions (locked with the user): #4 roles decoded from the **access token** in the BFF (no Keycloak re-config); #5 the proxy handles only the **HTTP-401** case — an `auth-required` event *inside* the NDJSON stream stays a plugin concern (the BFF streams raw and does not parse events).

---

### Task 1: Env-driven cookie `secure` + `_locks` cleanup

**Files:** Modify `app/config.py`, `app/main.py`, `tests/conftest.py`; Test `tests/test_routes.py` (extend), add `tests/test_locks.py`.

**Interfaces produced:** `Settings.cookie_secure: bool` (from `BFF_COOKIE_SECURE`, default `False`); a module helper `_evict(sid) -> TokenRecord | None` in `main.py` that calls `store.evict(sid)` then `_locks.pop(sid, None)`.

- [ ] **Step 1 — failing tests.**
  - In `tests/test_routes.py` add `test_sid_cookie_secure_flag_from_settings`: set `bff.settings.cookie_secure = True` (monkeypatch the module singleton), drive `/auth/callback` via monkeypatched `oidc.exchange_code`/`validate_id_token`/`fetch_metadata` (return a token dict + claims), and assert the `set-cookie` for `sid` contains `Secure`. (If a full callback drive is heavy, instead unit-test that `main._cookie_kwargs()` — see Step 3 — returns `secure=True` when `settings.cookie_secure`.)
  - `tests/test_locks.py::test_logout_pops_lock`: seed a session, touch `bff._locks[sid]` (so it exists), call `/auth/logout` with the `sid` cookie, assert `sid not in bff._locks`.
- [ ] **Step 2 — run, confirm RED.** `...\pytest apps/gis-canvas-bff/tests/test_locks.py apps/gis-canvas-bff/tests/test_routes.py -q` → new tests fail.
- [ ] **Step 3 — implement.**
  - `config.py`: add `cookie_secure: bool` field; in `from_env`, `cookie_secure=os.environ.get("BFF_COOKIE_SECURE", "false").lower() in ("1","true","yes","on")`.
  - `main.py`: replace the two `set_cookie(... secure=False ...)` / `_oidc_flow` cookie calls to use `secure=settings.cookie_secure` (the `_oidc_flow` cookie currently has no `secure`; add it). Add `_evict(sid)` helper and use it in `logout` (line ~109) and both eviction points in `_bearer_for` (lines ~131, ~138).
  - `tests/conftest.py`: add `os.environ["BFF_COOKIE_SECURE"] = "false"` (keep tests deterministic).
  - `.env.example`: add `BFF_COOKIE_SECURE=false` with a comment ("set true behind HTTPS in prod").
- [ ] **Step 4 — GREEN + full suite.** `...\pytest apps/gis-canvas-bff/tests -q` all pass.
- [ ] **Step 5 — commit** (`app/config.py app/main.py tests/conftest.py tests/test_routes.py tests/test_locks.py apps/gis-canvas-bff/.env.example`): `gis: BFF cookie secure env toggle + per-session lock cleanup`.

---

### Task 2: OIDC `nonce` + JWKS/metadata cache TTL

**Files:** Modify `app/oidc.py`, `app/main.py`; Test `tests/test_oidc.py` (extend), `tests/test_routes.py` (extend).

**Interfaces produced:** `oidc.build_authorize_url(meta, s, state, challenge, nonce)` (new required `nonce` arg); `oidc.fetch_metadata`/`_jwks` become TTL-cached (module `_CACHE_TTL = 300.0`, caches store `(value, fetched_at)`); `reset_caches_for_tests()` still clears them.

- [ ] **Step 1 — failing tests.**
  - `test_oidc.py::test_build_authorize_url_includes_nonce`: `build_authorize_url(_META,_settings(),"st","chal","nonce123")` → URL contains `nonce=nonce123` (plus existing state/PKCE assertions).
  - `test_oidc.py::test_jwks_cache_refetches_after_ttl`: with respx mocking `jwks_uri` returning two different key sets on successive calls and `oidc._CACHE_TTL` monkeypatched small (e.g. `0`), assert `_jwks` refetches (second call returns the new set). Reset caches first.
  - `test_routes.py::test_login_sets_nonce_in_flow_cookie`: `/auth/login` (mock `fetch_metadata`) → the redirect `location` has `nonce=`; decode the `_oidc_flow` cookie via `bff._signer.loads(...)` and assert it has a `nonce` key.
  - `test_routes.py::test_callback_rejects_nonce_mismatch`: sign a `_oidc_flow` with `{state,verifier,nonce:"A"}`; monkeypatch `oidc.exchange_code`→tokens, `oidc.validate_id_token`→claims with `nonce:"B"`, `oidc.fetch_metadata`→meta; call `/auth/callback?code=..&state=..` → 400. A matching nonce ("A"=="A") → 302.
- [ ] **Step 2 — run, confirm RED.**
- [ ] **Step 3 — implement.**
  - `oidc.py`: add `nonce` to `build_authorize_url` params (`"nonce": nonce`). Convert `_meta_cache`/`_jwks_cache` to `tuple[dict,float] | None`; in `fetch_metadata`/`_jwks` refetch when `None` or `time.time()-ts > _CACHE_TTL`; `import time`; keep `reset_caches_for_tests`.
  - `main.py` `login`: `nonce = secrets.token_urlsafe(32)`; `flow = _signer.dumps({"state":state,"verifier":verifier,"nonce":nonce})`; `url = oidc.build_authorize_url(meta, settings, state, challenge, nonce)`.
  - `main.py` `callback`: after `claims = await oidc.validate_id_token(...)`, add `if flow.get("nonce") and claims.get("nonce") != flow["nonce"]: return JSONResponse({"error":"nonce mismatch"}, status_code=400)`.
- [ ] **Step 4 — GREEN + full suite.**
- [ ] **Step 5 — commit** (`app/oidc.py app/main.py tests/test_oidc.py tests/test_routes.py`): `gis: BFF OIDC nonce + JWKS/metadata cache TTL`.

---

### Task 3: `/auth/me` roles from access token + HTTP-401 refresh-and-retry

**Files:** Modify `app/oidc.py` (add decoder), `app/main.py`; Test `tests/test_oidc.py`, `tests/test_proxy.py`, `tests/test_routes.py`.

**Interfaces produced:** `oidc.roles_from_access_token(access_token: str) -> list[str]` (unverified base64 decode of the JWT payload → `claims.get("roles", [])`, returns `[]` on any parse error); `main._force_refresh(sid) -> str | None` (refresh under `_locks[sid]` regardless of expiry, update store, return new access token; on failure `_evict` + `None`).

- [ ] **Step 1 — failing tests.**
  - `test_oidc.py::test_roles_from_access_token`: build an unsigned JWT-shaped string `header.<b64url(json({"roles":["selectdata"],"preferred_username":"x"}))>.sig` and assert `roles_from_access_token(...) == ["selectdata"]`; a garbage string → `[]`.
  - `test_proxy.py::test_proxy_refreshes_and_retries_on_upstream_401`: bound session (access_token "AT", refresh_token "RT", not near expiry); respx: Keycloak token endpoint → `{access_token:"AT2",expires_in:900}`; Data Agent `POST /` first call → 401, second call → 200 NDJSON. Assert `/a2a/message` returns 200 and the SECOND agent request carried `Authorization: Bearer AT2`.
  - `test_proxy.py::test_proxy_401_persists_after_failed_refresh`: bound session; Data Agent → 401; Keycloak refresh → 400 (fails). Assert `/a2a/message` → 401 and the session is evicted (`bff.store.sid_for_canvas(...)` gone).
  - `test_routes.py::test_me_roles_come_from_access_token`: drive `/auth/callback` (monkeypatch exchange→`{access_token:<jwt with roles>, id_token:.., ...}`, `validate_id_token`→claims WITHOUT roles) then `/auth/me` → `roles == ["selectdata"]` (proving roles came from the access token, not the id_token).
- [ ] **Step 2 — run, confirm RED.**
- [ ] **Step 3 — implement.**
  - `oidc.py`: add `roles_from_access_token` (`import base64, json`; split on ".", pad+`urlsafe_b64decode` the payload, `json.loads`, return `.get("roles", [])`; wrap in try/except → `[]`).
  - `main.py` `callback`: set `roles=oidc.roles_from_access_token(tokens["access_token"])` in the `TokenRecord` (instead of `claims.get("roles", [])`).
  - `main.py`: add `_force_refresh(sid)` (mirror the refresh block in `_bearer_for` but unconditional; use `_evict` on failure). In `a2a_message`, after the first `upstream = await client.send(...)`: `if upstream.status_code == 401: await upstream.aread(); await upstream.aclose(); nb = await _force_refresh(sid); if not nb: await client.aclose(); return JSONResponse({"error":"session expired"}, status_code=401); req = client.build_request(..., Authorization f"Bearer {nb}"); upstream = await client.send(req, stream=True)`. Then the existing `if upstream.status_code >= 400` block handles any remaining error; stream on success.
- [ ] **Step 4 — GREEN + full suite** (`...\pytest apps/gis-canvas-bff/tests -q`).
- [ ] **Step 5 — commit** (`app/oidc.py app/main.py tests/test_oidc.py tests/test_proxy.py tests/test_routes.py`): `gis: BFF roles from access token + HTTP-401 refresh-and-retry`.

---

## Self-Review

- Coverage: cookie secure (T1), _locks (T1), nonce (T2), JWKS TTL (T2), roles-from-access-token (T3), HTTP-401 retry (T3) — all six backlog items mapped. In-stream `auth-required` explicitly out of scope (design decision).
- No placeholders; each task has concrete code + test specs.
- Type/name consistency: `_evict` (T1) reused by `_force_refresh` (T3); `cookie_secure` (T1) used only in T1; `roles_from_access_token` / `_force_refresh` names consistent across T3 steps.
- After all three: BFF suite green (19 existing + new), plugin 101 + frontend 62 untouched.
