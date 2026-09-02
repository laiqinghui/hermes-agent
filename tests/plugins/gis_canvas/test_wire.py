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


def test_data_fetch_pages_from_broker(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_DATA_DIR", str(tmp_path))
    plugin.broker.reset_broker_for_tests()
    h = plugin.broker.get_broker().put([{"id": "a"}, {"id": "b"}], [{"name": "id", "type": "string"}])
    out = plugin.wire.handle_canvas_data_fetch({"handle": h, "page": 0, "pageSize": 1})
    assert out["ok"] and out["total"] == 2 and out["rows"] == [{"id": "a"}]


def test_data_fetch_missing_handle_errors(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_DATA_DIR", str(tmp_path))
    plugin.broker.reset_broker_for_tests()
    out = plugin.wire.handle_canvas_data_fetch({"handle": "data://nope"})
    assert out["ok"] is False and out["errors"]


def test_canvas_get_returns_the_stored_doc(plugin):
    _render(plugin, "s1")
    out = plugin.wire.handle_canvas_get({"session_id": "s1"})
    assert out["ok"] is True
    assert out["doc"]["rev"] == 1
    assert out["doc"]["components"][0]["id"] == "sev"


def test_canvas_get_unknown_session_returns_none_not_an_error(plugin):
    out = plugin.wire.handle_canvas_get({"session_id": "nope"})
    assert out["ok"] is True and out["doc"] is None


def test_canvas_get_requires_a_session_id(plugin):
    out = plugin.wire.handle_canvas_get({})
    assert out["ok"] is False and "session_id" in out["errors"][0]


def test_canvas_list_returns_stored_keys(plugin):
    _render(plugin, "s1")
    _render(plugin, "s2")
    out = plugin.wire.handle_canvas_list({})
    assert out["ok"] is True and out["keys"] == ["s1", "s2"]


def test_canvas_get_does_not_write(plugin):
    _render(plugin, "s1")
    plugin.wire.handle_canvas_get({"session_id": "s1"})
    plugin.wire.handle_canvas_list({})
    # A read must never bump the rev.
    assert plugin.wire.handle_canvas_get({"session_id": "s1"})["doc"]["rev"] == 1
