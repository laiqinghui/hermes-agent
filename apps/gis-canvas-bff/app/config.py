from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()  # reads apps/gis-canvas-bff/.env when cwd is that dir


@dataclass
class Settings:
    keycloak_issuer: str
    client_id: str
    client_secret: str
    redirect_uri: str
    spa_origin: str
    post_logout_redirect: str
    session_secret: str
    data_agent_url: str
    proxy_secret: str
    cookie_secure: bool
    # Gateway REST, used by the read-only session browser. Defaulted so
    # Settings stays constructible without them.
    gateway_url: str = "http://127.0.0.1:9119"
    gateway_token: str = ""

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            keycloak_issuer=os.environ["KEYCLOAK_ISSUER"],
            client_id=os.environ["KEYCLOAK_CLIENT_ID"],
            client_secret=os.environ["KEYCLOAK_CLIENT_SECRET"],
            redirect_uri=os.environ["BFF_REDIRECT_URI"],
            spa_origin=os.environ["SPA_ORIGIN"],
            post_logout_redirect=os.environ["POST_LOGOUT_REDIRECT"],
            session_secret=os.environ["SESSION_SECRET"],
            data_agent_url=os.environ.get("DATA_AGENT_URL", "http://localhost:2024"),
            gateway_url=os.environ.get("HERMES_GATEWAY_URL", "http://127.0.0.1:9119"),
            gateway_token=os.environ.get("HERMES_DASHBOARD_SESSION_TOKEN", ""),
            proxy_secret=os.environ["GIS_BFF_PROXY_SECRET"],
            cookie_secure=os.environ.get("BFF_COOKIE_SECURE", "false").lower() in ("1", "true", "yes", "on"),
        )
