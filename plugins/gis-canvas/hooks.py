"""Per-turn agent-awareness hook. Injects a compact <canvas> summary into the
model's turn via pre_llm_call (ephemeral; not persisted to history)."""
from __future__ import annotations

from .awareness import build_canvas_summary
from .tools_canvas import get_store


def on_pre_llm_call(**kw) -> dict | None:
    session_id = str(kw.get("session_id") or "")
    if not session_id:
        return None
    doc = get_store().get(session_id)
    if not doc:
        return None
    summary = build_canvas_summary(doc)
    if not summary.strip():
        return None
    return {"context": summary}
