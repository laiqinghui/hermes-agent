import os
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


def test_default_ttl_outlives_a_long_investigation(plugin, tmp_path, monkeypatch):
    """A canvas is authored over hours and reviewed later, so handles must outlive the
    session that minted them. The old 1h default silently swept mid-investigation handles."""
    monkeypatch.delenv("HERMES_GIS_DATA_TTL", raising=False)
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path))
    h = b.put([{"id": "a"}], [{"name": "id", "type": "string"}])
    path = b._path(h)
    aged = time.time() - (5 * 3600)  # 5h: longer than one investigation, well inside a day
    os.utime(path, (aged, aged))
    assert b.get(h) is not None


def test_reading_a_handle_refreshes_its_expiry(plugin, tmp_path):
    """Sliding TTL: an actively-viewed canvas must not expire out from under the viewer."""
    ttl = 3600
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path), ttl_s=ttl)
    h = b.put([{"id": "a"}], [{"name": "id", "type": "string"}])
    path = b._path(h)
    nearly_stale = time.time() - (ttl - 60)  # 1 min short of expiry
    os.utime(path, (nearly_stale, nearly_stale))

    assert b.page(h)["ok"] is True
    assert time.time() - path.stat().st_mtime < 60  # timer restarted on read

    # and because it was refreshed, it survives past the original deadline
    assert b.get(h) is not None


def test_expired_handle_reports_expiry_distinctly_from_unknown(plugin, tmp_path):
    """The canvas renders a failed fetch as an empty table, so the error text is the only
    signal a viewer gets about WHY rows vanished."""
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path), ttl_s=3600)
    h = b.put([{"id": "a"}], [{"name": "id", "type": "string"}])
    path = b._path(h)
    aged = time.time() - 7200
    os.utime(path, (aged, aged))

    res = b.page(h)
    assert res["ok"] is False
    assert "expired" in " ".join(res["errors"]).lower()
    assert res["expired"] is True
