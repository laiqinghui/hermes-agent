import base64
import json
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


def test_login_sets_nonce_in_flow_cookie(monkeypatch):
    meta = {"authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
            "token_endpoint": "http://kc/t", "jwks_uri": "http://kc/j",
            "end_session_endpoint": "http://kc/logout"}

    async def fake_fetch_metadata(issuer, client):
        return meta

    monkeypatch.setattr(bff.oidc, "fetch_metadata", fake_fetch_metadata)
    r = _client().get("/auth/login")
    assert r.status_code == 302
    assert "nonce=" in r.headers["location"]
    flow_cookie = r.cookies["_oidc_flow"]
    flow = bff._signer.loads(flow_cookie)
    assert flow.get("nonce")


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


def test_sid_cookie_secure_flag_from_settings(monkeypatch):
    meta = {"authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
            "token_endpoint": "http://kc/t", "jwks_uri": "http://kc/j",
            "end_session_endpoint": "http://kc/logout"}

    async def fake_fetch_metadata(issuer, client):
        return meta

    async def fake_exchange_code(meta, s, code, verifier, client):
        return {"access_token": "AT", "refresh_token": "RT", "id_token": "IT", "expires_in": 900}

    async def fake_validate_id_token(meta, s, id_token, client):
        return {"preferred_username": "jsmith", "roles": []}

    monkeypatch.setattr(bff.oidc, "fetch_metadata", fake_fetch_metadata)
    monkeypatch.setattr(bff.oidc, "exchange_code", fake_exchange_code)
    monkeypatch.setattr(bff.oidc, "validate_id_token", fake_validate_id_token)

    flow = bff._signer.dumps({"state": "s", "verifier": "v"})

    monkeypatch.setattr(bff.settings, "cookie_secure", True)
    c = _client()
    c.cookies.set("_oidc_flow", flow)
    r = c.get("/auth/callback?code=abc&state=s")
    assert r.status_code == 302
    sid_cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith("sid="))
    assert "Secure" in sid_cookie

    monkeypatch.setattr(bff.settings, "cookie_secure", False)
    c2 = _client()
    c2.cookies.set("_oidc_flow", flow)
    r2 = c2.get("/auth/callback?code=abc&state=s")
    assert r2.status_code == 302
    sid_cookie2 = next(h for h in r2.headers.get_list("set-cookie") if h.startswith("sid="))
    assert "Secure" not in sid_cookie2


def _mock_callback_deps(monkeypatch, claims_nonce):
    meta = {"authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
            "token_endpoint": "http://kc/t", "jwks_uri": "http://kc/j",
            "end_session_endpoint": "http://kc/logout"}

    async def fake_fetch_metadata(issuer, client):
        return meta

    async def fake_exchange_code(meta, s, code, verifier, client):
        return {"access_token": "AT", "refresh_token": "RT", "id_token": "IT", "expires_in": 900}

    async def fake_validate_id_token(meta, s, id_token, client):
        return {"preferred_username": "jsmith", "roles": [], "nonce": claims_nonce}

    monkeypatch.setattr(bff.oidc, "fetch_metadata", fake_fetch_metadata)
    monkeypatch.setattr(bff.oidc, "exchange_code", fake_exchange_code)
    monkeypatch.setattr(bff.oidc, "validate_id_token", fake_validate_id_token)


def test_callback_rejects_nonce_mismatch(monkeypatch):
    _mock_callback_deps(monkeypatch, claims_nonce="B")
    flow = bff._signer.dumps({"state": "s", "verifier": "v", "nonce": "A"})
    c = _client()
    c.cookies.set("_oidc_flow", flow)
    r = c.get("/auth/callback?code=c&state=s")
    assert r.status_code == 400


def test_callback_accepts_matching_nonce(monkeypatch):
    _mock_callback_deps(monkeypatch, claims_nonce="A")
    flow = bff._signer.dumps({"state": "s", "verifier": "v", "nonce": "A"})
    c = _client()
    c.cookies.set("_oidc_flow", flow)
    r = c.get("/auth/callback?code=c&state=s")
    assert r.status_code == 302


def _jwt_shaped(payload: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    return f"header.{body}.sig"


def test_me_roles_come_from_access_token(monkeypatch):
    meta = {"authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
            "token_endpoint": "http://kc/t", "jwks_uri": "http://kc/j",
            "end_session_endpoint": "http://kc/logout"}
    access_token = _jwt_shaped({"roles": ["selectdata"], "preferred_username": "jsmith"})

    async def fake_fetch_metadata(issuer, client):
        return meta

    async def fake_exchange_code(meta, s, code, verifier, client):
        return {"access_token": access_token, "refresh_token": "RT", "id_token": "IT", "expires_in": 900}

    async def fake_validate_id_token(meta, s, id_token, client):
        # Deliberately no "roles" key -- proves /auth/me does not fall back to id_token claims.
        return {"preferred_username": "jsmith"}

    monkeypatch.setattr(bff.oidc, "fetch_metadata", fake_fetch_metadata)
    monkeypatch.setattr(bff.oidc, "exchange_code", fake_exchange_code)
    monkeypatch.setattr(bff.oidc, "validate_id_token", fake_validate_id_token)

    flow = bff._signer.dumps({"state": "s", "verifier": "v"})
    c = _client()
    c.cookies.set("_oidc_flow", flow)
    r = c.get("/auth/callback?code=abc&state=s")
    assert r.status_code == 302

    me = c.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["roles"] == ["selectdata"]
