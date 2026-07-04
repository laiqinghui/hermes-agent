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
    src = ds.A2ADataSource("http://x:2024", lambda: "Bearer t")
    r = src.query("get rows")
    assert r.rows == [{"id": "a"}] and r.context_id == "c1" and r.clarification is None


def test_a2a_query_surfaces_clarification(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="input-required", context_id="c2", clarification="which one?"))
    src = ds.A2ADataSource("http://x:2024", lambda: "Bearer t")
    r = src.query("ambiguous")
    assert r.clarification == "which one?" and r.rows == [] and r.context_id == "c2"


def test_factory_defaults_to_mock(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.delenv("GIS_DATA_SOURCE", raising=False)
    assert isinstance(ds.make_data_source(), ds.MockDataSource)
    monkeypatch.setenv("GIS_DATA_SOURCE", "a2a")
    assert isinstance(ds.make_data_source(), ds.A2ADataSource)
