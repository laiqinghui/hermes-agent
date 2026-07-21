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
    doc["components"][0]["type"] = "unknown-type"  # not in catalog
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


def test_select_is_a_valid_leaf_component(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "sev", "type": "select",
        "area": {"col": 4, "colSpan": 3, "row": 1, "rowSpan": 1},
        "props": {"field": "severity", "options": ["all", "high", "med", "low"]},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_select_requires_field_and_options(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "sev", "type": "select",
        "area": {"col": 4, "colSpan": 3, "row": 1, "rowSpan": 1},
        "props": {"field": "severity"},
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("options" in e for e in errors)


def test_state_keys_registry_exposed(plugin):
    assert "value" in plugin.validator.STATE_KEYS["select"]
    assert "rowSelection" in plugin.validator.STATE_KEYS["data-table"]
    assert "filter" in plugin.validator.STATE_KEYS["data-table"]


def test_component_handlers_accepted(plugin):
    """Test that handlers field is accepted on components (RED before schema fix)."""
    doc = _minimal_doc()
    doc["components"].append({
        "id": "sev",
        "type": "select",
        "area": {"col": 4, "colSpan": 3, "row": 1, "rowSpan": 1},
        "props": {"field": "severity", "options": ["all", "high", "med", "low"]},
        "handlers": {
            "onChange": {
                "kind": "reactive",
                "controls": "tbl1.filter.severity"
            }
        }
    })
    assert plugin.validator.validate_doc(doc) == []


def test_esri_map_valid_with_layers_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "area": {"col": 1, "colSpan": 8, "row": 2, "rowSpan": 4},
        "bindings": {"layers": "mock://incidents"},   # single handle (string) OK
        "props": {"basemap": "osm"},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_esri_map_valid_with_layers_array(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "area": {"col": 1, "colSpan": 8, "row": 2, "rowSpan": 4},
        "bindings": {"layers": ["mock://incidents", "https://x/FeatureServer/0"]},  # array of handles OK
    })
    assert plugin.validator.validate_doc(doc) == []


def test_esri_map_requires_layers_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "area": {"col": 1, "colSpan": 8, "row": 2, "rowSpan": 4},
    })
    assert any("bindings.layers" in e for e in plugin.validator.validate_doc(doc))


def test_esri_feature_table_requires_layer_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "ft1", "type": "esri:feature-table",
        "area": {"col": 9, "colSpan": 4, "row": 2, "rowSpan": 4},
    })
    assert any("bindings.layer" in e for e in plugin.validator.validate_doc(doc))


def test_esri_state_keys(plugin):
    assert plugin.validator.STATE_KEYS["esri:map"] >= {"selection", "extent"}
    assert "selection" in plugin.validator.STATE_KEYS["esri:feature-table"]


def test_reactive_handler_requires_controls(plugin):
    doc = _minimal_doc()
    doc["components"][0]["handlers"] = {"onChange": {"kind": "reactive"}}  # missing controls
    assert any("controls" in e for e in plugin.validator.validate_doc(doc))


def test_agent_handler_requires_prompt(plugin):
    doc = _minimal_doc()
    doc["components"][0]["handlers"] = {"onClick": {"kind": "agent"}}  # missing prompt
    assert any("prompt" in e for e in plugin.validator.validate_doc(doc))


def test_wellformed_reactive_handler_passes(plugin):
    doc = _minimal_doc()
    doc["components"][0]["handlers"] = {"onChange": {"kind": "reactive", "controls": "tbl1.filter.severity"}}
    assert plugin.validator.validate_doc(doc) == []


def test_base_layer_needs_no_area(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map",
        "layer": "base",
        "bindings": {"layers": "mock://incidents"},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_float_layer_requires_anchor(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "leg1", "type": "esri:legend",
        "layer": "float",  # no anchor
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("anchor" in e for e in errors)


def test_float_layer_with_anchor_and_size_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "leg1", "type": "esri:legend",
        "layer": "float", "anchor": "top-right",
        "size": {"w": 24, "h": 40}, "z": 2,
    })
    assert plugin.validator.validate_doc(doc) == []


def test_at_most_one_base(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "map1", "type": "esri:map", "layer": "base",
        "bindings": {"layers": "mock://a"},
    })
    doc["components"].append({
        "id": "map2", "type": "esri:map", "layer": "base",
        "bindings": {"layers": "mock://b"},
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("one 'base'" in e for e in errors)


def test_grid_component_still_requires_area(plugin):
    # Regression: a component with NO layer keeps today's area requirement.
    doc = _minimal_doc()
    del doc["components"][0]["area"]  # stat, no layer
    errors = plugin.validator.validate_doc(doc)
    assert any("area" in e for e in errors)


def test_bad_anchor_value_rejected(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "leg1", "type": "esri:legend",
        "layer": "float", "anchor": "middle-ish",  # not in enum
    })
    errors = plugin.validator.validate_doc(doc)
    assert errors  # schema enum rejects it


def test_dock_layer_requires_edge(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "tbl", "type": "data-table", "layer": "dock",
        "bindings": {"source": "mock://x"},  # no edge
    })
    assert any("edge" in e for e in plugin.validator.validate_doc(doc))


def test_dock_layer_with_edge_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "tbl", "type": "data-table", "layer": "dock",
        "edge": "bottom", "size": {"w": 100, "h": 34},
        "bindings": {"source": "mock://x"},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_bad_edge_value_rejected(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "tbl", "type": "data-table", "layer": "dock",
        "edge": "north", "bindings": {"source": "mock://x"},  # not in enum
    })
    assert plugin.validator.validate_doc(doc)  # schema enum rejects


def _tabs_node():
    return {
        "id": "insp",
        "type": "tabs",
        "area": {"col": 1, "colSpan": 6, "row": 2, "rowSpan": 3},
        "props": {"tabs": [{"id": "overview", "label": "Overview"},
                           {"id": "props", "label": "Properties"}]},
        "slots": {
            "overview": [{"id": "t1", "type": "stat", "props": {"label": "A", "value": 1}}],
            "props": [{"id": "t2", "type": "stat", "props": {"label": "B", "value": 2}}],
        },
    }


def test_tabs_valid_doc_passes(plugin):
    doc = _minimal_doc()
    doc["components"].append(_tabs_node())
    assert plugin.validator.validate_doc(doc) == []


def test_tabs_missing_tabs_prop_rejected(plugin):
    doc = _minimal_doc()
    node = _tabs_node()
    node["props"] = {}
    doc["components"].append(node)
    errors = plugin.validator.validate_doc(doc)
    assert any("missing required props.tabs" in e for e in errors)


def test_tabs_slot_without_matching_tab_rejected(plugin):
    doc = _minimal_doc()
    node = _tabs_node()
    node["slots"]["ghost"] = [{"id": "t3", "type": "stat", "props": {"label": "C", "value": 3}}]
    doc["components"].append(node)
    errors = plugin.validator.validate_doc(doc)
    assert any("ghost" in e for e in errors)


def test_tabs_non_list_tabs_prop_does_not_crash(plugin):
    doc = _minimal_doc()
    node = _tabs_node()
    node["props"] = {"tabs": 5}  # malformed: scalar, not a list
    node["slots"] = {}
    doc["components"].append(node)
    errors = plugin.validator.validate_doc(doc)  # must NOT raise
    assert isinstance(errors, list)
