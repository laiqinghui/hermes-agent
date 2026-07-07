def test_mock_discover_lists_catalog(plugin):
    src = plugin.datasource.MockDataSource()
    names = [d["view_name"] for d in src.discover("anything")]
    assert "incidents" in names


def test_mock_query_returns_rows_and_schema(plugin):
    src = plugin.datasource.MockDataSource()
    r = src.query("show incidents")
    assert r.row_count == len(r.rows) and r.rows
    assert any(f["name"] == "lng" for f in r.schema)  # geo columns present for the map path


def test_rows_from_query_result_zips_columns(plugin):
    rows, schema = plugin.datasource.rows_from_query_result(
        {"columns": ["id", "n"], "rows": [["a", 1], ["b", 2]], "row_count": 2})
    assert rows == [{"id": "a", "n": 1}, {"id": "b", "n": 2}]
    assert {f["name"]: f["type"] for f in schema} == {"id": "string", "n": "number"}


def test_a2a_query_maps_query_result(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="completed", context_id="c1",
        query_result={"columns": ["id"], "rows": [["a"]], "row_count": 1}))
    src = ds.A2ADataSource("http://x:2024", "secret")
    r = src.query("get rows")
    assert r.rows == [{"id": "a"}] and r.context_id == "c1" and r.clarification is None


def test_a2a_query_surfaces_clarification(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="input-required", context_id="c2", clarification="which one?"))
    src = ds.A2ADataSource("http://x:2024", "secret")
    r = src.query("ambiguous")
    assert r.clarification == "which one?" and r.rows == [] and r.context_id == "c2"


def test_factory_defaults_to_mock(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.delenv("GIS_DATA_SOURCE", raising=False)
    assert isinstance(ds.make_data_source(), ds.MockDataSource)
    monkeypatch.setenv("GIS_DATA_SOURCE", "a2a")
    assert isinstance(ds.make_data_source(), ds.A2ADataSource)


def test_a2a_datasource_targets_bff_endpoint_with_session_headers(monkeypatch, plugin):
    ds = plugin.datasource
    seen = {}

    def _fake_query(endpoint_url, prompt, context_id=None, *, headers=None, timeout=180.0):
        seen["endpoint"] = endpoint_url
        seen["headers"] = headers
        return ds.a2a_client.A2AResult(datasets=[{"view_name": "v", "database_name": "d"}])

    monkeypatch.setattr(ds.a2a_client, "query", _fake_query)
    src = ds.A2ADataSource("http://localhost:9109", "proxy-sekret")
    out = src.discover("what data", session_id="c1")
    assert out == [{"view_name": "v", "database_name": "d"}]
    assert seen["endpoint"] == "http://localhost:9109/a2a/message"
    assert seen["headers"]["X-Canvas-Session"] == "c1"
    assert seen["headers"]["X-Proxy-Secret"] == "proxy-sekret"


def test_make_data_source_a2a_reads_bff_env(monkeypatch, plugin):
    ds = plugin.datasource
    monkeypatch.setenv("GIS_DATA_SOURCE", "a2a")
    monkeypatch.setenv("GIS_BFF_URL", "http://localhost:9109")
    monkeypatch.setenv("GIS_BFF_PROXY_SECRET", "proxy-sekret")
    ds.reset_data_source_for_tests()
    src = ds.make_data_source()
    assert isinstance(src, ds.A2ADataSource)
