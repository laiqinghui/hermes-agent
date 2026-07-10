import os

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
os.environ.setdefault("BFF_COOKIE_SECURE", "false")

from app import main as bff  # noqa: E402
from app.sessions import TokenRecord  # noqa: E402


def _client() -> TestClient:
    return TestClient(bff.app, follow_redirects=False)


def test_logout_pops_lock():
    sid = bff.store.create(TokenRecord(access_token="AT", refresh_token="RT", id_token="",
                                       expires_at=9e9, username="jsmith", roles=[]))
    c = _client()
    c.cookies.set("sid", sid)
    _ = bff._locks[sid]  # touch the defaultdict so the lock exists
    assert sid in bff._locks

    r = c.post("/auth/logout")
    assert r.status_code == 200
    assert sid not in bff._locks
