import json
import os

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

os.environ.setdefault("KEYCLOAK_ISSUER", "http://dev.com:8080/realms/master")
os.environ.setdefault("KEYCLOAK_CLIENT_ID", "gis-canvas-bff")
os.environ.setdefault("KEYCLOAK_CLIENT_SECRET", "sekret")
os.environ.setdefault("BFF_REDIRECT_URI", "http://localhost:9109/auth/callback")
os.environ.setdefault("SPA_ORIGIN", "http://localhost:5174")
os.environ.setdefault("POST_LOGOUT_REDIRECT", "http://localhost:5174/")
os.environ.setdefault("SESSION_SECRET", "s" * 40)
os.environ.setdefault("DATA_AGENT_URL", "http://localhost:2024")
os.environ.setdefault("GIS_BFF_PROXY_SECRET", "p" * 40)

from app import main as bff  # noqa: E402
from app.sessions import TokenRecord  # noqa: E402
from app.sessions_proxy import visible_sessions  # noqa: E402

GW = "http://127.0.0.1:9119"


@pytest.fixture(autouse=True)
def _reset():
    bff.store._by_sid.clear()
    bff.store._canvas_to_sid.clear()
    yield


def _authed() -> TestClient:
    sid = bff.store.create(TokenRecord(access_token="AT", refresh_token="RT", id_token="IT",
                                       expires_at=9e9, username="jsmith", roles=["selectdata"]))
    c = TestClient(bff.app, follow_redirects=False)
    c.cookies.set("sid", sid)
    return c


def test_visible_sessions_v1_returns_every_row():
    # v1 rule, stated in the design: any authenticated user sees every session
    # on the host. This test exists so tightening the rule is a visible diff.
    rows = [{"id": "a", "source": "telegram"}, {"id": "b", "source": "cli"}]
    assert visible_sessions(rows, "jsmith") == rows


def test_sessions_401_when_not_authenticated():
    r = TestClient(bff.app).get("/sessions")
    assert r.status_code == 401


def test_messages_401_when_not_authenticated():
    r = TestClient(bff.app).get("/sessions/abc/messages")
    assert r.status_code == 401


def test_sessions_proxies_the_gateway_with_the_service_token():
    payload = {"sessions": [{"id": "a", "source": "telegram", "title": "t",
                             "preview": "p", "message_count": 3,
                             "started_at": 1.0, "last_active": 2.0}], "total": 1}
    with respx.mock:
        route = respx.get(f"{GW}/api/sessions").mock(return_value=httpx.Response(200, json=payload))
        r = _authed().get("/sessions")
    assert r.status_code == 200
    assert r.json()["sessions"][0]["id"] == "a"
    assert r.json()["total"] == 1
    assert route.calls[0].request.headers["X-Hermes-Session-Token"] == "dev-gis-local"


def test_messages_proxies_the_gateway():
    payload = {"session_id": "abc", "messages": [{"role": "user", "content": "hi"}]}
    with respx.mock:
        respx.get(f"{GW}/api/sessions/abc/messages").mock(return_value=httpx.Response(200, json=payload))
        r = _authed().get("/sessions/abc/messages")
    assert r.status_code == 200
    assert r.json()["messages"][0]["content"] == "hi"


def test_gateway_failure_surfaces_as_502_not_500():
    with respx.mock:
        respx.get(f"{GW}/api/sessions").mock(return_value=httpx.Response(500, text="boom"))
        r = _authed().get("/sessions")
    assert r.status_code == 502


def test_sessions_asks_the_gateway_to_drop_empty_sessions():
    # The picker exists to find a session worth reopening; a session with no
    # messages never is. The gateway filters server-side so paging stays honest
    # (filtering client-side would leave short, ragged pages).
    payload = {"sessions": [], "total": 0}
    with respx.mock:
        route = respx.get(f"{GW}/api/sessions").mock(return_value=httpx.Response(200, json=payload))
        r = _authed().get("/sessions")
    assert r.status_code == 200
    assert route.calls[0].request.url.params["min_messages"] == "1"


def test_sessions_min_messages_is_caller_overridable():
    payload = {"sessions": [], "total": 0}
    with respx.mock:
        route = respx.get(f"{GW}/api/sessions").mock(return_value=httpx.Response(200, json=payload))
        r = _authed().get("/sessions?min_messages=0")
    assert r.status_code == 200
    assert route.calls[0].request.url.params["min_messages"] == "0"


def test_rename_401_when_not_authenticated():
    r = TestClient(bff.app).patch("/sessions/abc", json={"title": "New name"})
    assert r.status_code == 401


def test_delete_401_when_not_authenticated():
    r = TestClient(bff.app).delete("/sessions/abc")
    assert r.status_code == 401


def test_rename_proxies_the_title():
    with respx.mock:
        route = respx.patch(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True, "title": "New name"}))
        r = _authed().patch("/sessions/abc", json={"title": "New name"})
    assert r.status_code == 200
    assert json.loads(route.calls[0].request.content)["title"] == "New name"


def test_archive_proxies_the_flag_without_touching_the_title():
    with respx.mock:
        route = respx.patch(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True}))
        r = _authed().patch("/sessions/abc", json={"archived": True})
    assert r.status_code == 200
    body = json.loads(route.calls[0].request.content)
    assert body["archived"] is True
    # Sending title=None would CLEAR the title — only send what is being changed.
    assert "title" not in body


def test_rename_can_clear_a_title_with_an_empty_string():
    with respx.mock:
        route = respx.patch(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True}))
        r = _authed().patch("/sessions/abc", json={"title": ""})
    assert r.status_code == 200
    assert json.loads(route.calls[0].request.content)["title"] == ""


def test_delete_proxies_and_returns_the_gateway_body():
    with respx.mock:
        respx.delete(f"{GW}/api/sessions/abc").mock(
            return_value=httpx.Response(200, json={"ok": True}))
        r = _authed().delete("/sessions/abc")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_mutations_surface_a_missing_session_as_404():
    with respx.mock:
        respx.patch(f"{GW}/api/sessions/gone").mock(return_value=httpx.Response(404, json={}))
        r = _authed().patch("/sessions/gone", json={"title": "x"})
    assert r.status_code == 404


def test_mutations_surface_a_gateway_failure_as_502():
    with respx.mock:
        respx.delete(f"{GW}/api/sessions/abc").mock(return_value=httpx.Response(500, text="boom"))
        r = _authed().delete("/sessions/abc")
    assert r.status_code == 502


def test_cors_preflight_allows_the_mutating_methods():
    """The browser preflights PATCH/DELETE (they are not "simple" requests).

    With allow_methods=["GET","POST"] the preflight 400s and the real request is
    never sent — the rename silently reverts with nothing in the server log but
    a rejected OPTIONS. TestClient/respx never exercise preflight, so only this
    test catches it.
    """
    c = TestClient(bff.app)
    for method in ("GET", "POST", "PATCH", "DELETE"):
        r = c.options("/sessions/abc", headers={
            "Origin": "http://localhost:5174",
            "Access-Control-Request-Method": method,
        })
        assert r.status_code == 200, f"{method} preflight rejected: {r.status_code}"
        assert method in r.headers.get("access-control-allow-methods", "")
