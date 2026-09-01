import json

import pytest


@pytest.fixture(autouse=True)
def _isolated_store(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_CANVAS_DIR", str(tmp_path))
    plugin.tools_canvas.reset_store_for_tests()


def _spec():
    return {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {"id": "s1", "type": "stat", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"label": "High", "value": 42}},
        ],
    }


def test_render_view_success_envelope(plugin):
    out = json.loads(plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1"))
    assert out["gis_canvas"] is True and out["ok"] is True
    assert out["rev"] == 1
    assert out["components_index"] == [{"id": "s1", "type": "stat"}]
    assert out["doc"]["rev"] == 1


def test_render_view_applies_layout_and_version_defaults(plugin):
    spec = _spec()
    del spec["layout"]
    del spec["canvasVersion"]
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is True
    assert out["doc"]["layout"]["cols"] == 12
    assert out["doc"]["canvasVersion"] == 1


def test_render_view_accepts_tabs(plugin):
    spec = {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {
                "id": "insp",
                "type": "tabs",
                "area": {"col": 1, "colSpan": 6, "row": 1, "rowSpan": 3},
                "props": {"tabs": [{"id": "overview", "label": "Overview"}]},
                "slots": {"overview": [{"id": "s1", "type": "stat", "props": {"label": "A", "value": 1}}]},
            }
        ],
    }
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is True
    assert any(c["type"] == "tabs" for c in out["components_index"])


def test_render_view_invalid_spec_returns_errors_not_render(plugin):
    spec = _spec()
    spec["components"][0]["type"] = "bogus"
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is False and out["errors"]
    # nothing stored: get_state reports no canvas
    state = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t1"))
    assert state["ok"] is False


def test_render_view_missing_spec_arg(plugin):
    out = json.loads(plugin.tools_canvas.render_view({}, task_id="t1"))
    assert out["ok"] is False and any("spec" in e for e in out["errors"])


def test_update_view_happy_path_bumps_rev(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    ops = [{"op": "setProps", "target": "s1", "props": {"value": 50}}]
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 1, "ops": ops}, task_id="t1"))
    assert out["ok"] is True and out["rev"] == 2
    assert out["doc"]["components"][0]["props"]["value"] == 50


def test_update_view_stale_rev_rejected(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    ops = [{"op": "setProps", "target": "s1", "props": {"value": 50}}]
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 0, "ops": ops}, task_id="t1"))
    assert out["ok"] is False and any("stale" in e for e in out["errors"])
    assert out["rev"] == 1  # tells the agent the current rev to retry against


def test_update_view_without_canvas_rejected(plugin):
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 1, "ops": []}, task_id="t9"))
    assert out["ok"] is False and any("no canvas" in e for e in out["errors"])


def test_update_view_result_failing_validation_is_rejected_and_not_stored(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    # removing s1's area via replace: top-level component without area → invalid
    bad = {"op": "replace", "target": "s1",
           "node": {"id": "s1", "type": "stat", "props": {"label": "High", "value": 42}}}
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 1, "ops": [bad]}, task_id="t1"))
    assert out["ok"] is False
    state = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t1"))
    assert state["rev"] == 1  # unchanged


def test_get_state_full_and_subtree(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    full = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t1"))
    assert full["ok"] is True and full["doc"]["rev"] == 1
    sub = json.loads(plugin.tools_canvas.canvas_get_state({"component_id": "s1"}, task_id="t1"))
    assert sub["ok"] is True and sub["node"]["id"] == "s1"
    missing = json.loads(plugin.tools_canvas.canvas_get_state({"component_id": "zz"}, task_id="t1"))
    assert missing["ok"] is False


def test_sessions_are_isolated_by_task_id(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    other = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t2"))
    assert other["ok"] is False

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
    for kw in ("layer:'base'", "dock", "float", "edge", "anchor", "props.title", "overlap"):
        assert kw in text, f"guidance missing {kw!r}"


def test_tool_guidance_documents_tracks(plugin):
    text = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"] + plugin.tools_canvas._CATALOG_HELP
    for kw in ("render:'track'", "esri:time-slider", "timeField", "trackIdField", "spatio-temporal"):
        assert kw in text, f"track guidance missing {kw!r}"


def test_tool_guidance_documents_ontology_and_entity_detail(plugin):
    text = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"] + plugin.tools_canvas._CATALOG_HELP
    for kw in ("entity-detail", "ontology", "links", "reverse"):
        assert kw in text, f"ontology guidance missing {kw!r}"


def test_catalog_help_no_longer_forbids_all_inline_rows(plugin):
    """The absolute ban contradicted props.rows; it must stay narrowed to RETRIEVED rows."""
    help_text = plugin.tools_canvas._CATALOG_HELP
    assert "NEVER inline data rows" not in help_text
    assert "props.rows" in help_text


def test_catalog_help_documents_the_note_component(plugin):
    assert "note" in plugin.tools_canvas._CATALOG_HELP


def test_render_view_guidance_leads_with_analysis(plugin):
    desc = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"]
    assert "ANALYSIS PRODUCT" in desc
    # the old rule told the agent to hero the DATA -- that caused source-data-review canvases
    assert "for a tabular-only result make the main data-table the layer:'base'" not in desc


def test_render_view_guidance_keeps_one_map_one_table_and_map_title_rules(plugin):
    """The COMPOSITION -> ANALYSIS PRODUCT rewrite must not silently drop these two
    operational constraints: no duplicate table for one dataset, and esri:map must
    carry a legend-friendly props.title (never a raw data:// handle)."""
    desc = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"]
    assert (
        "Author at most ONE map and ONE table per dataset — do NOT wrap a table in a "
        "card AND also emit a standalone table."
    ) in desc
    assert (
        "Give esri:map a props.title — the legend shows it (never a raw data:// handle)."
    ) in desc


def test_render_view_accepts_imagery_block(plugin):
    spec = {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "imagery": {
            "scenes": [
                {
                    "id": "s2",
                    "title": "S2C 2025-12-05 — Singapore Strait",
                    "url": "https://example.com/TCI.tif",
                    "sensor": "optical",
                    "datetime": "2025-12-05T03:36:14Z",
                    "bbox": [104.58, 1.72, 104.78, 1.94],
                    "collection": "sentinel-2-c1-l2a",
                    "cloud": 2.65,
                }
            ]
        },
        "components": [
            {
                "id": "map1",
                "type": "esri:map",
                "layer": "base",
                "props": {"title": "AIS gap", "imagery": {"scenes": ["s2"], "footprints": True}},
                "bindings": {"layers": ["mock://incidents"]},
            }
        ],
    }
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is True, out.get("errors")
    assert out["doc"]["imagery"]["scenes"][0]["sensor"] == "optical"


def test_catalog_help_documents_imagery(plugin):
    # The agent only knows what _CATALOG_HELP tells it; an undocumented block is
    # dead code no matter how well the client renders it.
    help_text = plugin.tools_canvas._CATALOG_HELP
    assert "imagery" in help_text
    assert "sensor" in help_text
