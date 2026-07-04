# Phase 4a — Data Broker + A2A Data Flow (sandbox-backed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route real data through a server-side broker so bulk rows never enter the LLM context — the agent asks the Enterprise Data Agent (over A2A) or a mock source, gets back a `data://` handle + schema + a ≤3-row sample, binds the handle into the canvas, and the browser pulls paged rows via `canvas.data_fetch`.

**Architecture:** A `DataSource` interface with two implementations — `A2ADataSource` (streaming JSON-RPC `message/stream` to the Data Agent at :2024, tested live against `DATA_AGENT_MODE=sandbox`) and `MockDataSource` (structured geo rows for the render path, since sandbox emits no `query_result` DataPart). Query results land in a disk-backed `BrokerStore` (keyed by an opaque `data://` handle, TTL'd) — disk-backed for the same reason `store.py` is: `data_query` (tool context) and `canvas.data_fetch` (gateway context) may run in different processes. Two new agent tools (`data_discover`, `data_query`) and one new inbound gateway RPC (`canvas.data_fetch`). The frontend gains a data-plane client that pulls pages by handle and feeds the existing table/map molecules.

**Tech Stack:** Python 3.11 (plugin, `httpx` for A2A streaming), FastAPI/WS gateway (`tui_gateway`), React 19 + Vite + TanStack Table + `@arcgis/*` (frontend), pytest + vitest.

## Global Constraints

- **Confinement:** all code lives in `apps/gis-canvas/` + `plugins/gis-canvas/`. The **only** core edit is extending the existing fenced block in `tui_gateway/server.py` (`# >>> gis-canvas … <<<`, currently ending at line 13786) with one more `@method`. No root `package.json` edit. No new top-level files.
- **Staging discipline:** foreign uncommitted `web/` changes exist — **never `git add -A`**; stage explicit paths only.
- **Commit prefix** `gis:`; every commit ends with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Plugin import path** is `hermes_plugins.gis_canvas` (loader slug = key with `-`→`_`), never `plugins.gis_canvas`.
- **The §14 data invariant (load-bearing):** bulk rows appear **only** on the data plane. `data_query`'s agent-visible result contains **only** `{handle, schema, rowCount, sample(≤3 rows)}` — never the full row set. `data_discover` returns **metadata only** (no rows). Tests must assert this.
- **Auth-header seam from day one:** every A2A call carries an `Authorization` header from an injected `auth_provider()` callable. Phase 4a default returns `Bearer sandbox-test-token` (env `DATA_AGENT_AUTH_TOKEN`); Phase 4b swaps the provider — a drop-in, no signature change.
- **Broker/store are disk-backed & process-shared**, mirroring `plugins/gis-canvas/store.py` (`CanvasStore`): one JSON file per key under a configurable dir.
- **Do NOT change the Hermes model** (gpt-5.4 via openai-codex) or edit the installed `~/.hermes/hermes-agent` copy.
- **Back-compat:** existing Phase 1–3 prompts using `mock://…` handles and public FeatureServer URLs must keep working. `data://` is *added* alongside them, not a replacement.
- **Tests:** backend `.venv/bin/pytest tests/plugins/gis_canvas -q` (add `httpx` to the test venv: `.venv/bin/pip install httpx`); frontend `npm run -w @hermes/gis-canvas test`.

## Testing & Import Conventions (READ FIRST — repo-specific)

The gis-canvas plugin lives in a **hyphenated dir** (`plugins/gis-canvas/`) loaded by the test
`conftest.py` as a package named `gis_canvas_plugin`. Two rules follow, and every task depends on them:

1. **Plugin modules use RELATIVE imports for intra-plugin references** — `from .broker import get_broker`,
   `from . import a2a_client`. An absolute `import a2a_client` will NOT resolve under the package loader
   (only the package is on the path, not its submodules). This matches existing modules
   (`tools_canvas.py`: `from .ops import apply_ops`).
2. **Tests reach plugin modules through the `plugin` fixture**, never bare imports:
   `plugin.broker.get_broker()`, `plugin.datasource.A2ADataSource(...)`, `plugin.tools_data.data_query(...)`.
   The fixture (`conftest.load_plugin_module`) sets each submodule's `__package__` so relative imports
   resolve. `monkeypatch.setattr(plugin.datasource.a2a_client, "query", …)` works because `datasource`
   binds the submodule via `from . import a2a_client`.

Frontend tests use ordinary ESM imports (Vitest) — no special convention.

---

## File Structure

**Backend (`plugins/gis-canvas/`):**
- `broker.py` (new) — `BrokerStore` disk-backed handle cache + paging/filter/fields; `get_broker()` singleton.
- `a2a_client.py` (new) — streaming NDJSON A2A adapter: `stream_events()`, `collect() → A2AResult`, `query()`. Pure, no plugin state.
- `datasource.py` (new) — `QueryResult`, `DataSource` ABC, `A2ADataSource`, `MockDataSource`, `make_data_source()` factory + `get_data_source()`/`reset_data_source_for_tests()`, `default_auth_provider()`.
- `tools_data.py` (new) — `data_discover` / `data_query` tool handlers + schemas + `DATA_TOOL_DEFS`.
- `wire.py` (modify) — add `handle_canvas_data_fetch(params)`.
- `__init__.py` (modify) — register `DATA_TOOL_DEFS` alongside `TOOL_DEFS`.
- `tui_gateway/server.py` (modify, fenced) — add `@method("canvas.data_fetch")`.

**Frontend (`apps/gis-canvas/src/`):**
- `lib/data-plane.ts` (new) — `fetchDataPage()`, `isDataHandle()`, `DataPage`/`Row`/`Field` types.
- `lib/handlers.ts` (modify) — add `fetchData` to the `CanvasActions` interface.
- `components/HandlerContext.tsx` (modify) — add `fetchData` to the `NOOP` default.
- `App.tsx` (modify) — provide `fetchData` backed by the `client` gateway.
- `lib/esri/layers.ts` (modify) — `parseLayerRef` recognizes `data://`; extract `buildRowsLayer(source, esri, title)` from the rows branch.
- `components/molecules/DataTableMolecule.tsx` (modify) — pull `data://` handles via the data plane; keep `mock://` back-compat + client-side filter.
- `components/molecules/EsriMapMolecule.tsx` (modify) — fetch `data://` layer pages → `buildRowsLayer`; keep `mock://`/service back-compat.
- `components/molecules/EsriFeatureTableMolecule.tsx` (modify) — same `data://` handling.

**Tests:** `tests/plugins/gis_canvas/test_broker.py`, `test_a2a_client.py`, `test_datasource.py`, `test_data_tools.py`, `test_wire.py` (extend), `test_a2a_sandbox.py` (live, skip-if-down); `apps/gis-canvas/src/lib/data-plane.test.ts`, plus molecule test updates.

---

## Task 1: Broker store (disk-backed handle cache + paging)

**Files:**
- Create: `plugins/gis-canvas/broker.py`
- Test: `tests/plugins/gis_canvas/test_broker.py`

**Interfaces:**
- Consumes: nothing (pure module; mirrors `store.py` patterns).
- Produces:
  - `class BrokerStore(base_dir: str | None = None, ttl_s: int | None = None)`
  - `.put(rows: list[dict], schema: list[dict], meta: dict | None = None) -> str` → returns handle `"data://<hex8>"`
  - `.get(handle: str) -> dict | None` → `{"schema": [...], "rows": [...], "meta": {...}}` (None if missing/expired)
  - `.page(handle: str, page: int = 0, page_size: int = 100, filter: dict | None = None, fields: list[str] | None = None) -> dict` → `{"ok": True, "handle", "page", "pageSize", "total", "rows", "schema"}` or `{"ok": False, "errors": [...]}`
  - `.reset(handle: str) -> None`
  - `get_broker() -> BrokerStore` (singleton), `reset_broker_for_tests() -> None`

- [ ] **Step 1: Write the failing test**

```python
# tests/plugins/gis_canvas/test_broker.py
import time


def test_put_returns_data_handle_and_get_roundtrips(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path))
    schema = [{"name": "id", "type": "string"}, {"name": "sev", "type": "string"}]
    rows = [{"id": "a", "sev": "high"}, {"id": "b", "sev": "low"}]
    h = b.put(rows, schema)
    assert h.startswith("data://")
    got = b.get(h)
    assert got["rows"] == rows and got["schema"] == schema


def test_page_slices_filters_and_projects(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path))
    schema = [{"name": "id", "type": "string"}, {"name": "sev", "type": "string"}]
    rows = [{"id": str(i), "sev": "high" if i % 2 else "low"} for i in range(10)]
    h = b.put(rows, schema)
    p = b.page(h, page=0, page_size=3)
    assert p["ok"] and p["total"] == 10 and len(p["rows"]) == 3 and p["rows"][0]["id"] == "0"
    p2 = b.page(h, page=3, page_size=3)
    assert [r["id"] for r in p2["rows"]] == ["9"]
    pf = b.page(h, filter={"sev": "high"})
    assert pf["total"] == 5 and all(r["sev"] == "high" for r in pf["rows"])
    pj = b.page(h, page_size=2, fields=["id"])
    assert pj["rows"][0] == {"id": "0"}


def test_missing_handle_errors(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path))
    r = b.page("data://deadbeef")
    assert r["ok"] is False and r["errors"]


def test_expired_handle_purged(plugin, tmp_path):
    b = plugin.broker.BrokerStore(base_dir=str(tmp_path), ttl_s=0)  # everything immediately stale
    h = b.put([{"id": "a"}], [{"name": "id", "type": "string"}])
    time.sleep(0.01)
    assert b.get(h) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_broker.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'broker'`.

- [ ] **Step 3: Write minimal implementation**

```python
# plugins/gis-canvas/broker.py
"""Disk-backed data-plane broker: caches query rows behind an opaque data://
handle, TTL'd, with paging/filter/projection. Disk-backed (one JSON file per
handle) so the tool context (data_query) and the gateway context
(canvas.data_fetch) share it across processes — same rationale as store.py."""
from __future__ import annotations

import json
import os
import pathlib
import re
import secrets
import threading
import time

_SAFE = re.compile(r"[^a-zA-Z0-9_-]+")
_PREFIX = "data://"


class BrokerStore:
    def __init__(self, base_dir: str | None = None, ttl_s: int | None = None):
        root = base_dir or os.environ.get("HERMES_GIS_DATA_DIR") or str(
            pathlib.Path.home() / ".hermes" / "gis_canvas_data"
        )
        self._dir = pathlib.Path(root)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._ttl = ttl_s if ttl_s is not None else int(os.environ.get("HERMES_GIS_DATA_TTL", "3600"))
        self._lock = threading.Lock()

    def _path(self, handle: str) -> pathlib.Path:
        key = handle[len(_PREFIX):] if handle.startswith(_PREFIX) else handle
        return self._dir / f"{_SAFE.sub('_', key) or 'x'}.json"

    def put(self, rows: list[dict], schema: list[dict], meta: dict | None = None) -> str:
        handle = _PREFIX + secrets.token_hex(4)
        payload = {"schema": schema, "rows": rows, "meta": meta or {}}
        with self._lock:
            self._path(handle).write_text(json.dumps(payload, ensure_ascii=False))
        return handle

    def get(self, handle: str) -> dict | None:
        path = self._path(handle)
        if not path.exists():
            return None
        if self._ttl >= 0 and (time.time() - path.stat().st_mtime) > self._ttl:
            path.unlink(missing_ok=True)
            return None
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def page(self, handle: str, page: int = 0, page_size: int = 100,
             filter: dict | None = None, fields: list[str] | None = None) -> dict:
        data = self.get(handle)
        if data is None:
            return {"ok": False, "errors": [f"unknown or expired handle '{handle}'"]}
        rows = data["rows"]
        if filter:
            active = [(k, v) for k, v in filter.items() if v not in (None, "", "all")]
            rows = [r for r in rows if all(str(r.get(k)) == str(v) for k, v in active)]
        total = len(rows)
        start = max(0, page) * max(1, page_size)
        window = rows[start:start + max(1, page_size)]
        if fields:
            window = [{k: r.get(k) for k in fields} for r in window]
        return {"ok": True, "handle": handle, "page": page, "pageSize": page_size,
                "total": total, "rows": window, "schema": data["schema"]}

    def reset(self, handle: str) -> None:
        with self._lock:
            self._path(handle).unlink(missing_ok=True)


_broker: BrokerStore | None = None


def get_broker() -> BrokerStore:
    global _broker
    if _broker is None:
        _broker = BrokerStore()
    return _broker


def reset_broker_for_tests() -> None:
    global _broker
    _broker = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_broker.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/broker.py tests/plugins/gis_canvas/test_broker.py
git commit -m "gis: add disk-backed data-plane broker (handle cache + paging)"
```

---

## Task 2: A2A streaming client (NDJSON adapter)

**Files:**
- Create: `plugins/gis-canvas/a2a_client.py`
- Test: `tests/plugins/gis_canvas/test_a2a_client.py`

**Interfaces:**
- Consumes: nothing (pure; `httpx` only at call time).
- Produces:
  - `@dataclass A2AResult` fields: `final_state: str | None`, `context_id: str | None`, `task_id: str | None`, `datasets: list[dict] | None`, `query_result: dict | None`, `response_text: str`, `clarification: str | None`, `jsonrpc_error: dict | None`, `working_count: int`
  - `collect(events: Iterable[dict]) -> A2AResult`
  - `stream_events(url: str, auth_header: str | None, prompt: str, context_id: str | None = None, *, timeout: float = 180.0) -> Iterator[dict]` (yields each JSON-RPC `result`/error envelope)
  - `query(url, auth_header, prompt, context_id=None, *, timeout=180.0) -> A2AResult`

**Design note (verified live against sandbox):** artifacts arrive as `{"result":{"artifact":{"name","parts":[...]}}}`; a `datasets` DataPart has `parts[0].data.datasets`; a retrieval DataPart (real agent, Appendix B) has `parts[0].data.query_result`. `input-required` status carries the question in `status.message.parts[0].text`. `collect()` is pure over the event list so it's testable without a network.

- [ ] **Step 1: Write the failing test**

```python
# tests/plugins/gis_canvas/test_a2a_client.py
def ev(**result): return {"result": result}


def test_collect_discover_datasets(plugin):
    a2a = plugin.a2a_client
    events = [
        ev(status={"state": "working"}, contextId="c1"),
        ev(artifact={"name": "datasets", "parts": [{"kind": "data", "data": {"datasets": [
            {"view_name": "sandbox_db.vessel_traffic", "database_name": "sandbox_db", "description": "x"}]}}]}),
        ev(artifact={"name": "response", "parts": [{"kind": "text", "text": "Found 1 dataset"}]}),
        ev(status={"state": "completed"}, **{"final": True}),
    ]
    r = a2a.collect(events)
    assert r.final_state == "completed" and r.context_id == "c1"
    assert r.datasets and r.datasets[0]["view_name"] == "sandbox_db.vessel_traffic"
    assert "Found 1 dataset" in r.response_text


def test_collect_query_result_rows(plugin):
    a2a = plugin.a2a_client
    events = [ev(artifact={"name": "rows", "parts": [{"kind": "data", "data": {"query_result": {
        "columns": ["id", "sev"], "rows": [["a", "high"]], "row_count": 1, "vql": "SELECT ..."}}}]}),
        ev(status={"state": "completed"}, **{"final": True})]
    r = a2a.collect(events)
    assert r.query_result["columns"] == ["id", "sev"] and r.query_result["rows"] == [["a", "high"]]


def test_collect_input_required_is_clarification(plugin):
    a2a = plugin.a2a_client
    events = [ev(status={"state": "input-required", "message": {"parts": [
        {"kind": "text", "text": "vessel_traffic or port_arrivals?"}]}}, contextId="c9", **{"final": True})]
    r = a2a.collect(events)
    assert r.final_state == "input-required" and r.clarification == "vessel_traffic or port_arrivals?"
    assert r.context_id == "c9"


def test_collect_jsonrpc_error(plugin):
    r = plugin.a2a_client.collect([{"error": {"code": -32603, "message": "Internal error"}}])
    assert r.jsonrpc_error and r.jsonrpc_error["code"] == -32603
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_a2a_client.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'a2a_client'`.

- [ ] **Step 3: Write minimal implementation**

```python
# plugins/gis-canvas/a2a_client.py
"""Streaming A2A (Agent2Agent) adapter for the Enterprise Data Agent.

Manual JSON-RPC 2.0 message/stream over httpx (no A2A SDK dependency — the wire
format is the whole contract). collect() is pure over the parsed event list so
it is unit-testable without a network; stream_events() does the I/O."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Iterable, Iterator


@dataclass
class A2AResult:
    final_state: str | None = None
    context_id: str | None = None
    task_id: str | None = None
    datasets: list[dict] | None = None
    query_result: dict | None = None
    response_text: str = ""
    clarification: str | None = None
    jsonrpc_error: dict | None = None
    working_count: int = 0


def _part_text(parts: list[dict]) -> str:
    for p in parts:
        if p.get("kind") == "text":
            return p.get("text", "")
    return ""


def collect(events: Iterable[dict]) -> A2AResult:
    r = A2AResult()
    texts: list[str] = []
    for ev in events:
        if "error" in ev and "result" not in ev:
            r.jsonrpc_error = ev["error"]
            continue
        res = ev.get("result", {})
        r.context_id = res.get("contextId", r.context_id)
        r.task_id = res.get("taskId", r.task_id)
        if "status" in res:
            state = res["status"].get("state", "")
            if state == "working":
                r.working_count += 1
            if res.get("final"):
                r.final_state = state
            if state == "input-required":
                r.clarification = _part_text(res["status"].get("message", {}).get("parts", []))
        elif "artifact" in res:
            art = res["artifact"]
            for p in art.get("parts", []):
                data = p.get("data") if p.get("kind") == "data" else None
                if isinstance(data, dict) and "datasets" in data:
                    r.datasets = data["datasets"]
                elif isinstance(data, dict) and "query_result" in data:
                    r.query_result = data["query_result"]
                elif p.get("kind") == "text":
                    texts.append(p.get("text", ""))
    r.response_text = "\n".join(texts)
    return r


def stream_events(url: str, auth_header: str | None, prompt: str,
                  context_id: str | None = None, *, timeout: float = 180.0) -> Iterator[dict]:
    import httpx  # local import: keep module importable without httpx for pure collect() tests
    message = {"messageId": str(uuid.uuid4()), "role": "user",
               "parts": [{"kind": "text", "text": prompt}]}
    if context_id:
        message["contextId"] = context_id
    payload = {"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": "message/stream",
               "params": {"message": message}}
    headers = {"Content-Type": "application/json", "Accept": "application/x-ndjson"}
    if auth_header:
        headers["Authorization"] = auth_header
    with httpx.stream("POST", url.rstrip("/") + "/", json=payload, headers=headers, timeout=timeout) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines():
            line = line.strip()
            if not line:
                continue
            if line.startswith("data:"):
                line = line[5:].strip()
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def query(url: str, auth_header: str | None, prompt: str,
          context_id: str | None = None, *, timeout: float = 180.0) -> A2AResult:
    return collect(stream_events(url, auth_header, prompt, context_id, timeout=timeout))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_a2a_client.py -q`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/a2a_client.py tests/plugins/gis_canvas/test_a2a_client.py
git commit -m "gis: add streaming A2A NDJSON client (collect + stream_events)"
```

---

## Task 3: DataSource interface + A2A & Mock implementations

**Files:**
- Create: `plugins/gis-canvas/datasource.py`
- Test: `tests/plugins/gis_canvas/test_datasource.py`

**Interfaces:**
- Consumes: `a2a_client.query` / `A2AResult` (Task 2).
- Produces:
  - `@dataclass QueryResult` fields: `rows: list[dict]`, `schema: list[dict]`, `row_count: int`, `context_id: str | None = None`, `clarification: str | None = None`
  - `class DataSource(ABC)` with `discover(prompt: str) -> list[dict]` and `query(prompt: str, context_id: str | None = None) -> QueryResult`
  - `class A2ADataSource(DataSource)(url: str, auth_provider: Callable[[], str])`
  - `class MockDataSource(DataSource)(catalog: dict | None = None)` — default catalog = geo `incidents`/`districts` mirroring `apps/gis-canvas/src/lib/mock-data.ts`
  - `default_auth_provider() -> str` → `f"Bearer {os.environ.get('DATA_AGENT_AUTH_TOKEN','sandbox-test-token')}"`
  - `make_data_source() -> DataSource`, `get_data_source() -> DataSource`, `reset_data_source_for_tests() -> None`
  - Helper `rows_from_query_result(qr: dict) -> tuple[list[dict], list[dict]]` (rows-as-dicts, schema)

**Design note:** A2A `query_result` gives `rows` as list-of-lists + `columns`; convert to list-of-dicts and derive a schema (numeric vs string by sampling the first row). If the retrieval returned no structured rows (the sandbox case), `A2ADataSource.query` returns `rows=[]` with `response_text` preserved in `clarification=None` — the render path in Phase 4a uses `MockDataSource`, selected by the `GIS_DATA_SOURCE` env (default `mock`).

- [ ] **Step 1: Write the failing test**

```python
# tests/plugins/gis_canvas/test_datasource.py
def test_mock_discover_lists_catalog(plugin):
    src = plugin.datasource.MockDataSource()
    names = [d["view_name"] for d in src.discover("anything")]
    assert "incidents" in names


def test_mock_query_returns_rows_and_schema(plugin):
    src = plugin.datasource.MockDataSource()
    r = src.query("show incidents")
    assert r.row_count == len(r.rows) and r.rows
    assert any(f["name"] == "lng" for f in r.schema)  # geo columns present for the map path


def test_rows_from_query_result_zips_columns(plugin):
    rows, schema = plugin.datasource.rows_from_query_result(
        {"columns": ["id", "n"], "rows": [["a", 1], ["b", 2]], "row_count": 2})
    assert rows == [{"id": "a", "n": 1}, {"id": "b", "n": 2}]
    assert {f["name"]: f["type"] for f in schema} == {"id": "string", "n": "number"}


def test_a2a_query_maps_query_result(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="completed", context_id="c1",
        query_result={"columns": ["id"], "rows": [["a"]], "row_count": 1}))
    src = ds.A2ADataSource("http://x:2024", lambda: "Bearer t")
    r = src.query("get rows")
    assert r.rows == [{"id": "a"}] and r.context_id == "c1" and r.clarification is None


def test_a2a_query_surfaces_clarification(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.setattr(ds.a2a_client, "query", lambda *a, **k: ds.a2a_client.A2AResult(
        final_state="input-required", context_id="c2", clarification="which one?"))
    src = ds.A2ADataSource("http://x:2024", lambda: "Bearer t")
    r = src.query("ambiguous")
    assert r.clarification == "which one?" and r.rows == [] and r.context_id == "c2"


def test_factory_defaults_to_mock(plugin, monkeypatch):
    ds = plugin.datasource
    monkeypatch.delenv("GIS_DATA_SOURCE", raising=False)
    assert isinstance(ds.make_data_source(), ds.MockDataSource)
    monkeypatch.setenv("GIS_DATA_SOURCE", "a2a")
    assert isinstance(ds.make_data_source(), ds.A2ADataSource)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_datasource.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'datasource'`.

- [ ] **Step 3: Write minimal implementation**

```python
# plugins/gis-canvas/datasource.py
"""DataSource abstraction: A2ADataSource (Enterprise Data Agent, streaming) and
MockDataSource (structured geo rows for the render path). The auth-header
provider is injected so Phase 4b can swap sandbox-token → real Keycloak token
with no signature change."""
from __future__ import annotations

import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_datasource.py -q`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/datasource.py tests/plugins/gis_canvas/test_datasource.py
git commit -m "gis: add DataSource interface with A2A + Mock implementations"
```

---

## Task 4: Agent tools — `data_discover` + `data_query`

**Files:**
- Create: `plugins/gis-canvas/tools_data.py`
- Modify: `plugins/gis-canvas/__init__.py`
- Modify: `plugins/gis-canvas/tools_canvas.py` (one line in `_CATALOG_HELP` so the agent knows handles can be `data://`)
- Test: `tests/plugins/gis_canvas/test_data_tools.py`

**Interfaces:**
- Consumes: `get_broker()` (Task 1), `get_data_source()`/`reset_data_source_for_tests()` (Task 3).
- Produces:
  - `data_discover(args: dict, **kw) -> str` → JSON `{"ok": True, "datasets": [...]}`
  - `data_query(args: dict, **kw) -> str` → JSON `{"ok": True, "handle", "schema", "rowCount", "sample", "context_id"}` **or** `{"ok": True, "needs_input": True, "clarification", "context_id"}`
  - `DATA_TOOL_DEFS: list[tuple]` (same 5-tuple shape as `TOOL_DEFS`: name, schema, handler, description, emoji)
- Registration: `__init__.py` registers `TOOL_DEFS + DATA_TOOL_DEFS`.

- [ ] **Step 1: Write the failing test**

```python
# tests/plugins/gis_canvas/test_data_tools.py
import json


def _reset(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GIS_DATA_SOURCE", "mock")
    plugin.broker.reset_broker_for_tests()
    plugin.datasource.reset_data_source_for_tests()


def test_data_query_returns_handle_sample_never_bulk(plugin, tmp_path, monkeypatch):
    _reset(plugin, tmp_path, monkeypatch)
    out = json.loads(plugin.tools_data.data_query({"prompt": "incidents"}))
    assert out["ok"] and out["handle"].startswith("data://")
    assert out["rowCount"] == 8 and len(out["sample"]) == 3   # sample capped at 3
    assert "rows" not in out                                   # invariant: no bulk rows
    # handle resolves to the full set on the data plane
    page = plugin.broker.get_broker().page(out["handle"], page_size=100)
    assert page["total"] == 8


def test_data_discover_metadata_only(plugin, tmp_path, monkeypatch):
    _reset(plugin, tmp_path, monkeypatch)
    out = json.loads(plugin.tools_data.data_discover({"prompt": "what is available"}))
    assert out["ok"] and any(d["view_name"] == "incidents" for d in out["datasets"])
    assert "rows" not in json.dumps(out)  # discovery is metadata only


def test_data_query_relays_clarification(plugin, tmp_path, monkeypatch):
    _reset(plugin, tmp_path, monkeypatch)
    ds = plugin.datasource

    class Clar(ds.DataSource):
        def discover(self, p): return []
        def query(self, p, context_id=None):
            return ds.QueryResult([], [], 0, context_id="cx", clarification="which dataset?")

    monkeypatch.setattr(plugin.tools_data, "get_data_source", lambda: Clar())
    out = json.loads(plugin.tools_data.data_query({"prompt": "ambiguous"}))
    assert out["needs_input"] and out["clarification"] == "which dataset?" and out["context_id"] == "cx"


def test_registration_includes_data_tools(plugin):
    names = {d[0] for d in plugin.tools_data.DATA_TOOL_DEFS}
    assert names == {"data_discover", "data_query"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_data_tools.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'tools_data'`.

- [ ] **Step 3: Write minimal implementation**

```python
# plugins/gis-canvas/tools_data.py
"""Agent-facing data tools. The §14 invariant: data_query returns ONLY
{handle, schema, rowCount, sample≤3} — bulk rows live only on the data plane
(broker cache), fetched by the browser via canvas.data_fetch."""
from __future__ import annotations

import json

from .broker import get_broker
from .datasource import get_data_source

_SAMPLE = 3


def data_discover(args: dict, **kw) -> str:
    prompt = str(args.get("prompt") or "")
    if not prompt:
        return json.dumps({"ok": False, "errors": ["'prompt' is required"]})
    datasets = get_data_source().discover(prompt)
    return json.dumps({"ok": True, "datasets": datasets}, ensure_ascii=False)


def data_query(args: dict, **kw) -> str:
    prompt = str(args.get("prompt") or "")
    if not prompt:
        return json.dumps({"ok": False, "errors": ["'prompt' is required"]})
    context_id = args.get("context_id")
    res = get_data_source().query(prompt, context_id)
    if res.clarification:
        return json.dumps({"ok": True, "needs_input": True,
                           "clarification": res.clarification, "context_id": res.context_id},
                          ensure_ascii=False)
    handle = get_broker().put(res.rows, res.schema, meta={"prompt": prompt})
    return json.dumps({"ok": True, "handle": handle, "schema": res.schema,
                       "rowCount": res.row_count, "sample": res.rows[:_SAMPLE],
                       "context_id": res.context_id}, ensure_ascii=False)


DATA_DISCOVER_SCHEMA = {
    "name": "data_discover",
    "description": (
        "Discover enterprise datasets/views via the Data Agent (metadata only — no rows). "
        "Returns {ok, datasets:[{view_name, database_name, description}]}. Use this to learn what "
        "data exists before retrieving. Skill selection is automatic from your prompt."
    ),
    "parameters": {"type": "object",
                   "properties": {"prompt": {"type": "string", "description": "Natural-language discovery query."}},
                   "required": ["prompt"]},
}

DATA_QUERY_SCHEMA = {
    "name": "data_query",
    "description": (
        "Retrieve rows for ONE dataset via the Data Agent and cache them server-side. Returns "
        "{ok, handle:'data://…', schema, rowCount, sample(≤3 rows)} — NEVER the full rows (they live on "
        "the data plane; the canvas fetches them by handle). Bind the returned handle into a component "
        "(data-table bindings.source, or esri:map/esri:feature-table layer). One table per call — no "
        "cross-table JOINs; retrieve piecemeal. If the agent needs clarification you get "
        "{ok, needs_input:true, clarification, context_id}: ask the user, then call again passing that "
        "context_id to continue the same conversation."
    ),
    "parameters": {"type": "object",
                   "properties": {
                       "prompt": {"type": "string", "description": "Natural-language retrieval request for one dataset."},
                       "context_id": {"type": "string", "description": "Reuse to answer a prior clarification (multi-turn)."}},
                   "required": ["prompt"]},
}

DATA_TOOL_DEFS = [
    ("data_discover", DATA_DISCOVER_SCHEMA, data_discover,
     "Discover enterprise datasets (metadata only)", "🔎"),
    ("data_query", DATA_QUERY_SCHEMA, data_query,
     "Retrieve rows → data:// handle (bulk stays server-side)", "📥"),
]
```

Modify `plugins/gis-canvas/__init__.py`:

```python
def register(ctx):
    from .tools_canvas import TOOL_DEFS
    from .tools_data import DATA_TOOL_DEFS
    from .hooks import on_pre_llm_call

    for name, schema, handler, description, emoji in TOOL_DEFS + DATA_TOOL_DEFS:
        ctx.register_tool(
            name=name,
            toolset="gis-canvas",
            schema=schema,
            handler=handler,
            description=description,
            emoji=emoji,
        )

    ctx.register_hook("pre_llm_call", on_pre_llm_call)
```

In `tools_canvas.py`, extend `_CATALOG_HELP` so the agent knows data handles can come from `data_query`.
Change the `data-table` clause `bindings.source data handle e.g. 'mock://incidents'` to add:
`(a data handle may be a 'data://…' handle returned by data_query, or a 'mock://…' dev source)`.
And in the `esri:map` clause, after the layer-handle description, add:
`layer handles may also be a 'data://…' handle from data_query (rows plotted client-side from lng/lat).`
(Purely additive prose in the tool descriptions; no behavior change.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_data_tools.py tests/plugins/gis_canvas/test_registration.py -q`
Expected: PASS (4 new + existing registration tests). If `test_registration.py` asserts an exact tool count, update it to include the 2 new tools.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/tools_data.py plugins/gis-canvas/__init__.py plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_data_tools.py tests/plugins/gis_canvas/test_registration.py
git commit -m "gis: add data_discover + data_query tools (handle+sample, invariant enforced)"
```

---

## Task 5: `canvas.data_fetch` gateway RPC

**Files:**
- Modify: `plugins/gis-canvas/wire.py`
- Modify: `tui_gateway/server.py` (inside the existing `# >>> gis-canvas … <<<` fence only)
- Test: `tests/plugins/gis_canvas/test_wire.py` (extend)

**Interfaces:**
- Consumes: `get_broker()` (Task 1).
- Produces: `handle_canvas_data_fetch(params: dict) -> dict` → the broker `page()` dict (`{ok, handle, page, pageSize, total, rows, schema}` or `{ok:False, errors}`).

- [ ] **Step 1: Write the failing test**

```python
# tests/plugins/gis_canvas/test_wire.py  (add these to the existing file)
def test_data_fetch_pages_from_broker(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_DATA_DIR", str(tmp_path))
    plugin.broker.reset_broker_for_tests()
    h = plugin.broker.get_broker().put([{"id": "a"}, {"id": "b"}], [{"name": "id", "type": "string"}])
    out = plugin.wire.handle_canvas_data_fetch({"handle": h, "page": 0, "pageSize": 1})
    assert out["ok"] and out["total"] == 2 and out["rows"] == [{"id": "a"}]


def test_data_fetch_missing_handle_errors(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_DATA_DIR", str(tmp_path))
    plugin.broker.reset_broker_for_tests()
    out = plugin.wire.handle_canvas_data_fetch({"handle": "data://nope"})
    assert out["ok"] is False and out["errors"]
```

> Note: `test_wire.py` already has an `autouse` `_isolated_store` fixture that calls
> `plugin.tools_canvas.reset_store_for_tests()`; these two tests don't use the canvas store, so the
> autouse fixture is harmless. Keep the `import json`/`import pytest` header already in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_wire.py -q`
Expected: FAIL — `AttributeError: module 'wire' has no attribute 'handle_canvas_data_fetch'`.

- [ ] **Step 3: Write minimal implementation**

Add to `plugins/gis-canvas/wire.py`:

```python
from .broker import get_broker


def handle_canvas_data_fetch(params: dict) -> dict:
    p = params or {}
    handle = str(p.get("handle") or "")
    if not handle:
        return {"ok": False, "errors": ["'handle' is required"]}
    return get_broker().page(
        handle,
        page=int(p.get("page", 0) or 0),
        page_size=int(p.get("pageSize", 100) or 100),
        filter=p.get("filter"),
        fields=p.get("fields"),
    )
```

Add inside the fence in `tui_gateway/server.py` (immediately before the closing `# <<< gis-canvas >>>` on line 13786):

```python
@method("canvas.data_fetch")
def _(rid, params: dict) -> dict:
    try:
        from hermes_plugins.gis_canvas.wire import handle_canvas_data_fetch
    except Exception as exc:  # plugin absent/disabled — fail soft
        return _err(rid, -32601, f"gis-canvas plugin unavailable: {exc}")
    result = handle_canvas_data_fetch(params or {})
    if not result.get("ok"):
        return _err(rid, -32000, "; ".join(result.get("errors", ["canvas.data_fetch failed"])))
    return _ok(rid, result)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_wire.py -q`
Expected: PASS. Also byte-compile the core edit: `.venv/bin/python -m py_compile tui_gateway/server.py` → no output.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/wire.py tui_gateway/server.py tests/plugins/gis_canvas/test_wire.py
git commit -m "gis: add canvas.data_fetch inbound RPC (paged data-plane pull)"
```

---

## Task 6: Frontend data-plane client + context wiring

**Files:**
- Create: `apps/gis-canvas/src/lib/data-plane.ts`
- Modify: `apps/gis-canvas/src/lib/handlers.ts` (the `CanvasActions` interface lives here)
- Modify: `apps/gis-canvas/src/components/HandlerContext.tsx` (`NOOP` default)
- Modify: `apps/gis-canvas/src/App.tsx` (the memoized `actions` object at ~line 88)
- Test: `apps/gis-canvas/src/lib/data-plane.test.ts`

**Interfaces:**
- Consumes: `GatewayLike` (`apps/gis-canvas/src/lib/gateway.ts`).
- Produces:
  - `type Row = Record<string, string | number>`
  - `interface Field { name: string; type: 'string' | 'number' }`
  - `interface DataPage { ok: boolean; rows: Row[]; schema: Field[]; total: number; page: number; pageSize: number; errors?: string[] }`
  - `function isDataHandle(ref: string | undefined): boolean`
  - `function fetchDataPage(gw: Pick<GatewayLike,'request'>, handle: string, opts?: { page?: number; pageSize?: number; filter?: Record<string,string>; fields?: string[] }): Promise<DataPage>`
  - `CanvasActions` (in `lib/handlers.ts`) gains `fetchData(handle: string, opts?): Promise<DataPage>`.

**Design note:** `App.tsx` already builds the `actions` object from the `client` (`GatewayLike`) — `reportInteraction` calls `client.request('canvas.interaction', …)`. Add `fetchData` the same way. `CanvasActions` is defined in `lib/handlers.ts` and defaulted in `HandlerContext`'s `NOOP`; both must gain the method. Molecules never touch the gateway directly.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/gis-canvas/src/lib/data-plane.test.ts
import { describe, it, expect, vi } from 'vitest'
import { fetchDataPage, isDataHandle } from './data-plane'

describe('data-plane', () => {
  it('isDataHandle recognizes data:// only', () => {
    expect(isDataHandle('data://ab12')).toBe(true)
    expect(isDataHandle('mock://incidents')).toBe(false)
    expect(isDataHandle('https://services.arcgis.com/x/FeatureServer/0')).toBe(false)
    expect(isDataHandle(undefined)).toBe(false)
  })

  it('fetchDataPage calls canvas.data_fetch with params and returns the page', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, rows: [{ id: 'a' }], schema: [{ name: 'id', type: 'string' }], total: 1, page: 0, pageSize: 50 })
    const page = await fetchDataPage({ request }, 'data://ab12', { pageSize: 50, filter: { sev: 'high' } })
    expect(request).toHaveBeenCalledWith('canvas.data_fetch', { handle: 'data://ab12', page: 0, pageSize: 50, filter: { sev: 'high' } })
    expect(page.rows).toEqual([{ id: 'a' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @hermes/gis-canvas test -- data-plane`
Expected: FAIL — cannot resolve `./data-plane`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/gis-canvas/src/lib/data-plane.ts
import type { GatewayLike } from './gateway'

export type Row = Record<string, string | number>
export interface Field { name: string; type: 'string' | 'number' }
export interface DataPage {
  ok: boolean
  rows: Row[]
  schema: Field[]
  total: number
  page: number
  pageSize: number
  errors?: string[]
}

export function isDataHandle(ref: string | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith('data://')
}

export async function fetchDataPage(
  gw: Pick<GatewayLike, 'request'>,
  handle: string,
  opts: { page?: number; pageSize?: number; filter?: Record<string, string>; fields?: string[] } = {}
): Promise<DataPage> {
  const params: Record<string, unknown> = { handle, page: opts.page ?? 0, pageSize: opts.pageSize ?? 100 }
  if (opts.filter) params.filter = opts.filter
  if (opts.fields) params.fields = opts.fields
  return gw.request<DataPage>('canvas.data_fetch', params)
}
```

In `lib/handlers.ts`, add to the `CanvasActions` interface:

```typescript
import type { DataPage } from './data-plane'
// ...inside interface CanvasActions:
  /** Pull a page of rows from the data plane by handle (canvas.data_fetch). */
  fetchData(handle: string, opts?: { page?: number; pageSize?: number; filter?: Record<string, string>; fields?: string[] }): Promise<DataPage>
```

In `HandlerContext.tsx`, extend `NOOP` so the default context satisfies the type:

```typescript
const NOOP: CanvasActions = {
  setLocalState: () => {},
  reportInteraction: () => {},
  sendPrompt: () => {},
  fetchData: async () => ({ ok: false, rows: [], schema: [], total: 0, page: 0, pageSize: 0, errors: ['no gateway'] })
}
```

In `App.tsx`, add to the memoized `actions` object (~line 88, alongside `reportInteraction`), and import `fetchDataPage`:

```typescript
import { fetchDataPage } from './lib/data-plane'
// ...inside the actions object:
  fetchData: (handle, opts) => fetchDataPage(client, handle, opts),
```

(`client` is the same `GatewayLike` App already uses for `reportInteraction`. Keep `client` in the `useMemo` dependency array — it already is.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @hermes/gis-canvas test -- data-plane` then `npm run -w @hermes/gis-canvas build`
Expected: data-plane tests PASS; build succeeds (type-checks the context change).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/data-plane.ts apps/gis-canvas/src/lib/data-plane.test.ts apps/gis-canvas/src/components/HandlerContext.tsx apps/gis-canvas/src/App.tsx
git commit -m "gis: add frontend data-plane client + fetchData action"
```

---

## Task 7: Wire `data://` handles into DataTableMolecule

**Files:**
- Modify: `apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx`
- Test: `apps/gis-canvas/src/components/molecules/DataTableMolecule.test.tsx` (create)

**Interfaces:**
- Consumes: `useCanvasActions().fetchData` (Task 6), `isDataHandle` (Task 6), `resolveMockSource` (existing).
- Produces: no new exports — behavior change only. A `data://` `bindings.source` renders rows pulled from the broker; `mock://` still renders locally (back-compat). Client-side filter (`state.filter`) and row selection are unchanged.

**Design note:** Introduce local state seeded from the fetched page. When the source is a `data://` handle, fetch on mount/handle-change into `{schema, rows}` (shape-compatible with `MockSource`), then feed the existing table code. Keep the filter client-side for parity with Phase 2 (pass `state.filter` through the existing `useMemo`, not to the broker) so reactive select-filtering still needs no agent turn.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/gis-canvas/src/components/molecules/DataTableMolecule.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { DataTableMolecule } from './DataTableMolecule'
import { HandlerProvider } from '../HandlerContext'

const page = { ok: true, total: 1, page: 0, pageSize: 100,
  schema: [{ name: 'id', type: 'string' }, { name: 'sev', type: 'string' }],
  rows: [{ id: 'x1', sev: 'high' }] }

function renderWith(node: any, fetchData: any) {
  const actions = { reportInteraction: vi.fn(), fetchData }
  return render(<HandlerProvider actions={actions as any}><DataTableMolecule node={node} /></HandlerProvider>)
}

describe('DataTableMolecule data:// handle', () => {
  it('pulls rows from the data plane for a data:// source', async () => {
    const fetchData = vi.fn().mockResolvedValue(page)
    renderWith({ id: 't1', type: 'data-table', bindings: { source: 'data://ab12' } }, fetchData)
    await waitFor(() => expect(screen.getByText('x1')).toBeInTheDocument())
    expect(fetchData).toHaveBeenCalledWith('data://ab12', expect.anything())
  })

  it('still resolves mock:// sources locally (back-compat)', async () => {
    const fetchData = vi.fn()
    renderWith({ id: 't2', type: 'data-table', bindings: { source: 'mock://incidents' } }, fetchData)
    await waitFor(() => expect(screen.getByText('Downtown')).toBeInTheDocument())
    expect(fetchData).not.toHaveBeenCalled()
  })
})
```

(If `HandlerProvider`'s prop name differs, match the existing export in `HandlerContext.tsx`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @hermes/gis-canvas test -- DataTableMolecule`
Expected: FAIL — `data://` source resolves to "Unknown data source" (no fetch path yet).

- [ ] **Step 3: Write minimal implementation**

In `DataTableMolecule.tsx`, replace the single `const data = resolveMockSource(source)` line with a resolution that handles both:

```typescript
import { useEffect, useMemo, useState } from 'react'
import { isDataHandle, type DataPage } from '../../lib/data-plane'
// ...
const actions = useCanvasActions()
const [fetched, setFetched] = useState<{ schema: MockField[]; rows: Row[] } | null>(null)

useEffect(() => {
  let cancelled = false
  if (isDataHandle(source)) {
    actions.fetchData(source, { pageSize: 1000 })
      .then((p: DataPage) => { if (!cancelled) setFetched({ schema: p.schema as MockField[], rows: p.rows }) })
      .catch(() => { if (!cancelled) setFetched({ schema: [], rows: [] }) })
  } else {
    setFetched(null)
  }
  return () => { cancelled = true }
}, [source, actions])

const data = isDataHandle(source) ? fetched : resolveMockSource(source)
```

(`MockField`/`MockSource` import from `../../lib/mock-data`; `Row` from `../../lib/data-plane`. The rest of the molecule — filter `useMemo`, columns, table, selection — is unchanged since `data` keeps the `{schema, rows}` shape. While a `data://` fetch is in flight `data` is `null`, which already renders the existing loading/"Unknown data source" branch; keep that branch but treat `null`-while-loading as an empty table if you prefer a cleaner UX.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @hermes/gis-canvas test -- DataTableMolecule`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx apps/gis-canvas/src/components/molecules/DataTableMolecule.test.tsx
git commit -m "gis: DataTableMolecule pulls data:// handles via the data plane"
```

---

## Task 8: Wire `data://` handles into the map + feature-table molecules

**Files:**
- Modify: `apps/gis-canvas/src/lib/esri/layers.ts`
- Modify: `apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx`
- Modify: `apps/gis-canvas/src/components/molecules/EsriFeatureTableMolecule.tsx`
- Test: `apps/gis-canvas/src/lib/esri/layers.test.ts` (extend), `apps/gis-canvas/src/components/molecules/EsriWidgets.test.tsx` (extend)

**Interfaces:**
- Consumes: `graphicsFromMockSource`, `fieldsFromSchema` (existing `graphics.ts`), `useCanvasActions().fetchData`, `isDataHandle`.
- Produces:
  - `parseLayerRef(ref)` gains a third variant `{ kind: 'handle'; handle: string }` for `data://`.
  - `buildRowsLayer(source: MockSource, esri, title?: string) -> unknown` — extracted rows→FeatureLayer builder (the current `buildLayer` rows branch), callable with a fetched page shaped as `MockSource`.
  - `buildLayer` unchanged for `mock://`/service refs; throws for `handle` refs (they must be fetched first).

**Design note:** the map builds layers imperatively in `onReady`. For a `data://` layer, fetch the page (`actions.fetchData`), shape it as `MockSource` (`{schema, rows}`), and call `buildRowsLayer`. `mock://` and service URLs keep the synchronous `buildLayer` path. Geometry is synthesized client-side from `lng`/`lat` exactly as today — this is the whole point: Denodo/Data-Agent rows are tabular, so the map path is rows→graphics regardless of source.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/gis-canvas/src/lib/esri/layers.test.ts  (add)
import { parseLayerRef, buildRowsLayer } from './layers'

it('parseLayerRef classifies data:// as handle', () => {
  expect(parseLayerRef('data://ab12')).toEqual({ kind: 'handle', handle: 'data://ab12' })
  expect(parseLayerRef('mock://incidents').kind).toBe('rows')
  expect(parseLayerRef('https://x/FeatureServer/0').kind).toBe('service')
})

it('buildRowsLayer builds a FeatureLayer from a fetched page shape', () => {
  const esri = { FeatureLayer: function (o: unknown) { return o } } as any
  const layer: any = buildRowsLayer(
    { schema: [{ name: 'lng', type: 'number' }, { name: 'lat', type: 'number' }],
      rows: [{ lng: -122.6, lat: 45.5 }] }, esri, 'incidents')
  expect(layer.geometryType).toBe('point')
  expect(layer.objectIdField).toBe('__oid')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run -w @hermes/gis-canvas test -- layers`
Expected: FAIL — `buildRowsLayer` is not exported; `parseLayerRef` has no `handle` kind.

- [ ] **Step 3: Write minimal implementation**

In `layers.ts`:

```typescript
import type { MockSource } from '../mock-data'
import { resolveMockSource } from '../mock-data'
import { graphicsFromMockSource, fieldsFromSchema } from './graphics'

export type LayerRef =
  | { kind: 'rows'; name: string }
  | { kind: 'service'; url: string }
  | { kind: 'handle'; handle: string }

export function parseLayerRef(ref: string): LayerRef {
  if (ref.startsWith('data://')) return { kind: 'handle', handle: ref }
  if (ref.startsWith('mock://')) return { kind: 'rows', name: ref.slice('mock://'.length) }
  return { kind: 'service', url: ref }
}

export function buildRowsLayer(
  source: MockSource,
  esri: { FeatureLayer: new (o: unknown) => unknown },
  title?: string
): unknown {
  return new esri.FeatureLayer({
    source: graphicsFromMockSource(source),
    fields: fieldsFromSchema(source.schema),
    objectIdField: '__oid',
    geometryType: 'point',
    spatialReference: { wkid: 4326 },
    renderer: {
      type: 'simple',
      symbol: { type: 'simple-marker', color: '#e0685b', size: 8, outline: { color: '#fff', width: 1 } }
    },
    popupTemplate: { title: 'Feature {__oid}', content: 'Row {__oid}' },
    title: title ?? 'layer'
  })
}

export function buildLayer(ref: string, esri: { FeatureLayer: new (o: unknown) => unknown }): unknown {
  const parsed = parseLayerRef(ref)
  if (parsed.kind === 'service') return new esri.FeatureLayer({ url: parsed.url })
  if (parsed.kind === 'handle') throw new Error(`data:// layer must be fetched before building: ${ref}`)
  const source = resolveMockSource(ref)
  if (!source) throw new Error(`unknown mock source: ${ref}`)
  return buildRowsLayer(source, esri, parsed.name)
}
```

In `EsriMapMolecule.tsx`, make the per-layer add handle async and route `data://` through `fetchData` + `buildRowsLayer`:

```typescript
import { buildLayer, buildRowsLayer } from '../../lib/esri/layers'
import { isDataHandle } from '../../lib/data-plane'
// inside onReady, replacing the for-loop body:
for (const r of layerRefs) {
  try {
    let layer: unknown
    if (isDataHandle(r)) {
      const page = await actions.fetchData(r, { pageSize: 5000 })
      if (cancelled) return
      layer = buildRowsLayer({ schema: page.schema as any, rows: page.rows as any }, esri, r)
    } else {
      layer = buildLayer(r, esri)
    }
    if (view) view.map.add(layer)
  } catch (e) { console.error('layer build failed', r, e) }
}
```

Apply the equivalent change in `EsriFeatureTableMolecule.tsx` (fetch the `data://` layer page, `buildRowsLayer`, assign `el.layer`). Its current code calls `buildLayer(layerHandle, esri)` synchronously; guard with `isDataHandle` and `await actions.fetchData` for the handle path (add `useCanvasActions()` if not already present).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run -w @hermes/gis-canvas test -- layers EsriWidgets` then `npm run -w @hermes/gis-canvas build`
Expected: layers + widget tests PASS; build succeeds. Keep existing `EsriMapMolecule.test.tsx` green (its `buildLayer` mock still covers the non-handle path).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib/esri/layers.ts apps/gis-canvas/src/lib/esri/layers.test.ts apps/gis-canvas/src/components/molecules/EsriMapMolecule.tsx apps/gis-canvas/src/components/molecules/EsriFeatureTableMolecule.tsx apps/gis-canvas/src/components/molecules/EsriWidgets.test.tsx
git commit -m "gis: map + feature-table build client-side layers from data:// handles"
```

---

## Task 9: Live sandbox integration test + run/verify docs

**Files:**
- Create: `tests/plugins/gis_canvas/test_a2a_sandbox.py`
- Modify: `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` (§19 run notes — add a Phase-4a subsection)

**Interfaces:**
- Consumes: `A2ADataSource` (Task 3). Live sandbox at `DATA_AGENT_URL` (default `http://localhost:2024`), `DATA_AGENT_MODE=sandbox`, accepts any non-empty Bearer.

**Design note:** skip cleanly when the sandbox is unreachable so CI without it stays green. Assert against the *live* contract: discover returns ≥1 dataset with `view_name`; a `scenario:clarify` prompt yields a clarification + `context_id`, and resuming on that `context_id` clears it.

- [ ] **Step 1: Write the failing test**

```python
# tests/plugins/gis_canvas/test_a2a_sandbox.py
import os
import pytest

URL = os.environ.get("DATA_AGENT_URL", "http://localhost:2024")


def _sandbox_up() -> bool:
    try:
        import httpx
        httpx.get(f"{URL}/.well-known/agent-card.json", timeout=3.0).raise_for_status()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _sandbox_up(), reason="Data Agent sandbox not reachable")


def _src(plugin):
    ds = plugin.datasource
    return ds.A2ADataSource(URL, ds.default_auth_provider)


def test_live_discover_returns_datasets(plugin):
    datasets = _src(plugin).discover("scenario:discover what datasets are available")
    assert datasets and all("view_name" in d for d in datasets)


def test_live_clarify_then_resume(plugin):
    src = _src(plugin)
    first = src.query("scenario:clarify I want some data")
    assert first.clarification and first.context_id
    resumed = src.query("vessel_traffic", context_id=first.context_id)
    assert resumed.clarification is None  # conversation advanced past the interrupt
```

- [ ] **Step 2: Run test to verify it fails (then passes live)**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_a2a_sandbox.py -q`
Expected: with the sandbox **down** → 2 skipped. With the sandbox **up** (it is, per the user): the tests run; they FAIL only if the adapter is wrong, else PASS.

- [ ] **Step 3: Add the Phase-4a run note**

Append to `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` §19 a short subsection:

```markdown
- **Phase 4a data flow (sandbox).** Start the Data Agent sandbox (`docker compose up` or
  `DATA_AGENT_MODE=sandbox uvicorn server:app --host 0.0.0.0 --port 2024`). The gateway defaults to
  `GIS_DATA_SOURCE=mock` (structured geo rows → real map/table render, since sandbox `retrieve` emits
  no `query_result` DataPart). Set `GIS_DATA_SOURCE=a2a` (+ `DATA_AGENT_URL`, `DATA_AGENT_AUTH_TOKEN`)
  to route `data_discover`/`data_query` through the live A2A adapter. Agent flow: `data_discover` →
  pick a dataset → `data_query` → bind the returned `data://` handle into a component. The browser
  pulls rows via `canvas.data_fetch`; bulk rows never enter the agent context.
```

- [ ] **Step 4: Run the full backend + frontend suites**

Run: `.venv/bin/pytest tests/plugins/gis_canvas -q` and `npm run -w @hermes/gis-canvas test`
Expected: all green (sandbox tests run live or skip).

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/gis_canvas/test_a2a_sandbox.py apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md
git commit -m "gis: add live sandbox integration test + Phase 4a run notes"
```

---

## Manual end-to-end verification (after Task 9)

With the sandbox running and `GIS_DATA_SOURCE` set as desired, run the gateway + production preview (map needs preview, per §19), open the app, and try:
1. `Discover what datasets are available.` → agent calls `data_discover` → lists datasets.
2. `Retrieve the incidents and plot them on a map with a legend.` → `data_query` returns a `data://` handle → `esri:map` bound to the handle renders points pulled via `canvas.data_fetch`.
3. `Show the incidents in a data-table too.` → `data-table` bound to the same/again-queried handle pulls rows.
4. (a2a mode) `scenario:clarify I want some data` → agent relays the clarification, you answer, it re-queries on the same `context_id`.

Confirm in the gateway logs / broker dir (`~/.hermes/gis_canvas_data/`) that rows live in the broker, and that `data_query` tool results in the transcript carry only `{handle, schema, rowCount, sample}`.
