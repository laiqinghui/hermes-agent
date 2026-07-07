from app.sessions import SessionStore, TokenRecord


def _rec(**kw) -> TokenRecord:
    base = dict(access_token="a", refresh_token="r", id_token="i",
                expires_at=1000.0, username="jsmith", roles=["selectdata"])
    base.update(kw)
    return TokenRecord(**base)


def test_create_returns_opaque_sid_and_stores_record():
    s = SessionStore()
    sid = s.create(_rec())
    assert isinstance(sid, str) and len(sid) >= 16
    assert s.get(sid).username == "jsmith"


def test_get_unknown_sid_returns_none():
    assert SessionStore().get("nope") is None


def test_bind_maps_each_canvas_session_to_sid():
    s = SessionStore()
    sid = s.create(_rec())
    s.bind(sid, ["stored-1", "live-1"])
    assert s.sid_for_canvas("stored-1") == sid
    assert s.sid_for_canvas("live-1") == sid
    assert s.sid_for_canvas("unbound") is None


def test_needs_refresh_true_within_margin():
    s = SessionStore()
    sid = s.create(_rec(expires_at=1000.0))
    assert s.needs_refresh(sid, now=950.0, margin=60.0) is True   # 1000-60=940 <= 950
    assert s.needs_refresh(sid, now=930.0, margin=60.0) is False


def test_evict_removes_record_and_indexes():
    s = SessionStore()
    sid = s.create(_rec())
    s.bind(sid, ["c1"])
    evicted = s.evict(sid)
    assert evicted.username == "jsmith"
    assert s.get(sid) is None
    assert s.sid_for_canvas("c1") is None
