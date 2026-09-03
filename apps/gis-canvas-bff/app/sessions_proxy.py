"""Read-only session browsing for Thoughts Canvas.

Proxies two gateway endpoints so the SPA can list sessions and read a
transcript. Everything here is READ-ONLY by design: browsing must never mutate
someone's conversation, so no resume/branch/delete endpoint may be added to
this module.
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

    return router
