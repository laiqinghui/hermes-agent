import json


def _reset(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GIS_DATA_SOURCE", "mock")
    plugin.broker.reset_broker_for_tests()
    plugin.datasource.reset_data_source_for_tests()


def test_data_query_returns_handle_sample_never_bulk(plugin, tmp_path, monkeypatch):
    _reset(plugin, tmp_path, monkeypatch)
    out = json.loads(plugin.tools_data.data_query({"prompt": "incidents"}))
    assert out["ok"] and out["handle"].startswith("data://")
    assert out["rowCount"] == 8 and len(out["sample"]) == 3   # sample capped at 3
    assert "rows" not in out                                   # invariant: no bulk rows
    # handle resolves to the full set on the data plane
    page = plugin.broker.get_broker().page(out["handle"], page_size=100)
    assert page["total"] == 8


def test_data_discover_metadata_only(plugin, tmp_path, monkeypatch):
    _reset(plugin, tmp_path, monkeypatch)
    out = json.loads(plugin.tools_data.data_discover({"prompt": "what is available"}))
    assert out["ok"] and any(d["view_name"] == "incidents" for d in out["datasets"])
    assert "rows" not in json.dumps(out)  # discovery is metadata only


def test_data_query_relays_clarification(plugin, tmp_path, monkeypatch):
    _reset(plugin, tmp_path, monkeypatch)
    ds = plugin.datasource

    class Clar(ds.DataSource):
        def discover(self, p): return []
        def query(self, p, context_id=None):
            return ds.QueryResult([], [], 0, context_id="cx", clarification="which dataset?")

    monkeypatch.setattr(plugin.tools_data, "get_data_source", lambda: Clar())
    out = json.loads(plugin.tools_data.data_query({"prompt": "ambiguous"}))
    assert out["needs_input"] and out["clarification"] == "which dataset?" and out["context_id"] == "cx"


def test_registration_includes_data_tools(plugin):
    names = {d[0] for d in plugin.tools_data.DATA_TOOL_DEFS}
    assert names == {"data_discover", "data_query"}
