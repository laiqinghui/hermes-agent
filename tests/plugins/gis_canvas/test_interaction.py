def _doc():
    return {
        "canvasVersion": 1, "rev": 3,
        "layout": {"type": "grid", "cols": 12},
        "components": [
            {"id": "sev", "type": "select",
             "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"field": "severity", "options": ["all", "high"]}, "state": {"value": "all"}},
            {"id": "c1", "type": "card", "area": {"col": 4, "colSpan": 8, "row": 1, "rowSpan": 3},
             "props": {"title": "Incidents"},
             "slots": {"content": [{"id": "tbl1", "type": "data-table", "bindings": {"source": "mock://incidents"}}]}},
        ],
    }


def test_merges_state_on_leaf(plugin):
    new, errors = plugin.interaction.apply_interaction(_doc(), "sev", {"value": "high"})
    assert errors == []
    assert new["components"][0]["state"]["value"] == "high"


def test_merges_state_on_nested_node(plugin):
    new, errors = plugin.interaction.apply_interaction(_doc(), "tbl1", {"rowSelection": ["f_82", "f_91"]})
    assert errors == []
    assert new["components"][1]["slots"]["content"][0]["state"]["rowSelection"] == ["f_82", "f_91"]


def test_shallow_merge_preserves_other_state_keys(plugin):
    d = _doc()
    d["components"][0]["state"] = {"value": "all", "misc": 1}
    new, _ = plugin.interaction.apply_interaction(d, "sev", {"value": "high"})
    assert new["components"][0]["state"] == {"value": "high", "misc": 1}


def test_unknown_target_rejected_doc_untouched(plugin):
    import copy
    d = _doc(); snap = copy.deepcopy(d)
    new, errors = plugin.interaction.apply_interaction(d, "ghost", {"value": "x"})
    assert errors and new == snap


def test_disallowed_state_key_rejected(plugin):
    new, errors = plugin.interaction.apply_interaction(_doc(), "sev", {"rowSelection": ["x"]})
    assert any("state key" in e for e in errors)
