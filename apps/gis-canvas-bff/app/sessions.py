"""In-memory per-browser token store (keyed by opaque sid) plus a
canvas_session -> sid index. Single-process dev store; swap for Redis in prod."""
from __future__ import annotations

import secrets
from dataclasses import dataclass, field


@dataclass
class TokenRecord:
    access_token: str
    refresh_token: str
    id_token: str
    expires_at: float
    username: str
    roles: list[str] = field(default_factory=list)


class SessionStore:
    def __init__(self) -> None:
        self._by_sid: dict[str, TokenRecord] = {}
        self._canvas_to_sid: dict[str, str] = {}

    def create(self, record: TokenRecord) -> str:
        sid = secrets.token_urlsafe(32)
        self._by_sid[sid] = record
        return sid

    def get(self, sid: str) -> TokenRecord | None:
        return self._by_sid.get(sid)

    def update(self, sid: str, record: TokenRecord) -> None:
        if sid in self._by_sid:
            self._by_sid[sid] = record

    def bind(self, sid: str, canvas_sessions: list[str]) -> None:
        for c in canvas_sessions:
            if c:
                self._canvas_to_sid[c] = sid

    def sid_for_canvas(self, canvas_session: str) -> str | None:
        return self._canvas_to_sid.get(canvas_session)

    def needs_refresh(self, sid: str, now: float, margin: float = 60.0) -> bool:
        rec = self._by_sid.get(sid)
        if rec is None:
            return False
        return now >= rec.expires_at - margin

    def evict(self, sid: str) -> TokenRecord | None:
        rec = self._by_sid.pop(sid, None)
        self._canvas_to_sid = {c: s for c, s in self._canvas_to_sid.items() if s != sid}
        return rec
