import os
import time

import httpx
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

_BODY = {"jsonrpc": "2.0", "id": "1", "method": "message/stream",
         "params": {"message": {"messageId": "m", "role": "user",
                                "parts": [{"kind": "text", "text": "hi"}]}}}


def _seed_bound(canvas="c1", expires_at=9e9, refresh_token="RT") -> str:
    bff.store._by_sid.clear()
    bff.store._canvas_to_sid.clear()
    sid = bff.store.create(TokenRecord(access_token="AT", refresh_token=refresh_token, id_token="IT",
                                       expires_at=expires_at, username="jsmith", roles=["selectdata"]))
    bff.store.bind(sid, [canvas])
    return sid


def test_proxy_403_on_bad_proxy_secret():
    _seed_bound()
    r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                 headers={"X-Proxy-Secret": "wrong", "X-Canvas-Session": "c1"})
    assert r.status_code == 403


def test_proxy_401_when_canvas_unbound():
    _seed_bound(canvas="c1")
    r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                 headers={"X-Proxy-Secret": "p" * 40, "X-Canvas-Session": "unknown"})
    assert r.status_code == 401


def test_proxy_forwards_bearer_and_streams_ndjson():
    _seed_bound(canvas="c1")
    captured = {}

    def _agent(request):
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = request.content.decode()
        ndjson = ('{"result":{"kind":"status-update","status":{"state":"working"}}}\n'
                  '{"result":{"kind":"task","status":{"state":"completed"}}}\n')
        return httpx.Response(200, text=ndjson)

    with respx.mock:
        respx.post("http://localhost:2024/").mock(side_effect=_agent)
        r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                     headers={"X-Proxy-Secret": "p" * 40, "X-Canvas-Session": "c1"})
    assert r.status_code == 200
    assert captured["auth"] == "Bearer AT"
    assert '"kind":"task"' in r.text


def test_proxy_propagates_upstream_error_status():
    _seed_bound(canvas="c1")

    with respx.mock:
        respx.post("http://localhost:2024/").mock(
            return_value=httpx.Response(500, text='{"error":"boom"}'))
        r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                     headers={"X-Proxy-Secret": "p" * 40, "X-Canvas-Session": "c1"})
    assert r.status_code == 500


def test_proxy_401_when_token_expired_and_no_refresh():
    _seed_bound(canvas="c1", expires_at=time.time() - 10, refresh_token="")
    r = TestClient(bff.app).post("/a2a/message", json=_BODY,
                                 headers={"X-Proxy-Secret": "p" * 40, "X-Canvas-Session": "c1"})
    assert r.status_code == 401
