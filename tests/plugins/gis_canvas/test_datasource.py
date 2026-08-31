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


# Real captured A2A retrieval response (2026-08-27+): the Data Agent's collaborative-mode
# raw-data-conduit now passes the AISDK v1.3 MCP tool output through verbatim instead of a
# markdown table -- rows arrive as a CSV block wrapped in <execution_result_csv> tags, alongside
# sibling <sql_query>/<query_explanation> tags. Captured verbatim from
# C:\workspace\data-agent-ecosystem\data_agent.log, context_id=8a5325de-f48a-4511-971c-76ec2cac42fc
# (matches a live "RowCount 0" bug report for this exact query).
_RETRIEVE_CSV_TAG = '''Execution result returned 5 rows.


<execution_result_csv>
row_id,vessel_name,mmsi,imo,timestamp_date,latitudedegrees,longitudedegrees,sog,cog
Row 1,WONDER VEGA,610107031,9293155,Sun Dec 28 09:42:19 GMT 2025,1.41137054122,103.179021259,11.6761,305.992
Row 2,WONDER VEGA,610107031,9293155,Sun Dec 28 09:25:09 GMT 2025,1.3802330517,103.222762345,11.3846,305.97
Row 3,WONDER VEGA,610107031,9293155,Sun Dec 28 09:22:21 GMT 2025,1.37509435776,103.22968818,11.4817,305.977

</execution_result_csv>
<sql_query>
SELECT "vesselname" AS "vessel_name" FROM "admin"."pg_vessel_positions_select" LIMIT 5;
</sql_query>
<query_explanation>
The expected output is 5 rows with 8 columns.
</query_explanation>'''


def test_rows_from_execution_result_csv_parses_header_and_rows(plugin):
    ds = plugin.datasource
    rows, schema = ds.rows_from_execution_result_csv(_RETRIEVE_CSV_TAG)
    assert len(rows) == 3
    cols = [f["name"] for f in schema]
    assert "vessel_name" in cols and "latitudedegrees" in cols and "row_id" in cols
    assert rows[0]["vessel_name"] == "WONDER VEGA"
    assert rows[0]["latitudedegrees"] == 1.41137054122
    assert isinstance(rows[0]["latitudedegrees"], float)
    # sibling <sql_query>/<query_explanation> tags must not leak into the parsed rows
    assert all("SELECT" not in str(v) for r in rows for v in r.values())


def test_rows_from_execution_result_csv_returns_none_without_tag(plugin):
    ds = plugin.datasource
    assert ds.rows_from_execution_result_csv("just some prose, no csv tag") is None


# The Data Agent's raw_output_cache.pop() concatenates EVERY retrieval tool call made during
# one turn, so a turn where the agent retried/refined its query yields several
# <execution_result_csv> blocks in a single response. The LAST block is the authoritative
# answer; earlier ones are superseded intermediates. Shape taken from a real 2-block turn
# (data_agent.log, context be0f935e-8f69-483d-ab71-60e686205866), where the agent first
# queried latitudedegrees/longitudedegrees then refined to latitude/longitude/boundary_label.
_RETRIEVE_CSV_TWO_BLOCKS = '''Execution result returned 1 rows.

<execution_result_csv>
row_id,timestamp_date,latitudedegrees,longitudedegrees
Row 1,Sun Dec 28 09:42:19 GMT 2025,1.41137054122,103.179021259
</execution_result_csv>
<sql_query>
SELECT "latitudedegrees" FROM "admin"."pg_vessel_positions_select" LIMIT 1;
</sql_query>

Execution result returned 2 rows.

<execution_result_csv>
row_id,timestamp_date,latitude,longitude,boundary_label
Row 1,Sun Dec 28 09:42:19 GMT 2025,1.41137054122,103.179021259,SG_PORT
Row 2,Sun Dec 28 09:25:09 GMT 2025,1.3802330517,103.222762345,SG_PORT
</execution_result_csv>
<sql_query>
SELECT "latitudedegrees" AS "latitude" FROM "admin"."pg_vessel_positions_select" LIMIT 2;
</sql_query>'''


def test_rows_from_execution_result_csv_uses_last_block_when_agent_retried(plugin):
    ds = plugin.datasource
    rows, schema = ds.rows_from_execution_result_csv(_RETRIEVE_CSV_TWO_BLOCKS)
    cols = [f["name"] for f in schema]
    # the refined final query's columns win; the superseded first block must not leak through
    assert "latitude" in cols and "boundary_label" in cols
    assert "latitudedegrees" not in cols
    assert len(rows) == 2
    assert rows[0]["boundary_label"] == "SG_PORT"


def test_a2a_datasource_query_falls_back_to_execution_result_csv(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="completed", context_id="c1",
        response_text=_RETRIEVE_CSV_TAG, query_result=None))
    src = ds.A2ADataSource("http://bff", "sek")
    r = src.query("get vessels", session_id="c1")
    assert r.row_count == 3
    assert r.rows[0]["vessel_name"] == "WONDER VEGA"
