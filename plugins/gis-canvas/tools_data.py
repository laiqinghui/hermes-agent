"""Agent-facing data tools. The invariant: data_query returns ONLY
{handle, schema, rowCount, sample<=3} -- bulk rows live only on the data plane
(broker cache), fetched by the browser via canvas.data_fetch."""
from __future__ import annotations

import json

from .broker import get_broker
from .datasource import get_data_source

_SAMPLE = 3


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


DATA_DISCOVER_SCHEMA = {
    "name": "data_discover",
    "description": (
        "Discover enterprise datasets/views via the Data Agent (metadata only - no rows). "
        "Returns {ok, datasets:[{view_name, database_name, description}]}. Use this to learn what "
        "data exists before retrieving. Skill selection is automatic from your prompt."
    ),
    "parameters": {"type": "object",
                   "properties": {"prompt": {"type": "string", "description": "Natural-language discovery query."}},
                   "required": ["prompt"]},
}

DATA_QUERY_SCHEMA = {
    "name": "data_query",
    "description": (
        "Retrieve rows for ONE dataset via the Data Agent and cache them server-side. Returns "
        "{ok, handle:'data://...', schema, rowCount, sample(<=3 rows)} - NEVER the full rows (they live on "
        "the data plane; the canvas fetches them by handle). Bind the returned handle into a component "
        "(data-table bindings.source, or esri:map/esri:feature-table layer). One table per call - no "
        "cross-table JOINs; retrieve piecemeal. If the agent needs clarification you get "
        "{ok, needs_input:true, clarification, context_id}: ask the user, then call again passing that "
        "context_id to continue the same conversation."
    ),
    "parameters": {"type": "object",
                   "properties": {
                       "prompt": {"type": "string", "description": "Natural-language retrieval request for one dataset."},
                       "context_id": {"type": "string", "description": "Reuse to answer a prior clarification (multi-turn)."}},
                   "required": ["prompt"]},
}

DATA_TOOL_DEFS = [
    ("data_discover", DATA_DISCOVER_SCHEMA, data_discover,
     "Discover enterprise datasets (metadata only)", "🔎"),
    ("data_query", DATA_QUERY_SCHEMA, data_query,
     "Retrieve rows → data:// handle (bulk stays server-side)", "📥"),
]
