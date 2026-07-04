"""Canvas authoring tools: render_view / update_view / canvas_get_state.

Handlers return JSON strings (the Hermes tool contract). Successful results
carry the full validated doc in a {"gis_canvas": true} envelope — the frontend
recognizes canvas updates by that marker on tool.complete events.
"""
from __future__ import annotations

import copy
import json

from .ops import apply_ops
from .store import CanvasStore, resolve_session_key
from .validator import DEFAULT_LAYOUT, validate_doc

_store: CanvasStore | None = None


def get_store() -> CanvasStore:
    global _store
    if _store is None:
        _store = CanvasStore()
    return _store


def reset_store_for_tests() -> None:
    global _store
    _store = None


def _index(doc: dict) -> list[dict]:
    out: list[dict] = []

    def walk(node: dict) -> None:
        out.append({"id": node["id"], "type": node["type"]})
        for kid in node.get("children", []):
            walk(kid)
        for slot_kids in node.get("slots", {}).values():
            for kid in slot_kids:
                walk(kid)

    for comp in doc.get("components", []):
        walk(comp)
    for overlay in doc.get("overlays", []):
        walk(overlay)
    return out


def _ok(doc: dict, **extra) -> str:
    payload = {"gis_canvas": True, "ok": True, "rev": doc.get("rev"),
               "components_index": _index(doc), "doc": doc}
    payload.update(extra)
    return json.dumps(payload, ensure_ascii=False)


def _err(errors: list[str], rev: int | None = None) -> str:
    return json.dumps({"gis_canvas": True, "ok": False, "errors": errors, "rev": rev},
                      ensure_ascii=False)


def render_view(args: dict, **kw) -> str:
    spec = args.get("spec")
    if not isinstance(spec, dict):
        return _err(["'spec' (object) is required — the full canvas document"])
    doc = copy.deepcopy(spec)
    doc.setdefault("canvasVersion", 1)
    doc.setdefault("layout", dict(DEFAULT_LAYOUT))
    doc.pop("rev", None)  # server-stamped
    errors = validate_doc(doc)
    if errors:
        return _err(errors)
    stored = get_store().put(resolve_session_key(kw), doc)
    return _ok(stored)


def update_view(args: dict, **kw) -> str:
    key = resolve_session_key(kw)
    current = get_store().get(key)
    if current is None:
        return _err(["no canvas exists for this session — call render_view first"])
    base_rev = args.get("base_rev")
    if base_rev != current.get("rev"):
        return _err([f"stale base_rev {base_rev}: current rev is {current.get('rev')} — "
                     "re-read state (canvas_get_state) and retry"], rev=current.get("rev"))
    ops = args.get("ops")
    if not isinstance(ops, list):
        return _err(["'ops' (array) is required"], rev=current.get("rev"))
    patched, op_errors = apply_ops(current, ops)
    if op_errors:
        return _err(op_errors, rev=current.get("rev"))
    patched.pop("rev", None)
    errors = validate_doc(patched)
    if errors:
        return _err(errors, rev=current.get("rev"))
    stored = get_store().put(key, patched)
    return _ok(stored)


def canvas_get_state(args: dict, **kw) -> str:
    doc = get_store().get(resolve_session_key(kw))
    if doc is None:
        return _err(["no canvas exists for this session — call render_view first"])
    component_id = args.get("component_id")
    if not component_id:
        return _ok(doc)
    for entry in _iter_all_nodes(doc):
        if entry.get("id") == component_id:
            return json.dumps({"gis_canvas": True, "ok": True, "rev": doc.get("rev"),
                               "node": entry}, ensure_ascii=False)
    return _err([f"component '{component_id}' not found"], rev=doc.get("rev"))


def _iter_all_nodes(doc: dict):
    stack = list(doc.get("components", [])) + list(doc.get("overlays", []))
    while stack:
        node = stack.pop()
        yield node
        stack.extend(node.get("children", []))
        for slot_kids in node.get("slots", {}).values():
            stack.extend(slot_kids)


_CATALOG_HELP = (
    "Component catalog (Phase 1): "
    "card (container; props.title; slots 'content'/'footer') | "
    "stat (props.label, props.value, optional props.trend) | "
    "data-table (bindings.source data handle: a 'data://…' handle returned by data_query, or a "
    "'mock://incidents' dev source; optional props.title, "
    "props.columns as string[]). Grid: layout.cols (default 12); every TOP-LEVEL component "
    "requires area {col,colSpan,row,rowSpan} (1-based; col+colSpan-1 must fit cols). Nesting "
    "depth max 3. NEVER inline data rows — bind data via bindings.source handles only. "
    "(Phase 2) select: {id, type:'select', area, props:{field:'<attr>', options:[...] }, "
    "state:{value}, handlers:{onChange:<Handler>}}. props.options may be a string array OR "
    "{label,value} objects. handlers (top-level on node, NOT inside props): map of eventName→Handler. "
    "Handler kinds: {kind:'reactive', controls:'<targetId>.<key>.<subkey>'} (on event, writes value "
    "to target's state client-side, no agent turn; for data-table filter: controls:'<dataTableId>.filter.<field>'); "
    "{kind:'set', target:'<id>', key:'<stateKey>', value:<v>} (fixed value to state); "
    "{kind:'agent', prompt:'<text>'} (new agent turn). data-table applies client-side filtering from "
    "state.filter (map of field→value; 'all' or empty means no filter)."
    " (Phase 3 GIS) esri:map (bindings.layers = a layer handle or array of handles; each handle is "
    "a 'data://…' handle from data_query (rows plotted client-side from lng/lat), a 'mock://<name>' "
    "dev source, or a public ArcGIS FeatureServer URL like "
    "'https://services.arcgis.com/.../FeatureServer/0'; optional props.basemap default 'osm', "
    "props.center [lng,lat], props.zoom; state.selection/extent). esri:legend (bindings.mapRef = the "
    "esri:map component id it describes). esri:feature-table (bindings.layer = a layer handle; "
    "optional bindings.mapRef = an esri:map id to highlight selected rows on that map; state.selection). "
    "Plot geospatial data on esri:map; use esri:feature-table for a spatial table of a layer."
)

RENDER_VIEW_SCHEMA = {
    "name": "render_view",
    "description": (
        "Create or fully replace the GIS canvas dashboard the user sees. Author a declarative "
        "spec: {canvasVersion:1, layout:{type:'grid',cols:12,rowHeight:80,gap:8}, components:[...]}. "
        + _CATALOG_HELP +
        " Returns {ok, rev, doc} on success or {ok:false, errors} — fix the errors and retry. "
        "Example component: {id:'s1', type:'stat', area:{col:1,colSpan:3,row:1,rowSpan:1}, "
        "props:{label:'High severity', value:42}}. "
        "Example with select filtering data-table: select component {id:'sev', type:'select', "
        "area:{col:1,colSpan:2,row:1,rowSpan:1}, props:{field:'severity', "
        "options:[{label:'All',value:'all'},{label:'High',value:'high'}]}, state:{value:'all'}, "
        "handlers:{onChange:{kind:'reactive', controls:'tbl1.filter.severity'}}} wired to data-table "
        "{id:'tbl1', type:'data-table', ..., bindings:{source:'mock://incidents'}}. When user changes "
        "select, handler writes value to tbl1's state.filter.severity client-side, filtering rows without agent turn."
        " GIS example: {id:'map1', type:'esri:map', area:{col:1,colSpan:8,row:2,rowSpan:4}, "
        "props:{basemap:'osm'}, bindings:{layers:['mock://incidents']}} with a companion "
        "{id:'lg1', type:'esri:legend', area:{...}, bindings:{mapRef:'map1'}}."
    ),
    "parameters": {
        "type": "object",
        "properties": {"spec": {"type": "object", "description": "Full canvas document."}},
        "required": ["spec"],
    },
}

UPDATE_VIEW_SCHEMA = {
    "name": "update_view",
    "description": (
        "Modify the existing canvas with targeted patch ops (cheaper than re-rendering). "
        "Pass base_rev = the rev from the last render_view/update_view/canvas_get_state result; "
        "a stale rev is rejected with the current rev. Ops: "
        "{op:'add', target:null|containerId, slot?:'content'|'footer', node:{...}} | "
        "{op:'remove', target:id} | {op:'replace', target:id, node:{...}} | "
        "{op:'setProps', target:id, props:{...}} (shallow merge) | "
        "{op:'setBinding', target:id, key:'source', value:'mock://...'}. " + _CATALOG_HELP
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "base_rev": {"type": "integer", "description": "Current canvas rev you are patching."},
            "ops": {"type": "array", "items": {"type": "object"}, "description": "Patch operations."},
        },
        "required": ["base_rev", "ops"],
    },
}

CANVAS_GET_STATE_SCHEMA = {
    "name": "canvas_get_state",
    "description": (
        "Read the current canvas document (or one component's subtree via component_id): "
        "returns {ok, rev, doc|node}. Use before update_view when unsure of current state/rev."
    ),
    "parameters": {
        "type": "object",
        "properties": {"component_id": {"type": "string", "description": "Optional component id."}},
        "required": [],
    },
}

TOOL_DEFS = [
    ("render_view", RENDER_VIEW_SCHEMA, render_view,
     "Author/replace the GIS canvas dashboard (declarative spec)", "🗺️"),
    ("update_view", UPDATE_VIEW_SCHEMA, update_view,
     "Patch the existing canvas (component-addressed ops)", "🧩"),
    ("canvas_get_state", CANVAS_GET_STATE_SCHEMA, canvas_get_state,
     "Read the current canvas document/state", "📋"),
]
