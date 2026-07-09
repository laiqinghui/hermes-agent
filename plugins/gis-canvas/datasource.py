"""DataSource abstraction: A2ADataSource (Enterprise Data Agent, streaming via the
gis-canvas BFF proxy) and MockDataSource (structured geo rows for the render path).
The BFF handles auth (Keycloak-backed session -> Data Agent token); the plugin only
threads the caller's session_id through as a header."""
from __future__ import annotations

import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass

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


def _split_markdown_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [cell.strip() for cell in s.split("|")]


def _is_markdown_separator_row(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-+:?", c) for c in cells)


def _coerce_markdown_cell(v: str):
    if v == "":
        return ""
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    try:
        return float(v)
    except ValueError:
        return v


def rows_from_markdown_table(text: str) -> tuple[list[dict], list[dict]] | None:
    """Fallback parser: the real Data Agent returns retrieval rows as a GitHub-flavored
    markdown table embedded in a text artifact rather than a structured query_result."""
    lines = text.splitlines()
    n = len(lines)
    for i in range(n - 1):
        header_line, sep_line = lines[i], lines[i + 1]
        if "|" not in header_line or "|" not in sep_line:
            continue
        sep_cells = _split_markdown_row(sep_line)
        if not _is_markdown_separator_row(sep_cells):
            continue
        header = _split_markdown_row(header_line)
        ncols = len(header)
        rows: list[dict] = []
        j = i + 2
        while j < n and "|" in lines[j]:
            cells = _split_markdown_row(lines[j])
            if len(cells) == ncols:
                rows.append({col: _coerce_markdown_cell(val) for col, val in zip(header, cells)})
            j += 1
        if not rows:
            return None
        schema = [{"name": col, "type": _infer_type(rows[0][col])} for col in header]
        return rows, schema
    return None


class DataSource(ABC):
    @abstractmethod
    def discover(self, prompt: str, session_id: str | None = None) -> list[dict]: ...
    @abstractmethod
    def query(self, prompt: str, context_id: str | None = None,
              session_id: str | None = None) -> QueryResult: ...


class A2ADataSource(DataSource):
    def __init__(self, bff_url: str, proxy_secret: str):
        self._endpoint = bff_url.rstrip("/") + "/a2a/message"
        self._proxy_secret = proxy_secret

    def _headers(self, session_id: str | None) -> dict:
        return {"X-Canvas-Session": session_id or "", "X-Proxy-Secret": self._proxy_secret}

    def discover(self, prompt: str, session_id: str | None = None) -> list[dict]:
        r = a2a_client.query(self._endpoint, prompt, headers=self._headers(session_id))
        return r.datasets or []

    def query(self, prompt: str, context_id: str | None = None,
              session_id: str | None = None) -> QueryResult:
        r = a2a_client.query(self._endpoint, prompt, context_id, headers=self._headers(session_id))
        if r.clarification:
            return QueryResult(rows=[], schema=[], row_count=0,
                               context_id=r.context_id, clarification=r.clarification)
        rows, schema = ([], [])
        if r.query_result:
            rows, schema = rows_from_query_result(r.query_result)
        elif r.response_text:
            parsed = rows_from_markdown_table(r.response_text)
            if parsed:
                rows, schema = parsed
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

    def discover(self, prompt: str, session_id: str | None = None) -> list[dict]:
        return [{"view_name": name, "database_name": e["database_name"], "description": e["description"]}
                for name, e in self._catalog.items()]

    def query(self, prompt: str, context_id: str | None = None,
              session_id: str | None = None) -> QueryResult:
        low = (prompt or "").lower()
        entry = next((e for n, e in self._catalog.items() if n in low), None)
        if entry is None:
            entry = next(iter(self._catalog.values()))
        return QueryResult(rows=list(entry["rows"]), schema=list(entry["schema"]),
                           row_count=len(entry["rows"]), context_id=context_id)


def make_data_source() -> DataSource:
    kind = os.environ.get("GIS_DATA_SOURCE", "mock").lower()
    if kind == "a2a":
        bff_url = os.environ.get("GIS_BFF_URL", "http://localhost:9109")
        proxy_secret = os.environ.get("GIS_BFF_PROXY_SECRET", "")
        return A2ADataSource(bff_url, proxy_secret)
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
