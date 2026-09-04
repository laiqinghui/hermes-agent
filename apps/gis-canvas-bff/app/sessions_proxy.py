"""Session browsing and management for Thoughts Canvas.

Proxies the gateway's session endpoints. The invariant is about BROWSING, not
about this module: reading a session must never change it, so the GET routes
below are side-effect free and no resume/branch call may be added to them.

The PATCH and DELETE routes are explicit, user-initiated management actions
(rename, archive, delete) and are deliberately separate from the read path.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


def visible_sessions(rows: list[dict], principal: str) -> list[dict]:
    """Which sessions this principal may see.

    v1: every session on the host, for any authenticated user. This matches the
    single-operator deployment and is a deliberate, documented choice — there is
    no OIDC-subject column on ``sessions`` to filter by (the existing
    ``user_id`` is platform-scoped, e.g. a Telegram user id). The rule is
    isolated here so tightening it later is one change with one test.
    """
    return rows


def _init(app_module) -> APIRouter:
    """Bind the router to the app module (settings, session store, http client)
    without importing main.py at module scope — main.py imports us."""
    settings = app_module.settings
    store = app_module.store

    def _principal(request: Request) -> str | None:
        rec = store.get(request.cookies.get("sid", ""))
        return rec.username if rec else None

    async def _get(path: str, params: dict | None = None):
        async with app_module.get_http_client() as client:
            return await client.get(
                f"{settings.gateway_url}{path}",
                params=params,
                headers={"X-Hermes-Session-Token": settings.gateway_token},
            )

    @router.get("/sessions")
    async def list_sessions(
        request: Request, limit: int = 100, offset: int = 0, min_messages: int = 1
    ):
        # min_messages defaults to 1: the picker exists to find a session worth
        # reopening, and one with no messages never is. Filtering server-side
        # keeps paging honest — dropping rows here would leave ragged pages.
        principal = _principal(request)
        if not principal:
            return JSONResponse({"error": "not authenticated"}, status_code=401)
        try:
            r = await _get(
                "/api/sessions",
                {"limit": limit, "offset": offset, "min_messages": min_messages},
            )
        except httpx.HTTPError as exc:
            return JSONResponse({"error": f"gateway unreachable: {exc}"}, status_code=502)
        if r.status_code != 200:
            return JSONResponse({"error": "gateway error"}, status_code=502)
        body = r.json()
        rows = visible_sessions(body.get("sessions") or [], principal)
        return {"sessions": rows, "total": body.get("total", len(rows))}

    @router.get("/sessions/{session_id}/messages")
    async def session_messages(request: Request, session_id: str):
        if not _principal(request):
            return JSONResponse({"error": "not authenticated"}, status_code=401)
        try:
            r = await _get(f"/api/sessions/{session_id}/messages")
        except httpx.HTTPError as exc:
            return JSONResponse({"error": f"gateway unreachable: {exc}"}, status_code=502)
        if r.status_code == 404:
            return JSONResponse({"error": "session not found"}, status_code=404)
        if r.status_code != 200:
            return JSONResponse({"error": "gateway error"}, status_code=502)
        return r.json()

    # ── Management (explicit user actions, not part of the read path) ──────────

    async def _send(method: str, path: str, json_body: dict | None = None):
        async with app_module.get_http_client() as client:
            return await client.request(
                method,
                f"{settings.gateway_url}{path}",
                json=json_body,
                headers={"X-Hermes-Session-Token": settings.gateway_token},
            )

    def _relay(r: httpx.Response):
        """Map a gateway response onto ours: 404 stays 404 (the session is gone,
        which the caller must distinguish), anything else non-200 is a 502."""
        if r.status_code == 404:
            return JSONResponse({"error": "session not found"}, status_code=404)
        if r.status_code != 200:
            return JSONResponse({"error": "gateway error"}, status_code=502)
        return r.json()

    @router.patch("/sessions/{session_id}")
    async def update_session(request: Request, session_id: str):
        if not _principal(request):
            return JSONResponse({"error": "not authenticated"}, status_code=401)
        body = await request.json()
        # Forward ONLY the fields being changed: sending title=None would clear
        # the title, so an archive request must not carry one.
        patch = {k: body[k] for k in ("title", "archived") if k in body}
        if not patch:
            return JSONResponse({"error": "title or archived is required"}, status_code=400)
        try:
            r = await _send("PATCH", f"/api/sessions/{session_id}", patch)
        except httpx.HTTPError as exc:
            return JSONResponse({"error": f"gateway unreachable: {exc}"}, status_code=502)
        return _relay(r)

    @router.delete("/sessions/{session_id}")
    async def delete_session(request: Request, session_id: str):
        if not _principal(request):
            return JSONResponse({"error": "not authenticated"}, status_code=401)
        try:
            r = await _send("DELETE", f"/api/sessions/{session_id}")
        except httpx.HTTPError as exc:
            return JSONResponse({"error": f"gateway unreachable: {exc}"}, status_code=502)
        return _relay(r)

    return router
