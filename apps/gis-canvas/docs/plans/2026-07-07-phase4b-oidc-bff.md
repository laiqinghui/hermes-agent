# Phase 4b — Real OIDC/Keycloak Auth + Live Denodo (BFF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 4a static sandbox token with real per-user OIDC auth — the user logs in via Keycloak, and their own Bearer token (carrying `aud: denodo` + `roles`) is forwarded to the live Data Agent so Denodo VDP enforces that user's real entitlements, while rows render on map/table exactly as before and never enter the LLM context.

**Architecture:** A new standalone **BFF sidecar** (`apps/gis-canvas-bff/`, FastAPI) owns everything OIDC — Authorization Code + PKCE + `client_secret` against realm `master`, an in-memory per-browser (`sid`) token store with silent refresh, and an authenticated **A2A proxy** that attaches the user's Bearer and streams the Data Agent's NDJSON through verbatim. The gis-canvas plugin's `A2ADataSource` is re-pointed from the Data Agent (`:2024`) at the BFF (`:9109`), passing a `session_id` (not a token) via `X-Canvas-Session`. A `canvas_session → sid` index (populated by an `/auth/bind` call after the post-login `session.create`) lets the server-side tool resolve the right token. The Hermes gateway core is untouched (the existing fence stays as-is).

**Tech Stack:** Python 3.11 — BFF: FastAPI + uvicorn + httpx + authlib + itsdangerous + python-dotenv; plugin: httpx (existing). Frontend: React 19 + Vite + vitest. Tests: pytest (+ respx for httpx mocking, Starlette `TestClient`) and vitest.

## Global Constraints

- **Confinement:** all code lives in `apps/gis-canvas/`, `apps/gis-canvas-bff/`, and `plugins/gis-canvas/`. **Zero** new edits to `tui_gateway/server.py` — the existing fenced block stays exactly as-is (Phase 4b adds no gateway RPC).
- **Staging discipline:** foreign uncommitted `web/` changes may exist — **never `git add -A`**; stage explicit paths only.
- **Commit prefix** `gis:`; every commit ends with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Plugin import path** is `hermes_plugins.gis_canvas` at runtime (loader slug = key with `-`→`_`); intra-plugin refs use **relative imports** (`from . import a2a_client`). Tests load it as package `gis_canvas_plugin` via `tests/plugins/gis_canvas/conftest.py`.
- **The §14 data invariant (load-bearing, unchanged):** bulk rows appear **only** on the data plane. `data_query`'s agent-visible result contains **only** `{handle, schema, rowCount, sample(≤3 rows)}`. Tests must keep asserting this.
- **Secrets:** the client secret lives in `apps/gis-canvas-bff/.env` (git-ignored — verified via `git check-ignore`). **Never** commit `.env`, and never paste the secret into code, tests, or commits. `.env.example` (committed) carries placeholders only.
- **Keycloak (ground truth, already set up):** realm `master`, confidential client `gis-canvas-bff` (import JSON at `apps/gis-canvas-bff/keycloak/gis-canvas-bff-client.json`), issuer `http://dev.com:8080/realms/master`, mappers `denodo-audience` + `denodo-roles-mapper` present. `dev.com` → `127.0.0.1` already in the hosts file. A verified token shows `aud=['denodo','account']`, `roles` includes `selectdata`.
- **Ports:** BFF `:9109`, SPA preview `:5174`, gateway `:9119`, Data Agent `:2024`, Keycloak `:8080`.
- **Proxy trust:** `/a2a/*` requires header `X-Proxy-Secret: <GIS_BFF_PROXY_SECRET>` (shared gateway↔BFF); `/auth/*` are cookie-authenticated and never use this secret.
- **Coupling note (deliberate):** in this design the BFF is on the critical data path — if the BFF is down, data is down (not just login). `make_data_source()` keeps `mock` as the default so non-auth work is never blocked. Decoupling is a future env switch, out of scope here.
- **Do NOT change the Hermes model** (gpt-5.4 via openai-codex) or edit the installed `~/.hermes/hermes-agent` copy.
- **Design spec:** `apps/gis-canvas/docs/2026-07-06-phase4b-oidc-bff-design.md` (read it first).

## Testing & Import Conventions (READ FIRST — repo-specific)

- **BFF tests** run from `apps/gis-canvas-bff/` in a **dedicated venv** (`apps/gis-canvas-bff/.venv`) — isolated from the plugin test venv. Setup is Task 1.
- **Plugin tests** run from repo root: `.venv\Scripts\pytest tests/plugins/gis_canvas -q` (Windows). The plugin lives in a hyphenated dir loaded as `gis_canvas_plugin`; **intra-plugin imports must be relative**.
- **Frontend tests**: `npm run -w @hermes/gis-canvas test` (vitest), `npm run -w @hermes/gis-canvas build` (tsc typecheck).
- **Windows shell**: use `.venv\Scripts\python` / `.venv\Scripts\pytest`. Commands below show the Windows form.
- **Live e2e is mandatory** (Task 6) — the onboarding warns that unit tests load the plugin via a different path and have missed live-only bugs before.

## File Structure

**New — `apps/gis-canvas-bff/`:**
- `app/__init__.py` — empty package marker
- `app/config.py` — `Settings` loaded from env/`.env`
- `app/oidc.py` — PKCE gen, OIDC metadata + JWKS fetch/cache, token exchange, refresh, id_token validation (network; mock with respx)
- `app/sessions.py` — `SessionStore`: `sid → TokenRecord`, `canvas_session → sid` index, bind, expiry decision, evict (pure; unit-tested without network)
- `app/main.py` — FastAPI app + routes: `/auth/login|callback|me|bind|logout`, `/a2a/message`
- `tests/conftest.py`, `tests/test_sessions.py`, `tests/test_oidc.py`, `tests/test_routes.py`, `tests/test_proxy.py`
- `requirements.txt`, `.env.example`, `README.md`
- `keycloak/gis-canvas-bff-client.json` — **already created**

**Modify — `plugins/gis-canvas/`:**
- `a2a_client.py` — generalize headers; drop `auth_header` param
- `datasource.py` — `A2ADataSource` targets the BFF, threads `session_id` + proxy secret; `make_data_source()` reads `GIS_BFF_URL` / `GIS_BFF_PROXY_SECRET`
- `tools_data.py` — pass `kw["session_id"]` into datasource calls
- their tests: `tests/plugins/gis_canvas/test_a2a_client.py`, `test_datasource.py`, `test_data_tools.py`, `test_a2a_sandbox.py`

**Modify — `apps/gis-canvas/src/`:**
- `lib/auth.ts` — **new**: `authMe`, `loginUrl`, `bindSessions`, `logout`, `resolveBffUrl`
- `lib/auth.test.ts` — **new**
- `App.tsx` — login gate + bind call + logout control
- `App.test.tsx` — extend for the gate

---

### Task 1: BFF scaffold, config, and session store

**Files:**
- Create: `apps/gis-canvas-bff/requirements.txt`, `apps/gis-canvas-bff/.env.example`, `apps/gis-canvas-bff/app/__init__.py`, `apps/gis-canvas-bff/app/config.py`, `apps/gis-canvas-bff/app/sessions.py`
- Test: `apps/gis-canvas-bff/tests/conftest.py`, `apps/gis-canvas-bff/tests/test_sessions.py`

**Interfaces:**
- Produces:
  - `config.Settings` dataclass with attrs: `keycloak_issuer: str`, `client_id: str`, `client_secret: str`, `redirect_uri: str`, `spa_origin: str`, `post_logout_redirect: str`, `session_secret: str`, `data_agent_url: str`, `proxy_secret: str`; classmethod `Settings.from_env() -> Settings`.
  - `sessions.TokenRecord` dataclass: `access_token: str`, `refresh_token: str`, `id_token: str`, `expires_at: float`, `username: str`, `roles: list[str]`.
  - `sessions.SessionStore` with methods: `create(record: TokenRecord) -> str` (returns new `sid`), `get(sid: str) -> TokenRecord | None`, `update(sid, record)`, `bind(sid: str, canvas_sessions: list[str]) -> None`, `sid_for_canvas(canvas_session: str) -> str | None`, `needs_refresh(sid, now: float, margin: float = 60.0) -> bool`, `evict(sid) -> TokenRecord | None`.

- [ ] **Step 1: Create the dependency + env files**

`apps/gis-canvas-bff/requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.32.0
httpx==0.28.1
authlib==1.3.2
itsdangerous==2.2.0
python-dotenv==1.0.1
pytest==8.3.3
respx==0.21.1
```

`apps/gis-canvas-bff/.env.example`:
```
KEYCLOAK_ISSUER=http://dev.com:8080/realms/master
KEYCLOAK_CLIENT_ID=gis-canvas-bff
KEYCLOAK_CLIENT_SECRET=changeme-from-keycloak-credentials-tab
BFF_REDIRECT_URI=http://localhost:9109/auth/callback
SPA_ORIGIN=http://localhost:5174
POST_LOGOUT_REDIRECT=http://localhost:5174/
SESSION_SECRET=changeme-generate-with-secrets-token_hex-32
DATA_AGENT_URL=http://localhost:2024
GIS_BFF_PROXY_SECRET=changeme-shared-with-gateway
```

- [ ] **Step 2: Create the venv and install deps**

Run (Windows):
```
py -V:Astral/CPython3.11.15 -m venv apps/gis-canvas-bff/.venv
apps\gis-canvas-bff\.venv\Scripts\python -m pip install -r apps/gis-canvas-bff/requirements.txt
```
Expected: installs succeed; `apps\gis-canvas-bff\.venv\Scripts\pytest --version` prints a version.

- [ ] **Step 3: Write the failing test for `SessionStore`**

`apps/gis-canvas-bff/tests/conftest.py`:
```python
import pathlib
import sys

# Make `app` importable when running pytest from apps/gis-canvas-bff/
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
```

`apps/gis-canvas-bff/tests/test_sessions.py`:
```python
from app.sessions import SessionStore, TokenRecord


def _rec(**kw) -> TokenRecord:
    base = dict(access_token="a", refresh_token="r", id_token="i",
                expires_at=1000.0, username="jsmith", roles=["selectdata"])
    base.update(kw)
    return TokenRecord(**base)


def test_create_returns_opaque_sid_and_stores_record():
    s = SessionStore()
    sid = s.create(_rec())
    assert isinstance(sid, str) and len(sid) >= 16
    assert s.get(sid).username == "jsmith"


def test_get_unknown_sid_returns_none():
    assert SessionStore().get("nope") is None


def test_bind_maps_each_canvas_session_to_sid():
    s = SessionStore()
    sid = s.create(_rec())
    s.bind(sid, ["stored-1", "live-1"])
    assert s.sid_for_canvas("stored-1") == sid
    assert s.sid_for_canvas("live-1") == sid
    assert s.sid_for_canvas("unbound") is None


def test_needs_refresh_true_within_margin():
    s = SessionStore()
    sid = s.create(_rec(expires_at=1000.0))
    assert s.needs_refresh(sid, now=950.0, margin=60.0) is True   # 1000-60=940 <= 950
    assert s.needs_refresh(sid, now=930.0, margin=60.0) is False


def test_evict_removes_record_and_indexes():
    s = SessionStore()
    sid = s.create(_rec())
    s.bind(sid, ["c1"])
    evicted = s.evict(sid)
    assert evicted.username == "jsmith"
    assert s.get(sid) is None
    assert s.sid_for_canvas("c1") is None
```

- [ ] **Step 4: Run it to verify it fails**

Run: `apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests/test_sessions.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.sessions'`.

- [ ] **Step 5: Implement `config.py` and `sessions.py`**

`apps/gis-canvas-bff/app/__init__.py`: (empty file)

`apps/gis-canvas-bff/app/config.py`:
```python
from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()  # reads apps/gis-canvas-bff/.env when cwd is that dir


@dataclass
class Settings:
    keycloak_issuer: str
    client_id: str
    client_secret: str
    redirect_uri: str
    spa_origin: str
    post_logout_redirect: str
    session_secret: str
    data_agent_url: str
    proxy_secret: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            keycloak_issuer=os.environ["KEYCLOAK_ISSUER"],
            client_id=os.environ["KEYCLOAK_CLIENT_ID"],
            client_secret=os.environ["KEYCLOAK_CLIENT_SECRET"],
            redirect_uri=os.environ["BFF_REDIRECT_URI"],
            spa_origin=os.environ["SPA_ORIGIN"],
            post_logout_redirect=os.environ["POST_LOGOUT_REDIRECT"],
            session_secret=os.environ["SESSION_SECRET"],
            data_agent_url=os.environ.get("DATA_AGENT_URL", "http://localhost:2024"),
            proxy_secret=os.environ["GIS_BFF_PROXY_SECRET"],
        )
```

`apps/gis-canvas-bff/app/sessions.py`:
```python
"""In-memory per-browser token store (keyed by opaque sid) plus a
canvas_session -> sid index. Single-process dev store; swap for Redis in prod."""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field


@dataclass
class TokenRecord:
    access_token: str
    refresh_token: str
    id_token: str
    expires_at: float
    username: str
    roles: list[str] = field(default_factory=list)


class SessionStore:
    def __init__(self) -> None:
        self._by_sid: dict[str, TokenRecord] = {}
        self._canvas_to_sid: dict[str, str] = {}

    def create(self, record: TokenRecord) -> str:
        sid = secrets.token_urlsafe(32)
        self._by_sid[sid] = record
        return sid

    def get(self, sid: str) -> TokenRecord | None:
        return self._by_sid.get(sid)

    def update(self, sid: str, record: TokenRecord) -> None:
        if sid in self._by_sid:
            self._by_sid[sid] = record

    def bind(self, sid: str, canvas_sessions: list[str]) -> None:
        for c in canvas_sessions:
            if c:
                self._canvas_to_sid[c] = sid

    def sid_for_canvas(self, canvas_session: str) -> str | None:
        return self._canvas_to_sid.get(canvas_session)

    def needs_refresh(self, sid: str, now: float, margin: float = 60.0) -> bool:
        rec = self._by_sid.get(sid)
        if rec is None:
            return False
        return now >= rec.expires_at - margin

    def evict(self, sid: str) -> TokenRecord | None:
        rec = self._by_sid.pop(sid, None)
        self._canvas_to_sid = {c: s for c, s in self._canvas_to_sid.items() if s != sid}
        return rec
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests/test_sessions.py -q`
Expected: PASS (5 passed).

- [ ] **Step 7: Commit**

```
git add apps/gis-canvas-bff/requirements.txt apps/gis-canvas-bff/.env.example apps/gis-canvas-bff/app/__init__.py apps/gis-canvas-bff/app/config.py apps/gis-canvas-bff/app/sessions.py apps/gis-canvas-bff/tests/conftest.py apps/gis-canvas-bff/tests/test_sessions.py
git commit -m "gis: BFF scaffold — config + in-memory session store (Phase 4b)"
```
(Confirm `git status` shows `.env` is NOT staged.)

---

### Task 2: OIDC helpers (PKCE, metadata/JWKS, token exchange, refresh, validation)

**Files:**
- Create: `apps/gis-canvas-bff/app/oidc.py`
- Test: `apps/gis-canvas-bff/tests/test_oidc.py`

**Interfaces:**
- Consumes: `config.Settings`.
- Produces (module-level functions in `app.oidc`):
  - `make_pkce() -> tuple[str, str]` → `(verifier, challenge)` where `challenge = BASE64URL(SHA256(verifier))` unpadded.
  - `async fetch_metadata(issuer, client) -> dict` (cached) — returns dict with `authorization_endpoint`, `token_endpoint`, `end_session_endpoint`, `jwks_uri`.
  - `build_authorize_url(meta, settings, state, challenge) -> str`.
  - `async exchange_code(meta, settings, code, verifier, client) -> dict` — POST token endpoint, returns token response JSON.
  - `async refresh_tokens(meta, settings, refresh_token, client) -> dict`.
  - `async validate_id_token(meta, settings, id_token, client) -> dict` — RS256/JWKS verify + `iss`/`aud` checks; returns claims.
  - where `client` is an `httpx.AsyncClient`.

- [ ] **Step 1: Write the failing tests**

`apps/gis-canvas-bff/tests/test_oidc.py`:
```python
import base64
import hashlib

import httpx
import pytest
import respx

from app import oidc
from app.config import Settings


def _settings() -> Settings:
    return Settings(
        keycloak_issuer="http://dev.com:8080/realms/master",
        client_id="gis-canvas-bff", client_secret="sekret",
        redirect_uri="http://localhost:9109/auth/callback",
        spa_origin="http://localhost:5174",
        post_logout_redirect="http://localhost:5174/",
        session_secret="x" * 32, data_agent_url="http://localhost:2024",
        proxy_secret="p" * 32,
    )


_META = {
    "authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
    "token_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/token",
    "end_session_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/logout",
    "jwks_uri": "http://dev.com:8080/realms/master/protocol/openid-connect/certs",
}


def test_make_pkce_challenge_is_s256_of_verifier():
    verifier, challenge = oidc.make_pkce()
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    assert challenge == expected
    assert 43 <= len(verifier) <= 128


def test_build_authorize_url_has_pkce_and_state():
    url = oidc.build_authorize_url(_META, _settings(), state="st8", challenge="chal")
    assert url.startswith(_META["authorization_endpoint"] + "?")
    assert "code_challenge=chal" in url
    assert "code_challenge_method=S256" in url
    assert "state=st8" in url
    assert "client_id=gis-canvas-bff" in url
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A9109%2Fauth%2Fcallback" in url


@pytest.mark.asyncio
async def test_exchange_code_posts_authorization_code_grant():
    route_hit = {}

    def _capture(request):
        route_hit["body"] = request.content.decode()
        return httpx.Response(200, json={"access_token": "AT", "refresh_token": "RT",
                                         "id_token": "IT", "expires_in": 900})

    with respx.mock:
        respx.post(_META["token_endpoint"]).mock(side_effect=_capture)
        async with httpx.AsyncClient() as client:
            tokens = await oidc.exchange_code(_META, _settings(), "the-code", "the-verifier", client)
    assert tokens["access_token"] == "AT"
    assert "grant_type=authorization_code" in route_hit["body"]
    assert "code=the-code" in route_hit["body"]
    assert "code_verifier=the-verifier" in route_hit["body"]


@pytest.mark.asyncio
async def test_refresh_tokens_posts_refresh_grant():
    with respx.mock:
        respx.post(_META["token_endpoint"]).mock(
            return_value=httpx.Response(200, json={"access_token": "AT2", "expires_in": 900})
        )
        async with httpx.AsyncClient() as client:
            tokens = await oidc.refresh_tokens(_META, _settings(), "old-refresh", client)
    assert tokens["access_token"] == "AT2"
```

Note: this uses `pytest.mark.asyncio`. Add `pytest-asyncio==0.24.0` to `requirements.txt` and re-run the install; add `asyncio_mode = auto` under `[pytest]` in a new `apps/gis-canvas-bff/pytest.ini`.

- [ ] **Step 2: Add async test config**

`apps/gis-canvas-bff/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
```
Append `pytest-asyncio==0.24.0` to `requirements.txt`, then:
```
apps\gis-canvas-bff\.venv\Scripts\python -m pip install pytest-asyncio==0.24.0
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests/test_oidc.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.oidc'`.

- [ ] **Step 4: Implement `oidc.py`**

`apps/gis-canvas-bff/app/oidc.py`:
```python
"""OIDC primitives for the BFF: PKCE, discovery, token exchange/refresh,
id_token validation. All network calls take an injected httpx.AsyncClient so
tests can mock with respx."""
from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import urlencode

import httpx
from authlib.jose import JsonWebKey, jwt as authlib_jwt

from .config import Settings

_meta_cache: dict | None = None
_jwks_cache: dict | None = None


def make_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


async def fetch_metadata(issuer: str, client: httpx.AsyncClient) -> dict:
    global _meta_cache
    if _meta_cache is None:
        r = await client.get(f"{issuer}/.well-known/openid-configuration")
        r.raise_for_status()
        _meta_cache = r.json()
    return _meta_cache


async def _jwks(meta: dict, client: httpx.AsyncClient) -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        r = await client.get(meta["jwks_uri"])
        r.raise_for_status()
        _jwks_cache = r.json()
    return _jwks_cache


def build_authorize_url(meta: dict, s: Settings, state: str, challenge: str) -> str:
    params = urlencode({
        "client_id": s.client_id,
        "redirect_uri": s.redirect_uri,
        "response_type": "code",
        "scope": "openid profile email",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return f"{meta['authorization_endpoint']}?{params}"


async def exchange_code(meta: dict, s: Settings, code: str, verifier: str,
                        client: httpx.AsyncClient) -> dict:
    r = await client.post(meta["token_endpoint"], data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": s.redirect_uri, "client_id": s.client_id,
        "client_secret": s.client_secret, "code_verifier": verifier,
    })
    r.raise_for_status()
    return r.json()


async def refresh_tokens(meta: dict, s: Settings, refresh_token: str,
                         client: httpx.AsyncClient) -> dict:
    r = await client.post(meta["token_endpoint"], data={
        "grant_type": "refresh_token", "refresh_token": refresh_token,
        "client_id": s.client_id, "client_secret": s.client_secret,
    })
    r.raise_for_status()
    return r.json()


async def validate_id_token(meta: dict, s: Settings, id_token: str,
                            client: httpx.AsyncClient) -> dict:
    jwks = await _jwks(meta, client)
    claims = authlib_jwt.decode(id_token, JsonWebKey.import_key_set(jwks))
    claims.validate()  # exp/nbf/iat
    if claims.get("iss") != s.keycloak_issuer:
        raise ValueError("issuer mismatch")
    aud = claims.get("aud", [])
    aud = [aud] if isinstance(aud, str) else aud
    if s.client_id not in aud:
        raise ValueError("audience mismatch")
    return dict(claims)


def reset_caches_for_tests() -> None:
    global _meta_cache, _jwks_cache
    _meta_cache = None
    _jwks_cache = None
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests/test_oidc.py -q`
Expected: PASS (4 passed). If `test_build_authorize_url` fails on the redirect-uri encoding, confirm `urlencode` produced `%2F` (it does by default).

- [ ] **Step 6: Commit**

```
git add apps/gis-canvas-bff/app/oidc.py apps/gis-canvas-bff/tests/test_oidc.py apps/gis-canvas-bff/pytest.ini apps/gis-canvas-bff/requirements.txt
git commit -m "gis: BFF OIDC helpers — PKCE, discovery, token exchange/refresh, id_token validation"
```

---

### Task 3: BFF FastAPI app — auth routes + authenticated A2A proxy

**Files:**
- Create: `apps/gis-canvas-bff/app/main.py`
- Test: `apps/gis-canvas-bff/tests/test_routes.py`, `apps/gis-canvas-bff/tests/test_proxy.py`

**Interfaces:**
- Consumes: `Settings`, `SessionStore`, `TokenRecord`, `app.oidc.*`.
- Produces: `app.main.app` (FastAPI). Routes:
  - `GET /auth/login` → 302 to Keycloak (sets signed `_oidc_flow` cookie with `{state, verifier}`).
  - `GET /auth/callback?code&state` → validates flow cookie + state, exchanges code, validates id_token, creates session, sets httpOnly `sid` cookie, 302 → `SPA_ORIGIN`.
  - `GET /auth/me` → `{authenticated, username, roles}` (200) or 401.
  - `POST /auth/bind` (cookie) body `{canvas_sessions: [...]}` → binds each to the caller's `sid`; 200 `{ok:true}` or 401.
  - `POST /auth/logout` (cookie) → evicts session, returns `{logout_url}`, deletes `sid` cookie.
  - `POST /a2a/message` (header `X-Proxy-Secret`, `X-Canvas-Session`) → resolves token (refresh if needed), forwards the JSON body to the Data Agent with `Authorization: Bearer`, streams NDJSON back. 401 if unbound/expired, 403 if bad proxy secret.
  - Module-level singletons `settings` and `store` created at import from env; a `get_http_client()` seam returning `httpx.AsyncClient` so tests can inject.

- [ ] **Step 1: Write failing auth-route tests**

`apps/gis-canvas-bff/tests/test_routes.py`:
```python
import os

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

# Env must exist before importing app.main (it builds Settings at import).
os.environ.setdefault("KEYCLOAK_ISSUER", "http://dev.com:8080/realms/master")
os.environ.setdefault("KEYCLOAK_CLIENT_ID", "gis-canvas-bff")
os.environ.setdefault("KEYCLOAK_CLIENT_SECRET", "sekret")
os.environ.setdefault("BFF_REDIRECT_URI", "http://localhost:9109/auth/callback")
os.environ.setdefault("SPA_ORIGIN", "http://localhost:5174")
os.environ.setdefault("POST_LOGOUT_REDIRECT", "http://localhost:5174/")
os.environ.setdefault("SESSION_SECRET", "s" * 40)
os.environ.setdefault("DATA_AGENT_URL", "http://localhost:2024")
os.environ.setdefault("GIS_BFF_PROXY_SECRET", "p" * 40)

from app import main as bff  # noqa: E402
from app.sessions import TokenRecord  # noqa: E402


@pytest.fixture(autouse=True)
def _reset():
    bff.store._by_sid.clear()
    bff.store._canvas_to_sid.clear()
    yield


def _client() -> TestClient:
    # Do not follow redirects so we can assert 302s.
    return TestClient(bff.app, follow_redirects=False)


def test_login_redirects_to_keycloak_and_sets_flow_cookie():
    meta = {"authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
            "token_endpoint": "http://kc/t", "jwks_uri": "http://kc/j",
            "end_session_endpoint": "http://kc/logout"}
    with respx.mock:
        respx.get("http://dev.com:8080/realms/master/.well-known/openid-configuration").mock(
            return_value=httpx.Response(200, json=meta))
        r = _client().get("/auth/login")
    assert r.status_code == 302
    assert r.headers["location"].startswith(meta["authorization_endpoint"])
    assert "_oidc_flow" in r.cookies


def test_me_401_when_no_session():
    r = _client().get("/auth/me")
    assert r.status_code == 401


def test_bind_401_when_no_session():
    r = _client().post("/auth/bind", json={"canvas_sessions": ["c1"]})
    assert r.status_code == 401


def test_me_and_bind_when_session_present():
    # Seed a session and set the sid cookie directly.
    sid = bff.store.create(TokenRecord(access_token="AT", refresh_token="RT", id_token="IT",
                                       expires_at=9e9, username="jsmith", roles=["selectdata"]))
    c = _client()
    c.cookies.set("sid", sid)
    me = c.get("/auth/me")
    assert me.status_code == 200 and me.json()["username"] == "jsmith"
    b = c.post("/auth/bind", json={"canvas_sessions": ["stored-1", "live-1"]})
    assert b.status_code == 200
    assert bff.store.sid_for_canvas("stored-1") == sid
    assert bff.store.sid_for_canvas("live-1") == sid
```

- [ ] **Step 2: Write failing proxy tests**

`apps/gis-canvas-bff/tests/test_proxy.py`:
```python
import os

import httpx
import respx
from fastapi.testclient import TestClient

os.environ.setdefault("KEYCLOAK_ISSUER", "http://dev.com:8080/realms/master")
os.environ.setdefault("KEYCLOAK_CLIENT_ID", "gis-canvas-bff")
os.environ.setdefault("KEYCLOAK_CLIENT_SECRET", "sekret")
os.environ.setdefault("BFF_REDIRECT_URI", "http://localhost:9109/auth/callback")
os.environ.setdefault("SPA_ORIGIN", "http://localhost:5174")
os.environ.setdefault("POST_LOGOUT_REDIRECT", "http://localhost:5174/")
os.environ.setdefault("SESSION_SECRET", "s" * 40)
os.environ.setdefault("DATA_AGENT_URL", "http://localhost:2024")
os.environ.setdefault("GIS_BFF_PROXY_SECRET", "p" * 40)

from app import main as bff  # noqa: E402
from app.sessions import TokenRecord  # noqa: E402

_BODY = {"jsonrpc": "2.0", "id": "1", "method": "message/stream",
         "params": {"message": {"messageId": "m", "role": "user",
                                "parts": [{"kind": "text", "text": "hi"}]}}}


def _seed_bound(canvas="c1", expires_at=9e9) -> str:
    bff.store._by_sid.clear()
    bff.store._canvas_to_sid.clear()
    sid = bff.store.create(TokenRecord(access_token="AT", refresh_token="RT", id_token="IT",
                                       expires_at=expires_at, username="jsmith", roles=["selectdata"]))
    bff.store.bind(sid, [canvas])
    return sid


def test_proxy_403_on_bad_proxy_secret():
    _seed_bound()
    r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                 headers={"X-Proxy-Secret": "wrong", "X-Canvas-Session": "c1"})
    assert r.status_code == 403


def test_proxy_401_when_canvas_unbound():
    _seed_bound(canvas="c1")
    r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                 headers={"X-Proxy-Secret": "p" * 40, "X-Canvas-Session": "unknown"})
    assert r.status_code == 401


def test_proxy_forwards_bearer_and_streams_ndjson():
    _seed_bound(canvas="c1")
    captured = {}

    def _agent(request):
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = request.content.decode()
        ndjson = ('{"result":{"kind":"status-update","status":{"state":"working"}}}\n'
                  '{"result":{"kind":"task","status":{"state":"completed"}}}\n')
        return httpx.Response(200, text=ndjson)

    with respx.mock:
        respx.post("http://localhost:2024/").mock(side_effect=_agent)
        r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                     headers={"X-Proxy-Secret": "p" * 40, "X-Canvas-Session": "c1"})
    assert r.status_code == 200
    assert captured["auth"] == "Bearer AT"
    assert '"kind":"task"' in r.text
```

- [ ] **Step 3: Run both to verify they fail**

Run: `apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests/test_routes.py apps/gis-canvas-bff/tests/test_proxy.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 4: Implement `main.py`**

`apps/gis-canvas-bff/app/main.py`:
```python
"""GIS Canvas BFF — OIDC (Authorization Code + PKCE) + authenticated A2A proxy.
Tokens live only here (in-memory, keyed by sid); the browser holds only the
opaque httpOnly sid cookie, and the gateway/plugin forward only a canvas session
id + the shared proxy secret."""
from __future__ import annotations

import asyncio
import secrets
import time
from collections import defaultdict

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from . import oidc
from .config import Settings
from .sessions import SessionStore, TokenRecord

settings = Settings.from_env()
store = SessionStore()
_signer = URLSafeTimedSerializer(settings.session_secret)
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

app = FastAPI(title="gis-canvas-bff")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.spa_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def get_http_client() -> httpx.AsyncClient:  # test seam
    return httpx.AsyncClient(timeout=180.0)


async def _meta(client: httpx.AsyncClient) -> dict:
    return await oidc.fetch_metadata(settings.keycloak_issuer, client)


# ── Auth ──────────────────────────────────────────────────────────────────────

@app.get("/auth/login")
async def login():
    state = secrets.token_urlsafe(32)
    verifier, challenge = oidc.make_pkce()
    async with get_http_client() as client:
        meta = await _meta(client)
    flow = _signer.dumps({"state": state, "verifier": verifier})
    url = oidc.build_authorize_url(meta, settings, state, challenge)
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie("_oidc_flow", flow, httponly=True, samesite="lax", max_age=300, path="/auth")
    return resp


@app.get("/auth/callback")
async def callback(code: str, state: str, request: Request):
    flow_cookie = request.cookies.get("_oidc_flow")
    try:
        flow = _signer.loads(flow_cookie, max_age=300)
    except (BadSignature, SignatureExpired, TypeError):
        return JSONResponse({"error": "invalid or expired flow"}, status_code=400)
    if flow["state"] != state:
        return JSONResponse({"error": "state mismatch"}, status_code=400)
    async with get_http_client() as client:
        meta = await _meta(client)
        tokens = await oidc.exchange_code(meta, settings, code, flow["verifier"], client)
        claims = await oidc.validate_id_token(meta, settings, tokens["id_token"], client)
    sid = store.create(TokenRecord(
        access_token=tokens["access_token"],
        refresh_token=tokens.get("refresh_token", ""),
        id_token=tokens["id_token"],
        expires_at=time.time() + tokens.get("expires_in", 900),
        username=claims.get("preferred_username", ""),
        roles=claims.get("roles", []),
    ))
    resp = RedirectResponse(settings.spa_origin, status_code=302)
    resp.set_cookie("sid", sid, httponly=True, secure=False, samesite="lax", path="/")
    resp.delete_cookie("_oidc_flow", path="/auth")
    return resp


@app.get("/auth/me")
async def me(request: Request):
    rec = store.get(request.cookies.get("sid", ""))
    if not rec:
        return JSONResponse({"authenticated": False}, status_code=401)
    return {"authenticated": True, "username": rec.username, "roles": rec.roles}


@app.post("/auth/bind")
async def bind(request: Request):
    sid = request.cookies.get("sid", "")
    if not store.get(sid):
        return JSONResponse({"error": "not authenticated"}, status_code=401)
    body = await request.json()
    store.bind(sid, [str(c) for c in (body.get("canvas_sessions") or []) if c])
    return {"ok": True}


@app.post("/auth/logout")
async def logout(request: Request):
    sid = request.cookies.get("sid", "")
    rec = store.evict(sid)
    logout_url = settings.post_logout_redirect
    if rec and rec.id_token:
        async with get_http_client() as client:
            meta = await _meta(client)
        from urllib.parse import urlencode
        logout_url = meta["end_session_endpoint"] + "?" + urlencode({
            "id_token_hint": rec.id_token,
            "post_logout_redirect_uri": settings.post_logout_redirect,
        })
    resp = JSONResponse({"logout_url": logout_url})
    resp.delete_cookie("sid", path="/")
    return resp


# ── Authenticated A2A proxy ───────────────────────────────────────────────────

async def _bearer_for(sid: str) -> str | None:
    async with _locks[sid]:
        if store.needs_refresh(sid, time.time()):
            rec = store.get(sid)
            if rec and rec.refresh_token:
                async with get_http_client() as client:
                    meta = await _meta(client)
                    try:
                        td = await oidc.refresh_tokens(meta, settings, rec.refresh_token, client)
                    except httpx.HTTPError:
                        store.evict(sid)
                        return None
                store.update(sid, TokenRecord(
                    access_token=td["access_token"],
                    refresh_token=td.get("refresh_token", rec.refresh_token),
                    id_token=rec.id_token,
                    expires_at=time.time() + td.get("expires_in", 900),
                    username=rec.username, roles=rec.roles,
                ))
        rec = store.get(sid)
        return rec.access_token if rec else None


@app.post("/a2a/message")
async def a2a_message(request: Request):
    if request.headers.get("X-Proxy-Secret") != settings.proxy_secret:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    canvas = request.headers.get("X-Canvas-Session", "")
    sid = store.sid_for_canvas(canvas)
    if not sid:
        return JSONResponse({"error": "no session for canvas"}, status_code=401)
    bearer = await _bearer_for(sid)
    if not bearer:
        return JSONResponse({"error": "session expired"}, status_code=401)
    body = await request.body()

    async def _stream():
        client = get_http_client()
        try:
            async with client.stream(
                "POST", settings.data_agent_url.rstrip("/") + "/", content=body,
                headers={"Content-Type": "application/json",
                         "Accept": "application/x-ndjson",
                         "Authorization": f"Bearer {bearer}"},
            ) as resp:
                async for chunk in resp.aiter_raw():
                    yield chunk
        finally:
            await client.aclose()

    return StreamingResponse(_stream(), media_type="application/x-ndjson")
```

- [ ] **Step 5: Run route + proxy tests to verify they pass**

Run: `apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests -q`
Expected: PASS (all tests across the three files). If the proxy stream test flakes on `aiter_raw`, confirm respx returned `text=` (respx buffers it; `aiter_raw` yields it in one chunk).

- [ ] **Step 6: Add a README and commit**

`apps/gis-canvas-bff/README.md` (short — how to run):
```markdown
# gis-canvas-bff

BFF for the GIS Generative Canvas (Phase 4b): OIDC login against Keycloak + an
authenticated A2A proxy to the Data Agent. Tokens live only here.

## Run
1. Copy `.env.example` → `.env`; fill `KEYCLOAK_CLIENT_SECRET` (Keycloak → client
   `gis-canvas-bff` → Credentials) and generate `SESSION_SECRET` / `GIS_BFF_PROXY_SECRET`
   (`python -c "import secrets;print(secrets.token_hex(32))"`). Use the SAME
   `GIS_BFF_PROXY_SECRET` on the gateway.
2. `.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 9109`

## Test
`.venv\Scripts\pytest tests -q`
```

```
git add apps/gis-canvas-bff/app/main.py apps/gis-canvas-bff/tests/test_routes.py apps/gis-canvas-bff/tests/test_proxy.py apps/gis-canvas-bff/README.md
git commit -m "gis: BFF FastAPI app — auth routes + authenticated A2A proxy"
```

---

### Task 4: Re-point the plugin datasource at the BFF

**Files:**
- Modify: `plugins/gis-canvas/a2a_client.py`, `plugins/gis-canvas/datasource.py`, `plugins/gis-canvas/tools_data.py`
- Test: `tests/plugins/gis_canvas/test_a2a_client.py`, `test_datasource.py`, `test_data_tools.py`, `test_a2a_sandbox.py`

**Interfaces:**
- Consumes: BFF `/a2a/message` (Task 3), headers `X-Canvas-Session`, `X-Proxy-Secret`.
- Produces:
  - `a2a_client.stream_events(endpoint_url, prompt, context_id=None, *, headers=None, timeout=180.0)` and `a2a_client.query(endpoint_url, prompt, context_id=None, *, headers=None, timeout=180.0)` — `auth_header` param removed; posts to `endpoint_url` **exactly** (no trailing-slash munging).
  - `A2ADataSource(bff_url: str, proxy_secret: str)`; `discover(prompt, session_id=None)`, `query(prompt, context_id=None, session_id=None)`.
  - `DataSource.discover(prompt, session_id=None)`, `DataSource.query(prompt, context_id=None, session_id=None)` (abstract).
  - `MockDataSource.discover(prompt, session_id=None)`, `MockDataSource.query(prompt, context_id=None, session_id=None)`.
  - `make_data_source()` reads `GIS_BFF_URL` + `GIS_BFF_PROXY_SECRET` for a2a mode.

- [ ] **Step 1: Update the failing `a2a_client` test**

Replace the auth-header assertions in `tests/plugins/gis_canvas/test_a2a_client.py` with header-dict passing. Add:
```python
def test_stream_events_posts_to_exact_endpoint_with_headers(monkeypatch, plugin):
    a2a = plugin.a2a_client
    seen = {}

    class _Resp:
        def raise_for_status(self): pass
        def iter_lines(self):
            yield '{"result":{"kind":"task","status":{"state":"completed"}}}'
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def _fake_stream(method, url, **kw):
        seen["url"] = url
        seen["headers"] = kw.get("headers")
        return _Resp()

    import httpx
    monkeypatch.setattr(httpx, "stream", _fake_stream)
    list(a2a.stream_events("http://localhost:9109/a2a/message", "hi",
                           headers={"X-Canvas-Session": "c1", "X-Proxy-Secret": "p"}))
    assert seen["url"] == "http://localhost:9109/a2a/message"   # no trailing-slash munging
    assert seen["headers"]["X-Canvas-Session"] == "c1"
    assert seen["headers"]["X-Proxy-Secret"] == "p"
```
(Keep the existing pure-`collect()` tests unchanged — `collect()` is not modified.)

- [ ] **Step 2: Run it to verify it fails**

Run: `.venv\Scripts\pytest tests/plugins/gis_canvas/test_a2a_client.py -q`
Expected: FAIL — `stream_events()` still has the old `auth_header` signature / munges the URL.

- [ ] **Step 3: Edit `a2a_client.py`**

Replace `stream_events` and `query` (lines 66-94) with:
```python
def stream_events(endpoint_url: str, prompt: str, context_id: str | None = None,
                  *, headers: dict | None = None, timeout: float = 180.0) -> Iterator[dict]:
    import httpx  # local import: keep module importable without httpx for pure collect() tests
    message = {"messageId": str(uuid.uuid4()), "role": "user",
               "parts": [{"kind": "text", "text": prompt}]}
    if context_id:
        message["contextId"] = context_id
    payload = {"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "message/stream",
               "params": {"message": message}}
    h = {"Content-Type": "application/json", "Accept": "application/x-ndjson"}
    if headers:
        h.update(headers)
    with httpx.stream("POST", endpoint_url, json=payload, headers=h, timeout=timeout) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def query(endpoint_url: str, prompt: str, context_id: str | None = None,
          *, headers: dict | None = None, timeout: float = 180.0) -> A2AResult:
    return collect(stream_events(endpoint_url, prompt, context_id, headers=headers, timeout=timeout))
```

- [ ] **Step 4: Run the a2a_client test to verify it passes**

Run: `.venv\Scripts\pytest tests/plugins/gis_canvas/test_a2a_client.py -q`
Expected: PASS.

- [ ] **Step 5: Update the failing `datasource` + `data_tools` tests**

In `tests/plugins/gis_canvas/test_datasource.py`, replace `A2ADataSource(url, auth_provider)` usage. Add:
```python
def test_a2a_datasource_targets_bff_endpoint_with_session_headers(monkeypatch, plugin):
    ds = plugin.datasource
    seen = {}

    def _fake_query(endpoint_url, prompt, context_id=None, *, headers=None, timeout=180.0):
        seen["endpoint"] = endpoint_url
        seen["headers"] = headers
        return ds.a2a_client.A2AResult(datasets=[{"view_name": "v", "database_name": "d"}])

    monkeypatch.setattr(ds.a2a_client, "query", _fake_query)
    src = ds.A2ADataSource("http://localhost:9109", "proxy-sekret")
    out = src.discover("what data", session_id="c1")
    assert out == [{"view_name": "v", "database_name": "d"}]
    assert seen["endpoint"] == "http://localhost:9109/a2a/message"
    assert seen["headers"]["X-Canvas-Session"] == "c1"
    assert seen["headers"]["X-Proxy-Secret"] == "proxy-sekret"


def test_make_data_source_a2a_reads_bff_env(monkeypatch, plugin):
    ds = plugin.datasource
    monkeypatch.setenv("GIS_DATA_SOURCE", "a2a")
    monkeypatch.setenv("GIS_BFF_URL", "http://localhost:9109")
    monkeypatch.setenv("GIS_BFF_PROXY_SECRET", "proxy-sekret")
    ds.reset_data_source_for_tests()
    src = ds.make_data_source()
    assert isinstance(src, ds.A2ADataSource)
```
In `tests/plugins/gis_canvas/test_data_tools.py`, ensure the data-source stub's `query`/`discover` accept `session_id=` (update the fake to `def query(self, prompt, context_id=None, session_id=None)`), and add an assertion that `data_query({"prompt": "x"}, session_id="c1")` forwards `session_id="c1"` to the source.

- [ ] **Step 6: Run them to verify they fail**

Run: `.venv\Scripts\pytest tests/plugins/gis_canvas/test_datasource.py tests/plugins/gis_canvas/test_data_tools.py -q`
Expected: FAIL — `A2ADataSource` signature / `make_data_source` env not yet updated.

- [ ] **Step 7: Edit `datasource.py`**

Replace `A2ADataSource` (lines 44-61), the `DataSource` ABC signatures (lines 37-41), `MockDataSource` method signatures (lines 96-106), `default_auth_provider` + `make_data_source` (lines 109-118):
```python
class DataSource(ABC):
    @abstractmethod
    def discover(self, prompt: str, session_id: str | None = None) -> list[dict]: ...
    @abstractmethod
    def query(self, prompt: str, context_id: str | None = None,
              session_id: str | None = None) -> QueryResult: ...


class A2ADataSource(DataSource):
    def __init__(self, bff_url: str, proxy_secret: str):
        self._endpoint = bff_url.rstrip("/") + "/a2a/message"
        self._proxy_secret = proxy_secret

    def _headers(self, session_id: str | None) -> dict:
        return {"X-Canvas-Session": session_id or "", "X-Proxy-Secret": self._proxy_secret}

    def discover(self, prompt: str, session_id: str | None = None) -> list[dict]:
        r = a2a_client.query(self._endpoint, prompt, headers=self._headers(session_id))
        return r.datasets or []

    def query(self, prompt: str, context_id: str | None = None,
              session_id: str | None = None) -> QueryResult:
        r = a2a_client.query(self._endpoint, prompt, context_id, headers=self._headers(session_id))
        if r.clarification:
            return QueryResult(rows=[], schema=[], row_count=0,
                               context_id=r.context_id, clarification=r.clarification)
        rows, schema = ([], [])
        if r.query_result:
            rows, schema = rows_from_query_result(r.query_result)
        return QueryResult(rows=rows, schema=schema, row_count=len(rows), context_id=r.context_id)
```
Update `MockDataSource.discover`/`query` signatures to accept `session_id: str | None = None` (ignore it). Replace `default_auth_provider` + `make_data_source`:
```python
def make_data_source() -> DataSource:
    kind = os.environ.get("GIS_DATA_SOURCE", "mock").lower()
    if kind == "a2a":
        bff_url = os.environ.get("GIS_BFF_URL", "http://localhost:9109")
        proxy_secret = os.environ.get("GIS_BFF_PROXY_SECRET", "")
        return A2ADataSource(bff_url, proxy_secret)
    return MockDataSource()
```
Delete the now-unused `default_auth_provider`, the `Callable` import, and the `from . import a2a_client` stays.

- [ ] **Step 8: Edit `tools_data.py` to thread `session_id`**

`data_discover` (line 14) and `data_query` (line 22):
```python
def data_discover(args: dict, **kw) -> str:
    prompt = str(args.get("prompt") or "")
    if not prompt:
        return json.dumps({"ok": False, "errors": ["'prompt' is required"]})
    datasets = get_data_source().discover(prompt, session_id=kw.get("session_id"))
    return json.dumps({"ok": True, "datasets": datasets}, ensure_ascii=False)


def data_query(args: dict, **kw) -> str:
    prompt = str(args.get("prompt") or "")
    if not prompt:
        return json.dumps({"ok": False, "errors": ["'prompt' is required"]})
    context_id = args.get("context_id")
    res = get_data_source().query(prompt, context_id, session_id=kw.get("session_id"))
    if res.clarification:
        return json.dumps({"ok": True, "needs_input": True,
                           "clarification": res.clarification, "context_id": res.context_id},
                          ensure_ascii=False)
    handle = get_broker().put(res.rows, res.schema, meta={"prompt": prompt})
    return json.dumps({"ok": True, "handle": handle, "schema": res.schema,
                       "rowCount": res.row_count, "sample": res.rows[:_SAMPLE],
                       "context_id": res.context_id}, ensure_ascii=False)
```

- [ ] **Step 9: Fix `test_a2a_sandbox.py`**

This live test used `A2ADataSource(URL, ds.default_auth_provider)` and sandbox `scenario:` prefixes; both are gone. Re-point it at the BFF and gate on the BFF being up:
```python
import os
import pytest

BFF = os.environ.get("GIS_BFF_URL", "http://localhost:9109")
SECRET = os.environ.get("GIS_BFF_PROXY_SECRET", "")


def _bff_up() -> bool:
    try:
        import httpx
        # /auth/me returns 401 (not connection error) when the BFF is running
        return httpx.get(f"{BFF}/auth/me", timeout=3.0).status_code in (200, 401)
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _bff_up(), reason="gis-canvas BFF not reachable")


def test_bff_proxy_requires_proxy_secret(plugin):
    """Without X-Proxy-Secret the BFF rejects the proxy call (403)."""
    import httpx
    r = httpx.post(f"{BFF}/a2a/message", json={"jsonrpc": "2.0", "id": "1",
                   "method": "message/stream", "params": {"message": {"messageId": "m",
                   "role": "user", "parts": [{"kind": "text", "text": "hi"}]}}},
                   headers={"X-Canvas-Session": "nobody"}, timeout=5.0)
    assert r.status_code in (401, 403)
```

- [ ] **Step 10: Run the full plugin suite to verify it passes**

Run: `.venv\Scripts\pytest tests/plugins/gis_canvas -q`
Expected: PASS. The old sandbox test count changes; the ≥90 non-sandbox tests must stay green. Confirm no test references `default_auth_provider` or `DATA_AGENT_AUTH_TOKEN`.

- [ ] **Step 11: Commit**

```
git add plugins/gis-canvas/a2a_client.py plugins/gis-canvas/datasource.py plugins/gis-canvas/tools_data.py tests/plugins/gis_canvas/test_a2a_client.py tests/plugins/gis_canvas/test_datasource.py tests/plugins/gis_canvas/test_data_tools.py tests/plugins/gis_canvas/test_a2a_sandbox.py
git commit -m "gis: re-point plugin datasource at the BFF proxy (session_id, no static token)"
```

---

### Task 5: SPA login gate + session bind + logout

**Files:**
- Create: `apps/gis-canvas/src/lib/auth.ts`, `apps/gis-canvas/src/lib/auth.test.ts`
- Modify: `apps/gis-canvas/src/App.tsx`, `apps/gis-canvas/src/App.test.tsx`

**Interfaces:**
- Consumes: BFF `/auth/me`, `/auth/login`, `/auth/bind`, `/auth/logout`.
- Produces (in `lib/auth.ts`):
  - `resolveBffUrl(env): string` — from `VITE_BFF_URL` (throws if unset).
  - `authMe(bffUrl): Promise<{ authenticated: boolean; username?: string; roles?: string[] }>`.
  - `loginUrl(bffUrl): string`.
  - `bindSessions(bffUrl, ids: string[]): Promise<void>`.
  - `logout(bffUrl): Promise<string>` — returns the Keycloak logout URL to navigate to.

- [ ] **Step 1: Write the failing `auth.ts` test**

`apps/gis-canvas/src/lib/auth.test.ts`:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveBffUrl, authMe, loginUrl, bindSessions } from './auth'

afterEach(() => vi.restoreAllMocks())

describe('auth', () => {
  it('resolveBffUrl reads VITE_BFF_URL', () => {
    expect(resolveBffUrl({ VITE_BFF_URL: 'http://localhost:9109' })).toBe('http://localhost:9109')
    expect(() => resolveBffUrl({})).toThrow()
  })

  it('loginUrl points at /auth/login', () => {
    expect(loginUrl('http://localhost:9109')).toBe('http://localhost:9109/auth/login')
  })

  it('authMe returns authenticated=false on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    expect(await authMe('http://b')).toEqual({ authenticated: false })
  })

  it('authMe returns user on 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ authenticated: true, username: 'jsmith', roles: ['selectdata'] }),
    }))
    expect(await authMe('http://b')).toEqual({ authenticated: true, username: 'jsmith', roles: ['selectdata'] })
  })

  it('bindSessions POSTs canvas_sessions with credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await bindSessions('http://b', ['stored-1', 'live-1'])
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://b/auth/bind')
    expect(opts.method).toBe('POST')
    expect(opts.credentials).toBe('include')
    expect(JSON.parse(opts.body)).toEqual({ canvas_sessions: ['stored-1', 'live-1'] })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run -w @hermes/gis-canvas test -- auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 3: Implement `lib/auth.ts`**

`apps/gis-canvas/src/lib/auth.ts`:
```typescript
export interface AuthState {
  authenticated: boolean
  username?: string
  roles?: string[]
}

export function resolveBffUrl(env: Record<string, string | undefined>): string {
  if (env.VITE_BFF_URL) return env.VITE_BFF_URL
  throw new Error('Set VITE_BFF_URL (e.g. http://localhost:9109) to enable auth.')
}

export function loginUrl(bffUrl: string): string {
  return `${bffUrl}/auth/login`
}

export async function authMe(bffUrl: string): Promise<AuthState> {
  const r = await fetch(`${bffUrl}/auth/me`, { credentials: 'include' })
  if (!r.ok) return { authenticated: false }
  return (await r.json()) as AuthState
}

export async function bindSessions(bffUrl: string, ids: string[]): Promise<void> {
  await fetch(`${bffUrl}/auth/bind`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvas_sessions: ids }),
  })
}

export async function logout(bffUrl: string): Promise<string> {
  const r = await fetch(`${bffUrl}/auth/logout`, { method: 'POST', credentials: 'include' })
  const data = (await r.json()) as { logout_url: string }
  return data.logout_url
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run -w @hermes/gis-canvas test -- auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing App gate test**

Add to `apps/gis-canvas/src/App.test.tsx` a test that when `authMe` resolves `authenticated:false`, the app renders a "Login with Keycloak" control and does NOT call `session.create`. Use the existing fake-gateway injection pattern in that file; mock the auth module:
```typescript
vi.mock('./lib/auth', async (orig) => ({
  ...(await orig<typeof import('./lib/auth')>()),
  resolveBffUrl: () => 'http://bff',
  authMe: vi.fn().mockResolvedValue({ authenticated: false }),
  bindSessions: vi.fn(),
}))

it('shows login gate when unauthenticated and skips session.create', async () => {
  const client = makeFakeGateway() // reuse the file's existing helper
  render(<App client={client} wsUrl="ws://x" />)
  expect(await screen.findByText(/log in with keycloak/i)).toBeInTheDocument()
  expect(client.request).not.toHaveBeenCalledWith('session.create', expect.anything())
})
```
(If `App.test.tsx` has no `makeFakeGateway` helper, mirror the fake client already used by its other tests.)

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run -w @hermes/gis-canvas test -- App.test.tsx`
Expected: FAIL — no login gate rendered yet.

- [ ] **Step 7: Add the gate + bind to `App.tsx`**

At the top of the component, add auth state and an effect that checks `authMe` before connecting; gate the connect/session.create effect on `auth?.authenticated`; after `session.create` succeeds, call `bindSessions(bffUrl, [stored, live])`. Concretely:
- import: `import { resolveBffUrl, authMe, loginUrl, bindSessions, logout, type AuthState } from './lib/auth'`
- add state: `const [auth, setAuth] = useState<AuthState | null>(null)` and `const bffUrl = useMemo(() => resolveBffUrl(import.meta.env as Record<string,string|undefined>), [])`
- new effect (runs once): `useEffect(() => { void authMe(bffUrl).then(setAuth) }, [bffUrl])`
- guard the existing connect effect: change `if (!startedRef.current)` to `if (!startedRef.current && auth?.authenticated)`, and add `auth` to that effect's dependency array.
- inside the connect effect, right after `canvasKeyRef.current = created.stored_session_id ?? created.session_id`, add:
  ```typescript
  void bindSessions(bffUrl, [created.stored_session_id ?? created.session_id, created.session_id].filter(Boolean) as string[])
  ```
- render: when `auth && !auth.authenticated`, return a centered panel with a button:
  ```tsx
  if (auth && !auth.authenticated) {
    return (
      <div className="flex h-screen items-center justify-center">
        <a href={loginUrl(bffUrl)} className="rounded bg-blue-600 px-4 py-2 text-white">Log in with Keycloak</a>
      </div>
    )
  }
  ```
- add a small logout affordance in the header area (optional for the gate test): a button calling `logout(bffUrl).then(u => { window.location.href = u })`.

- [ ] **Step 8: Run App + full frontend suite + typecheck**

Run:
```
npm run -w @hermes/gis-canvas test
npm run -w @hermes/gis-canvas build
```
Expected: all vitest tests PASS (49 existing + new auth/App tests); `build` (tsc + vite) succeeds. If `build` trips `TS2688` for jest-dom, run `npm install` at the repo root (the dashboard prunes devDeps — see ONBOARDING gotcha).

- [ ] **Step 9: Commit**

```
git add apps/gis-canvas/src/lib/auth.ts apps/gis-canvas/src/lib/auth.test.ts apps/gis-canvas/src/App.tsx apps/gis-canvas/src/App.test.tsx
git commit -m "gis: SPA login gate + canvas-session bind + logout (Phase 4b)"
```

---

### Task 6: Live end-to-end wiring, verification, and docs

**Files:**
- Modify: `apps/gis-canvas/docs/2026-07-06-phase4b-oidc-bff-design.md` (append a "Verified" note), `ONBOARDING.md` (update the 4b status + run notes)
- No production code changes — this task wires the running stack and proves it.

**Interfaces:** none (integration).

- [ ] **Step 1: Populate the BFF `.env`**

Copy `apps/gis-canvas-bff/.env.example` → `apps/gis-canvas-bff/.env`; set `KEYCLOAK_CLIENT_SECRET` (already placed by the operator), generate `SESSION_SECRET` and `GIS_BFF_PROXY_SECRET`:
```
apps\gis-canvas-bff\.venv\Scripts\python -c "import secrets;print('SESSION_SECRET',secrets.token_hex(32));print('GIS_BFF_PROXY_SECRET',secrets.token_hex(32))"
```
Confirm `git status` shows `.env` untracked/ignored.

- [ ] **Step 2: Start the BFF**

Run (own terminal):
```
cd apps/gis-canvas-bff
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 9109
```
Verify: `curl http://localhost:9109/auth/me` → HTTP 401 `{"authenticated":false}`.

- [ ] **Step 3: Start the gateway in a2a mode pointed at the BFF**

Run (own terminal), using the SAME proxy secret as the BFF `.env`:
```
$env:HERMES_DASHBOARD_SESSION_TOKEN="dev-gis-local"
$env:GIS_DATA_SOURCE="a2a"
$env:GIS_BFF_URL="http://localhost:9109"
$env:GIS_BFF_PROXY_SECRET="<same as BFF .env>"
hermes dashboard --no-open --port 9119
```
Wait for `HERMES_DASHBOARD_READY port=9119`. Then `npm install` at the repo root (dashboard prunes devDeps).

- [ ] **Step 4: Build + preview the SPA with the BFF URL**

Run (own terminal):
```
$env:VITE_HERMES_TOKEN="dev-gis-local"; $env:VITE_BFF_URL="http://localhost:9109"
npm run -w "@hermes/gis-canvas" build
cd apps/gis-canvas ; npx vite preview --port 5174 --host 127.0.0.1
```

- [ ] **Step 5: Browser login + session-id verification (the §6 risk)**

Open `http://localhost:5174` → click "Log in with Keycloak" → authenticate as the Denodo test user → land back on the canvas ("Agent ● connected"). Temporarily add a one-line debug log in `plugins/gis-canvas/tools_data.py` `data_query` (`import sys; print("TOOL session_id=", kw.get("session_id"), file=sys.stderr)`), ask the agent `Discover what datasets are available.`, and confirm the printed `session_id` equals one of the two bound ids (visible in the SPA `session … ready` log / `canvas.interaction` key). Remove the debug line after confirming. If it matches neither, adjust the `bindSessions([...])` id list in `App.tsx` to include the id the tool actually receives, rebuild, retest.

- [ ] **Step 6: Live real-Denodo e2e**

In the chat, run:
- `Discover what datasets are available.` → expect a real dataset list from Denodo (not the Portland mock).
- `Retrieve <a real dataset/view> and show it in a data-table and on a map.` → expect a `data://` handle bound into components; the browser pulls rows via `canvas.data_fetch`; rows render. Confirm in the BFF terminal that a `POST /a2a/message` occurred and (via the Data Agent logs if visible) that the query ran as the logged-in user. Confirm the agent context never received bulk rows (the tool result shows `sample≤3`).

- [ ] **Step 7: Run the BFF live-gated plugin test + full suites**

Run:
```
.venv\Scripts\pytest tests/plugins/gis_canvas -q
apps\gis-canvas-bff\.venv\Scripts\pytest apps/gis-canvas-bff/tests -q
npm run -w @hermes/gis-canvas test
```
Expected: all green; `test_a2a_sandbox.py::test_bff_proxy_requires_proxy_secret` now runs (BFF up) and passes.

- [ ] **Step 8: Update docs and commit**

Append a short "Verified <date>" note to the design doc's §12 (what was tested live, and the confirmed tool `session_id` identity). In `ONBOARDING.md`, update the "Current state" line to mark Phase 4b done, add the BFF to the run notes (port 9109, `.env`, `GIS_BFF_URL`/`GIS_BFF_PROXY_SECRET`, `VITE_BFF_URL`), and note that data now flows through the BFF (mock remains the default for non-auth work).
```
git add apps/gis-canvas/docs/2026-07-06-phase4b-oidc-bff-design.md ONBOARDING.md
git commit -m "gis: Phase 4b verified live — real OIDC + Denodo through the BFF"
```

---

## Self-Review

**Spec coverage:** §2 architecture → Tasks 1-5; §3 Keycloak client → already done + Task 6 setup; §4 auth flow (login/callback/me/bind/logout, refresh) → Tasks 2-3, 5; §5 data flow + §14 invariant → Task 4 (+ Task 6 live proof); §6 session keying/bind → Tasks 3, 5, and the §6 live-verify in Task 6 Step 5; §7 coupling → Global Constraints + `mock` default in Task 4; §8 config/ports/env/proxy-secret → `.env.example` (T1), `make_data_source` (T4), Task 6 wiring; §9 error handling (401/403/refresh/BFF-down) → Task 3 proxy tests + `_bearer_for`; §10 testing → every task's tests + Task 6; §11 change surface → matches Tasks 1-5; §12 setup checklist → Task 6 Steps 1-4; §13 risks → session-id (T6 S5), coupling (constraints).

**Placeholder scan:** no TBD/TODO; every code step shows full code; commands have expected output.

**Type consistency:** `SessionStore` method names used identically across Tasks 1/3; `A2ADataSource(bff_url, proxy_secret)` + `.discover(prompt, session_id=)` / `.query(prompt, context_id=, session_id=)` consistent across Tasks 4/6; `a2a_client.query(endpoint_url, prompt, context_id=None, *, headers=None, ...)` consistent across Tasks 4; `authMe/loginUrl/bindSessions/logout` signatures consistent across Task 5. `X-Canvas-Session` / `X-Proxy-Secret` header names identical in BFF (T3) and plugin (T4).
