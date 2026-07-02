# tests/plugins/gis_canvas/test_wire.py
import json
import pytest


@pytest.fixture(autouse=True)
def _isolated_store(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_CANVAS_DIR", str(tmp_path))
    plugin.tools_canvas.reset_store_for_tests()


def _render(plugin, sid):
    spec = {
        "canvasVersion": 1, "layout": {"type": "grid", "cols": 12},
        "components": [
            {"id": "sev", "type": "select", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"field": "severity", "options": ["all", "high"]}, "state": {"value": "all"}},
        ],
    }
    plugin.tools_canvas.render_view({"spec": spec}, session_id=sid)


def test_interaction_updates_state_and_bumps_rev(plugin):
    _render(plugin, "s1")  # rev 1
    out = plugin.wire.handle_canvas_interaction({"session_id": "s1", "target": "sev", "state": {"value": "high"}})
    assert out["ok"] is True and out["rev"] == 2
    state = json.loads(plugin.tools_canvas.canvas_get_state({"component_id": "sev"}, session_id="s1"))
    assert state["node"]["state"]["value"] == "high"


def test_interaction_unknown_target_errors(plugin):
    _render(plugin, "s1")
    out = plugin.wire.handle_canvas_interaction({"session_id": "s1", "target": "ghost", "state": {"value": "x"}})
    assert out["ok"] is False and out["errors"]


def test_interaction_without_canvas_errors(plugin):
    out = plugin.wire.handle_canvas_interaction({"session_id": "nope", "target": "sev", "state": {"value": "x"}})
    assert out["ok"] is False and any("no canvas" in e for e in out["errors"])


def test_pre_llm_call_injects_summary_for_that_session(plugin):
    _render(plugin, "s1")
    plugin.wire.handle_canvas_interaction({"session_id": "s1", "target": "sev", "state": {"value": "high"}})
    res = plugin.hooks.on_pre_llm_call(session_id="s1", task_id="t")
    assert res and "<canvas" in res["context"] and "value=high" in res["context"]


def test_pre_llm_call_none_when_no_canvas(plugin):
    assert plugin.hooks.on_pre_llm_call(session_id="empty") is None
