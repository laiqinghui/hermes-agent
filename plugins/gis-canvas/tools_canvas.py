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
    "requires area {col,colSpan,row,rowSpan} unless it sets a layer (see C2 shell below) "
    "(1-based; col+colSpan-1 must fit cols). Nesting "
    "depth max 3. NEVER inline data rows — bind data via bindings.source handles only. "
    "(Phase 2) select: {id, type:'select', area, props:{field:'<attr>', options:[...] }, "
    "state:{value}, handlers:{onChange:<Handler>}}. props.options may be a string array OR "
    "{label,value} objects. handlers (top-level on node, NOT inside props): map of eventName→Handler. "
    "Handler kinds: {kind:'reactive', controls:'<targetId>.<key>.<subkey>'} (on event, writes value "
    "to target's state client-side, no agent turn; for data-table filter: controls:'<dataTableId>.filter.<field>'); "
    "{kind:'set', target:'<id>', key:'<stateKey>', value:<v>} (fixed value to state); "
    "{kind:'agent', prompt:'<text>'} (new agent turn). data-table applies client-side filtering from "
    "state.filter (map of field→value; 'all' or empty means no filter)."
    " (Container) tabs: {id, type:'tabs', props:{tabs:[{id,label},...]}, "
    "state:{active:'<tabId>'}, slots:{'<tabId>':[...child nodes]}} — a tabbed "
    "container; each slot key MUST equal a props.tabs id and holds that tab's "
    "children; the shown tab is tracked client-side in state.active (no agent "
    "turn); optional handlers.onChange fires on tab switch. USE type:'tabs' (NOT a "
    "card) whenever the user asks for tabs / a tabbed panel, or to hold several "
    "views in one panel showing ONE at a time (put each view's nodes in its "
    "matching slot); use a card only when the children should all show stacked together."
    " (Phase 3 GIS) esri:map (bindings.layers = a layer handle or array of handles; each handle is "
    "a 'data://…' handle from data_query (rows plotted client-side from lng/lat), a 'mock://<name>' "
    "dev source, or a public ArcGIS FeatureServer URL like "
    "'https://services.arcgis.com/.../FeatureServer/0'; optional props.basemap default 'osm', "
    "props.center [lng,lat], props.zoom; state.selection/extent). "
    "For MULTIPLE layers, give each a name + optional color via props.layers "
    "(positional to bindings.layers): props.layers:[{title,color?}] — color is "
    "auto-assigned distinctly when omitted; ALSO author an esri:layer-list (not "
    "just a legend) so the user can distinguish/toggle them."
    " esri:legend (bindings.mapRef = the "
    "esri:map component id it describes). esri:feature-table (bindings.layer = a layer handle; "
    "optional bindings.mapRef = an esri:map id to highlight selected rows on that map; state.selection). "
    "Plot geospatial data on esri:map; use esri:feature-table for a spatial table of a layer."
    " esri:layer-list (bindings.mapRef = an esri:map id) shows that map's layers with "
    "visibility toggles; dock it like the legend. esri:map ALSO accepts props.spatialFilter:true "
    "(adds draw tools — draw a geofence/rectangle/circle/polygon to SELECT the features inside, "
    "highlighting them on the map and in any linked data-table), props.basemapToggle:true "
    "(+ optional props.basemapAlt, default 'satellite') for an in-map basemap switch, and "
    "props.render:'heatmap' to draw the primary data layer as a density surface instead of points."
    " SPATIO-TEMPORAL (moving platforms — vessels/aircraft/satellites): first CLASSIFY the "
    "data's dimensions. Coordinates + a timestamp field + a question about movement/route/history "
    "over time => render a TRACK: props.render:'track' on esri:map draws time-ordered track lines + "
    "heading arrows + a slider-driven cursor, and REQUIRES a time field. Coordinates but no usable "
    "time => props.render:'points' (or 'heatmap'). A time field but NO coordinates => a chronological "
    "data-table (temporal charts are not yet available). Field roles — timeField, latField/lngField, "
    "trackIdField (groups many platforms in ONE source into separate colored tracks — e.g. "
    "MMSI/tail number/callsign), headingField (else heading is derived from successive positions) — are "
    "OPTIONAL and PREFERABLY OMITTED: the client auto-detects them from common column names. Set a role "
    "prop ONLY to an ACTUAL column name from the source schema; NEVER invent one (e.g. do not guess "
    "'timestamp'/'vessel'/'heading' — a name that isn't a real column is ignored and detection is used "
    "instead). For a track ALSO author an esri:time-slider (bindings.mapRef = the esri:map id; dockable "
    "like the legend, edge:'bottom'; optional props.stops number) so the user can play/scrub time. The "
    "'mock://vessel-track' dev source (columns: mmsi, vessel_name, ts, lat, lng, cog) is available for "
    "spatio-temporal demos — OMIT the field props and they are auto-detected."
    " (Phase B C2 shell) A top-level component may use a LAYER instead of a grid area to build a "
    "Command-and-Control view: layer:'base' = one full-bleed primary view (usually esri:map; may be a "
    "data-table/chart for non-geospatial data; max one; needs no area/edge/anchor). layer:'dock' = an "
    "edge rail; requires edge:'left'|'right'|'top'|'bottom'; optional size:{w,h} = rail thickness in "
    "percent (left/right fill height, top/bottom fill width). layer:'float' = an anchored card; requires "
    "anchor:'top-left'|'top'|'top-right'|'left'|'center'|'right'|'bottom-left'|'bottom'|'bottom-right'; "
    "optional size:{w,h} in percent; optional z. area{col,colSpan,row,rowSpan} is ONLY for grid "
    "components (those WITHOUT a layer). If you author a plain grid containing one esri:map, the client "
    "auto-arranges it into a shell — but prefer authoring the shell explicitly."
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
        " Tabs example (author type:'tabs', NOT a card, whenever the user wants tabs / a tabbed panel or "
        "several views shown ONE at a time): {id:'panel1', type:'tabs', layer:'float', anchor:'top-left', "
        "props:{tabs:[{id:'overview',label:'Overview'},{id:'legend',label:'Legend'}]}, "
        "state:{active:'overview'}, slots:{overview:[{id:'st1', type:'stat', props:{label:'Records', value:20}}], "
        "legend:[{id:'lg1', type:'esri:legend', bindings:{mapRef:'map1'}}]}}. Each slot key MATCHES a "
        "props.tabs id — the stat shows on the Overview tab, the legend on the Legend tab."
        " GIS example: {id:'map1', type:'esri:map', area:{col:1,colSpan:8,row:2,rowSpan:4}, "
        "props:{basemap:'osm'}, bindings:{layers:['mock://incidents']}} with a companion "
        "{id:'lg1', type:'esri:legend', area:{...}, bindings:{mapRef:'map1'}}."
        " Geospatial C2 example (draw-to-select + layer control): {id:'map1', type:'esri:map', "
        "layer:'base', props:{title:'AIS positions', basemap:'osm', spatialFilter:true, "
        "basemapToggle:true}, bindings:{layers:['data://<handle>']}} with {id:'ll1', "
        "type:'esri:layer-list', layer:'dock', edge:'right', bindings:{mapRef:'map1'}}, a legend "
        "dock, and a data-table dock over the same handle — drawing a geofence selects the "
        "contained rows in BOTH the map and the table."
        " Multi-layer example: {id:'m', type:'esri:map', layer:'base', "
        "props:{title:'WONDER VEGA trail', layers:[{title:'Dec 18'},{title:'Dec 23'},{title:'Dec 28'}]}, "
        "bindings:{layers:['data://<d18>','data://<d23>','data://<d28>']}} with an "
        "{id:'ll', type:'esri:layer-list', layer:'dock', edge:'right', bindings:{mapRef:'m'}} — "
        "each layer gets its own name + distinct color; a drawn geofence selects across all three."
        " Spatio-temporal track example (moving platform over time): {id:'trk', type:'esri:map', "
        "layer:'base', props:{title:'WONDER VEGA — track', basemap:'osm', render:'track', "
        "timeField:'BaseDateTime', trackIdField:'MMSI', headingField:'COG'}, "
        "bindings:{layers:['data://<vessel-positions>']}} (or bindings:{layers:['mock://vessel-track']} "
        "for a demo) WITH {id:'ts', type:'esri:time-slider', layer:'dock', edge:'bottom', "
        "bindings:{mapRef:'trk'}} and {id:'lg', type:'esri:legend', layer:'dock', edge:'right', "
        "bindings:{mapRef:'trk'}} — each MMSI becomes its own colored, time-ordered track; playing the "
        "time-slider sweeps the platforms along their courses."
        " COMPOSITION (Command-and-Control): ALWAYS call render_view — even a text/summary answer ends "
        "with a card or stat so the canvas is never empty. Hero the primary view: for geospatial rows "
        "render an esri:map as layer:'base'; for a tabular-only result make the main data-table the "
        "layer:'base'. Put supporting panels in rails/floats: table -> dock:'bottom', legend -> "
        "dock:'right', key stats/filters -> dock:'left' or 'top'; use float for compact callouts. Author "
        "at most ONE map and ONE table per dataset — do NOT wrap a table in a card AND also emit a "
        "standalone table. Give esri:map a props.title — the legend shows it (never a raw data:// "
        "handle). For non-geospatial data use a base data-table with stat docks, or a plain area grid for "
        "equal tiles. C2 example: {canvasVersion:1, layout:{type:'grid',cols:12}, components:[ "
        "{id:'map1', type:'esri:map', layer:'base', props:{title:'GREY LADY — AIS positions', "
        "basemap:'osm'}, bindings:{layers:['data://<handle>']}}, {id:'tbl1', type:'data-table', "
        "layer:'dock', edge:'bottom', size:{w:100,h:34}, props:{title:'Latest positions'}, "
        "bindings:{source:'data://<handle>'}}, {id:'lg1', type:'esri:legend', layer:'dock', "
        "edge:'right', bindings:{mapRef:'map1'}}, {id:'st1', type:'stat', layer:'float', "
        "anchor:'top-left', props:{label:'Records', value:20}} ]}."
        " LAYOUT & REAL-ESTATE (use judgement to maximise coherent use of space): panels must not overlap "
        "each other, and must not bury the map's own chrome — keep its attribution (bottom edge) and its "
        "title/zoom controls (a corner) visible; a float may overlay the map's interior but not those "
        "zones. SIZE every panel to its content via size:{w,h}: just large enough to show the content "
        "without a scrollbar and without large empty gaps — never cram a content-bearing card into a tiny "
        "box, and never leave a mostly-empty oversized one. You have authority to choose each panel's "
        "placement and size to use the real estate efficiently within these principles: give substantial "
        "content (tables, multi-field cards) a rail or a generously-sized panel; give a single metric a "
        "compact float, or group related metrics into ONE panel (a dock rail of stats, a card with stat "
        "children, or a tabs panel when the user wants to switch between grouped views) rather than "
        "scattering separate floats that collide. Prefer docking supporting panels "
        "to the edges and keep the map's centre clear."
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
