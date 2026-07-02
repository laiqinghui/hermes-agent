import copy


def _doc():
    return {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {"id": "s1", "type": "stat", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"label": "High", "value": 42}},
            {"id": "c1", "type": "card", "area": {"col": 4, "colSpan": 6, "row": 1, "rowSpan": 3},
             "props": {"title": "Incidents"},
             "slots": {"content": [{"id": "t1", "type": "data-table", "bindings": {"source": "mock://incidents"}}]}},
        ],
    }


def test_add_top_level(plugin):
    node = {"id": "s2", "type": "stat", "area": {"col": 10, "colSpan": 3, "row": 1, "rowSpan": 1},
            "props": {"label": "Total", "value": 1240}}
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "add", "target": None, "node": node}])
    assert errors == []
    assert [c["id"] for c in new["components"]] == ["s1", "c1", "s2"]


def test_add_into_container_slot(plugin):
    node = {"id": "s3", "type": "stat", "props": {"label": "New", "value": 7}}
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "add", "target": "c1", "slot": "footer", "node": node}])
    assert errors == []
    assert new["components"][1]["slots"]["footer"][0]["id"] == "s3"


def test_add_into_container_requires_slot(plugin):
    node = {"id": "s3", "type": "stat", "props": {"label": "New", "value": 7}}
    _, errors = plugin.ops.apply_ops(_doc(), [{"op": "add", "target": "c1", "node": node}])
    assert any("slot" in e for e in errors)


def test_remove_nested_node(plugin):
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "remove", "target": "t1"}])
    assert errors == []
    assert new["components"][1]["slots"]["content"] == []


def test_remove_unknown_target_errors_and_leaves_doc_untouched(plugin):
    original = _doc()
    snapshot = copy.deepcopy(original)
    new, errors = plugin.ops.apply_ops(original, [{"op": "remove", "target": "nope"}])
    assert errors and new == snapshot


def test_replace_swaps_node(plugin):
    node = {"id": "s1b", "type": "stat", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
            "props": {"label": "Low", "value": 3}}
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "replace", "target": "s1", "node": node}])
    assert errors == []
    assert new["components"][0]["id"] == "s1b"


def test_set_props_shallow_merges(plugin):
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "setProps", "target": "s1", "props": {"value": 50}}])
    assert errors == []
    assert new["components"][0]["props"] == {"label": "High", "value": 50}


def test_set_binding(plugin):
    new, errors = plugin.ops.apply_ops(
        _doc(), [{"op": "setBinding", "target": "t1", "key": "source", "value": "mock://districts"}])
    assert errors == []
    assert new["components"][1]["slots"]["content"][0]["bindings"]["source"] == "mock://districts"


def test_all_or_nothing_on_mid_batch_failure(plugin):
    original = _doc()
    snapshot = copy.deepcopy(original)
    ops = [
        {"op": "setProps", "target": "s1", "props": {"value": 99}},  # valid
        {"op": "remove", "target": "ghost"},                          # invalid → whole batch rejected
    ]
    new, errors = plugin.ops.apply_ops(original, ops)
    assert errors and new == snapshot


def test_unknown_op_rejected(plugin):
    _, errors = plugin.ops.apply_ops(_doc(), [{"op": "teleport", "target": "s1"}])
    assert any("unknown op" in e for e in errors)
