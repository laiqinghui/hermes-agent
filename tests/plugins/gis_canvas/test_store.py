def _doc(rev=None):
    d = {"canvasVersion": 1, "layout": {"type": "grid", "cols": 12}, "components": []}
    if rev is not None:
        d["rev"] = rev
    return d


def test_get_missing_returns_none(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    assert store.get("sess1") is None


def test_put_stamps_rev_starting_at_1(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    stored = store.put("sess1", _doc())
    assert stored["rev"] == 1
    stored2 = store.put("sess1", _doc())
    assert stored2["rev"] == 2


def test_put_ignores_client_supplied_rev(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    stored = store.put("sess1", _doc(rev=999))
    assert stored["rev"] == 1


def test_persistence_roundtrip_across_instances(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    store.put("sess1", _doc())
    fresh = plugin.store.CanvasStore(base_dir=str(tmp_path))
    loaded = fresh.get("sess1")
    assert loaded is not None and loaded["rev"] == 1


def test_keys_are_isolated(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    store.put("a", _doc())
    assert store.get("b") is None


def test_reset_removes_doc(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    store.put("sess1", _doc())
    store.reset("sess1")
    assert store.get("sess1") is None


def test_key_is_sanitized_for_filesystem(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    stored = store.put("../evil/../../key", _doc())
    assert stored["rev"] == 1  # no traversal, file lands inside base_dir
    # tmp_path may hold extra dirs from the repo's hermetic-test fixtures
    # (HERMES_HOME isolation), so assert on our json file specifically.
    files = list(tmp_path.glob("*.json"))
    assert len(files) == 1 and files[0].name == "_evil_key.json"


def test_resolve_session_key(plugin):
    assert plugin.store.resolve_session_key({"task_id": "abc123"}) == "abc123"
    assert plugin.store.resolve_session_key({}) == "default"
    assert plugin.store.resolve_session_key({"task_id": None}) == "default"


def test_resolve_session_key_prefers_session_id(plugin):
    assert plugin.store.resolve_session_key({"session_id": "9d368060", "task_id": "20260702_x"}) == "9d368060"


def test_resolve_session_key_falls_back_to_task_id(plugin):
    assert plugin.store.resolve_session_key({"task_id": "t1"}) == "t1"


def test_resolve_session_key_default_when_empty(plugin):
    assert plugin.store.resolve_session_key({"session_id": "", "task_id": ""}) == "default"
