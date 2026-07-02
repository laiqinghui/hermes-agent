"""Gateway-process entry point for inbound canvas.interaction JSON-RPC calls.

Reached from tui_gateway/server.py via a single fenced @method delegate (the
one core edit). Returns a plain result dict; the @method wraps it with _ok().
"""
from __future__ import annotations

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
