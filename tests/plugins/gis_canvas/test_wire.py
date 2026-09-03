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


def test_preview_set_then_get_round_trips(plugin):
    plugin.preview_index.reset_index_for_tests()
    out = plugin.wire.handle_canvas_preview_set({
        "source_session_id": "tg1", "preview_session_id": "p1",
        "verdict": "rendered", "reason": "analysis session",
    })
    assert out["ok"] is True
    got = plugin.wire.handle_canvas_preview_get({"source_session_id": "tg1"})
    assert got["ok"] is True and got["record"]["preview_session_id"] == "p1"


def test_preview_get_unknown_returns_none(plugin):
    plugin.preview_index.reset_index_for_tests()
    got = plugin.wire.handle_canvas_preview_get({"source_session_id": "nope"})
    assert got["ok"] is True and got["record"] is None


def test_preview_set_requires_ids(plugin):
    out = plugin.wire.handle_canvas_preview_set({"source_session_id": "tg1"})
    assert out["ok"] is False


def test_preview_set_rejects_an_unknown_verdict(plugin):
    plugin.preview_index.reset_index_for_tests()
    out = plugin.wire.handle_canvas_preview_set({
        "source_session_id": "tg1", "preview_session_id": "p1", "verdict": "maybe",
    })
    assert out["ok"] is False and "verdict" in out["errors"][0]


def test_judge_finish_records_a_rendered_verdict_when_a_doc_exists(plugin):
    plugin.preview_index.reset_index_for_tests()
    _render(plugin, "preview-key")  # the judging turn authored a canvas
    out = plugin.wire.handle_canvas_judge_finish({
        "source_session_id": "tg1", "preview_session_id": "preview-key",
        "answer": "I have laid out the tracks.",
    })
    assert out["ok"] is True
    assert out["record"]["verdict"] == "rendered"
    assert out["record"]["preview_session_id"] == "preview-key"
    assert out["doc"]["rev"] == 1
    # Cached, so reopening never re-spends a turn.
    assert plugin.wire.handle_canvas_preview_get({"source_session_id": "tg1"})["record"]["verdict"] == "rendered"


def test_judge_finish_declines_when_the_turn_authored_nothing(plugin):
    plugin.preview_index.reset_index_for_tests()
    out = plugin.wire.handle_canvas_judge_finish({
        "source_session_id": "tg2", "preview_session_id": "empty-key",
        "answer": "NO CANVAS: this was a debugging session.",
    })
    assert out["record"]["verdict"] == "declined"
    assert out["record"]["reason"] == "this was a debugging session."
    assert out["doc"] is None


def test_judge_finish_requires_both_ids(plugin):
    out = plugin.wire.handle_canvas_judge_finish({"source_session_id": "tg1"})
    assert out["ok"] is False


def test_branch_doc_copies_the_parent_canvas_to_the_new_key(plugin):
    _render(plugin, "parent")
    out = plugin.wire.handle_canvas_branch_doc({"from_key": "parent", "to_key": "child"})
    assert out["ok"] is True
    assert out["doc"]["components"][0]["id"] == "sev"
    # The copy is the branch's OWN document, starting at rev 1.
    assert out["doc"]["rev"] == 1
    assert plugin.wire.handle_canvas_get({"session_id": "child"})["doc"]["components"][0]["id"] == "sev"


def test_branch_doc_leaves_the_parent_untouched(plugin):
    _render(plugin, "parent")   # rev 1
    _render(plugin, "parent")   # rev 2 — a parent with some history
    before = plugin.wire.handle_canvas_get({"session_id": "parent"})["doc"]
    plugin.wire.handle_canvas_branch_doc({"from_key": "parent", "to_key": "child"})
    after = plugin.wire.handle_canvas_get({"session_id": "parent"})["doc"]
    # This is the load-bearing guarantee of the whole feature.
    assert after == before
    assert after["rev"] == 2


def test_branch_doc_is_fine_when_the_parent_has_no_canvas(plugin):
    out = plugin.wire.handle_canvas_branch_doc({"from_key": "no-canvas", "to_key": "child"})
    assert out["ok"] is True and out["doc"] is None
    # Nothing was written for the branch either.
    assert plugin.wire.handle_canvas_get({"session_id": "child"})["doc"] is None


def test_branch_doc_requires_both_keys(plugin):
    assert plugin.wire.handle_canvas_branch_doc({"from_key": "parent"})["ok"] is False
    assert plugin.wire.handle_canvas_branch_doc({"to_key": "child"})["ok"] is False
