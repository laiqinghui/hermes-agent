import time


def test_put_returns_data_handle_and_get_roundtrips(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path))
    schema = [{"name": "id", "type": "string"}, {"name": "sev", "type": "string"}]
    rows = [{"id": "a", "sev": "high"}, {"id": "b", "sev": "low"}]
    h = b.put(rows, schema)
    assert h.startswith("data://")
    got = b.get(h)
    assert got["rows"] == rows and got["schema"] == schema


def test_page_slices_filters_and_projects(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path))
    schema = [{"name": "id", "type": "string"}, {"name": "sev", "type": "string"}]
    rows = [{"id": str(i), "sev": "high" if i % 2 else "low"} for i in range(10)]
    h = b.put(rows, schema)
    p = b.page(h, page=0, page_size=3)
    assert p["ok"] and p["total"] == 10 and len(p["rows"]) == 3 and p["rows"][0]["id"] == "0"
    p2 = b.page(h, page=3, page_size=3)
    assert [r["id"] for r in p2["rows"]] == ["9"]
    pf = b.page(h, filter={"sev": "high"})
    assert pf["total"] == 5 and all(r["sev"] == "high" for r in pf["rows"])
    pj = b.page(h, page_size=2, fields=["id"])
    assert pj["rows"][0] == {"id": "0"}


def test_missing_handle_errors(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path))
    r = b.page("data://deadbeef")
    assert r["ok"] is False and r["errors"]


def test_expired_handle_purged(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path), ttl_s=0)  # everything immediately stale
    h = b.put([{"id": "a"}], [{"name": "id", "type": "string"}])
    time.sleep(0.01)
    assert b.get(h) is None
