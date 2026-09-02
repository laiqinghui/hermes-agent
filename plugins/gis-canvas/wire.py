"""Gateway-process entry point for inbound canvas.interaction JSON-RPC calls.

Reached from tui_gateway/server.py via a single fenced @method delegate (the
one core edit). Returns a plain result dict; the @method wraps it with _ok().
"""
from __future__ import annotations

from .broker import get_broker
from .interaction import apply_interaction
from .tools_canvas import get_store


def handle_canvas_interaction(params: dict) -> dict:
    session_id = str((params or {}).get("session_id") or "")
    target = str((params or {}).get("target") or "")
    state_patch = (params or {}).get("state") or {}
    if not session_id or not target:
        return {"ok": False, "errors": ["session_id and target are required"]}
    store = get_store()
    doc = store.get(session_id)
    if doc is None:
        return {"ok": False, "errors": [f"no canvas for session '{session_id}'"]}
    patched, errors = apply_interaction(doc, target, state_patch)
    if errors:
        return {"ok": False, "errors": errors, "rev": doc.get("rev")}
    stored = store.put(session_id, patched)
    return {"ok": True, "rev": stored.get("rev")}


def handle_canvas_get(params: dict) -> dict:
    """Inbound canvas.get: return the stored doc for a session, or None. Purely
    read-only — the session browser opens past canvases through this."""
    session_id = str((params or {}).get("session_id") or "")
    if not session_id:
        return {"ok": False, "errors": ["session_id is required"]}
    return {"ok": True, "doc": get_store().get(session_id)}


def handle_canvas_list(params: dict) -> dict:
    """Inbound canvas.list: the stored canvas keys, so the session picker can
    mark which sessions already have a canvas."""
    return {"ok": True, "keys": get_store().list()}


def handle_canvas_data_fetch(params: dict) -> dict:
    """Inbound canvas.data_fetch: serve a page of rows from the broker cache by
    handle. Bulk rows travel on this data plane only — never the agent context."""
    p = params or {}
    handle = str(p.get("handle") or "")
    if not handle:
        return {"ok": False, "errors": ["'handle' is required"]}
    return get_broker().page(
        handle,
        page=int(p.get("page", 0) or 0),
        page_size=int(p.get("pageSize", 100) or 100),
        filter=p.get("filter"),
        fields=p.get("fields"),
    )
