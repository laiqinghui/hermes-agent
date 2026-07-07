# gis-canvas-bff

BFF for the GIS Generative Canvas (Phase 4b): OIDC login against Keycloak + an
authenticated A2A proxy to the Data Agent. Tokens live only here.

## Run
1. Copy `.env.example` → `.env`; fill `KEYCLOAK_CLIENT_SECRET` (Keycloak → client
   `gis-canvas-bff` → Credentials) and generate `SESSION_SECRET` / `GIS_BFF_PROXY_SECRET`
   (`python -c "import secrets;print(secrets.token_hex(32))"`). Use the SAME
   `GIS_BFF_PROXY_SECRET` on the gateway.
2. `.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 9109`

## Test
`.venv\Scripts\pytest tests -q`
