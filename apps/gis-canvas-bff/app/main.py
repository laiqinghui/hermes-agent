"""GIS Canvas BFF — OIDC (Authorization Code + PKCE) + authenticated A2A proxy.
Tokens live only here (in-memory, keyed by sid); the browser holds only the
opaque httpOnly sid cookie, and the gateway/plugin forward only a canvas session
id + the shared proxy secret."""
from __future__ import annotations

import asyncio
import hmac
import secrets
import time
from collections import defaultdict

import httpx
from fastapi import FastAPI, Request
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
            if not rec or not rec.refresh_token:
                store.evict(sid)
                return None
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
    if not hmac.compare_digest(request.headers.get("X-Proxy-Secret", ""), settings.proxy_secret):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    canvas = request.headers.get("X-Canvas-Session", "")
    sid = store.sid_for_canvas(canvas)
    if not sid:
        return JSONResponse({"error": "no session for canvas"}, status_code=401)
    bearer = await _bearer_for(sid)
    if not bearer:
        return JSONResponse({"error": "session expired"}, status_code=401)
    body = await request.body()
    client = get_http_client()
    req = client.build_request(
        "POST", settings.data_agent_url.rstrip("/") + "/", content=body,
        headers={"Content-Type": "application/json",
                 "Accept": "application/x-ndjson",
                 "Authorization": f"Bearer {bearer}"},
    )
    upstream = await client.send(req, stream=True)
    if upstream.status_code >= 400:
        detail = (await upstream.aread()).decode(errors="replace")[:2000]
        await upstream.aclose()
        await client.aclose()
        return JSONResponse({"error": "data agent error", "detail": detail},
                            status_code=upstream.status_code)

    async def _stream():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(_stream(), status_code=upstream.status_code,
                             media_type="application/x-ndjson")
