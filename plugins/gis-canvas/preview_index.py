"""Foreign session -> preview session mapping plus the cached render verdict.

Opening a foreign session in Thoughts Canvas spends one agent turn deciding
whether a canvas is warranted. This index makes that "once, ever": it survives
gateway restarts and browser reloads, and it remembers DECLINED verdicts too so
a session judged not worth rendering is never re-judged.

Stored as a single ``_previews.json`` beside the canvas docs. The underscore
prefix is why ``CanvasStore.list()`` skips underscore files.
"""
from __future__ import annotations

import json
import os
import pathlib
import threading


class PreviewIndex:
    def __init__(self, base_dir: str | None = None):
        root = base_dir or os.environ.get("HERMES_GIS_CANVAS_DIR") or str(
            pathlib.Path.home() / ".hermes" / "gis_canvas"
        )
        self._dir = pathlib.Path(root)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._path = self._dir / "_previews.json"
        self._lock = threading.Lock()

    def _read(self) -> dict:
        try:
            data = json.loads(self._path.read_text())
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            # A corrupt or absent index is an empty index, never an error: the
            # worst case is re-judging one session.
            return {}

    def get(self, source_session_id: str) -> dict | None:
        return self._read().get(source_session_id)

    def put(self, source_session_id: str, record: dict) -> dict:
        stored = dict(record)
        stored["source_session_id"] = source_session_id
        with self._lock:
            data = self._read()
            data[source_session_id] = stored
            self._path.write_text(json.dumps(data, ensure_ascii=False))
        return stored


_index: PreviewIndex | None = None


def get_preview_index() -> PreviewIndex:
    global _index
    if _index is None:
        _index = PreviewIndex()
    return _index


def reset_index_for_tests() -> None:
    global _index
    _index = None
