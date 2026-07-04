"""Streaming A2A (Agent2Agent) adapter for the Enterprise Data Agent.

Manual JSON-RPC 2.0 message/stream over httpx (no A2A SDK dependency — the wire
format is the whole contract). collect() is pure over the parsed event list so
it is unit-testable without a network; stream_events() does the I/O."""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
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
