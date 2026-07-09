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


# Real captured A2A retrieval response: the Data Agent returns retrieval rows ONLY as a
# markdown table inside a text artifact (no structured query_result DataPart). Note the
# preamble line before the table, and Row 3's empty `callsign` cell.
_RETRIEVE_MD = '''The first 20 rows from `admin.vessel_positions` have been retrieved:

| row_id | id | vesselname | callsign | imonumber | latitudedegrees | longitudedegrees | point_wkt |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Row 1 | 58746537 | SUNSHINE | V4YW5 | 0 | 1.31205669418 | 103.727075562 | POINT(103.727075562 1.31205669418) |
| Row 2 | 58746538 | AMAKUSA DOLPHIN | YDC3943 | 5254014 | 1.30812002761 | 103.715200561 | POINT(103.715200561 1.30812002761) |
| Row 3 | 58746543 | TWO FLOWER |  | 0 | 1.29449669268 | 103.760542224 | POINT(103.760542224 1.29449669268) |
'''


def test_rows_from_markdown_table_parses_header_and_rows(plugin):
    ds = plugin.datasource
    rows, schema = ds.rows_from_markdown_table(_RETRIEVE_MD)
    assert len(rows) == 3
    cols = [f["name"] for f in schema]
    assert "vesselname" in cols and "latitudedegrees" in cols and "point_wkt" in cols
    assert rows[0]["vesselname"] == "SUNSHINE"
    assert rows[0]["latitudedegrees"] == 1.31205669418
    assert isinstance(rows[0]["latitudedegrees"], float)
    # separator row (":---" cells) must not be treated as a data row
    assert all(r["vesselname"] != ":---" for r in rows)


def test_rows_from_markdown_table_preserves_empty_cell(plugin):
    ds = plugin.datasource
    rows, _schema = ds.rows_from_markdown_table(_RETRIEVE_MD)
    assert rows[2]["callsign"] == ""


def test_rows_from_markdown_table_schema_types(plugin):
    ds = plugin.datasource
    _rows, schema = ds.rows_from_markdown_table(_RETRIEVE_MD)
    by_name = {f["name"]: f["type"] for f in schema}
    assert by_name["latitudedegrees"] == "number"
    assert by_name["vesselname"] == "string"


def test_rows_from_markdown_table_returns_none_when_no_table(plugin):
    ds = plugin.datasource
    assert ds.rows_from_markdown_table("just some prose, no table") is None


def test_a2a_datasource_query_falls_back_to_markdown(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="completed", context_id="c1",
        response_text=_RETRIEVE_MD, query_result=None))
    src = ds.A2ADataSource("http://bff", "sek")
    r = src.query("get vessels", session_id="c1")
    assert r.row_count == 3
    assert r.rows[0]["vesselname"] == "SUNSHINE"


def test_a2a_datasource_query_prefers_structured_query_result(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="completed", context_id="c1",
        response_text=_RETRIEVE_MD,
        query_result={"columns": ["id"], "rows": [["a"]], "row_count": 1}))
    src = ds.A2ADataSource("http://bff", "sek")
    r = src.query("get vessels", session_id="c1")
    assert r.rows == [{"id": "a"}]
    assert r.row_count == 1
