def ev(**result): return {"result": result}


def test_collect_discover_datasets(plugin):
    a2a = plugin.a2a_client
    events = [
        ev(status={"state": "working"}, contextId="c1"),
        ev(artifact={"name": "datasets", "parts": [{"kind": "data", "data": {"datasets": [
            {"view_name": "sandbox_db.vessel_traffic", "database_name": "sandbox_db", "description": "x"}]}}]}),
        ev(artifact={"name": "response", "parts": [{"kind": "text", "text": "Found 1 dataset"}]}),
        ev(status={"state": "completed"}, **{"final": True}),
    ]
    r = a2a.collect(events)
    assert r.final_state == "completed" and r.context_id == "c1"
    assert r.datasets and r.datasets[0]["view_name"] == "sandbox_db.vessel_traffic"
    assert "Found 1 dataset" in r.response_text


def test_collect_query_result_rows(plugin):
    a2a = plugin.a2a_client
    events = [ev(artifact={"name": "rows", "parts": [{"kind": "data", "data": {"query_result": {
        "columns": ["id", "sev"], "rows": [["a", "high"]], "row_count": 1, "vql": "SELECT ..."}}}]}),
        ev(status={"state": "completed"}, **{"final": True})]
    r = a2a.collect(events)
    assert r.query_result["columns"] == ["id", "sev"] and r.query_result["rows"] == [["a", "high"]]


def test_collect_input_required_is_clarification(plugin):
    a2a = plugin.a2a_client
    events = [ev(status={"state": "input-required", "message": {"parts": [
        {"kind": "text", "text": "vessel_traffic or port_arrivals?"}]}}, contextId="c9", **{"final": True})]
    r = a2a.collect(events)
    assert r.final_state == "input-required" and r.clarification == "vessel_traffic or port_arrivals?"
    assert r.context_id == "c9"


def test_collect_jsonrpc_error(plugin):
    r = plugin.a2a_client.collect([{"error": {"code": -32603, "message": "Internal error"}}])
    assert r.jsonrpc_error and r.jsonrpc_error["code"] == -32603


def test_stream_events_posts_to_exact_endpoint_with_headers(monkeypatch, plugin):
    a2a = plugin.a2a_client
    seen = {}

    class _Resp:
        def raise_for_status(self): pass
        def iter_lines(self):
            yield '{"result":{"kind":"task","status":{"state":"completed"}}}'
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def _fake_stream(method, url, **kw):
        seen["url"] = url
        seen["headers"] = kw.get("headers")
        return _Resp()

    import httpx
    monkeypatch.setattr(httpx, "stream", _fake_stream)
    list(a2a.stream_events("http://localhost:9109/a2a/message", "hi",
                           headers={"X-Canvas-Session": "c1", "X-Proxy-Secret": "p"}))
    assert seen["url"] == "http://localhost:9109/a2a/message"   # no trailing-slash munging
    assert seen["headers"]["X-Canvas-Session"] == "c1"
    assert seen["headers"]["X-Proxy-Secret"] == "p"
