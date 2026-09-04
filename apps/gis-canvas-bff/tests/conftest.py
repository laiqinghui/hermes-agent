import os
import pathlib
import sys

# Hermetic test env: hard-assign (not setdefault) BEFORE any `app.*` import,
# so python-dotenv's load_dotenv() in app/config.py (override=False by default)
# sees these already set and leaves them alone, even when a real
# apps/gis-canvas-bff/.env exists on this machine with production-like values.
os.environ["KEYCLOAK_ISSUER"] = "http://dev.com:8080/realms/master"
os.environ["KEYCLOAK_CLIENT_ID"] = "gis-canvas-bff"
os.environ["KEYCLOAK_CLIENT_SECRET"] = "sekret"
os.environ["BFF_REDIRECT_URI"] = "http://localhost:9109/auth/callback"
os.environ["SPA_ORIGIN"] = "http://localhost:5174"
os.environ["POST_LOGOUT_REDIRECT"] = "http://localhost:5174/"
os.environ["SESSION_SECRET"] = "s" * 40
os.environ["DATA_AGENT_URL"] = "http://localhost:2024"
os.environ["GIS_BFF_PROXY_SECRET"] = "p" * 40
os.environ["BFF_COOKIE_SECURE"] = "false"
os.environ["HERMES_DASHBOARD_SESSION_TOKEN"] = "dev-gis-local"

# Make `app` importable when running pytest from apps/gis-canvas-bff/
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
