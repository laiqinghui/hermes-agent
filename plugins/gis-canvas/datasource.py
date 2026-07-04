"""DataSource abstraction: A2ADataSource (Enterprise Data Agent, streaming) and
MockDataSource (structured geo rows for the render path). The auth-header
provider is injected so Phase 4b can swap sandbox-token -> real Keycloak token
with no signature change."""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable

from . import a2a_client  # relative: resolves under the gis_canvas_plugin package loader


@dataclass
class QueryResult:
    rows: list[dict]
    schema: list[dict]
    row_count: int
    context_id: str | None = None
    clarification: str | None = None


def _infer_type(v) -> str:
    return "number" if isinstance(v, (int, float)) and not isinstance(v, bool) else "string"


def rows_from_query_result(qr: dict) -> tuple[list[dict], list[dict]]:
    cols = qr.get("columns", [])
    raw = qr.get("rows", [])
    rows = [dict(zip(cols, r)) for r in raw]
    sample = rows[0] if rows else {c: "" for c in cols}
    schema = [{"name": c, "type": _infer_type(sample.get(c))} for c in cols]
    return rows, schema


class DataSource(ABC):
    @abstractmethod
    def discover(self, prompt: str) -> list[dict]: ...
    @abstractmethod
    def query(self, prompt: str, context_id: str | None = None) -> QueryResult: ...


class A2ADataSource(DataSource):
    def __init__(self, url: str, auth_provider: Callable[[], str]):
        self._url = url
        self._auth = auth_provider

    def discover(self, prompt: str) -> list[dict]:
        r = a2a_client.query(self._url, self._auth(), prompt)
        return r.datasets or []

    def query(self, prompt: str, context_id: str | None = None) -> QueryResult:
        r = a2a_client.query(self._url, self._auth(), prompt, context_id)
        if r.clarification:
            return QueryResult(rows=[], schema=[], row_count=0,
                               context_id=r.context_id, clarification=r.clarification)
        rows, schema = ([], [])
        if r.query_result:
            rows, schema = rows_from_query_result(r.query_result)
        return QueryResult(rows=rows, schema=schema, row_count=len(rows), context_id=r.context_id)


# Geo catalog mirrors apps/gis-canvas/src/lib/mock-data.ts so the render path works.
_DEFAULT_CATALOG: dict[str, dict] = {
    "incidents": {
        "database_name": "mock", "description": "Mock incident points (Portland)",
        "schema": [
            {"name": "id", "type": "string"}, {"name": "severity", "type": "string"},
            {"name": "district", "type": "string"}, {"name": "reported_at", "type": "string"},
            {"name": "lng", "type": "number"}, {"name": "lat", "type": "number"}],
        "rows": [
            {"id": "f_82", "severity": "high", "district": "Downtown", "reported_at": "2026-07-01T09:14Z", "lng": -122.676, "lat": 45.523},
            {"id": "f_91", "severity": "high", "district": "Downtown", "reported_at": "2026-07-01T08:47Z", "lng": -122.678, "lat": 45.521},
            {"id": "f_63", "severity": "med", "district": "Riverside", "reported_at": "2026-07-01T08:02Z", "lng": -122.660, "lat": 45.500},
            {"id": "f_57", "severity": "high", "district": "Downtown", "reported_at": "2026-07-01T07:51Z", "lng": -122.673, "lat": 45.525},
            {"id": "f_44", "severity": "low", "district": "Midtown", "reported_at": "2026-07-01T07:20Z", "lng": -122.640, "lat": 45.530},
            {"id": "f_31", "severity": "med", "district": "Midtown", "reported_at": "2026-07-01T06:58Z", "lng": -122.638, "lat": 45.528},
            {"id": "f_29", "severity": "high", "district": "Riverside", "reported_at": "2026-07-01T06:31Z", "lng": -122.662, "lat": 45.498},
            {"id": "f_18", "severity": "low", "district": "Downtown", "reported_at": "2026-07-01T06:05Z", "lng": -122.675, "lat": 45.519}],
    },
    "districts": {
        "database_name": "mock", "description": "Mock district populations",
        "schema": [{"name": "district", "type": "string"}, {"name": "population", "type": "number"}],
        "rows": [
            {"district": "Downtown", "population": 51200}, {"district": "Riverside", "population": 23800},
            {"district": "Midtown", "population": 33400}, {"district": "Harbor", "population": 12100}],
    },
}


class MockDataSource(DataSource):
    def __init__(self, catalog: dict | None = None):
        self._catalog = catalog or _DEFAULT_CATALOG

    def discover(self, prompt: str) -> list[dict]:
        return [{"view_name": name, "database_name": e["database_name"], "description": e["description"]}
                for name, e in self._catalog.items()]

    def query(self, prompt: str, context_id: str | None = None) -> QueryResult:
        low = (prompt or "").lower()
        entry = next((e for n, e in self._catalog.items() if n in low), None)
        if entry is None:
            entry = next(iter(self._catalog.values()))
        return QueryResult(rows=list(entry["rows"]), schema=list(entry["schema"]),
                           row_count=len(entry["rows"]), context_id=context_id)


def default_auth_provider() -> str:
    return f"Bearer {os.environ.get('DATA_AGENT_AUTH_TOKEN', 'sandbox-test-token')}"


def make_data_source() -> DataSource:
    kind = os.environ.get("GIS_DATA_SOURCE", "mock").lower()
    if kind == "a2a":
        url = os.environ.get("DATA_AGENT_URL", "http://localhost:2024")
        return A2ADataSource(url, default_auth_provider)
    return MockDataSource()


_data_source: DataSource | None = None


def get_data_source() -> DataSource:
    global _data_source
    if _data_source is None:
        _data_source = make_data_source()
    return _data_source


def reset_data_source_for_tests() -> None:
    global _data_source
    _data_source = None
