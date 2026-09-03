"""Gateway-process entry point for inbound canvas.interaction JSON-RPC calls.

Reached from tui_gateway/server.py via a single fenced @method delegate (the
one core edit). Returns a plain result dict; the @method wraps it with _ok().
"""
from __future__ import annotations

from .broker import get_broker
from .interaction import apply_interaction
from .judge import verdict_from
from .preview_index import get_preview_index
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


def handle_canvas_preview_get(params: dict) -> dict:
    """Inbound canvas.preview_get: the cached preview record for a foreign
    session, or None when it has never been judged."""
    source = str((params or {}).get("source_session_id") or "")
    if not source:
        return {"ok": False, "errors": ["source_session_id is required"]}
    return {"ok": True, "record": get_preview_index().get(source)}


def handle_canvas_preview_set(params: dict) -> dict:
    """Inbound canvas.preview_set: remember the preview session and the render
    verdict for a foreign session, so it is judged once and never again."""
    p = params or {}
    source = str(p.get("source_session_id") or "")
    preview = str(p.get("preview_session_id") or "")
    verdict = str(p.get("verdict") or "")
    if not source or not preview:
        return {"ok": False, "errors": ["source_session_id and preview_session_id are required"]}
    if verdict not in ("rendered", "declined"):
        return {"ok": False, "errors": ["verdict must be 'rendered' or 'declined'"]}
    record = get_preview_index().put(source, {
        "preview_session_id": preview,
        "verdict": verdict,
        "reason": str(p.get("reason") or ""),
    })
    return {"ok": True, "record": record}


def handle_canvas_judge_finish(params: dict) -> dict:
    """Finalise a judging turn: derive the verdict from what the agent said AND
    whether a canvas actually landed in the store, then cache it so this foreign
    session is never judged again. Called by the gateway's canvas.judge once the
    turn has genuinely finished — the client cannot observe turn boundaries."""
    p = params or {}
    source = str(p.get("source_session_id") or "")
    preview = str(p.get("preview_session_id") or "")
    if not source or not preview:
        return {"ok": False, "errors": ["source_session_id and preview_session_id are required"]}
    doc = get_store().get(preview)
    verdict, reason = verdict_from(str(p.get("answer") or ""), doc)
    record = get_preview_index().put(source, {
        "preview_session_id": preview,
        "verdict": verdict,
        "reason": reason,
    })
    return {"ok": True, "record": record, "doc": doc}


def handle_canvas_branch_doc(params: dict) -> dict:
    """Inbound (from canvas.branch): copy a canvas doc onto a branch's key.

    The parent's doc is READ ONLY — the branch gets its own file, stamped as
    its own rev 1 by CanvasStore.put. That separation is what lets a branch
    diverge without ever altering the session it came from.

    A parent with no canvas is normal (a conversation-only session), not an
    error: nothing is written and the caller gets None.
    """
    p = params or {}
    from_key = str(p.get("from_key") or "")
    to_key = str(p.get("to_key") or "")
    if not from_key or not to_key:
        return {"ok": False, "errors": ["from_key and to_key are required"]}
    store = get_store()
    doc = store.get(from_key)
    if doc is None:
        return {"ok": True, "doc": None}
    return {"ok": True, "doc": store.put(to_key, doc)}
