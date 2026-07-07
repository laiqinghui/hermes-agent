"""OIDC primitives for the BFF: PKCE, discovery, token exchange/refresh,
id_token validation. All network calls take an injected httpx.AsyncClient so
tests can mock with respx."""
from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import urlencode

import httpx
from authlib.jose import JsonWebKey, JsonWebToken

from .config import Settings

_meta_cache: dict | None = None
_jwks_cache: dict | None = None


def make_pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


async def fetch_metadata(issuer: str, client: httpx.AsyncClient) -> dict:
    global _meta_cache
    if _meta_cache is None:
        r = await client.get(f"{issuer}/.well-known/openid-configuration")
        r.raise_for_status()
        _meta_cache = r.json()
    return _meta_cache


async def _jwks(meta: dict, client: httpx.AsyncClient) -> dict:
    global _jwks_cache
    if _jwks_cache is None:
        r = await client.get(meta["jwks_uri"])
        r.raise_for_status()
        _jwks_cache = r.json()
    return _jwks_cache


def build_authorize_url(meta: dict, s: Settings, state: str, challenge: str) -> str:
    params = urlencode({
        "client_id": s.client_id,
        "redirect_uri": s.redirect_uri,
        "response_type": "code",
        "scope": "openid profile email",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
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


def reset_caches_for_tests() -> None:
    global _meta_cache, _jwks_cache
    _meta_cache = None
    _jwks_cache = None
