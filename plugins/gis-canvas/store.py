"""Server-side canonical canvas document store: rev-stamping + JSON persistence.

Phase 1 keys docs by the tool dispatch's task_id (see resolve_session_key).
One JSON file per key so docs survive gateway restarts (rehydration).
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import threading

_SAFE = re.compile(r"[^a-zA-Z0-9_-]+")


def resolve_session_key(kw: dict) -> str:
    """Derive the store key. Prefer the stable gateway session_id (present in
    tool kwargs, the pre_llm_call hook, and frontend canvas.interaction);
    fall back to task_id, then a constant. task_id alone is per-turn and would
    split one session's canvas across turns."""
    return str(kw.get("session_id") or kw.get("task_id") or "default")


class CanvasStore:
    def __init__(self, base_dir: str | None = None):
        root = base_dir or os.environ.get("HERMES_GIS_CANVAS_DIR") or str(
            pathlib.Path.home() / ".hermes" / "gis_canvas"
        )
        self._dir = pathlib.Path(root)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, key: str) -> pathlib.Path:
        safe = _SAFE.sub("_", key) or "default"
        return self._dir / f"{safe}.json"

    def get(self, key: str) -> dict | None:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def list(self) -> list[str]:
        """Stored canvas keys, sorted. Skips ``_``-prefixed files so index
        sidecars living in this same directory (e.g. the preview index) are
        never mistaken for canvases."""
        try:
            return sorted(
                p.stem for p in self._dir.glob("*.json") if not p.name.startswith("_")
            )
        except OSError:
            return []

    def put(self, key: str, doc: dict) -> dict:
        with self._lock:
            current = self.get(key)
            stored = dict(doc)
            stored["rev"] = (current.get("rev", 0) if current else 0) + 1
            self._path(key).write_text(json.dumps(stored, ensure_ascii=False))
            return stored

    def reset(self, key: str) -> None:
        with self._lock:
            self._path(key).unlink(missing_ok=True)
