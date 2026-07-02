def _doc():
    return {
        "canvasVersion": 1, "rev": 4,
        "layout": {"type": "grid", "cols": 12},
        "components": [
            {"id": "sev", "type": "select", "props": {"field": "severity", "options": ["all", "high"]},
             "state": {"value": "high"}},
            {"id": "tbl1", "type": "data-table", "bindings": {"source": "mock://incidents"},
             "state": {"rowSelection": ["f_82", "f_91"], "filter": {"severity": "high"}}},
        ],
    }


def test_summary_wraps_and_includes_rev(plugin):
    s = plugin.awareness.build_canvas_summary(_doc())
    assert s.startswith("<canvas rev=4>") and s.rstrip().endswith("</canvas>")


def test_summary_lists_components_and_types(plugin):
    s = plugin.awareness.build_canvas_summary(_doc())
    assert "sev(select)" in s and "tbl1(data-table)" in s


def test_summary_includes_live_state(plugin):
    s = plugin.awareness.build_canvas_summary(_doc())
    assert "value=high" in s
    assert "rowSelection=[f_82,f_91]" in s or "rowSelection=2" in s
    assert "severity" in s  # filter surfaced


def test_empty_doc_summary_is_blank(plugin):
    assert plugin.awareness.build_canvas_summary(None) == ""
    assert plugin.awareness.build_canvas_summary({"components": []}).strip() != ""  # header still emitted
