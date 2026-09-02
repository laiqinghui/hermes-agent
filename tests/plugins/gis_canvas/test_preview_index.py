def _rec(preview="p1", verdict="rendered"):
    return {"preview_session_id": preview, "verdict": verdict, "reason": "analysis session"}


def test_get_missing_returns_none(plugin, tmp_path):
    idx = plugin.preview_index.PreviewIndex(base_dir=str(tmp_path))
    assert idx.get("tg1") is None


def test_put_then_get_round_trips(plugin, tmp_path):
    idx = plugin.preview_index.PreviewIndex(base_dir=str(tmp_path))
    idx.put("tg1", _rec())
    got = idx.get("tg1")
    assert got["preview_session_id"] == "p1"
    assert got["verdict"] == "rendered"
    assert got["source_session_id"] == "tg1"


def test_put_overwrites_and_persists_across_instances(plugin, tmp_path):
    idx = plugin.preview_index.PreviewIndex(base_dir=str(tmp_path))
    idx.put("tg1", _rec())
    idx.put("tg1", _rec(preview="p2", verdict="declined"))
    fresh = plugin.preview_index.PreviewIndex(base_dir=str(tmp_path))
    assert fresh.get("tg1")["preview_session_id"] == "p2"
    assert fresh.get("tg1")["verdict"] == "declined"


def test_declined_is_remembered_so_no_turn_is_respent(plugin, tmp_path):
    idx = plugin.preview_index.PreviewIndex(base_dir=str(tmp_path))
    idx.put("cli9", _rec(verdict="declined"))
    assert idx.get("cli9")["verdict"] == "declined"


def test_corrupt_index_file_is_treated_as_empty(plugin, tmp_path):
    (tmp_path / "_previews.json").write_text("{ not json")
    idx = plugin.preview_index.PreviewIndex(base_dir=str(tmp_path))
    assert idx.get("tg1") is None
    idx.put("tg1", _rec())
    assert idx.get("tg1")["preview_session_id"] == "p1"
