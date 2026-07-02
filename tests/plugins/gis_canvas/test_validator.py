"""Contract tests for the canvas document validator."""


def _minimal_doc():
    return {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {
                "id": "s1",
                "type": "stat",
                "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
                "props": {"label": "High", "value": 42},
            }
        ],
    }


def test_valid_minimal_doc_passes(plugin):
    assert plugin.validator.validate_doc(_minimal_doc()) == []


def test_unknown_component_type_rejected(plugin):
    doc = _minimal_doc()
    doc["components"][0]["type"] = "esri:map"  # not in Phase-1 catalog
    errors = plugin.validator.validate_doc(doc)
    assert errors and any("type" in e for e in errors)


def test_duplicate_ids_rejected_across_nesting(plugin):
    doc = _minimal_doc()
    doc["components"].append(
        {
            "id": "c1",
            "type": "card",
            "area": {"col": 4, "colSpan": 4, "row": 1, "rowSpan": 2},
            "props": {"title": "Dup"},
            "slots": {"content": [{"id": "s1", "type": "stat", "props": {"label": "X", "value": 1}}]},
        }
    )
    errors = plugin.validator.validate_doc(doc)
    assert any("duplicate id" in e for e in errors)


def test_depth_limit_enforced(plugin):
    # card > card > card > stat = depth 4 → reject
    deep = {"id": "s9", "type": "stat", "props": {"label": "L", "value": 1}}
    for i in (3, 2, 1):
        deep = {"id": f"c{i}", "type": "card", "props": {"title": "T"}, "slots": {"content": [deep]}}
    doc = _minimal_doc()
    deep["area"] = {"col": 1, "colSpan": 3, "row": 2, "rowSpan": 2}
    doc["components"].append(deep)
    errors = plugin.validator.validate_doc(doc)
    assert any("depth" in e for e in errors)


def test_stat_requires_label_and_value(plugin):
    doc = _minimal_doc()
    doc["components"][0]["props"] = {"label": "only label"}
    errors = plugin.validator.validate_doc(doc)
    assert any("value" in e for e in errors)


def test_data_table_requires_source_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append(
        {"id": "t1", "type": "data-table", "area": {"col": 4, "colSpan": 6, "row": 1, "rowSpan": 3}}
    )
    errors = plugin.validator.validate_doc(doc)
    assert any("bindings.source" in e for e in errors)


def test_top_level_component_requires_area(plugin):
    doc = _minimal_doc()
    del doc["components"][0]["area"]
    errors = plugin.validator.validate_doc(doc)
    assert any("area" in e for e in errors)


def test_area_exceeding_grid_cols_rejected(plugin):
    doc = _minimal_doc()
    doc["components"][0]["area"] = {"col": 11, "colSpan": 4, "row": 1, "rowSpan": 1}  # 11+4-1 = 14 > 12
    errors = plugin.validator.validate_doc(doc)
    assert any("exceeds grid" in e for e in errors)


def test_non_container_may_not_have_children_or_slots(plugin):
    doc = _minimal_doc()
    doc["components"][0]["slots"] = {"content": []}
    errors = plugin.validator.validate_doc(doc)
    assert any("container" in e for e in errors)
