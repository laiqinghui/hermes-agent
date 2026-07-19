# Thought Canvas — Phase C: agent C2-composition guidance

> REQUIRED SUB-SKILL: superpowers:executing-plans. Teaches the agent the shipped `base`/`dock`/`float`
> C2 shell (Phase B) via the `render_view`/`update_view` tool text. Flexible-building-blocks style.

**Goal:** Update the `render_view`/`update_view` tool descriptions so the agent authors deliberate C2
layouts (hero the primary view, dock rails, float callouts, one map+table per dataset, titled layers)
instead of flat grids that rely on auto-shell — fixing the over-composition and unnamed-layer roughness
seen in live verify.

**Architecture:** Text-only edits to `plugins/gis-canvas/tools_canvas.py` (`_CATALOG_HELP`, shared by both
tools, + the `render_view` description). No code-logic change; auto-shell stays the fallback. Guarded by a
light test that the guidance carries the new primitive keywords and that a `base`/`dock`/`float` spec
renders through `render_view`; real verification is live.

## Global Constraints

- **Text-only.** No changes to validator/render logic, schema, or frontend. The guidance must stay
  consistent with the shipped primitive (`layer: base|dock|float`, `edge`, `anchor`, `size`, `z`).
- **Backward compatible.** The grid/`area` path stays documented and valid; `layer` is additive.
- **Out of scope** (tracked in `docs/2026-07-19-thought-canvas-backend-followups.md`): the
  `data_query`→`execute_code`/PKCE storm and the denodo-skill `data_query` steering.

---

### Task 1: Document the C2 shell primitive + composition principles in the tool text

**Files:** `plugins/gis-canvas/tools_canvas.py`, `tests/plugins/gis_canvas/test_tools.py`

- [ ] **Step 1 — failing tests.** Append to `test_tools.py`:

```python
def _c2_spec():
    return {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12},
        "components": [
            {"id": "map1", "type": "esri:map", "layer": "base",
             "props": {"title": "GREY LADY — AIS positions", "basemap": "osm"},
             "bindings": {"layers": ["mock://incidents"]}},
            {"id": "tbl1", "type": "data-table", "layer": "dock", "edge": "bottom",
             "size": {"w": 100, "h": 34}, "bindings": {"source": "mock://incidents"}},
            {"id": "lg1", "type": "esri:legend", "layer": "dock", "edge": "right",
             "bindings": {"mapRef": "map1"}},
            {"id": "st1", "type": "stat", "layer": "float", "anchor": "top-left",
             "props": {"label": "Records", "value": 20}},
        ],
    }


def test_render_view_accepts_c2_shell(plugin):
    out = json.loads(plugin.tools_canvas.render_view({"spec": _c2_spec()}, task_id="t1"))
    assert out["ok"] is True and out["rev"] == 1


def test_tool_guidance_documents_c2_primitive(plugin):
    text = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"] + plugin.tools_canvas._CATALOG_HELP
    for kw in ("layer:'base'", "dock", "float", "edge", "anchor", "props.title"):
        assert kw in text, f"guidance missing {kw!r}"
```

- [ ] **Step 2 — run, expect fail:** `python -m pytest tests/plugins/gis_canvas/test_tools.py -q`
  (`test_render_view_accepts_c2_shell` should already PASS — the validator accepts the shell since Phase B;
  `test_tool_guidance_documents_c2_primitive` FAILS — the text doesn't mention the primitive yet.)

- [ ] **Step 3 — extend `_CATALOG_HELP`.** Append this sentence to the `_CATALOG_HELP` string (inside the
  closing paren, after the existing GIS text ending `"...spatial table of a layer."`):

```python
    " (Phase B C2 shell) A top-level component may use a LAYER instead of a grid area to build a "
    "Command-and-Control view: layer:'base' = one full-bleed primary view (usually esri:map; may be a "
    "data-table/chart for non-geospatial data; max one; needs no area/edge/anchor). layer:'dock' = an "
    "edge rail; requires edge:'left'|'right'|'top'|'bottom'; optional size:{w,h} = rail thickness in "
    "percent (left/right fill height, top/bottom fill width). layer:'float' = an anchored card; requires "
    "anchor:'top-left'|'top'|'top-right'|'left'|'center'|'right'|'bottom-left'|'bottom'|'bottom-right'; "
    "optional size:{w,h} in percent; optional z. area{col,colSpan,row,rowSpan} is ONLY for grid "
    "components (those WITHOUT a layer). If you author a plain grid containing one esri:map, the client "
    "auto-arranges it into a shell — but prefer authoring the shell explicitly."
```

- [ ] **Step 4 — fix the stale `area`-required wording** in `_CATALOG_HELP`. Change:
  `"requires area {col,colSpan,row,rowSpan}"` →
  `"requires area {col,colSpan,row,rowSpan} unless it sets a layer (see C2 shell below)"`.

- [ ] **Step 5 — add composition principles + a C2 example to `RENDER_VIEW_SCHEMA["description"]`.** Insert
  this block into the description string, right before the trailing `" Returns {ok, rev, doc} ..."`:

```python
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
```

- [ ] **Step 6 — run, expect pass:** `python -m pytest tests/plugins/gis_canvas/test_tools.py -q`
  (both new tests green; existing tests unchanged).

- [ ] **Step 7 — commit:** `feat(gis-canvas): teach the agent the C2 shell (base/dock/float) in render_view`

---

## Post-implementation
- **Live verify** (a couple of runs — flexible style ⇒ variance): the agent authors a titled base map +
  bottom-rail table + right-rail legend (legend shows the title, not the handle), no redundant card+table,
  and a non-geo prompt yields a sensible base-table or grid. If the agent still over-composes or mis-titles,
  tighten the wording (not the code).
- **Then:** finishing-a-development-branch, and the thought-canvas arc (Phases A–C) is complete. Remaining
  work is the tracked backend follow-ups (reasoning stream, 80-char cap, 401 storm).

## Self-Review
- Design §5 coverage: primitive docs → Steps 3-4; composition principles + example → Step 5; test anchor →
  Step 1. Covered. Placeholders: none (`<handle>` is illustrative text inside the agent-facing example,
  intentional). Consistency: keywords in the test (Step 1) match the strings added in Steps 3 & 5.
