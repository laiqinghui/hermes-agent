"""OIDC primitives for the BFF: PKCE, discovery, token exchange/refresh,
id_token validation. All network calls take an injected httpx.AsyncClient so
tests can mock with respx."""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode

import httpx
from authlib.jose import JsonWebKey, JsonWebToken

from .config import Settings

_CACHE_TTL: float = 300.0
_meta_cache: tuple[dict, float] | None = None
_jwks_cache: tuple[dict, float] | None = None


def make_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


async def fetch_metadata(issuer: str, client: httpx.AsyncClient) -> dict:
    global _meta_cache
    if _meta_cache is None or time.time() - _meta_cache[1] > _CACHE_TTL:
        r = await client.get(f"{issuer}/.well-known/openid-configuration")
        r.raise_for_status()
        _meta_cache = (r.json(), time.time())
    return _meta_cache[0]


async def _jwks(meta: dict, client: httpx.AsyncClient) -> dict:
    global _jwks_cache
    if _jwks_cache is None or time.time() - _jwks_cache[1] > _CACHE_TTL:
        r = await client.get(meta["jwks_uri"])
        r.raise_for_status()
        _jwks_cache = (r.json(), time.time())
    return _jwks_cache[0]


def build_authorize_url(meta: dict, s: Settings, state: str, challenge: str, nonce: str) -> str:
    params = urlencode({
        "client_id": s.client_id,
        "redirect_uri": s.redirect_uri,
        "response_type": "code",
        "scope": "openid profile email",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "nonce": nonce,
    })
    return f"{meta['authorization_endpoint']}?{params}"


async def exchange_code(meta: dict, s: Settings, code: str, verifier: str,
                        client: httpx.AsyncClient) -> dict:
    r = await client.post(meta["token_endpoint"], data={
        "grant_type": "authorization_code", "code": code,
        "redirect_uri": s.redirect_uri, "client_id": s.client_id,
        "client_secret": s.client_secret, "code_verifier": verifier,
    })
    r.raise_for_status()
    return r.json()


async def refresh_tokens(meta: dict, s: Settings, refresh_token: str,
                         client: httpx.AsyncClient) -> dict:
    r = await client.post(meta["token_endpoint"], data={
        "grant_type": "refresh_token", "refresh_token": refresh_token,
        "client_id": s.client_id, "client_secret": s.client_secret,
    })
    r.raise_for_status()
    return r.json()


async def validate_id_token(meta: dict, s: Settings, id_token: str,
                            client: httpx.AsyncClient) -> dict:
    jwks = await _jwks(meta, client)
    claims = JsonWebToken(["RS256"]).decode(id_token, JsonWebKey.import_key_set(jwks))
    claims.validate()  # exp/nbf/iat
    if claims.get("iss") != s.keycloak_issuer:
        raise ValueError("issuer mismatch")
    aud = claims.get("aud", [])
    aud = [aud] if isinstance(aud, str) else aud
    if s.client_id not in aud:
        raise ValueError("audience mismatch")
    return dict(claims)


def roles_from_access_token(access_token: str) -> list[str]:
    """Unverified decode of the access token's JWT payload -> claims["roles"].

    The BFF trusts this token because it just received it directly from
    Keycloak's token endpoint over TLS (or is about to send it straight back
    upstream as a bearer token); this is not used for authn/authz decisions
    that require signature verification (that's validate_id_token's job for
    the id_token). Any parse error yields an empty role list rather than
    raising, since this is best-effort UI/authorization metadata.
    """
    try:
        payload_seg = access_token.split(".")[1]
        padded = payload_seg + "=" * (-len(payload_seg) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
        return claims.get("roles", [])
    except Exception:
        return []


def reset_caches_for_tests() -> None:
    global _meta_cache, _jwks_cache
    _meta_cache = None
    _jwks_cache = None
