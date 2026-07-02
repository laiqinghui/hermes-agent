# GIS Canvas — Phase 2: Interaction Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the interaction loop — user actions on the canvas (row selection, filter changes) update state locally *and* are recorded server-side, and the agent becomes aware of the current canvas (components + live state) via a per-turn context injection, so a prompt like "summarize my selection" works.

**Architecture:** Canvas docs are re-keyed by the stable gateway `session_id` (fixing a latent per-turn `task_id` bug). A new plugin module applies interaction state-patches to the stored doc; it's reached from the frontend via **one** fenced `@method("canvas.interaction")` in `tui_gateway/server.py` (the only core edit — gateway methods aren't plugin-extensible). A `pre_llm_call` hook (fully additive) reads the stored doc and injects a compact `<canvas>` summary into the model's turn. The frontend gains a handler model (`set`/`reactive`/`agent`), a `select` control, and data-table row selection, with an optimistic local state overlay synced to the server.

**Tech Stack:** Python 3.11 + jsonschema (backend); React 19 + Vite + TS + @tanstack/react-table + vitest (frontend); Hermes `pre_llm_call` hook + `@method` gateway dispatch; `JsonRpcGatewayClient`.

**Spec:** `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` (Phase 2 of §13; §6 state/interaction; §11 core-edit contingency).

## Global Constraints

- ALL code stays in `apps/gis-canvas/` and `plugins/gis-canvas/`; backend tests in `tests/plugins/gis_canvas/`. The **only** permitted core edit is a single comment-fenced `@method("canvas.interaction")` block in `tui_gateway/server.py` (fences `# >>> gis-canvas <<<` … `# <<< gis-canvas >>>`). No other existing file may change.
- Every commit message starts with `gis:` and ends with the Co-Authored-By trailer from Task 1.
- Branch `gis/main` (Phase 1 merged; continue on it).
- Backend env: run tests with `.venv/bin/pytest tests/plugins/gis_canvas` (venv from Phase 1: `/opt/homebrew/bin/python3.11 -m venv .venv && .venv/bin/pip install pytest jsonschema pyyaml`). Frontend: `npm run -w @hermes/gis-canvas test|build`.
- **Canvas key = `session_id`** (gateway session id, `uuid4().hex[:8]`). Tool handlers receive it as the `session_id` kwarg (model_tools.py passes both `session_id=` and `task_id=`); the frontend has it from `session.create`; the `pre_llm_call` hook receives it as `session_id=agent.session_id`. All three must resolve the same key.
- Interaction state is user-owned and lives in each node's `state` object. Interactions NEVER change structure (that's `update_view`), only `state`.
- Verified integration facts: `@method("name") def _(rid, params: dict) -> dict: return _ok(rid, {...})` or `_err(rid, code, msg)` (`tui_gateway/server.py:1061-1065`); the last method is `@method("shell.exec")` (~line 13736) — append the fenced block after it. `pre_llm_call` invoked at `agent/turn_context.py:435`; a handler returning `{"context": str}` (or a str) has that text appended to the user message; plugins load in both gateway and agent processes.

## File Structure

```
plugins/gis-canvas/
  validator.py       # MODIFY: add 'select' to CATALOG + schema enum; add STATE_KEYS
  store.py           # MODIFY: resolve_session_key prefers session_id
  interaction.py     # CREATE: apply_interaction(doc, target, state_patch)
  awareness.py       # CREATE: build_canvas_summary(doc) -> str
  wire.py            # CREATE: handle_canvas_interaction(params) -> dict (gateway-process entry)
  hooks.py           # CREATE: on_pre_llm_call(**kw) -> {"context": str} | None
  __init__.py        # MODIFY: register_hook("pre_llm_call", ...)
  schema/canvas.schema.json  # MODIFY: add 'select' to type enum

tui_gateway/server.py          # MODIFY (only core edit): fenced @method("canvas.interaction")

tests/plugins/gis_canvas/
  test_store.py            # MODIFY: session_id keying
  test_interaction.py      # CREATE
  test_awareness.py        # CREATE
  test_wire.py             # CREATE

apps/gis-canvas/src/
  lib/types.ts             # MODIFY: add 'select', Handler, handlers on ComponentNode
  lib/handlers.ts          # CREATE: CanvasActions + runHandler
  lib/handlers.test.ts     # CREATE
  lib/merge.ts             # CREATE: mergeOverrides(doc, overrides)
  lib/merge.test.ts        # CREATE
  components/HandlerContext.tsx   # CREATE: React context for CanvasActions
  components/registry.tsx         # MODIFY: register 'select'
  components/molecules/SelectMolecule.tsx      # CREATE
  components/molecules/DataTableMolecule.tsx   # MODIFY: filter + row selection
  App.tsx                  # MODIFY: overrides state, canvas.interaction sender, provider
  App.test.tsx             # (unchanged) still must pass
```

---

### Task 1: Re-key canvas by session_id

**Files:**
- Modify: `plugins/gis-canvas/store.py` (`resolve_session_key`)
- Test: `tests/plugins/gis_canvas/test_store.py` (add cases)

**Interfaces:**
- Produces: `resolve_session_key(kw)` now returns `str(kw.get("session_id") or kw.get("task_id") or "default")`.

- [ ] **Step 1: Add failing tests for the new precedence**

Append to `tests/plugins/gis_canvas/test_store.py`:

```python
def test_resolve_session_key_prefers_session_id(plugin):
    assert plugin.store.resolve_session_key({"session_id": "9d368060", "task_id": "20260702_x"}) == "9d368060"


def test_resolve_session_key_falls_back_to_task_id(plugin):
    assert plugin.store.resolve_session_key({"task_id": "t1"}) == "t1"


def test_resolve_session_key_default_when_empty(plugin):
    assert plugin.store.resolve_session_key({"session_id": "", "task_id": ""}) == "default"
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_store.py -k resolve_session_key -v`
Expected: `test_resolve_session_key_prefers_session_id` FAILS (returns `20260702_x`).

- [ ] **Step 3: Update resolve_session_key**

In `plugins/gis-canvas/store.py` replace the function body:

```python
def resolve_session_key(kw: dict) -> str:
    """Derive the store key. Prefer the stable gateway session_id (present in
    tool kwargs, the pre_llm_call hook, and frontend canvas.interaction);
    fall back to task_id, then a constant. task_id alone is per-turn and would
    split one session's canvas across turns."""
    return str(kw.get("session_id") or kw.get("task_id") or "default")
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_store.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/store.py tests/plugins/gis_canvas/test_store.py
git commit -m "gis: key canvas by session_id (stable) not per-turn task_id

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `select` in the catalog + state-key registry

**Files:**
- Modify: `plugins/gis-canvas/schema/canvas.schema.json` (type enum)
- Modify: `plugins/gis-canvas/validator.py` (CATALOG + STATE_KEYS)
- Test: `tests/plugins/gis_canvas/test_validator.py` (add cases)

**Interfaces:**
- Produces: catalog type `select` (leaf, required_props `field`, `options`; state key `value`); module-level `STATE_KEYS: dict[str, set[str]]` mapping type → allowed state keys, consumed by Task 3.

- [ ] **Step 1: Add failing tests**

Append to `tests/plugins/gis_canvas/test_validator.py`:

```python
def test_select_is_a_valid_leaf_component(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "sev", "type": "select",
        "area": {"col": 4, "colSpan": 3, "row": 1, "rowSpan": 1},
        "props": {"field": "severity", "options": ["all", "high", "med", "low"]},
    })
    assert plugin.validator.validate_doc(doc) == []


def test_select_requires_field_and_options(plugin):
    doc = _minimal_doc()
    doc["components"].append({
        "id": "sev", "type": "select",
        "area": {"col": 4, "colSpan": 3, "row": 1, "rowSpan": 1},
        "props": {"field": "severity"},
    })
    errors = plugin.validator.validate_doc(doc)
    assert any("options" in e for e in errors)


def test_state_keys_registry_exposed(plugin):
    assert "value" in plugin.validator.STATE_KEYS["select"]
    assert "rowSelection" in plugin.validator.STATE_KEYS["data-table"]
    assert "filter" in plugin.validator.STATE_KEYS["data-table"]
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_validator.py -k "select or state_keys" -v`
Expected: FAIL (`select` not in enum / `STATE_KEYS` missing).

- [ ] **Step 3: Add `select` to the schema enum**

In `plugins/gis-canvas/schema/canvas.schema.json`, change the `type` enum:

```json
        "type": { "enum": ["card", "stat", "data-table", "select"] },
```

- [ ] **Step 4: Extend CATALOG + add STATE_KEYS**

In `plugins/gis-canvas/validator.py`, add the `select` entry to `CATALOG` and a new `STATE_KEYS` map after `CATALOG`:

```python
    "select": {
        "container": False,
        "slots": set(),
        "required_props": ["field", "options"],
        "required_bindings": [],
    },
}

# Allowed keys inside each component type's user-owned `state` object.
# Used to validate inbound interactions (interaction.py).
STATE_KEYS: dict[str, set[str]] = {
    "card": set(),
    "stat": set(),
    "data-table": {"rowSelection", "sort", "columnFilters", "columnVisibility", "page", "filter"},
    "select": {"value"},
}
```

(Note: the closing `}` shown is the end of the existing `CATALOG` dict — insert the `select` entry as its last item, then add `STATE_KEYS` below.)

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_validator.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/gis-canvas/schema/canvas.schema.json plugins/gis-canvas/validator.py tests/plugins/gis_canvas/test_validator.py
git commit -m "gis: add 'select' control to catalog + STATE_KEYS registry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Interaction application (pure)

**Files:**
- Create: `plugins/gis-canvas/interaction.py`
- Test: `tests/plugins/gis_canvas/test_interaction.py`

**Interfaces:**
- Consumes: `validator.STATE_KEYS`, `validator.CATALOG`.
- Produces: `apply_interaction(doc: dict, target: str, state_patch: dict) -> tuple[dict, list[str]]` — finds the node by id anywhere in the tree, shallow-merges `state_patch` into its `state`, returns `(new_doc, [])`; on unknown target or a state key not allowed for that node's type returns `(doc, errors)` (original unchanged).

- [ ] **Step 1: Write failing tests**

```python
# tests/plugins/gis_canvas/test_interaction.py
def _doc():
    return {
        "canvasVersion": 1, "rev": 3,
        "layout": {"type": "grid", "cols": 12},
        "components": [
            {"id": "sev", "type": "select",
             "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"field": "severity", "options": ["all", "high"]}, "state": {"value": "all"}},
            {"id": "c1", "type": "card", "area": {"col": 4, "colSpan": 8, "row": 1, "rowSpan": 3},
             "props": {"title": "Incidents"},
             "slots": {"content": [{"id": "tbl1", "type": "data-table", "bindings": {"source": "mock://incidents"}}]}},
        ],
    }


def test_merges_state_on_leaf(plugin):
    new, errors = plugin.interaction.apply_interaction(_doc(), "sev", {"value": "high"})
    assert errors == []
    assert new["components"][0]["state"]["value"] == "high"


def test_merges_state_on_nested_node(plugin):
    new, errors = plugin.interaction.apply_interaction(_doc(), "tbl1", {"rowSelection": ["f_82", "f_91"]})
    assert errors == []
    assert new["components"][1]["slots"]["content"][0]["state"]["rowSelection"] == ["f_82", "f_91"]


def test_shallow_merge_preserves_other_state_keys(plugin):
    d = _doc()
    d["components"][0]["state"] = {"value": "all", "misc": 1}
    new, _ = plugin.interaction.apply_interaction(d, "sev", {"value": "high"})
    assert new["components"][0]["state"] == {"value": "high", "misc": 1}


def test_unknown_target_rejected_doc_untouched(plugin):
    import copy
    d = _doc(); snap = copy.deepcopy(d)
    new, errors = plugin.interaction.apply_interaction(d, "ghost", {"value": "x"})
    assert errors and new == snap


def test_disallowed_state_key_rejected(plugin):
    new, errors = plugin.interaction.apply_interaction(_doc(), "sev", {"rowSelection": ["x"]})
    assert any("state key" in e for e in errors)
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_interaction.py -v`
Expected: FAIL — no module `interaction`.

- [ ] **Step 3: Implement**

```python
# plugins/gis-canvas/interaction.py
"""Apply user-interaction state patches to a canvas document.

Interactions only touch each node's user-owned `state` object — never
structure. Pure + all-or-nothing (returns original doc on any error).
"""
from __future__ import annotations

import copy

from .validator import STATE_KEYS


def _find(doc: dict, target: str) -> dict | None:
    stack = list(doc.get("components", [])) + list(doc.get("overlays", []))
    while stack:
        node = stack.pop()
        if node.get("id") == target:
            return node
        stack.extend(node.get("children", []))
        for slot_kids in node.get("slots", {}).values():
            stack.extend(slot_kids)
    return None


def apply_interaction(doc: dict, target: str, state_patch: dict) -> tuple[dict, list[str]]:
    if not isinstance(state_patch, dict):
        return doc, ["state_patch must be an object"]
    work = copy.deepcopy(doc)
    node = _find(work, target)
    if node is None:
        return doc, [f"interaction target '{target}' not found"]
    allowed = STATE_KEYS.get(node.get("type", ""), set())
    bad = [k for k in state_patch if k not in allowed]
    if bad:
        return doc, [f"'{target}' ({node.get('type')}): disallowed state key(s) {bad}; allowed={sorted(allowed)}"]
    node.setdefault("state", {}).update(state_patch)
    return work, []
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_interaction.py -v`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/interaction.py tests/plugins/gis_canvas/test_interaction.py
git commit -m "gis: add apply_interaction (state-only patches, validated by STATE_KEYS)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Canvas summary for agent awareness (pure)

**Files:**
- Create: `plugins/gis-canvas/awareness.py`
- Test: `tests/plugins/gis_canvas/test_awareness.py`

**Interfaces:**
- Produces: `build_canvas_summary(doc: dict) -> str` — a compact one-block string listing components (id/type, grid area for top-level) and notable live state (select `value`, data-table `rowSelection`/`filter`), wrapped in `<canvas rev=N>…</canvas>`. Returns `""` for a falsy/empty doc.

- [ ] **Step 1: Write failing tests**

```python
# tests/plugins/gis_canvas/test_awareness.py
def _doc():
    return {
        "canvasVersion": 1, "rev": 4,
        "layout": {"type": "grid", "cols": 12},
        "components": [
            {"id": "sev", "type": "select", "props": {"field": "severity", "options": ["all", "high"]},
             "state": {"value": "high"}},
            {"id": "tbl1", "type": "data-table", "bindings": {"source": "mock://incidents"},
             "state": {"rowSelection": ["f_82", "f_91"], "filter": {"severity": "high"}}},
        ],
    }


def test_summary_wraps_and_includes_rev(plugin):
    s = plugin.awareness.build_canvas_summary(_doc())
    assert s.startswith("<canvas rev=4>") and s.rstrip().endswith("</canvas>")


def test_summary_lists_components_and_types(plugin):
    s = plugin.awareness.build_canvas_summary(_doc())
    assert "sev(select)" in s and "tbl1(data-table)" in s


def test_summary_includes_live_state(plugin):
    s = plugin.awareness.build_canvas_summary(_doc())
    assert "value=high" in s
    assert "rowSelection=[f_82,f_91]" in s or "rowSelection=2" in s
    assert "severity" in s  # filter surfaced


def test_empty_doc_summary_is_blank(plugin):
    assert plugin.awareness.build_canvas_summary(None) == ""
    assert plugin.awareness.build_canvas_summary({"components": []}).strip() != ""  # header still emitted
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_awareness.py -v`
Expected: FAIL — no module `awareness`.

- [ ] **Step 3: Implement**

```python
# plugins/gis-canvas/awareness.py
"""Compact, model-facing summary of the current canvas (injected each turn).

Small by design: ids/types + a little live state, never data rows. Lets the
agent reason about what's on screen and what the user has selected/filtered.
"""
from __future__ import annotations


def _fmt_state(node: dict) -> str:
    st = node.get("state") or {}
    parts = []
    if "value" in st:
        parts.append(f"value={st['value']}")
    if "rowSelection" in st and isinstance(st["rowSelection"], list):
        ids = st["rowSelection"]
        parts.append("rowSelection=[" + ",".join(map(str, ids[:8])) + ("...]" if len(ids) > 8 else "]"))
    if "filter" in st and isinstance(st["filter"], dict):
        f = ",".join(f"{k}:{v}" for k, v in st["filter"].items())
        parts.append(f"filter={{{f}}}")
    return " ".join(parts)


def build_canvas_summary(doc: dict | None) -> str:
    if not doc:
        return ""
    rev = doc.get("rev", "?")
    lines: list[str] = [f"<canvas rev={rev}>"]

    def walk(node: dict, depth: int) -> None:
        entry = f"{'  ' * depth}- {node.get('id')}({node.get('type')})"
        area = node.get("area")
        if area:
            entry += f" @[c{area.get('col')}+{area.get('colSpan')},r{area.get('row')}+{area.get('rowSpan')}]"
        src = (node.get("bindings") or {}).get("source")
        if src:
            entry += f" source={src}"
        st = _fmt_state(node)
        if st:
            entry += f" {st}"
        lines.append(entry)
        for kid in node.get("children", []):
            walk(kid, depth + 1)
        for slot, kids in (node.get("slots") or {}).items():
            for kid in kids:
                walk(kid, depth + 1)

    for comp in doc.get("components", []):
        walk(comp, 0)
    for ov in doc.get("overlays", []):
        walk(ov, 0)
    lines.append("</canvas>")
    return "\n".join(lines) + "\n"
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_awareness.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/awareness.py tests/plugins/gis_canvas/test_awareness.py
git commit -m "gis: add build_canvas_summary for per-turn agent awareness

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Gateway interaction handler + pre_llm_call hook + registration

**Files:**
- Create: `plugins/gis-canvas/wire.py`
- Create: `plugins/gis-canvas/hooks.py`
- Modify: `plugins/gis-canvas/__init__.py` (register the hook)
- Test: `tests/plugins/gis_canvas/test_wire.py`

**Interfaces:**
- Consumes: `tools_canvas.get_store`, `interaction.apply_interaction`, `awareness.build_canvas_summary`, `store.resolve_session_key`.
- Produces:
  - `wire.handle_canvas_interaction(params: dict) -> dict` — reads `params["session_id"]`, `params["target"]`, `params["state"]` (dict); loads doc, applies interaction, `store.put`, returns `{"ok": True, "rev": N}` or `{"ok": False, "errors": [...]}`.
  - `hooks.on_pre_llm_call(**kw) -> dict | None` — reads `kw["session_id"]`, loads doc, returns `{"context": build_canvas_summary(doc)}` when a canvas exists, else `None`.
  - `register(ctx)` additionally calls `ctx.register_hook("pre_llm_call", on_pre_llm_call)`.

- [ ] **Step 1: Write failing tests**

```python
# tests/plugins/gis_canvas/test_wire.py
import json
import pytest


@pytest.fixture(autouse=True)
def _isolated_store(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_CANVAS_DIR", str(tmp_path))
    plugin.tools_canvas.reset_store_for_tests()


def _render(plugin, sid):
    spec = {
        "canvasVersion": 1, "layout": {"type": "grid", "cols": 12},
        "components": [
            {"id": "sev", "type": "select", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"field": "severity", "options": ["all", "high"]}, "state": {"value": "all"}},
        ],
    }
    plugin.tools_canvas.render_view({"spec": spec}, session_id=sid)


def test_interaction_updates_state_and_bumps_rev(plugin):
    _render(plugin, "s1")  # rev 1
    out = plugin.wire.handle_canvas_interaction({"session_id": "s1", "target": "sev", "state": {"value": "high"}})
    assert out["ok"] is True and out["rev"] == 2
    state = json.loads(plugin.tools_canvas.canvas_get_state({"component_id": "sev"}, session_id="s1"))
    assert state["node"]["state"]["value"] == "high"


def test_interaction_unknown_target_errors(plugin):
    _render(plugin, "s1")
    out = plugin.wire.handle_canvas_interaction({"session_id": "s1", "target": "ghost", "state": {"value": "x"}})
    assert out["ok"] is False and out["errors"]


def test_interaction_without_canvas_errors(plugin):
    out = plugin.wire.handle_canvas_interaction({"session_id": "nope", "target": "sev", "state": {"value": "x"}})
    assert out["ok"] is False and any("no canvas" in e for e in out["errors"])


def test_pre_llm_call_injects_summary_for_that_session(plugin):
    _render(plugin, "s1")
    plugin.wire.handle_canvas_interaction({"session_id": "s1", "target": "sev", "state": {"value": "high"}})
    res = plugin.hooks.on_pre_llm_call(session_id="s1", task_id="t")
    assert res and "<canvas" in res["context"] and "value=high" in res["context"]


def test_pre_llm_call_none_when_no_canvas(plugin):
    assert plugin.hooks.on_pre_llm_call(session_id="empty") is None
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/plugins/gis_canvas/test_wire.py -v`
Expected: FAIL — no modules `wire`/`hooks`.

- [ ] **Step 3: Implement wire.py**

```python
# plugins/gis-canvas/wire.py
"""Gateway-process entry point for inbound canvas.interaction JSON-RPC calls.

Reached from tui_gateway/server.py via a single fenced @method delegate (the
one core edit). Returns a plain result dict; the @method wraps it with _ok().
"""
from __future__ import annotations

from .interaction import apply_interaction
from .tools_canvas import get_store


def handle_canvas_interaction(params: dict) -> dict:
    session_id = str((params or {}).get("session_id") or "")
    target = str((params or {}).get("target") or "")
    state_patch = (params or {}).get("state") or {}
    if not session_id or not target:
        return {"ok": False, "errors": ["session_id and target are required"]}
    store = get_store()
    doc = store.get(session_id)
    if doc is None:
        return {"ok": False, "errors": [f"no canvas for session '{session_id}'"]}
    patched, errors = apply_interaction(doc, target, state_patch)
    if errors:
        return {"ok": False, "errors": errors, "rev": doc.get("rev")}
    stored = store.put(session_id, patched)
    return {"ok": True, "rev": stored.get("rev")}
```

- [ ] **Step 4: Implement hooks.py**

```python
# plugins/gis-canvas/hooks.py
"""Per-turn agent-awareness hook. Injects a compact <canvas> summary into the
model's turn via pre_llm_call (ephemeral; not persisted to history)."""
from __future__ import annotations

from .awareness import build_canvas_summary
from .tools_canvas import get_store


def on_pre_llm_call(**kw) -> dict | None:
    session_id = str(kw.get("session_id") or "")
    if not session_id:
        return None
    doc = get_store().get(session_id)
    if not doc:
        return None
    summary = build_canvas_summary(doc)
    if not summary.strip():
        return None
    return {"context": summary}
```

- [ ] **Step 5: Register the hook in `__init__.py`**

Replace `plugins/gis-canvas/__init__.py`'s `register`:

```python
def register(ctx):
    from .tools_canvas import TOOL_DEFS
    from .hooks import on_pre_llm_call

    for name, schema, handler, description, emoji in TOOL_DEFS:
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

- [ ] **Step 6: Run to verify pass**

Run: `.venv/bin/pytest tests/plugins/gis_canvas -v`
Expected: whole backend suite PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/gis-canvas/wire.py plugins/gis-canvas/hooks.py plugins/gis-canvas/__init__.py tests/plugins/gis_canvas/test_wire.py
git commit -m "gis: add canvas.interaction handler + pre_llm_call awareness hook

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The one core edit — `@method("canvas.interaction")`

**Files:**
- Modify: `tui_gateway/server.py` (append one fenced block after the `@method("shell.exec")` handler)

**Interfaces:**
- Consumes: `wire.handle_canvas_interaction`, `_ok`, `_err`, `@method`.
- Produces: gateway JSON-RPC method `canvas.interaction` → result `{ok, rev, [errors]}`.

- [ ] **Step 1: Locate the insertion point**

Run: `grep -n '@method("shell.exec")' tui_gateway/server.py`
Then find the end of that function (next top-level `@method(` or `def ` at column 0 after it). Insert the block from Step 2 immediately before the next top-level definition (i.e., right after the `shell.exec` handler body).

- [ ] **Step 2: Add the fenced method**

Insert into `tui_gateway/server.py`:

```python
# >>> gis-canvas (Phase 2): inbound canvas interaction. Delegates to the
# gis-canvas plugin so all logic stays in plugins/gis-canvas/. Keep this
# block fenced and minimal for conflict-free upstream merges. <<<
@method("canvas.interaction")
def _(rid, params: dict) -> dict:
    try:
        from plugins.gis_canvas.wire import handle_canvas_interaction
    except Exception as exc:  # plugin absent/disabled — fail soft
        return _err(rid, -32601, f"gis-canvas plugin unavailable: {exc}")
    result = handle_canvas_interaction(params or {})
    if not result.get("ok"):
        return _err(rid, -32000, "; ".join(result.get("errors", ["canvas.interaction failed"])))
    return _ok(rid, result)
# <<< gis-canvas >>>
```

> Note: the import path `plugins.gis_canvas.wire` uses the underscore package slug the plugin loader registers for the hyphenated `plugins/gis-canvas/` dir (verified: loader does `slug = key.replace("/", "__").replace("-", "_")`). If import fails at runtime, confirm the plugin is enabled and loaded (`hermes plugins list`).

- [ ] **Step 3: Verify it imports and the tree still parses**

Run: `.venv/bin/python -c "import ast; ast.parse(open('tui_gateway/server.py').read()); print('parse ok')"`
Expected: `parse ok`.

- [ ] **Step 4: Commit**

```bash
git add tui_gateway/server.py
git commit -m "gis: add fenced @method(canvas.interaction) delegating to gis-canvas plugin

The one permitted core edit (gateway methods are not plugin-extensible);
comment-fenced and minimal for conflict-free upstream merges.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Frontend — types, override merge, handler dispatch

**Files:**
- Modify: `apps/gis-canvas/src/lib/types.ts`
- Create: `apps/gis-canvas/src/lib/merge.ts`, `apps/gis-canvas/src/lib/merge.test.ts`
- Create: `apps/gis-canvas/src/lib/handlers.ts`, `apps/gis-canvas/src/lib/handlers.test.ts`

**Interfaces:**
- Produces:
  - types: `'select'` added to `MOLECULE_TYPES`; `Handler` union; `ComponentNode.handlers?: Record<string, Handler>`.
  - `mergeOverrides(doc: CanvasDoc, overrides: Overrides): CanvasDoc` where `Overrides = Record<string, Record<string, unknown>>` — returns a doc clone with each node's `state` shallow-merged with `overrides[node.id]`.
  - `CanvasActions` interface + `runHandler(handler: Handler, node: ComponentNode, actions: CanvasActions): void`.

- [ ] **Step 1: Extend types.ts**

In `apps/gis-canvas/src/lib/types.ts`:

```typescript
export const MOLECULE_TYPES = ['card', 'stat', 'data-table', 'select'] as const
```

And add below `CanvasEnvelope`:

```typescript
export type Handler =
  | { kind: 'set'; target: string; key: string; value: unknown }
  | { kind: 'reactive'; controls: string } // "targetId.key.subkey" path written from event value
  | { kind: 'agent'; prompt: string }

// add to ComponentNode:
//   handlers?: Record<string, Handler>
```

Then add `handlers?: Record<string, Handler>` to the `ComponentNode` interface.

- [ ] **Step 2: Write failing merge test**

```typescript
// apps/gis-canvas/src/lib/merge.test.ts
import { mergeOverrides } from './merge'
import type { CanvasDoc } from './types'

const doc: CanvasDoc = {
  canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
  components: [
    { id: 'sev', type: 'select', props: { field: 'severity', options: ['all', 'high'] }, state: { value: 'all' } },
    { id: 'c1', type: 'card', props: { title: 'x' },
      slots: { content: [{ id: 'tbl1', type: 'data-table', bindings: { source: 'mock://incidents' } }] } }
  ]
}

test('overlays override state on matching nodes (incl nested)', () => {
  const merged = mergeOverrides(doc, { sev: { value: 'high' }, tbl1: { rowSelection: ['f_82'] } })
  expect(merged.components[0].state).toEqual({ value: 'high' })
  expect(merged.components[1].slots!.content[0].state).toEqual({ rowSelection: ['f_82'] })
})

test('does not mutate the input doc', () => {
  const before = JSON.stringify(doc)
  mergeOverrides(doc, { sev: { value: 'high' } })
  expect(JSON.stringify(doc)).toBe(before)
})

test('nodes without overrides keep their state', () => {
  const merged = mergeOverrides(doc, {})
  expect(merged.components[0].state).toEqual({ value: 'all' })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run -w @hermes/gis-canvas test -- merge`
Expected: FAIL — no module `merge`.

- [ ] **Step 4: Implement merge.ts**

```typescript
// apps/gis-canvas/src/lib/merge.ts
import type { CanvasDoc, ComponentNode } from './types'

export type Overrides = Record<string, Record<string, unknown>>

function mergeNode(node: ComponentNode, ov: Overrides): ComponentNode {
  const patch = ov[node.id]
  const next: ComponentNode = { ...node }
  if (patch) next.state = { ...(node.state ?? {}), ...patch }
  if (node.children) next.children = node.children.map(k => mergeNode(k, ov))
  if (node.slots) {
    next.slots = Object.fromEntries(
      Object.entries(node.slots).map(([slot, kids]) => [slot, kids.map(k => mergeNode(k, ov))])
    )
  }
  return next
}

/** Return a doc clone with each node's state shallow-merged with overrides[node.id]. */
export function mergeOverrides(doc: CanvasDoc, overrides: Overrides): CanvasDoc {
  return { ...doc, components: doc.components.map(n => mergeNode(n, overrides)) }
}
```

- [ ] **Step 5: Write failing handlers test**

```typescript
// apps/gis-canvas/src/lib/handlers.test.ts
import { runHandler, type CanvasActions } from './handlers'
import type { ComponentNode, Handler } from './types'

function spyActions() {
  const calls: string[] = []
  const actions: CanvasActions = {
    reportInteraction: (id, patch) => calls.push(`report:${id}:${JSON.stringify(patch)}`),
    setLocalState: (id, patch) => calls.push(`local:${id}:${JSON.stringify(patch)}`),
    sendPrompt: text => calls.push(`prompt:${text}`)
  }
  return { actions, calls }
}

const node: ComponentNode = { id: 'sev', type: 'select', props: { field: 'severity' } }

test('set handler reports interaction to the target', () => {
  const { actions, calls } = spyActions()
  const h: Handler = { kind: 'set', target: 'tbl1', key: 'rowSelection', value: ['f_82'] }
  runHandler(h, node, actions, { value: undefined })
  expect(calls).toContain('report:tbl1:{"rowSelection":["f_82"]}')
})

test('reactive handler writes the event value into the controls path (id.key.subkey)', () => {
  const { actions, calls } = spyActions()
  const h: Handler = { kind: 'reactive', controls: 'tbl1.filter.severity' }
  runHandler(h, node, actions, { value: 'high' })
  // writes {filter:{severity:'high'}} onto tbl1, and records it
  expect(calls).toContain('report:tbl1:{"filter":{"severity":"high"}}')
})

test('agent handler sends the prompt', () => {
  const { actions, calls } = spyActions()
  const h: Handler = { kind: 'agent', prompt: 'Summarize selection' }
  runHandler(h, node, actions, { value: undefined })
  expect(calls).toContain('prompt:Summarize selection')
})
```

- [ ] **Step 6: Run to verify failure**

Run: `npm run -w @hermes/gis-canvas test -- handlers`
Expected: FAIL — no module `handlers`.

- [ ] **Step 7: Implement handlers.ts**

```typescript
// apps/gis-canvas/src/lib/handlers.ts
import type { ComponentNode, Handler } from './types'

export interface CanvasActions {
  /** Optimistic local state change (instant re-render). */
  setLocalState(id: string, patch: Record<string, unknown>): void
  /** Local change + record server-side (canvas.interaction) for agent awareness. */
  reportInteraction(id: string, patch: Record<string, unknown>): void
  /** Trigger an agent turn. */
  sendPrompt(text: string): void
}

export interface HandlerEvent {
  value?: unknown
}

/** Execute a component handler. `event.value` is the control's new value. */
export function runHandler(
  handler: Handler,
  node: ComponentNode,
  actions: CanvasActions,
  event: HandlerEvent
): void {
  switch (handler.kind) {
    case 'set':
      actions.reportInteraction(handler.target, { [handler.key]: handler.value })
      return
    case 'reactive': {
      // controls path: "targetId.key" or "targetId.key.subkey"
      const [target, key, subkey] = handler.controls.split('.')
      if (!target || !key) return
      const patch = subkey ? { [key]: { [subkey]: event.value } } : { [key]: event.value }
      actions.reportInteraction(target, patch)
      return
    }
    case 'agent':
      actions.sendPrompt(handler.prompt)
      return
  }
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npm run -w @hermes/gis-canvas test -- merge handlers`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/gis-canvas/src/lib/types.ts apps/gis-canvas/src/lib/merge.ts apps/gis-canvas/src/lib/merge.test.ts apps/gis-canvas/src/lib/handlers.ts apps/gis-canvas/src/lib/handlers.test.ts
git commit -m "gis: frontend handler model + state-override merge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — select control, data-table selection/filter, wiring

**Files:**
- Create: `apps/gis-canvas/src/components/HandlerContext.tsx`
- Create: `apps/gis-canvas/src/components/molecules/SelectMolecule.tsx`
- Modify: `apps/gis-canvas/src/components/registry.tsx` (register `select`; pass actions via context)
- Modify: `apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx` (row selection + client-side filter)
- Modify: `apps/gis-canvas/src/App.tsx` (overrides state, merged doc, canvas.interaction sender, provider)
- Test: `apps/gis-canvas/src/components/CanvasGrid.test.tsx` (add interaction cases)

**Interfaces:**
- Consumes: `runHandler`, `CanvasActions`, `mergeOverrides`, existing `CanvasGrid`/registry.
- Produces: `HandlerContext` (React context providing `CanvasActions`); `SelectMolecule`; data-table rows filtered by `state.filter` and selectable (checkbox) writing `state.rowSelection` via `set` handler; App merges overrides and sends `canvas.interaction`.

- [ ] **Step 1: Add failing interaction tests to CanvasGrid.test.tsx**

Append:

```tsx
import { HandlerProvider } from './HandlerContext'
import type { CanvasActions } from '../lib/handlers'

function renderWithActions(d: CanvasDoc, actions: Partial<CanvasActions> = {}) {
  const full: CanvasActions = {
    setLocalState: () => {},
    reportInteraction: () => {},
    sendPrompt: () => {},
    ...actions
  }
  return render(
    <HandlerProvider actions={full}>
      <CanvasGrid doc={d} />
    </HandlerProvider>
  )
}

test('select renders options and reports interaction on change', () => {
  const reports: string[] = []
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 'sev', type: 'select', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
        props: { field: 'severity', options: ['all', 'high', 'low'] }, state: { value: 'all' },
        handlers: { onChange: { kind: 'reactive', controls: 'tbl1.filter.severity' } } }
    ]
  }
  renderWithActions(d, { reportInteraction: (id, patch) => reports.push(`${id}:${JSON.stringify(patch)}`) })
  const select = screen.getByRole('combobox')
  select.dispatchEvent(new Event('change', { bubbles: true }))
  // change to 'high'
  ;(select as HTMLSelectElement).value = 'high'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  expect(reports.some(r => r.includes('tbl1') && r.includes('severity'))).toBe(true)
})

test('data-table filters rows by state.filter', () => {
  const d: CanvasDoc = {
    canvasVersion: 1, rev: 1, layout: { type: 'grid', cols: 12 },
    components: [
      { id: 'tbl1', type: 'data-table', area: { col: 1, colSpan: 12, row: 1, rowSpan: 4 },
        bindings: { source: 'mock://incidents' }, state: { filter: { severity: 'low' } } }
    ]
  }
  renderWithActions(d)
  // only 'low' severity rows: f_44, f_18 present; a 'high' row absent
  expect(screen.getByText('f_44')).toBeInTheDocument()
  expect(screen.queryByText('f_82')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run -w @hermes/gis-canvas test -- CanvasGrid`
Expected: FAIL — no `HandlerContext` / `select` not registered / no filtering.

- [ ] **Step 3: Create HandlerContext.tsx**

```tsx
// apps/gis-canvas/src/components/HandlerContext.tsx
import { createContext, useContext, type ReactNode } from 'react'
import type { CanvasActions } from '../lib/handlers'

const NOOP: CanvasActions = {
  setLocalState: () => {},
  reportInteraction: () => {},
  sendPrompt: () => {}
}

const Ctx = createContext<CanvasActions>(NOOP)

export function HandlerProvider({ actions, children }: { actions: CanvasActions; children: ReactNode }) {
  return <Ctx.Provider value={actions}>{children}</Ctx.Provider>
}

export function useCanvasActions(): CanvasActions {
  return useContext(Ctx)
}
```

- [ ] **Step 4: Create SelectMolecule.tsx**

```tsx
// apps/gis-canvas/src/components/molecules/SelectMolecule.tsx
import { useCanvasActions } from '../HandlerContext'
import { runHandler } from '../../lib/handlers'
import type { Handler } from '../../lib/types'
import type { MoleculeProps } from '../registry'

export function SelectMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const { field, options } = (node.props ?? {}) as { field?: string; options?: string[] }
  const value = (node.state?.value as string | undefined) ?? (options?.[0] ?? '')
  const onChange = node.handlers?.onChange as Handler | undefined

  return (
    <div className="flex h-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3">
      <label className="text-xs uppercase tracking-wide text-neutral-500">{field ?? node.id}</label>
      <select
        className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
        value={value}
        onChange={e => {
          const v = e.target.value
          // record the select's own value, then run its handler with the new value
          actions.reportInteraction(node.id, { value: v })
          if (onChange) runHandler(onChange, node, actions, { value: v })
        }}
      >
        {(options ?? []).map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}
```

- [ ] **Step 5: Register `select` in registry.tsx**

In `apps/gis-canvas/src/components/registry.tsx` add the import and entry:

```tsx
import { SelectMolecule } from './molecules/SelectMolecule'
```

```tsx
export const COMPONENT_REGISTRY: Record<string, ComponentType<MoleculeProps>> = {
  card: CardMolecule,
  stat: StatMolecule,
  'data-table': DataTableMolecule,
  select: SelectMolecule
}
```

- [ ] **Step 6: Update DataTableMolecule.tsx (filter + selection)**

Replace `apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx`:

```tsx
import { useMemo, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState
} from '@tanstack/react-table'
import { resolveMockSource } from '../../lib/mock-data'
import { useCanvasActions } from '../HandlerContext'
import type { MoleculeProps } from '../registry'

type Row = Record<string, string | number>
const helper = createColumnHelper<Row>()

export function DataTableMolecule({ node }: MoleculeProps) {
  const actions = useCanvasActions()
  const source = node.bindings?.source ?? ''
  const data = resolveMockSource(source)
  const wanted = (node.props?.columns as string[] | undefined) ?? null
  const filter = (node.state?.filter as Record<string, string> | undefined) ?? {}
  const selected = (node.state?.rowSelection as string[] | undefined) ?? []
  const [sorting, setSorting] = useState<SortingState>([])

  // client-side filter (reactive, no agent turn): keep rows matching every
  // active filter entry (ignore empty / 'all').
  const rows = useMemo(() => {
    const all = data?.rows ?? []
    const active = Object.entries(filter).filter(([, v]) => v && v !== 'all')
    if (!active.length) return all
    return all.filter(r => active.every(([k, v]) => String(r[k]) === v))
  }, [data, filter])

  const idField = data?.schema[0]?.name ?? 'id'
  const columns = useMemo(() => {
    const fields = (data?.schema ?? []).filter(f => !wanted || wanted.includes(f.name))
    return fields.map(f => helper.accessor(row => row[f.name], { id: f.name, header: f.name }))
  }, [data, wanted])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  })

  if (!data) {
    return <div className="p-2 text-sm text-red-600">Unknown data source: {source || '(none)'}</div>
  }

  const toggle = (rowId: string) => {
    const next = selected.includes(rowId) ? selected.filter(x => x !== rowId) : [...selected, rowId]
    actions.reportInteraction(node.id, { rowSelection: next })
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id}>
            <th className="w-6 border-b border-neutral-200 px-2 py-1" />
            {hg.headers.map(h => (
              <th
                key={h.id}
                onClick={h.column.getToggleSortingHandler()}
                className="cursor-pointer border-b border-neutral-200 px-2 py-1 text-left font-semibold"
              >
                {flexRender(h.column.columnDef.header, h.getContext())}
                {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map(row => {
          const rid = String(row.original[idField])
          const isSel = selected.includes(rid)
          return (
            <tr key={row.id} className={isSel ? 'bg-blue-50' : undefined}>
              <td className="border-b border-neutral-100 px-2 py-1">
                <input type="checkbox" checked={isSel} onChange={() => toggle(rid)} aria-label={`select ${rid}`} />
              </td>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className="border-b border-neutral-100 px-2 py-1">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 7: Wire App.tsx (overrides + provider + interaction sender)**

Edit `apps/gis-canvas/src/App.tsx`: add imports, an `overrides` state, a merged doc, a `CanvasActions` implementation that sends `canvas.interaction`, and wrap the canvas in `HandlerProvider`.

Add these imports (the existing `import { useEffect, useMemo, useRef, useState } from 'react'` line already covers the hooks):

```tsx
import { HandlerProvider } from './components/HandlerContext'
import { mergeOverrides, type Overrides } from './lib/merge'
import type { CanvasActions } from './lib/handlers'
```

**Ordering requirement:** move the existing `const send = async (text: string) => {…}` definition to *above* the `actions` useMemo below (so `sendPrompt: text => { void send(text) }` can reference it). Then, after `const { doc, errors } = useCanvasDoc(client)` (and after `send`):

```tsx
  const [overrides, setOverrides] = useState<Overrides>({})

  const actions: CanvasActions = useMemo(() => ({
    setLocalState: (id, patch) =>
      setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } })),
    reportInteraction: (id, patch) => {
      setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch } }))
      const sid = sessionIdRef.current
      if (sid) void client.request('canvas.interaction', { session_id: sid, target: id, state: patch }).catch(() => {})
    },
    sendPrompt: text => { void send(text) }
  }), [client])

  // reset local overrides whenever the agent re-renders the canvas (new structure)
  useEffect(() => { setOverrides({}) }, [doc?.rev])

  const mergedDoc = doc ? mergeOverrides(doc, overrides) : null
```

Replace the `{doc ? <CanvasGrid doc={doc} /> : …}` block with:

```tsx
        {mergedDoc ? (
          <HandlerProvider actions={actions}>
            <CanvasGrid doc={mergedDoc} />
          </HandlerProvider>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">
            No canvas yet — ask the agent to build a dashboard.
          </div>
        )}
```

(`send` is defined below in the component; hoist it above `actions` or wrap the `sendPrompt` call — since `send` is a `const` arrow function, move its definition above the `actions` useMemo, or reference it via a ref. Simplest: move the `send` definition to before `actions`.)

- [ ] **Step 8: Run frontend suite + build**

Run: `npm run -w @hermes/gis-canvas test`
Expected: all PASS (including new select/filter tests and the unchanged App StrictMode test).

Run: `npm run -w @hermes/gis-canvas build`
Expected: typecheck + build succeed.

- [ ] **Step 9: Commit**

```bash
git add apps/gis-canvas/src
git commit -m "gis: select control + data-table selection/filter + interaction wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: E2E verification + docs

**Files:**
- Modify: `apps/gis-canvas/README.md`, `plugins/gis-canvas/README.md` (Phase 2 status)

- [ ] **Step 1: Full test sweep**

Run: `.venv/bin/pytest tests/plugins/gis_canvas -q`
Expected: all green.
Run: `npm run -w @hermes/gis-canvas test && npm run -w @hermes/gis-canvas build`
Expected: all green.

- [ ] **Step 2: Restart the backend (picks up the new @method + hook)**

```bash
kill "$(lsof -tiTCP:9119 -sTCP:LISTEN)" 2>/dev/null
export PATH="$HOME/.local/bin:$PATH"
HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119 &
```
Wait for `HERMES_DASHBOARD_READY port=9119`. Confirm `hermes plugins list` shows `gis-canvas` enabled.

- [ ] **Step 3: Verify the session_id key assumption live**

Drive the gateway (reuse the Phase-1 pattern): `session.create` → note `session_id`; `prompt.submit` "build a dashboard with a severity select (options all/high/med/low) and a data-table bound to mock://incidents in a card"; wait for the `render_view` envelope. Then confirm a canvas file named `<session_id>.json` exists:

```bash
ls ~/.hermes/gis_canvas/    # expect a file named <the 8-hex session_id>.json
```
Expected: filename equals the `session_id` from `session.create` (proves Task 1's keying). If it's a timestamped name instead, the tool-layer `session_id` differs from the frontend's — STOP and reconcile before proceeding.

- [ ] **Step 4: Browser test (Playwright, reuse Phase-1 harness)**

Start the dev server (`cd apps/gis-canvas && VITE_HERMES_TOKEN=dev-gis-local npx vite --port 5174 --host 127.0.0.1 &`) and run a Playwright script that: loads the app, waits for `● connected`, prompts the agent to build the select+table dashboard, waits for render, **changes the select to `high`** (asserts the table filters client-side — `f_63` (med) disappears) with NO new agent turn, **checks two rows**, then sends "Which incidents did I select and what filter is active?" and asserts the agent's reply references the selected ids / `high` (proving the awareness hook). Screenshot to `scratchpad/phase2-canvas.png`.

Expected: filter narrows rows without an agent turn; the agent's answer reflects the live selection + filter.

- [ ] **Step 5: Update READMEs**

Set status to "Phase 2 (interaction loop) implemented" in both READMEs; add the demo prompt and note the one fenced core edit in `tui_gateway/server.py`.

- [ ] **Step 6: Commit + push**

```bash
git add apps/gis-canvas/README.md plugins/gis-canvas/README.md
git commit -m "gis: Phase 2 complete — interaction loop verified (filter/select/awareness)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin gis/main
```

---

## Out of scope for Phase 2 (later phases)

- Event subscriptions (agent subscribes to specific interaction events → injected only when fired). Phase 2 ships always-on awareness summary; subscriptions are a later refinement.
- Overlays layer rendering (dialog/sheet/popover) and the `open` handler kind.
- ESRI map/feature-table molecules + Calcite theming (Phase 3).
- Data broker / `DataSource` / `canvas.data_fetch` / A2A adapter (Phase 4).
