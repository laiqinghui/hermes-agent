import os
import pytest

BFF = os.environ.get("GIS_BFF_URL", "http://localhost:9109")
SECRET = os.environ.get("GIS_BFF_PROXY_SECRET", "")


def _bff_up() -> bool:
    try:
        import httpx
        # /auth/me returns 401 (not connection error) when the BFF is running
        return httpx.get(f"{BFF}/auth/me", timeout=3.0).status_code in (200, 401)
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _bff_up(), reason="gis-canvas BFF not reachable")


def test_bff_proxy_requires_proxy_secret(plugin):
    """Without X-Proxy-Secret the BFF rejects the proxy call (403)."""
    import httpx
    r = httpx.post(f"{BFF}/a2a/message", json={"jsonrpc": "2.0", "id": "1",
                   "method": "message/stream", "params": {"message": {"messageId": "m",
                   "role": "user", "parts": [{"kind": "text", "text": "hi"}]}}},
                   headers={"X-Canvas-Session": "nobody"}, timeout=5.0)
    assert r.status_code in (401, 403)
