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
