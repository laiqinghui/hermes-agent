import base64
import hashlib

import httpx
import pytest
import respx

from app import oidc
from app.config import Settings


def _settings() -> Settings:
    return Settings(
        keycloak_issuer="http://dev.com:8080/realms/master",
        client_id="gis-canvas-bff", client_secret="sekret",
        redirect_uri="http://localhost:9109/auth/callback",
        spa_origin="http://localhost:5174",
        post_logout_redirect="http://localhost:5174/",
        session_secret="x" * 32, data_agent_url="http://localhost:2024",
        proxy_secret="p" * 32,
    )


_META = {
    "authorization_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/auth",
    "token_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/token",
    "end_session_endpoint": "http://dev.com:8080/realms/master/protocol/openid-connect/logout",
    "jwks_uri": "http://dev.com:8080/realms/master/protocol/openid-connect/certs",
}


def test_make_pkce_challenge_is_s256_of_verifier():
    verifier, challenge = oidc.make_pkce()
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    assert challenge == expected
    assert 43 <= len(verifier) <= 128


def test_build_authorize_url_has_pkce_and_state():
    url = oidc.build_authorize_url(_META, _settings(), state="st8", challenge="chal")
    assert url.startswith(_META["authorization_endpoint"] + "?")
    assert "code_challenge=chal" in url
    assert "code_challenge_method=S256" in url
    assert "state=st8" in url
    assert "client_id=gis-canvas-bff" in url
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A9109%2Fauth%2Fcallback" in url


@pytest.mark.asyncio
async def test_exchange_code_posts_authorization_code_grant():
    route_hit = {}

    def _capture(request):
        route_hit["body"] = request.content.decode()
        return httpx.Response(200, json={"access_token": "AT", "refresh_token": "RT",
                                         "id_token": "IT", "expires_in": 900})

    with respx.mock:
        respx.post(_META["token_endpoint"]).mock(side_effect=_capture)
        async with httpx.AsyncClient() as client:
            tokens = await oidc.exchange_code(_META, _settings(), "the-code", "the-verifier", client)
    assert tokens["access_token"] == "AT"
    assert "grant_type=authorization_code" in route_hit["body"]
    assert "code=the-code" in route_hit["body"]
    assert "code_verifier=the-verifier" in route_hit["body"]


@pytest.mark.asyncio
async def test_refresh_tokens_posts_refresh_grant():
    with respx.mock:
        respx.post(_META["token_endpoint"]).mock(
            return_value=httpx.Response(200, json={"access_token": "AT2", "expires_in": 900})
        )
        async with httpx.AsyncClient() as client:
            tokens = await oidc.refresh_tokens(_META, _settings(), "old-refresh", client)
    assert tokens["access_token"] == "AT2"


@pytest.mark.asyncio
async def test_validate_id_token_rejects_non_rs256():
    """validate_id_token must enforce RS256-only signature verification.

    Regression test for an algorithm-confusion hole: a generic
    authlib `jwt.decode()` (no algorithm allowlist) will happily accept a
    token signed with whatever key it can find matching the JOSE header's
    `alg`/`kid`, including HS256, if a suitably-typed key happens to be
    present in the JWKS. This proves an HS256-signed token is rejected even
    when the JWKS contains a symmetric ("oct") key matching its `kid` and
    secret -- i.e. even when a naive generic decode would have verified the
    signature successfully. Only RS256 may pass.
    """
    from authlib.jose import JsonWebKey, jwt as _jwt

    oidc.reset_caches_for_tests()

    secret = "leaked-shared-secret-value"
    oct_jwk = JsonWebKey.import_key(secret, {"kty": "oct", "kid": "evil-hs256-key"})
    forged_jwks = {"keys": [oct_jwk.as_dict()]}

    s = _settings()
    token = _jwt.encode(
        {"alg": "HS256", "kid": "evil-hs256-key"},
        {"iss": s.keycloak_issuer, "aud": s.client_id, "exp": 99999999999},
        secret,
    ).decode()

    # Sanity check: this HS256 token is validly signed for its own algorithm
    # (i.e. it isn't merely malformed) -- generic authlib decode would accept
    # it, which is exactly the confusion the fix must close.
    forged_claims = _jwt.decode(token, JsonWebKey.import_key_set(forged_jwks))
    forged_claims.validate()
    assert forged_claims["iss"] == s.keycloak_issuer

    with respx.mock:
        respx.get(_META["jwks_uri"]).mock(
            return_value=httpx.Response(200, json=forged_jwks)
        )
        async with httpx.AsyncClient() as client:
            with pytest.raises(Exception):
                await oidc.validate_id_token(_META, s, token, client)
