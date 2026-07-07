import os

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

# Env must exist before importing app.main (it builds Settings at import).
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


@pytest.fixture(autouse=True)
def _reset():
    bff.store._by_sid.clear()
    bff.store._canvas_to_sid.clear()
    yield


def _client() -> TestClient:
    # Do not follow redirects so we can assert 302s.
    return TestClient(bff.app, follow_redirects=False)


def test_login_redirects_to_keycloak_and_sets_flow_cookie():
    meta = {"authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
            "token_endpoint": "http://kc/t", "jwks_uri": "http://kc/j",
            "end_session_endpoint": "http://kc/logout"}
    with respx.mock:
        respx.get("http://dev.com:8080/realms/master/.well-known/openid-configuration").mock(
            return_value=httpx.Response(200, json=meta))
        r = _client().get("/auth/login")
    assert r.status_code == 302
    assert r.headers["location"].startswith(meta["authorization_endpoint"])
    assert "_oidc_flow" in r.cookies


def test_me_401_when_no_session():
    r = _client().get("/auth/me")
    assert r.status_code == 401


def test_bind_401_when_no_session():
    r = _client().post("/auth/bind", json={"canvas_sessions": ["c1"]})
    assert r.status_code == 401


def test_me_and_bind_when_session_present():
    # Seed a session and set the sid cookie directly.
    sid = bff.store.create(TokenRecord(access_token="AT", refresh_token="RT", id_token="IT",
                                       expires_at=9e9, username="jsmith", roles=["selectdata"]))
    c = _client()
    c.cookies.set("sid", sid)
    me = c.get("/auth/me")
    assert me.status_code == 200 and me.json()["username"] == "jsmith"
    b = c.post("/auth/bind", json={"canvas_sessions": ["stored-1", "live-1"]})
    assert b.status_code == 200
    assert bff.store.sid_for_canvas("stored-1") == sid
    assert bff.store.sid_for_canvas("live-1") == sid
