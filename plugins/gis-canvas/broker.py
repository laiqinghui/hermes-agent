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
