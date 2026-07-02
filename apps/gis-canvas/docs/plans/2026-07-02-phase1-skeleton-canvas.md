# GIS Canvas — Phase 1: Skeleton Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the declarative canvas loop end-to-end — the Hermes agent authors a canvas spec via `render_view`/`update_view` tools, a server-side validated document rides `tool.complete` events to a new React frontend, which renders a grid of `card`/`stat`/`data-table` molecules on mock data.

**Architecture:** A Hermes plugin (`plugins/gis-canvas/`) registers three tools that validate specs against a JSON-Schema + catalog contract and store the canonical doc server-side (rev-guarded). A new workspace app (`apps/gis-canvas/`) connects to the Hermes gateway over WS+JSON-RPC, extracts canvas envelopes from `tool.complete` events, and renders them. No Hermes core file is modified.

**Tech Stack:** Python 3.11 + jsonschema 4.26 + pytest (backend); React 19 + Vite 8 + TypeScript 6 + Tailwind 4 + @tanstack/react-table 8 + vitest 4 (frontend); `@hermes/shared` `JsonRpcGatewayClient` for gateway transport.

**Spec:** `apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` (Phase 1 of §13).

## Global Constraints

- ALL code lives in `apps/gis-canvas/` and `plugins/gis-canvas/`; backend tests in `tests/plugins/gis_canvas/` (new dir — additive, repo convention). **Never edit any other existing file.** Exception: root `package-lock.json` changes when `npm install` wires the new workspace (generated file; on future merge conflict: take upstream's, re-run `npm install`).
- Every commit message starts with `gis:` and ends with the Co-Authored-By trailer shown in Task 1.
- Work on branch `gis/main` (already exists, tracks `origin/gis/main`).
- Canvas contract: `canvasVersion: 1`; `rev` is server-stamped (monotonic, starts at 1); nesting depth ≤ 3; Phase-1 catalog is exactly `card`, `stat`, `data-table`; grid layout default `{type:"grid", cols:12, rowHeight:80, gap:8}`.
- Bulk data never rides in the doc or tool results — `data-table` binds `bindings.source = "mock://…"` handles resolved client-side (Phase 1 mock of the data plane).
- Tool results are JSON strings with envelope `{"gis_canvas": true, "ok": …, "rev": …, …}` — the frontend recognizes canvas results by `gis_canvas: true`, not by tool name or payload field name.
- Python: stdlib + `jsonschema` only (already in `uv.lock` v4.26.0); no imports from Hermes core modules inside plugin logic (only `ctx.*` in `register`). Run tests with `uv run pytest`.
- Frontend deps pinned in `apps/gis-canvas/package.json` only (never root): react `^19.2.5`, vite `^8.0.10`, typescript `^6.0.3`, tailwindcss `^4.2.4`, vitest `^4.1.5`, @tanstack/react-table `^8.21.3`.
- Hermes plugin facts (verified): manifest = `plugins/gis-canvas/plugin.yaml` (`name`, `version`, `description`, `kind: standalone`, `provides_tools`); loading is opt-in via `plugins.enabled: [gis-canvas]` in `~/.hermes/config.yaml`; `__init__.py` must expose `register(ctx)`; `ctx.register_tool(name, toolset, schema, handler, check_fn=None, requires_env=None, is_async=False, description="", emoji="", override=False)`; handlers are called as `handler(args_dict, **kw)` where `kw` includes `task_id`; handlers return JSON strings.
- Gateway facts (verified): frontend RPC methods `session.create` (params `{cols: 96}`, returns `{session_id}` among other fields) and `prompt.submit` (params `{session_id, text}`); events are `{type, session_id, payload}` with types like `tool.complete`, `message.delta`; `JsonRpcGatewayClient` from `@hermes/shared` provides `connect(wsUrl)`, `request(method, params)`, `on(type, handler)`, `onAny(handler)`.
- Local dev auth (verified): `HERMES_DASHBOARD_SESSION_TOKEN=<token> hermes dashboard --no-open --port 9119` pins the WS token; connect to `ws://127.0.0.1:9119/api/ws?token=<token>`.

---

## File Structure

```
plugins/gis-canvas/
  plugin.yaml                 # manifest (Task 5)
  __init__.py                 # register(ctx) (Task 5)
  schema/canvas.schema.json   # JSON Schema — structural contract (Task 1)
  validator.py                # validate_doc(): schema + catalog + depth/id checks (Task 1)
  ops.py                      # apply_ops(): add/remove/replace/setProps/setBinding (Task 2)
  store.py                    # CanvasStore: rev-stamping, JSON-file persistence (Task 3)
  tools_canvas.py             # tool handlers + schemas + result envelopes (Task 4)

tests/plugins/gis_canvas/
  __init__.py  conftest.py    # plugin package loader (Task 1)
  test_validator.py  test_ops.py  test_store.py  test_tools.py  test_registration.py

apps/gis-canvas/
  package.json  vite.config.ts  tsconfig.json  index.html      (Task 6)
  src/main.tsx  src/index.css  src/test-setup.ts  src/App.tsx  (Tasks 6, 9)
  src/lib/types.ts            # TS mirror of the schema (Task 6)
  src/lib/extract.ts          # tool.complete → CanvasEnvelope (Task 7)
  src/lib/mock-data.ts        # mock:// data-plane stub (Task 7)
  src/lib/use-canvas-doc.ts   # event subscription → doc state (Task 9)
  src/lib/gateway.ts          # WS URL builder + client factory (Task 9)
  src/components/registry.tsx # type → molecule map + UnknownTile (Task 8)
  src/components/CanvasGrid.tsx                                 (Task 8)
  src/components/molecules/{CardMolecule,StatMolecule,DataTableMolecule}.tsx (Task 8)
  src/components/Chat.tsx     # composer + activity log (Task 9)
```

---

### Task 1: Canvas contract — JSON Schema + Python validator

**Files:**
- Create: `plugins/gis-canvas/schema/canvas.schema.json`
- Create: `plugins/gis-canvas/validator.py`
- Create: `tests/plugins/gis_canvas/__init__.py` (empty), `tests/plugins/gis_canvas/conftest.py`
- Test: `tests/plugins/gis_canvas/test_validator.py`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `validate_doc(doc: dict) -> list[str]` (empty list = valid); `CATALOG: dict[str, dict]`; `DEFAULT_LAYOUT: dict`; `MAX_DEPTH = 3`. Loaded by later tasks via the `plugin` conftest fixture.

- [ ] **Step 1: Create the test-side plugin loader (conftest)**

The plugin dir has a hyphen (`gis-canvas`) so it can't be imported by dotted path; load it by file location as package `gis_canvas_plugin`:

```python
# tests/plugins/gis_canvas/conftest.py
"""Load the gis-canvas plugin (hyphenated dir) as an importable package."""
import importlib.util
import pathlib
import sys

import pytest

PLUGIN_DIR = pathlib.Path(__file__).resolve().parents[3] / "plugins" / "gis-canvas"
PKG = "gis_canvas_plugin"


def _load_package():
    if PKG in sys.modules:
        return sys.modules[PKG]
    spec = importlib.util.spec_from_file_location(
        PKG, PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PKG] = module
    spec.loader.exec_module(module)
    return module


def load_plugin_module(name: str):
    """Import a submodule of the plugin, e.g. load_plugin_module('validator')."""
    _load_package()
    full = f"{PKG}.{name}"
    if full in sys.modules:
        return sys.modules[full]
    spec = importlib.util.spec_from_file_location(full, PLUGIN_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[full] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def plugin():
    """Namespace fixture: plugin.validator, plugin.ops, plugin.store, plugin.tools_canvas."""
    class _NS:
        def __getattr__(self, name):
            return load_plugin_module(name)
    return _NS()
```

Also create empty `tests/plugins/gis_canvas/__init__.py`.

- [ ] **Step 2: Write the failing validator tests**

```python
# tests/plugins/gis_canvas/test_validator.py
"""Contract tests for the canvas document validator."""


def _minimal_doc():
    return {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {
                "id": "s1",
                "type": "stat",
                "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
                "props": {"label": "High", "value": 42},
            }
        ],
    }


def test_valid_minimal_doc_passes(plugin):
    assert plugin.validator.validate_doc(_minimal_doc()) == []


def test_unknown_component_type_rejected(plugin):
    doc = _minimal_doc()
    doc["components"][0]["type"] = "esri:map"  # not in Phase-1 catalog
    errors = plugin.validator.validate_doc(doc)
    assert errors and any("type" in e for e in errors)


def test_duplicate_ids_rejected_across_nesting(plugin):
    doc = _minimal_doc()
    doc["components"].append(
        {
            "id": "c1",
            "type": "card",
            "area": {"col": 4, "colSpan": 4, "row": 1, "rowSpan": 2},
            "props": {"title": "Dup"},
            "slots": {"content": [{"id": "s1", "type": "stat", "props": {"label": "X", "value": 1}}]},
        }
    )
    errors = plugin.validator.validate_doc(doc)
    assert any("duplicate id" in e for e in errors)


def test_depth_limit_enforced(plugin):
    # card > card > card > stat = depth 4 → reject
    deep = {"id": "s9", "type": "stat", "props": {"label": "L", "value": 1}}
    for i in (3, 2, 1):
        deep = {"id": f"c{i}", "type": "card", "props": {"title": "T"}, "slots": {"content": [deep]}}
    doc = _minimal_doc()
    deep["area"] = {"col": 1, "colSpan": 3, "row": 2, "rowSpan": 2}
    doc["components"].append(deep)
    errors = plugin.validator.validate_doc(doc)
    assert any("depth" in e for e in errors)


def test_stat_requires_label_and_value(plugin):
    doc = _minimal_doc()
    doc["components"][0]["props"] = {"label": "only label"}
    errors = plugin.validator.validate_doc(doc)
    assert any("value" in e for e in errors)


def test_data_table_requires_source_binding(plugin):
    doc = _minimal_doc()
    doc["components"].append(
        {"id": "t1", "type": "data-table", "area": {"col": 4, "colSpan": 6, "row": 1, "rowSpan": 3}}
    )
    errors = plugin.validator.validate_doc(doc)
    assert any("bindings.source" in e for e in errors)


def test_top_level_component_requires_area(plugin):
    doc = _minimal_doc()
    del doc["components"][0]["area"]
    errors = plugin.validator.validate_doc(doc)
    assert any("area" in e for e in errors)


def test_area_exceeding_grid_cols_rejected(plugin):
    doc = _minimal_doc()
    doc["components"][0]["area"] = {"col": 11, "colSpan": 4, "row": 1, "rowSpan": 1}  # 11+4-1 = 14 > 12
    errors = plugin.validator.validate_doc(doc)
    assert any("exceeds grid" in e for e in errors)


def test_non_container_may_not_have_children_or_slots(plugin):
    doc = _minimal_doc()
    doc["components"][0]["slots"] = {"content": []}
    errors = plugin.validator.validate_doc(doc)
    assert any("container" in e for e in errors)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/plugins/gis_canvas/test_validator.py -v`
Expected: FAIL — `FileNotFoundError` / `ModuleNotFoundError` for `validator.py` (plugin package has only README so far).

- [ ] **Step 4: Write the JSON Schema**

```json
// plugins/gis-canvas/schema/canvas.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "hermes-gis-canvas/canvas/v1",
  "title": "GIS Canvas Document v1",
  "type": "object",
  "required": ["canvasVersion", "layout", "components"],
  "additionalProperties": false,
  "properties": {
    "canvasVersion": { "const": 1 },
    "rev": { "type": "integer", "minimum": 0 },
    "layout": {
      "type": "object",
      "required": ["type", "cols"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "grid" },
        "cols": { "type": "integer", "minimum": 1, "maximum": 24 },
        "rowHeight": { "type": "integer", "minimum": 20, "maximum": 400 },
        "gap": { "type": "integer", "minimum": 0, "maximum": 64 }
      }
    },
    "components": { "type": "array", "items": { "$ref": "#/$defs/componentNode" } },
    "overlays": { "type": "array", "items": { "$ref": "#/$defs/componentNode" } },
    "focus": { "type": "string" }
  },
  "$defs": {
    "area": {
      "type": "object",
      "required": ["col", "colSpan", "row", "rowSpan"],
      "additionalProperties": false,
      "properties": {
        "col": { "type": "integer", "minimum": 1 },
        "colSpan": { "type": "integer", "minimum": 1 },
        "row": { "type": "integer", "minimum": 1 },
        "rowSpan": { "type": "integer", "minimum": 1 }
      }
    },
    "componentNode": {
      "type": "object",
      "required": ["id", "type"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" },
        "type": { "enum": ["card", "stat", "data-table"] },
        "area": { "$ref": "#/$defs/area" },
        "props": { "type": "object" },
        "bindings": { "type": "object", "additionalProperties": { "type": "string" } },
        "state": { "type": "object" },
        "children": { "type": "array", "items": { "$ref": "#/$defs/componentNode" } },
        "slots": {
          "type": "object",
          "additionalProperties": { "type": "array", "items": { "$ref": "#/$defs/componentNode" } }
        }
      }
    }
  }
}
```

- [ ] **Step 5: Write the validator**

```python
# plugins/gis-canvas/validator.py
"""Canvas document validation: JSON Schema (structure) + catalog (per-type rules).

The JSON Schema at schema/canvas.schema.json is the cross-language structural
contract (mirrored by apps/gis-canvas/src/lib/types.ts). CATALOG holds the
per-type rules that don't fit cleanly in the schema: container-ness, slots,
required props/bindings.
"""
from __future__ import annotations

import json
import pathlib

from jsonschema import Draft202012Validator

MAX_DEPTH = 3

DEFAULT_LAYOUT = {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8}

CATALOG: dict[str, dict] = {
    "card": {
        "container": True,
        "slots": {"content", "footer"},
        "required_props": [],
        "required_bindings": [],
    },
    "stat": {
        "container": False,
        "slots": set(),
        "required_props": ["label", "value"],
        "required_bindings": [],
    },
    "data-table": {
        "container": False,
        "slots": set(),
        "required_props": [],
        "required_bindings": ["source"],
    },
}

_SCHEMA_PATH = pathlib.Path(__file__).resolve().parent / "schema" / "canvas.schema.json"
_schema_validator = Draft202012Validator(json.loads(_SCHEMA_PATH.read_text()))


def validate_doc(doc: dict) -> list[str]:
    """Return a list of human-readable errors; empty list means the doc is valid."""
    errors = [
        f"schema: {'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in _schema_validator.iter_errors(doc)
    ]
    if errors:
        return errors  # structural failures make deeper checks unreliable

    seen_ids: set[str] = set()
    cols = doc.get("layout", {}).get("cols", DEFAULT_LAYOUT["cols"])

    def walk(node: dict, depth: int, top_level: bool) -> None:
        node_id, node_type = node["id"], node["type"]
        if node_id in seen_ids:
            errors.append(f"duplicate id: '{node_id}'")
        seen_ids.add(node_id)

        if depth > MAX_DEPTH:
            errors.append(f"'{node_id}': nesting depth {depth} exceeds max {MAX_DEPTH}")

        entry = CATALOG[node_type]  # schema enum guarantees membership
        props = node.get("props", {})
        bindings = node.get("bindings", {})

        for p in entry["required_props"]:
            if p not in props:
                errors.append(f"'{node_id}' ({node_type}): missing required props.{p}")
        for b in entry["required_bindings"]:
            if b not in bindings:
                errors.append(f"'{node_id}' ({node_type}): missing required bindings.{b}")

        if top_level:
            area = node.get("area")
            if not area:
                errors.append(f"'{node_id}': top-level component requires area")
            elif area["col"] + area["colSpan"] - 1 > cols:
                errors.append(
                    f"'{node_id}': area col {area['col']}+span {area['colSpan']} exceeds grid cols {cols}"
                )

        kids = list(node.get("children", []))
        slots = node.get("slots", {})
        if not entry["container"] and (kids or slots):
            errors.append(f"'{node_id}' ({node_type}): not a container, may not have children/slots")
        for slot_name, slot_kids in slots.items():
            if entry["container"] and slot_name not in entry["slots"]:
                errors.append(f"'{node_id}' ({node_type}): unknown slot '{slot_name}'")
            kids.extend(slot_kids)
        for kid in kids:
            walk(kid, depth + 1, top_level=False)

    for comp in doc.get("components", []):
        walk(comp, 1, top_level=True)
    for overlay in doc.get("overlays", []):
        walk(overlay, 1, top_level=False)  # overlays are portals: no grid area

    return errors
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/plugins/gis_canvas/test_validator.py -v`
Expected: 9 PASSED.

- [ ] **Step 7: Commit**

```bash
git add plugins/gis-canvas/schema plugins/gis-canvas/validator.py tests/plugins/gis_canvas
git commit -m "gis: add canvas doc JSON Schema + validator (Phase-1 catalog)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Ops engine — component-addressed patches

**Files:**
- Create: `plugins/gis-canvas/ops.py`
- Test: `tests/plugins/gis_canvas/test_ops.py`

**Interfaces:**
- Consumes: nothing (pure; validation happens in Task 4 after applying).
- Produces: `apply_ops(doc: dict, ops: list[dict]) -> tuple[dict, list[str]]` — returns `(new_doc, [])` on success or `(original_doc, errors)` (all-or-nothing). Op shapes (spec §7): `{"op":"add","target":null|"<container-id>","slot":"content","node":{…}}`, `{"op":"remove","target":"<id>"}`, `{"op":"replace","target":"<id>","node":{…}}`, `{"op":"setProps","target":"<id>","props":{…}}` (shallow merge), `{"op":"setBinding","target":"<id>","key":"source","value":"mock://x"}`.

- [ ] **Step 1: Write the failing ops tests**

```python
# tests/plugins/gis_canvas/test_ops.py
import copy


def _doc():
    return {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {"id": "s1", "type": "stat", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"label": "High", "value": 42}},
            {"id": "c1", "type": "card", "area": {"col": 4, "colSpan": 6, "row": 1, "rowSpan": 3},
             "props": {"title": "Incidents"},
             "slots": {"content": [{"id": "t1", "type": "data-table", "bindings": {"source": "mock://incidents"}}]}},
        ],
    }


def test_add_top_level(plugin):
    node = {"id": "s2", "type": "stat", "area": {"col": 10, "colSpan": 3, "row": 1, "rowSpan": 1},
            "props": {"label": "Total", "value": 1240}}
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "add", "target": None, "node": node}])
    assert errors == []
    assert [c["id"] for c in new["components"]] == ["s1", "c1", "s2"]


def test_add_into_container_slot(plugin):
    node = {"id": "s3", "type": "stat", "props": {"label": "New", "value": 7}}
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "add", "target": "c1", "slot": "footer", "node": node}])
    assert errors == []
    assert new["components"][1]["slots"]["footer"][0]["id"] == "s3"


def test_add_into_container_requires_slot(plugin):
    node = {"id": "s3", "type": "stat", "props": {"label": "New", "value": 7}}
    _, errors = plugin.ops.apply_ops(_doc(), [{"op": "add", "target": "c1", "node": node}])
    assert any("slot" in e for e in errors)


def test_remove_nested_node(plugin):
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "remove", "target": "t1"}])
    assert errors == []
    assert new["components"][1]["slots"]["content"] == []


def test_remove_unknown_target_errors_and_leaves_doc_untouched(plugin):
    original = _doc()
    snapshot = copy.deepcopy(original)
    new, errors = plugin.ops.apply_ops(original, [{"op": "remove", "target": "nope"}])
    assert errors and new == snapshot


def test_replace_swaps_node(plugin):
    node = {"id": "s1b", "type": "stat", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
            "props": {"label": "Low", "value": 3}}
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "replace", "target": "s1", "node": node}])
    assert errors == []
    assert new["components"][0]["id"] == "s1b"


def test_set_props_shallow_merges(plugin):
    new, errors = plugin.ops.apply_ops(_doc(), [{"op": "setProps", "target": "s1", "props": {"value": 50}}])
    assert errors == []
    assert new["components"][0]["props"] == {"label": "High", "value": 50}


def test_set_binding(plugin):
    new, errors = plugin.ops.apply_ops(
        _doc(), [{"op": "setBinding", "target": "t1", "key": "source", "value": "mock://districts"}])
    assert errors == []
    assert new["components"][1]["slots"]["content"][0]["bindings"]["source"] == "mock://districts"


def test_all_or_nothing_on_mid_batch_failure(plugin):
    original = _doc()
    snapshot = copy.deepcopy(original)
    ops = [
        {"op": "setProps", "target": "s1", "props": {"value": 99}},  # valid
        {"op": "remove", "target": "ghost"},                          # invalid → whole batch rejected
    ]
    new, errors = plugin.ops.apply_ops(original, ops)
    assert errors and new == snapshot


def test_unknown_op_rejected(plugin):
    _, errors = plugin.ops.apply_ops(_doc(), [{"op": "teleport", "target": "s1"}])
    assert any("unknown op" in e for e in errors)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/plugins/gis_canvas/test_ops.py -v`
Expected: FAIL — no module `ops`.

- [ ] **Step 3: Implement the ops engine**

```python
# plugins/gis-canvas/ops.py
"""Component-addressed patch operations over a canvas document.

All-or-nothing: ops apply to a deep copy; any error returns the ORIGINAL doc
plus the error list. Catalog/schema validation of the result happens in
tools_canvas.py after a successful apply.
"""
from __future__ import annotations

import copy

OPS = {"add", "remove", "replace", "setProps", "setBinding"}


def _iter_nodes(doc: dict):
    """Yield (node, parent_list) for every node in components/overlays trees."""
    stack = [(node, doc.setdefault("components", [])) for node in doc.get("components", [])]
    stack += [(node, doc.setdefault("overlays", [])) for node in doc.get("overlays", [])]
    while stack:
        node, parent_list = stack.pop()
        yield node, parent_list
        for kid in node.get("children", []):
            stack.append((kid, node["children"]))
        for slot_kids in node.get("slots", {}).values():
            for kid in slot_kids:
                stack.append((kid, slot_kids))


def _find(doc: dict, target: str):
    for node, parent_list in _iter_nodes(doc):
        if node.get("id") == target:
            return node, parent_list
    return None, None


def apply_ops(doc: dict, ops: list[dict]) -> tuple[dict, list[str]]:
    work = copy.deepcopy(doc)
    errors: list[str] = []

    for i, op in enumerate(ops):
        kind = op.get("op")
        target = op.get("target")
        prefix = f"ops[{i}]"
        if kind not in OPS:
            errors.append(f"{prefix}: unknown op '{kind}' (valid: {sorted(OPS)})")
            break

        if kind == "add":
            node = op.get("node")
            if not isinstance(node, dict):
                errors.append(f"{prefix}: add requires a 'node' object")
                break
            if target is None:
                work.setdefault("components", []).append(node)
            else:
                container, _ = _find(work, target)
                if container is None:
                    errors.append(f"{prefix}: target '{target}' not found")
                    break
                slot = op.get("slot")
                if not slot:
                    errors.append(f"{prefix}: add into container '{target}' requires 'slot'")
                    break
                container.setdefault("slots", {}).setdefault(slot, []).append(node)
            continue

        node, parent_list = _find(work, target or "")
        if node is None:
            errors.append(f"{prefix}: target '{target}' not found")
            break

        if kind == "remove":
            parent_list.remove(node)
            if work.get("focus") == target:
                work.pop("focus", None)
        elif kind == "replace":
            replacement = op.get("node")
            if not isinstance(replacement, dict):
                errors.append(f"{prefix}: replace requires a 'node' object")
                break
            parent_list[parent_list.index(node)] = replacement
        elif kind == "setProps":
            props = op.get("props")
            if not isinstance(props, dict):
                errors.append(f"{prefix}: setProps requires a 'props' object")
                break
            node.setdefault("props", {}).update(props)
        elif kind == "setBinding":
            key, value = op.get("key"), op.get("value")
            if not isinstance(key, str) or not isinstance(value, str):
                errors.append(f"{prefix}: setBinding requires string 'key' and 'value'")
                break
            node.setdefault("bindings", {})[key] = value

    if errors:
        return doc, errors
    return work, []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/plugins/gis_canvas/test_ops.py -v`
Expected: 10 PASSED. Also re-run Task 1: `uv run pytest tests/plugins/gis_canvas -v` → all green.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/ops.py tests/plugins/gis_canvas/test_ops.py
git commit -m "gis: add canvas ops engine (add/remove/replace/setProps/setBinding, all-or-nothing)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: CanvasStore — rev-stamped, persisted canonical doc

**Files:**
- Create: `plugins/gis-canvas/store.py`
- Test: `tests/plugins/gis_canvas/test_store.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `class CanvasStore(base_dir: str | None = None)` with `get(key: str) -> dict | None`, `put(key: str, doc: dict) -> dict` (stamps `rev` = previous rev + 1, persists, returns stored doc), `reset(key: str) -> None`. Storage dir resolution: explicit `base_dir` arg → `$HERMES_GIS_CANVAS_DIR` → `~/.hermes/gis_canvas/`. One JSON file per key: `<base>/<key>.json`. Module-level `resolve_session_key(kw: dict) -> str` returning `str(kw.get("task_id") or "default")`.

- [ ] **Step 1: Write the failing store tests**

```python
# tests/plugins/gis_canvas/test_store.py
def _doc(rev=None):
    d = {"canvasVersion": 1, "layout": {"type": "grid", "cols": 12}, "components": []}
    if rev is not None:
        d["rev"] = rev
    return d


def test_get_missing_returns_none(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    assert store.get("sess1") is None


def test_put_stamps_rev_starting_at_1(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    stored = store.put("sess1", _doc())
    assert stored["rev"] == 1
    stored2 = store.put("sess1", _doc())
    assert stored2["rev"] == 2


def test_put_ignores_client_supplied_rev(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    stored = store.put("sess1", _doc(rev=999))
    assert stored["rev"] == 1


def test_persistence_roundtrip_across_instances(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    store.put("sess1", _doc())
    fresh = plugin.store.CanvasStore(base_dir=str(tmp_path))
    loaded = fresh.get("sess1")
    assert loaded is not None and loaded["rev"] == 1


def test_keys_are_isolated(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    store.put("a", _doc())
    assert store.get("b") is None


def test_reset_removes_doc(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    store.put("sess1", _doc())
    store.reset("sess1")
    assert store.get("sess1") is None


def test_key_is_sanitized_for_filesystem(plugin, tmp_path):
    store = plugin.store.CanvasStore(base_dir=str(tmp_path))
    stored = store.put("../evil/../../key", _doc())
    assert stored["rev"] == 1  # no traversal, file lands inside base_dir
    files = list(tmp_path.iterdir())
    assert len(files) == 1 and files[0].suffix == ".json"


def test_resolve_session_key(plugin):
    assert plugin.store.resolve_session_key({"task_id": "abc123"}) == "abc123"
    assert plugin.store.resolve_session_key({}) == "default"
    assert plugin.store.resolve_session_key({"task_id": None}) == "default"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/plugins/gis_canvas/test_store.py -v`
Expected: FAIL — no module `store`.

- [ ] **Step 3: Implement the store**

```python
# plugins/gis-canvas/store.py
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
    """Derive the store key from tool-handler kwargs (Hermes passes task_id)."""
    return str(kw.get("task_id") or "default")


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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/plugins/gis_canvas/test_store.py -v`
Expected: 8 PASSED.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/store.py tests/plugins/gis_canvas/test_store.py
git commit -m "gis: add CanvasStore (rev-stamped canonical doc, JSON persistence)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Tool handlers — render_view / update_view / canvas_get_state

**Files:**
- Create: `plugins/gis-canvas/tools_canvas.py`
- Test: `tests/plugins/gis_canvas/test_tools.py`

**Interfaces:**
- Consumes: `validator.validate_doc`, `validator.DEFAULT_LAYOUT`, `ops.apply_ops`, `store.CanvasStore`, `store.resolve_session_key` (relative imports).
- Produces: handlers `render_view(args, **kw) -> str`, `update_view(args, **kw) -> str`, `canvas_get_state(args, **kw) -> str` (JSON strings); `TOOL_DEFS: list[tuple[name, schema, handler, description, emoji]]` consumed by Task 5; module-level `_store: CanvasStore` (lazily created via `get_store()` so tests can inject `HERMES_GIS_CANVAS_DIR`).
- Result envelope (success): `{"gis_canvas": true, "ok": true, "rev": N, "components_index": [{"id","type"}...], "doc": {...}}`. Failure: `{"gis_canvas": true, "ok": false, "errors": [...], "rev": N|null}`.

- [ ] **Step 1: Write the failing tool tests**

```python
# tests/plugins/gis_canvas/test_tools.py
import json

import pytest


@pytest.fixture(autouse=True)
def _isolated_store(plugin, tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_GIS_CANVAS_DIR", str(tmp_path))
    plugin.tools_canvas.reset_store_for_tests()


def _spec():
    return {
        "canvasVersion": 1,
        "layout": {"type": "grid", "cols": 12, "rowHeight": 80, "gap": 8},
        "components": [
            {"id": "s1", "type": "stat", "area": {"col": 1, "colSpan": 3, "row": 1, "rowSpan": 1},
             "props": {"label": "High", "value": 42}},
        ],
    }


def test_render_view_success_envelope(plugin):
    out = json.loads(plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1"))
    assert out["gis_canvas"] is True and out["ok"] is True
    assert out["rev"] == 1
    assert out["components_index"] == [{"id": "s1", "type": "stat"}]
    assert out["doc"]["rev"] == 1


def test_render_view_applies_layout_and_version_defaults(plugin):
    spec = _spec()
    del spec["layout"]
    del spec["canvasVersion"]
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is True
    assert out["doc"]["layout"]["cols"] == 12
    assert out["doc"]["canvasVersion"] == 1


def test_render_view_invalid_spec_returns_errors_not_render(plugin):
    spec = _spec()
    spec["components"][0]["type"] = "bogus"
    out = json.loads(plugin.tools_canvas.render_view({"spec": spec}, task_id="t1"))
    assert out["ok"] is False and out["errors"]
    # nothing stored: get_state reports no canvas
    state = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t1"))
    assert state["ok"] is False


def test_render_view_missing_spec_arg(plugin):
    out = json.loads(plugin.tools_canvas.render_view({}, task_id="t1"))
    assert out["ok"] is False and any("spec" in e for e in out["errors"])


def test_update_view_happy_path_bumps_rev(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    ops = [{"op": "setProps", "target": "s1", "props": {"value": 50}}]
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 1, "ops": ops}, task_id="t1"))
    assert out["ok"] is True and out["rev"] == 2
    assert out["doc"]["components"][0]["props"]["value"] == 50


def test_update_view_stale_rev_rejected(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    ops = [{"op": "setProps", "target": "s1", "props": {"value": 50}}]
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 0, "ops": ops}, task_id="t1"))
    assert out["ok"] is False and any("stale" in e for e in out["errors"])
    assert out["rev"] == 1  # tells the agent the current rev to retry against


def test_update_view_without_canvas_rejected(plugin):
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 1, "ops": []}, task_id="t9"))
    assert out["ok"] is False and any("no canvas" in e for e in out["errors"])


def test_update_view_result_failing_validation_is_rejected_and_not_stored(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    # removing s1's area via replace: top-level component without area → invalid
    bad = {"op": "replace", "target": "s1",
           "node": {"id": "s1", "type": "stat", "props": {"label": "High", "value": 42}}}
    out = json.loads(plugin.tools_canvas.update_view({"base_rev": 1, "ops": [bad]}, task_id="t1"))
    assert out["ok"] is False
    state = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t1"))
    assert state["rev"] == 1  # unchanged


def test_get_state_full_and_subtree(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    full = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t1"))
    assert full["ok"] is True and full["doc"]["rev"] == 1
    sub = json.loads(plugin.tools_canvas.canvas_get_state({"component_id": "s1"}, task_id="t1"))
    assert sub["ok"] is True and sub["node"]["id"] == "s1"
    missing = json.loads(plugin.tools_canvas.canvas_get_state({"component_id": "zz"}, task_id="t1"))
    assert missing["ok"] is False


def test_sessions_are_isolated_by_task_id(plugin):
    plugin.tools_canvas.render_view({"spec": _spec()}, task_id="t1")
    other = json.loads(plugin.tools_canvas.canvas_get_state({}, task_id="t2"))
    assert other["ok"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/plugins/gis_canvas/test_tools.py -v`
Expected: FAIL — no module `tools_canvas`.

- [ ] **Step 3: Implement the tool handlers**

Note the descriptions: they are the agent's *manual* — they must teach the spec format, catalog, and error-retry loop.

```python
# plugins/gis-canvas/tools_canvas.py
"""Canvas authoring tools: render_view / update_view / canvas_get_state.

Handlers return JSON strings (the Hermes tool contract). Successful results
carry the full validated doc in a {"gis_canvas": true} envelope — the frontend
recognizes canvas updates by that marker on tool.complete events.
"""
from __future__ import annotations

import copy
import json

from .ops import apply_ops
from .store import CanvasStore, resolve_session_key
from .validator import DEFAULT_LAYOUT, validate_doc

_store: CanvasStore | None = None


def get_store() -> CanvasStore:
    global _store
    if _store is None:
        _store = CanvasStore()
    return _store


def reset_store_for_tests() -> None:
    global _store
    _store = None


def _index(doc: dict) -> list[dict]:
    out: list[dict] = []

    def walk(node: dict) -> None:
        out.append({"id": node["id"], "type": node["type"]})
        for kid in node.get("children", []):
            walk(kid)
        for slot_kids in node.get("slots", {}).values():
            for kid in slot_kids:
                walk(kid)

    for comp in doc.get("components", []):
        walk(comp)
    for overlay in doc.get("overlays", []):
        walk(overlay)
    return out


def _ok(doc: dict, **extra) -> str:
    payload = {"gis_canvas": True, "ok": True, "rev": doc.get("rev"),
               "components_index": _index(doc), "doc": doc}
    payload.update(extra)
    return json.dumps(payload, ensure_ascii=False)


def _err(errors: list[str], rev: int | None = None) -> str:
    return json.dumps({"gis_canvas": True, "ok": False, "errors": errors, "rev": rev},
                      ensure_ascii=False)


def render_view(args: dict, **kw) -> str:
    spec = args.get("spec")
    if not isinstance(spec, dict):
        return _err(["'spec' (object) is required — the full canvas document"])
    doc = copy.deepcopy(spec)
    doc.setdefault("canvasVersion", 1)
    doc.setdefault("layout", dict(DEFAULT_LAYOUT))
    doc.pop("rev", None)  # server-stamped
    errors = validate_doc(doc)
    if errors:
        return _err(errors)
    stored = get_store().put(resolve_session_key(kw), doc)
    return _ok(stored)


def update_view(args: dict, **kw) -> str:
    key = resolve_session_key(kw)
    current = get_store().get(key)
    if current is None:
        return _err(["no canvas exists for this session — call render_view first"])
    base_rev = args.get("base_rev")
    if base_rev != current.get("rev"):
        return _err([f"stale base_rev {base_rev}: current rev is {current.get('rev')} — "
                     "re-read state (canvas_get_state) and retry"], rev=current.get("rev"))
    ops = args.get("ops")
    if not isinstance(ops, list):
        return _err(["'ops' (array) is required"], rev=current.get("rev"))
    patched, op_errors = apply_ops(current, ops)
    if op_errors:
        return _err(op_errors, rev=current.get("rev"))
    patched.pop("rev", None)
    errors = validate_doc(patched)
    if errors:
        return _err(errors, rev=current.get("rev"))
    stored = get_store().put(key, patched)
    return _ok(stored)


def canvas_get_state(args: dict, **kw) -> str:
    doc = get_store().get(resolve_session_key(kw))
    if doc is None:
        return _err(["no canvas exists for this session — call render_view first"])
    component_id = args.get("component_id")
    if not component_id:
        return _ok(doc)
    for entry in _iter_all_nodes(doc):
        if entry.get("id") == component_id:
            return json.dumps({"gis_canvas": True, "ok": True, "rev": doc.get("rev"),
                               "node": entry}, ensure_ascii=False)
    return _err([f"component '{component_id}' not found"], rev=doc.get("rev"))


def _iter_all_nodes(doc: dict):
    stack = list(doc.get("components", [])) + list(doc.get("overlays", []))
    while stack:
        node = stack.pop()
        yield node
        stack.extend(node.get("children", []))
        for slot_kids in node.get("slots", {}).values():
            stack.extend(slot_kids)


_CATALOG_HELP = (
    "Component catalog (Phase 1): "
    "card (container; props.title; slots 'content'/'footer') | "
    "stat (props.label, props.value, optional props.trend) | "
    "data-table (bindings.source data handle e.g. 'mock://incidents'; optional props.title, "
    "props.columns as string[]). Grid: layout.cols (default 12); every TOP-LEVEL component "
    "requires area {col,colSpan,row,rowSpan} (1-based; col+colSpan-1 must fit cols). Nesting "
    "depth max 3. NEVER inline data rows — bind data via bindings.source handles only."
)

RENDER_VIEW_SCHEMA = {
    "name": "render_view",
    "description": (
        "Create or fully replace the GIS canvas dashboard the user sees. Author a declarative "
        "spec: {canvasVersion:1, layout:{type:'grid',cols:12,rowHeight:80,gap:8}, components:[...]}. "
        + _CATALOG_HELP +
        " Returns {ok, rev, doc} on success or {ok:false, errors} — fix the errors and retry. "
        "Example component: {id:'s1', type:'stat', area:{col:1,colSpan:3,row:1,rowSpan:1}, "
        "props:{label:'High severity', value:42}}."
    ),
    "parameters": {
        "type": "object",
        "properties": {"spec": {"type": "object", "description": "Full canvas document."}},
        "required": ["spec"],
    },
}

UPDATE_VIEW_SCHEMA = {
    "name": "update_view",
    "description": (
        "Modify the existing canvas with targeted patch ops (cheaper than re-rendering). "
        "Pass base_rev = the rev from the last render_view/update_view/canvas_get_state result; "
        "a stale rev is rejected with the current rev. Ops: "
        "{op:'add', target:null|containerId, slot?:'content'|'footer', node:{...}} | "
        "{op:'remove', target:id} | {op:'replace', target:id, node:{...}} | "
        "{op:'setProps', target:id, props:{...}} (shallow merge) | "
        "{op:'setBinding', target:id, key:'source', value:'mock://...'}. " + _CATALOG_HELP
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "base_rev": {"type": "integer", "description": "Current canvas rev you are patching."},
            "ops": {"type": "array", "items": {"type": "object"}, "description": "Patch operations."},
        },
        "required": ["base_rev", "ops"],
    },
}

CANVAS_GET_STATE_SCHEMA = {
    "name": "canvas_get_state",
    "description": (
        "Read the current canvas document (or one component's subtree via component_id): "
        "returns {ok, rev, doc|node}. Use before update_view when unsure of current state/rev."
    ),
    "parameters": {
        "type": "object",
        "properties": {"component_id": {"type": "string", "description": "Optional component id."}},
        "required": [],
    },
}

TOOL_DEFS = [
    ("render_view", RENDER_VIEW_SCHEMA, render_view,
     "Author/replace the GIS canvas dashboard (declarative spec)", "🗺️"),
    ("update_view", UPDATE_VIEW_SCHEMA, update_view,
     "Patch the existing canvas (component-addressed ops)", "🧩"),
    ("canvas_get_state", CANVAS_GET_STATE_SCHEMA, canvas_get_state,
     "Read the current canvas document/state", "📋"),
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/plugins/gis_canvas/test_tools.py -v`
Expected: 10 PASSED. Full suite: `uv run pytest tests/plugins/gis_canvas -v` → all green.

- [ ] **Step 5: Commit**

```bash
git add plugins/gis-canvas/tools_canvas.py tests/plugins/gis_canvas/test_tools.py
git commit -m "gis: add canvas tools (render_view/update_view/canvas_get_state) with validation gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Plugin manifest + registration

**Files:**
- Create: `plugins/gis-canvas/plugin.yaml`
- Create: `plugins/gis-canvas/__init__.py`
- Test: `tests/plugins/gis_canvas/test_registration.py`

**Interfaces:**
- Consumes: `tools_canvas.TOOL_DEFS`.
- Produces: `register(ctx)` — the Hermes plugin entry point; calls `ctx.register_tool(name=..., toolset="gis-canvas", schema=..., handler=..., description=..., emoji=...)` once per tool.

- [ ] **Step 1: Write the failing registration test**

```python
# tests/plugins/gis_canvas/test_registration.py
import pathlib

import yaml

PLUGIN_DIR = pathlib.Path(__file__).resolve().parents[3] / "plugins" / "gis-canvas"


class FakeCtx:
    def __init__(self):
        self.tools = {}

    def register_tool(self, name, toolset, schema, handler, **kwargs):
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler, **kwargs}


def test_manifest_declares_tools_and_kind():
    manifest = yaml.safe_load((PLUGIN_DIR / "plugin.yaml").read_text())
    assert manifest["name"] == "gis-canvas"
    assert manifest["kind"] == "standalone"
    assert set(manifest["provides_tools"]) == {"render_view", "update_view", "canvas_get_state"}


def test_register_registers_three_tools(plugin):
    import sys
    pkg = sys.modules["gis_canvas_plugin"]
    _ = plugin.tools_canvas  # ensure submodule loaded before register() resolves it
    ctx = FakeCtx()
    pkg.register(ctx)
    assert set(ctx.tools) == {"render_view", "update_view", "canvas_get_state"}
    for name, entry in ctx.tools.items():
        assert entry["toolset"] == "gis-canvas"
        assert entry["schema"]["name"] == name
        assert callable(entry["handler"])
        assert entry["description"]


def test_tool_descriptions_teach_the_catalog(plugin):
    schema = plugin.tools_canvas.RENDER_VIEW_SCHEMA
    for keyword in ("card", "stat", "data-table", "area", "bindings.source"):
        assert keyword in schema["description"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/plugins/gis_canvas/test_registration.py -v`
Expected: FAIL — `plugin.yaml` missing / `register` not defined (the current `__init__.py` doesn't exist; only `README.md` is in the dir).

- [ ] **Step 3: Write manifest and entry point**

```yaml
# plugins/gis-canvas/plugin.yaml
name: gis-canvas
version: 0.1.0
description: >
  Generative GIS canvas — the agent declaratively authors a dashboard
  (grid of card/stat/data-table molecules) rendered by apps/gis-canvas.
author: gis-canvas
kind: standalone
provides_tools:
  - render_view
  - update_view
  - canvas_get_state
```

```python
# plugins/gis-canvas/__init__.py
"""Hermes plugin entry point for the GIS generative canvas (Phase 1).

Enable via ~/.hermes/config.yaml:
    plugins:
      enabled:
        - gis-canvas
"""


def register(ctx):
    from .tools_canvas import TOOL_DEFS

    for name, schema, handler, description, emoji in TOOL_DEFS:
        ctx.register_tool(
            name=name,
            toolset="gis-canvas",
            schema=schema,
            handler=handler,
            description=description,
            emoji=emoji,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/plugins/gis_canvas -v`
Expected: all tests green (whole backend suite).

- [ ] **Step 5: Sanity-check no existing tests broke**

Run: `uv run pytest tests/plugins -x -q 2>&1 | tail -5`
Expected: existing plugin tests still pass (our additions are purely additive).

- [ ] **Step 6: Commit**

```bash
git add plugins/gis-canvas/plugin.yaml plugins/gis-canvas/__init__.py tests/plugins/gis_canvas/test_registration.py
git commit -m "gis: register gis-canvas plugin (manifest + register(ctx) entry point)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend scaffold — workspace app + TS contract mirror

**Files:**
- Create: `apps/gis-canvas/package.json`, `apps/gis-canvas/vite.config.ts`, `apps/gis-canvas/tsconfig.json`, `apps/gis-canvas/index.html`
- Create: `apps/gis-canvas/src/main.tsx`, `apps/gis-canvas/src/index.css`, `apps/gis-canvas/src/test-setup.ts`, `apps/gis-canvas/src/App.tsx` (placeholder)
- Create: `apps/gis-canvas/src/lib/types.ts`
- Test: `apps/gis-canvas/src/lib/types.test.ts` (smoke)

**Interfaces:**
- Consumes: root workspace glob `"apps/*"` (auto-discovers; root package.json untouched).
- Produces: TS types used by all later frontend tasks: `CanvasDoc`, `ComponentNode`, `Area`, `CanvasEnvelope`, `MOLECULE_TYPES`. Build/test commands: `npm run -w @hermes/gis-canvas build|test|typecheck`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@hermes/gis-canvas",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p . --noEmit && vite build",
    "typecheck": "tsc -p . --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@hermes/shared": "*",
    "@tanstack/react-table": "^8.21.3",
    "react": "^19.2.5",
    "react-dom": "^19.2.5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.2.4",
    "@testing-library/jest-dom": "^6.9.0",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.0.1",
    "jsdom": "^29.1.1",
    "tailwindcss": "^4.2.4",
    "typescript": "^6.0.3",
    "vite": "^8.0.10",
    "vitest": "^4.1.5"
  }
}
```

- [ ] **Step 2: Create vite/tsconfig/html/entry files**

```ts
// apps/gis-canvas/vite.config.ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts']
  }
})
```

```ts
// apps/gis-canvas/src/test-setup.ts
// Registers jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...) with vitest.
import '@testing-library/jest-dom/vitest'
```

```json
// apps/gis-canvas/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

```html
<!-- apps/gis-canvas/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hermes GIS Canvas</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```css
/* apps/gis-canvas/src/index.css */
@import "tailwindcss";
```

```tsx
// apps/gis-canvas/src/main.tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

```tsx
// apps/gis-canvas/src/App.tsx  (placeholder — replaced in Task 9)
export default function App() {
  return <div className="p-4 font-sans">Hermes GIS Canvas — skeleton</div>
}
```

- [ ] **Step 3: Write the TS contract mirror + smoke test**

```ts
// apps/gis-canvas/src/lib/types.ts
/**
 * TypeScript mirror of plugins/gis-canvas/schema/canvas.schema.json (v1).
 * Keep in sync when the schema changes.
 */
export const MOLECULE_TYPES = ['card', 'stat', 'data-table'] as const
export type MoleculeType = (typeof MOLECULE_TYPES)[number]

export interface Area {
  col: number
  colSpan: number
  row: number
  rowSpan: number
}

export interface ComponentNode {
  id: string
  type: MoleculeType | (string & {}) // tolerate future types; renderer falls back to UnknownTile
  area?: Area
  props?: Record<string, unknown>
  bindings?: Record<string, string>
  state?: Record<string, unknown>
  children?: ComponentNode[]
  slots?: Record<string, ComponentNode[]>
}

export interface GridLayout {
  type: 'grid'
  cols: number
  rowHeight?: number
  gap?: number
}

export interface CanvasDoc {
  canvasVersion: 1
  rev: number
  layout: GridLayout
  components: ComponentNode[]
  overlays?: ComponentNode[]
  focus?: string
}

/** Envelope carried in canvas tool results (see plugins/gis-canvas/tools_canvas.py). */
export interface CanvasEnvelope {
  gis_canvas: true
  ok: boolean
  rev: number | null
  doc?: CanvasDoc
  node?: ComponentNode
  errors?: string[]
  components_index?: Array<{ id: string; type: string }>
}
```

```ts
// apps/gis-canvas/src/lib/types.test.ts
import { MOLECULE_TYPES } from './types'
import type { CanvasDoc } from './types'

test('phase-1 catalog matches the backend', () => {
  expect([...MOLECULE_TYPES]).toEqual(['card', 'stat', 'data-table'])
})

test('a canonical doc typechecks', () => {
  const doc: CanvasDoc = {
    canvasVersion: 1,
    rev: 1,
    layout: { type: 'grid', cols: 12, rowHeight: 80, gap: 8 },
    components: [
      { id: 's1', type: 'stat', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 }, props: { label: 'High', value: 42 } }
    ]
  }
  expect(doc.rev).toBe(1)
})
```

- [ ] **Step 4: Install workspace deps and verify build + test**

Run (from repo root): `npm install`
Expected: succeeds; `apps/gis-canvas` linked into the workspace; root `package-lock.json` updated (expected, generated file).

Run: `npm run -w @hermes/gis-canvas test`
Expected: 2 PASSED.

Run: `npm run -w @hermes/gis-canvas build`
Expected: typecheck + vite build succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas package-lock.json
git commit -m "gis: scaffold gis-canvas frontend workspace app + TS canvas contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Envelope extraction + mock data plane

**Files:**
- Create: `apps/gis-canvas/src/lib/extract.ts`, `apps/gis-canvas/src/lib/mock-data.ts`
- Test: `apps/gis-canvas/src/lib/extract.test.ts`, `apps/gis-canvas/src/lib/mock-data.test.ts`

**Interfaces:**
- Consumes: `CanvasEnvelope`, `CanvasDoc` from `./types`.
- Produces: `extractCanvasEnvelope(event: { type?: string; payload?: unknown }): CanvasEnvelope | null`; `resolveMockSource(handle: string): MockSource | null` where `MockSource = { schema: Array<{name: string; type: 'string'|'number'}>, rows: Array<Record<string, string | number>> }`. Mock handles: `mock://incidents` (8 rows: id, severity, district, reported_at), `mock://districts` (4 rows: district, population).

- [ ] **Step 1: Write the failing extraction tests**

The wire field carrying the tool result inside `tool.complete` payloads is not pinned by `@hermes/shared` types, so the extractor is field-name agnostic: it checks the payload object itself, then every direct value of it, parsing strings as JSON, and accepts whatever carries `gis_canvas: true`.

```ts
// apps/gis-canvas/src/lib/extract.test.ts
import { extractCanvasEnvelope } from './extract'

const doc = {
  canvasVersion: 1, rev: 1,
  layout: { type: 'grid', cols: 12 },
  components: [{ id: 's1', type: 'stat', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 }, props: { label: 'H', value: 1 } }]
}
const envelope = { gis_canvas: true, ok: true, rev: 1, doc }

test('extracts envelope from a JSON-string payload field', () => {
  const event = { type: 'tool.complete', payload: { name: 'render_view', result: JSON.stringify(envelope) } }
  expect(extractCanvasEnvelope(event)?.doc?.rev).toBe(1)
})

test('extracts envelope from an object payload field', () => {
  const event = { type: 'tool.complete', payload: { output: envelope } }
  expect(extractCanvasEnvelope(event)?.ok).toBe(true)
})

test('extracts envelope when the payload itself is the envelope', () => {
  const event = { type: 'tool.complete', payload: envelope }
  expect(extractCanvasEnvelope(event)?.rev).toBe(1)
})

test('extracts error envelopes (ok:false)', () => {
  const errEnv = { gis_canvas: true, ok: false, rev: null, errors: ['bad spec'] }
  const event = { type: 'tool.complete', payload: { result: JSON.stringify(errEnv) } }
  expect(extractCanvasEnvelope(event)?.errors).toEqual(['bad spec'])
})

test('ignores non-canvas tool results', () => {
  const event = { type: 'tool.complete', payload: { result: '{"success": true}' } }
  expect(extractCanvasEnvelope(event)).toBeNull()
})

test('ignores other event types even if payload matches', () => {
  const event = { type: 'message.delta', payload: envelope }
  expect(extractCanvasEnvelope(event)).toBeNull()
})

test('tolerates malformed JSON strings', () => {
  const event = { type: 'tool.complete', payload: { result: '{not json' } }
  expect(extractCanvasEnvelope(event)).toBeNull()
})
```

```ts
// apps/gis-canvas/src/lib/mock-data.test.ts
import { resolveMockSource } from './mock-data'

test('resolves mock://incidents with schema and rows', () => {
  const src = resolveMockSource('mock://incidents')
  expect(src).not.toBeNull()
  expect(src!.schema.map(f => f.name)).toEqual(['id', 'severity', 'district', 'reported_at'])
  expect(src!.rows.length).toBeGreaterThanOrEqual(8)
})

test('unknown handle returns null', () => {
  expect(resolveMockSource('mock://nope')).toBeNull()
  expect(resolveMockSource('data://q1')).toBeNull()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run -w @hermes/gis-canvas test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement extract + mock data**

```ts
// apps/gis-canvas/src/lib/extract.ts
import type { CanvasEnvelope } from './types'

function asEnvelope(value: unknown): CanvasEnvelope | null {
  if (value && typeof value === 'object' && (value as Record<string, unknown>).gis_canvas === true) {
    return value as CanvasEnvelope
  }
  return null
}

function parseCandidate(value: unknown): CanvasEnvelope | null {
  if (typeof value === 'string') {
    try {
      return asEnvelope(JSON.parse(value))
    } catch {
      return null
    }
  }
  return asEnvelope(value)
}

/**
 * Recognize canvas tool results on tool.complete events by the gis_canvas
 * marker — field-name agnostic (checks the payload and each direct value).
 */
export function extractCanvasEnvelope(event: { type?: string; payload?: unknown }): CanvasEnvelope | null {
  if (event?.type !== 'tool.complete') return null
  const payload = event.payload
  if (!payload || typeof payload !== 'object') return null
  const direct = asEnvelope(payload)
  if (direct) return direct
  for (const value of Object.values(payload as Record<string, unknown>)) {
    const env = parseCandidate(value)
    if (env) return env
  }
  return null
}
```

```ts
// apps/gis-canvas/src/lib/mock-data.ts
/** Phase-1 stand-in for the data plane: mock:// handles resolved client-side. */
export interface MockField { name: string; type: 'string' | 'number' }
export interface MockSource { schema: MockField[]; rows: Array<Record<string, string | number>> }

const SOURCES: Record<string, MockSource> = {
  'mock://incidents': {
    schema: [
      { name: 'id', type: 'string' },
      { name: 'severity', type: 'string' },
      { name: 'district', type: 'string' },
      { name: 'reported_at', type: 'string' }
    ],
    rows: [
      { id: 'f_82', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T09:14Z' },
      { id: 'f_91', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T08:47Z' },
      { id: 'f_63', severity: 'med', district: 'Riverside', reported_at: '2026-07-01T08:02Z' },
      { id: 'f_57', severity: 'high', district: 'Downtown', reported_at: '2026-07-01T07:51Z' },
      { id: 'f_44', severity: 'low', district: 'Midtown', reported_at: '2026-07-01T07:20Z' },
      { id: 'f_31', severity: 'med', district: 'Midtown', reported_at: '2026-07-01T06:58Z' },
      { id: 'f_29', severity: 'high', district: 'Riverside', reported_at: '2026-07-01T06:31Z' },
      { id: 'f_18', severity: 'low', district: 'Downtown', reported_at: '2026-07-01T06:05Z' }
    ]
  },
  'mock://districts': {
    schema: [
      { name: 'district', type: 'string' },
      { name: 'population', type: 'number' }
    ],
    rows: [
      { district: 'Downtown', population: 51200 },
      { district: 'Riverside', population: 23800 },
      { district: 'Midtown', population: 33400 },
      { district: 'Harbor', population: 12100 }
    ]
  }
}

export function resolveMockSource(handle: string): MockSource | null {
  return SOURCES[handle] ?? null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run -w @hermes/gis-canvas test`
Expected: all PASSED (types + extract + mock-data).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/lib
git commit -m "gis: add canvas envelope extraction + mock data plane

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Renderer — registry, CanvasGrid, molecules

**Files:**
- Create: `apps/gis-canvas/src/components/registry.tsx`, `apps/gis-canvas/src/components/CanvasGrid.tsx`
- Create: `apps/gis-canvas/src/components/molecules/CardMolecule.tsx`, `StatMolecule.tsx`, `DataTableMolecule.tsx`
- Test: `apps/gis-canvas/src/components/CanvasGrid.test.tsx`

**Interfaces:**
- Consumes: `CanvasDoc`, `ComponentNode` from `../lib/types`; `resolveMockSource` from `../lib/mock-data`.
- Produces: `MoleculeProps = { node: ComponentNode; renderChild: (n: ComponentNode) => React.ReactNode }`; `COMPONENT_REGISTRY: Record<string, React.ComponentType<MoleculeProps>>`; `<CanvasGrid doc={CanvasDoc} />`. Unknown types render a fallback tile (`data-testid="unknown-tile"`), never crash.

- [ ] **Step 1: Write the failing renderer tests**

```tsx
// apps/gis-canvas/src/components/CanvasGrid.test.tsx
import { render, screen } from '@testing-library/react'
import { CanvasGrid } from './CanvasGrid'
import type { CanvasDoc } from '../lib/types'

function doc(): CanvasDoc {
  return {
    canvasVersion: 1,
    rev: 1,
    layout: { type: 'grid', cols: 12, rowHeight: 80, gap: 8 },
    components: [
      {
        id: 's1', type: 'stat',
        area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
        props: { label: 'High severity', value: 42 }
      },
      {
        id: 'c1', type: 'card',
        area: { col: 4, colSpan: 8, row: 1, rowSpan: 3 },
        props: { title: 'Incidents' },
        slots: {
          content: [{ id: 't1', type: 'data-table', bindings: { source: 'mock://incidents' } }],
          footer: [{ id: 's2', type: 'stat', props: { label: 'Total', value: 8 } }]
        }
      }
    ]
  }
}

test('renders stat molecule with label and value', () => {
  render(<CanvasGrid doc={doc()} />)
  expect(screen.getByText('High severity')).toBeInTheDocument()
  expect(screen.getByText('42')).toBeInTheDocument()
})

test('renders card with title and nested slot children', () => {
  render(<CanvasGrid doc={doc()} />)
  expect(screen.getByText('Incidents')).toBeInTheDocument()
  expect(screen.getByText('Total')).toBeInTheDocument() // footer slot child
})

test('data-table renders rows from mock source', () => {
  render(<CanvasGrid doc={doc()} />)
  expect(screen.getByText('f_82')).toBeInTheDocument()
  expect(screen.getAllByText('Downtown').length).toBeGreaterThanOrEqual(3)
})

test('data-table respects props.columns subset', () => {
  const d = doc()
  const table = d.components[1].slots!.content[0]
  table.props = { columns: ['id', 'severity'] }
  render(<CanvasGrid doc={d} />)
  expect(screen.getByText('f_82')).toBeInTheDocument()
  expect(screen.queryByText('Downtown')).not.toBeInTheDocument()
})

test('unknown component type renders fallback tile, not a crash', () => {
  const d = doc()
  d.components.push({
    id: 'x1', type: 'esri:map',
    area: { col: 1, colSpan: 3, row: 2, rowSpan: 2 }
  })
  render(<CanvasGrid doc={d} />)
  expect(screen.getByTestId('unknown-tile')).toHaveTextContent('esri:map')
})

test('top-level placement maps to grid CSS', () => {
  render(<CanvasGrid doc={doc()} />)
  const cell = screen.getByTestId('cell-s1')
  expect(cell.style.gridColumn).toBe('1 / span 3')
  expect(cell.style.gridRow).toBe('1 / span 1')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run -w @hermes/gis-canvas test`
Expected: FAIL — components not found.

- [ ] **Step 3: Implement molecules, registry, grid**

```tsx
// apps/gis-canvas/src/components/molecules/StatMolecule.tsx
import type { MoleculeProps } from '../registry'

export function StatMolecule({ node }: MoleculeProps) {
  const { label, value, trend } = (node.props ?? {}) as { label?: string; value?: unknown; trend?: string }
  return (
    <div className="flex h-full flex-col justify-center rounded-lg border border-neutral-200 bg-white p-3">
      <span className="text-2xl font-bold">{String(value ?? '—')}</span>
      <span className="text-xs uppercase tracking-wide text-neutral-500">{label ?? node.id}</span>
      {trend ? <span className="text-xs text-neutral-400">{trend}</span> : null}
    </div>
  )
}
```

```tsx
// apps/gis-canvas/src/components/molecules/CardMolecule.tsx
import type { MoleculeProps } from '../registry'

export function CardMolecule({ node, renderChild }: MoleculeProps) {
  const { title } = (node.props ?? {}) as { title?: string }
  const slots = node.slots ?? {}
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {title ? <div className="border-b border-neutral-200 px-3 py-2 text-sm font-semibold">{title}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto p-3">{(slots.content ?? []).map(renderChild)}</div>
      {slots.footer?.length ? (
        <div className="border-t border-neutral-200 px-3 py-2">{slots.footer.map(renderChild)}</div>
      ) : null}
    </div>
  )
}
```

```tsx
// apps/gis-canvas/src/components/molecules/DataTableMolecule.tsx
import { useMemo, useState } from 'react'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState
} from '@tanstack/react-table'
import { resolveMockSource } from '../../lib/mock-data'
import type { MoleculeProps } from '../registry'

type Row = Record<string, string | number>
const helper = createColumnHelper<Row>()

export function DataTableMolecule({ node }: MoleculeProps) {
  const source = node.bindings?.source ?? ''
  const data = resolveMockSource(source)
  const wanted = (node.props?.columns as string[] | undefined) ?? null
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo(() => {
    const fields = (data?.schema ?? []).filter(f => !wanted || wanted.includes(f.name))
    return fields.map(f => helper.accessor(row => row[f.name], { id: f.name, header: f.name }))
  }, [data, wanted])

  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel()
  })

  if (!data) {
    return <div className="p-2 text-sm text-red-600">Unknown data source: {source || '(none)'}</div>
  }

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id}>
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
        {table.getRowModel().rows.map(row => (
          <tr key={row.id}>
            {row.getVisibleCells().map(cell => (
              <td key={cell.id} className="border-b border-neutral-100 px-2 py-1">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

```tsx
// apps/gis-canvas/src/components/registry.tsx
import type { ComponentType, ReactNode } from 'react'
import type { ComponentNode } from '../lib/types'
import { CardMolecule } from './molecules/CardMolecule'
import { StatMolecule } from './molecules/StatMolecule'
import { DataTableMolecule } from './molecules/DataTableMolecule'

export interface MoleculeProps {
  node: ComponentNode
  renderChild: (node: ComponentNode) => ReactNode
}

export const COMPONENT_REGISTRY: Record<string, ComponentType<MoleculeProps>> = {
  card: CardMolecule,
  stat: StatMolecule,
  'data-table': DataTableMolecule
}

export function UnknownTile({ node }: MoleculeProps) {
  return (
    <div
      data-testid="unknown-tile"
      className="flex h-full items-center justify-center rounded-lg border border-dashed border-neutral-300 p-2 text-xs text-neutral-500"
    >
      unsupported component: {node.type} ({node.id})
    </div>
  )
}
```

```tsx
// apps/gis-canvas/src/components/CanvasGrid.tsx
import type { ReactNode } from 'react'
import type { CanvasDoc, ComponentNode } from '../lib/types'
import { COMPONENT_REGISTRY, UnknownTile } from './registry'

function renderNode(node: ComponentNode): ReactNode {
  const Molecule = COMPONENT_REGISTRY[node.type] ?? UnknownTile
  return <Molecule key={node.id} node={node} renderChild={renderNode} />
}

export function CanvasGrid({ doc }: { doc: CanvasDoc }) {
  const { cols, rowHeight = 80, gap = 8 } = doc.layout
  return (
    <div
      className="w-full"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: `${rowHeight}px`,
        gap: `${gap}px`
      }}
    >
      {doc.components.map(node => {
        const area = node.area ?? { col: 1, colSpan: cols, row: 1, rowSpan: 1 }
        return (
          <div
            key={node.id}
            data-testid={`cell-${node.id}`}
            style={{
              gridColumn: `${area.col} / span ${area.colSpan}`,
              gridRow: `${area.row} / span ${area.rowSpan}`,
              minHeight: 0
            }}
          >
            {renderNode(node)}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run -w @hermes/gis-canvas test`
Expected: all PASSED (6 new renderer tests + earlier suites).

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src/components
git commit -m "gis: add canvas renderer (registry, grid, card/stat/data-table molecules)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Gateway wiring — useCanvasDoc, Chat, App

**Files:**
- Create: `apps/gis-canvas/src/lib/use-canvas-doc.ts`, `apps/gis-canvas/src/lib/gateway.ts`
- Create: `apps/gis-canvas/src/components/Chat.tsx`
- Modify: `apps/gis-canvas/src/App.tsx` (replace placeholder)
- Test: `apps/gis-canvas/src/lib/use-canvas-doc.test.tsx`, `apps/gis-canvas/src/lib/gateway.test.ts`

**Interfaces:**
- Consumes: `JsonRpcGatewayClient` from `@hermes/shared` (`connect(wsUrl)`, `request(method, params)`, `on(type, handler)`, `onAny(handler)`); `extractCanvasEnvelope` (Task 7); `CanvasGrid` (Task 8). RPC: `session.create` `{cols: 96}` → response containing `session_id`; `prompt.submit` `{session_id, text}`.
- Produces: `useCanvasDoc(client: CanvasEventSource): { doc: CanvasDoc | null; errors: string[] }` where `CanvasEventSource = { on(type: string, handler: (event: { type?: string; payload?: unknown }) => void): unknown }`; `resolveWsUrl(env: Record<string, string | undefined>): string`.

- [ ] **Step 1: Write the failing hook + URL tests**

```tsx
// apps/gis-canvas/src/lib/use-canvas-doc.test.tsx
import { act, renderHook } from '@testing-library/react'
import { useCanvasDoc } from './use-canvas-doc'

type Handler = (event: { type?: string; payload?: unknown }) => void

function fakeClient() {
  const handlers = new Map<string, Handler[]>()
  return {
    on(type: string, handler: Handler) {
      handlers.set(type, [...(handlers.get(type) ?? []), handler])
      return () => undefined
    },
    emit(type: string, event: { type?: string; payload?: unknown }) {
      for (const h of handlers.get(type) ?? []) h(event)
    }
  }
}

const doc = {
  canvasVersion: 1, rev: 1,
  layout: { type: 'grid', cols: 12 },
  components: [{ id: 's1', type: 'stat', area: { col: 1, colSpan: 3, row: 1, rowSpan: 1 }, props: { label: 'H', value: 1 } }]
}

test('updates doc when a canvas envelope arrives on tool.complete', () => {
  const client = fakeClient()
  const { result } = renderHook(() => useCanvasDoc(client))
  expect(result.current.doc).toBeNull()
  act(() => {
    client.emit('tool.complete', {
      type: 'tool.complete',
      payload: { result: JSON.stringify({ gis_canvas: true, ok: true, rev: 1, doc }) }
    })
  })
  expect(result.current.doc?.rev).toBe(1)
  expect(result.current.errors).toEqual([])
})

test('surfaces errors from ok:false envelopes without clearing the doc', () => {
  const client = fakeClient()
  const { result } = renderHook(() => useCanvasDoc(client))
  act(() => {
    client.emit('tool.complete', {
      type: 'tool.complete',
      payload: { result: JSON.stringify({ gis_canvas: true, ok: true, rev: 1, doc }) }
    })
    client.emit('tool.complete', {
      type: 'tool.complete',
      payload: { result: JSON.stringify({ gis_canvas: true, ok: false, rev: 1, errors: ['stale base_rev'] }) }
    })
  })
  expect(result.current.doc?.rev).toBe(1) // still rendered
  expect(result.current.errors).toEqual(['stale base_rev'])
})

test('ignores unrelated tool results', () => {
  const client = fakeClient()
  const { result } = renderHook(() => useCanvasDoc(client))
  act(() => {
    client.emit('tool.complete', { type: 'tool.complete', payload: { result: '{"success":true}' } })
  })
  expect(result.current.doc).toBeNull()
})
```

```ts
// apps/gis-canvas/src/lib/gateway.test.ts
import { resolveWsUrl } from './gateway'

test('explicit full URL wins', () => {
  expect(resolveWsUrl({ VITE_HERMES_WS_URL: 'ws://x:1/api/ws?token=t' })).toBe('ws://x:1/api/ws?token=t')
})

test('token + default host compose a loopback URL', () => {
  expect(resolveWsUrl({ VITE_HERMES_TOKEN: 'abc' })).toBe('ws://127.0.0.1:9119/api/ws?token=abc')
})

test('missing config throws a helpful error', () => {
  expect(() => resolveWsUrl({})).toThrow(/VITE_HERMES_WS_URL/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run -w @hermes/gis-canvas test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement hook, gateway helper, Chat, App**

```ts
// apps/gis-canvas/src/lib/use-canvas-doc.ts
import { useEffect, useState } from 'react'
import { extractCanvasEnvelope } from './extract'
import type { CanvasDoc } from './types'

export interface CanvasEventSource {
  on(type: string, handler: (event: { type?: string; payload?: unknown }) => void): unknown
}

export function useCanvasDoc(client: CanvasEventSource): { doc: CanvasDoc | null; errors: string[] } {
  const [doc, setDoc] = useState<CanvasDoc | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    const off = client.on('tool.complete', event => {
      const env = extractCanvasEnvelope(event)
      if (!env) return
      if (env.ok && env.doc) {
        setDoc(env.doc)
        setErrors([])
      } else if (!env.ok) {
        setErrors(env.errors ?? ['canvas update failed'])
      }
    })
    return () => {
      if (typeof off === 'function') off()
    }
  }, [client])

  return { doc, errors }
}
```

```ts
// apps/gis-canvas/src/lib/gateway.ts
import { JsonRpcGatewayClient } from '@hermes/shared'

/**
 * Dev connection config:
 *   VITE_HERMES_WS_URL  full URL, e.g. ws://127.0.0.1:9119/api/ws?token=dev-gis-local
 *   VITE_HERMES_TOKEN   just the token (host defaults to ws://127.0.0.1:9119/api/ws)
 */
export function resolveWsUrl(env: Record<string, string | undefined>): string {
  if (env.VITE_HERMES_WS_URL) return env.VITE_HERMES_WS_URL
  if (env.VITE_HERMES_TOKEN) return `ws://127.0.0.1:9119/api/ws?token=${env.VITE_HERMES_TOKEN}`
  throw new Error(
    'Set VITE_HERMES_WS_URL (full ws URL incl. ?token=) or VITE_HERMES_TOKEN. ' +
      'Start the backend with: HERMES_DASHBOARD_SESSION_TOKEN=<token> hermes dashboard --no-open --port 9119'
  )
}

export function createGatewayClient(): JsonRpcGatewayClient {
  return new JsonRpcGatewayClient()
}
```

```tsx
// apps/gis-canvas/src/components/Chat.tsx
import { useState } from 'react'

export interface ActivityItem { id: number; kind: string; text: string }

export function Chat({
  activity,
  errors,
  onSend,
  connected
}: {
  activity: ActivityItem[]
  errors: string[]
  onSend: (text: string) => void
  connected: boolean
}) {
  const [text, setText] = useState('')
  const submit = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }
  return (
    <div className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50">
      <div className="border-b border-neutral-200 px-3 py-2 text-sm font-semibold">
        Agent {connected ? '● connected' : '○ connecting…'}
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-auto p-3 text-xs">
        {activity.map(item => (
          <div key={item.id}>
            <span className="font-mono text-neutral-400">[{item.kind}]</span> {item.text}
          </div>
        ))}
        {errors.map((e, i) => (
          <div key={`err-${i}`} className="text-red-600">canvas error: {e}</div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-neutral-200 p-2">
        <input
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-sm"
          value={text}
          placeholder="Ask the agent to build a dashboard…"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        <button className="rounded bg-blue-600 px-3 py-1 text-sm text-white" onClick={submit} disabled={!connected}>
          Send
        </button>
      </div>
    </div>
  )
}
```

```tsx
// apps/gis-canvas/src/App.tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { CanvasGrid } from './components/CanvasGrid'
import { Chat, type ActivityItem } from './components/Chat'
import { createGatewayClient, resolveWsUrl } from './lib/gateway'
import { useCanvasDoc } from './lib/use-canvas-doc'

const LOGGED_EVENTS = new Set(['message.delta', 'message.complete', 'tool.start', 'tool.complete', 'error'])

export default function App() {
  const client = useMemo(() => createGatewayClient(), [])
  const { doc, errors } = useCanvasDoc(client)
  const [connected, setConnected] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const sessionIdRef = useRef<string | null>(null)
  const nextId = useRef(0)

  const log = (kind: string, text: string) =>
    setActivity(prev => [...prev.slice(-199), { id: nextId.current++, kind, text }])

  useEffect(() => {
    let cancelled = false
    const off = client.onAny((event: { type?: string; payload?: unknown }) => {
      const type = event?.type ?? ''
      if (!LOGGED_EVENTS.has(type)) return
      const payload = event.payload as Record<string, unknown> | undefined
      const summary =
        typeof payload?.text === 'string'
          ? payload.text
          : typeof payload?.name === 'string'
            ? String(payload.name)
            : JSON.stringify(payload ?? {}).slice(0, 160)
      log(type, summary)
    })
    ;(async () => {
      try {
        await client.connect(resolveWsUrl(import.meta.env as Record<string, string | undefined>))
        const created = (await client.request('session.create', { cols: 96 })) as { session_id: string }
        if (cancelled) return
        sessionIdRef.current = created.session_id
        setConnected(true)
        log('system', `session ${created.session_id} ready`)
      } catch (err) {
        log('error', err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      if (typeof off === 'function') off()
    }
  }, [client])

  const send = async (text: string) => {
    if (!sessionIdRef.current) return
    log('you', text)
    try {
      await client.request('prompt.submit', { session_id: sessionIdRef.current, text })
    } catch (err) {
      log('error', err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="grid h-screen grid-cols-[1fr_360px] font-sans">
      <main className="overflow-auto bg-neutral-100 p-4">
        {doc ? (
          <CanvasGrid doc={doc} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-400">
            No canvas yet — ask the agent to build a dashboard.
          </div>
        )}
      </main>
      <Chat activity={activity} errors={errors} onSend={send} connected={connected} />
    </div>
  )
}
```

- [ ] **Step 4: Run tests, typecheck, build**

Run: `npm run -w @hermes/gis-canvas test`
Expected: all PASSED.

Run: `npm run -w @hermes/gis-canvas build`
Expected: succeeds. (If `@hermes/shared`'s raw-TS export trips the build, add `optimizeDeps.include`/`resolve.alias` is NOT the fix — mirror how `web/vite.config.ts` consumes `@hermes/shared` and copy that configuration exactly.)

- [ ] **Step 5: Commit**

```bash
git add apps/gis-canvas/src
git commit -m "gis: wire gateway (session, prompt, tool.complete -> canvas doc) + minimal chat

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: End-to-end demo, docs, wrap-up

**Files:**
- Modify: `apps/gis-canvas/README.md`, `plugins/gis-canvas/README.md` (status + run instructions)
- No code changes expected (fixes discovered here belong to the task that owns the file)

- [ ] **Step 1: Enable the plugin (user config, not repo)**

Add to `~/.hermes/config.yaml` (create the keys if absent — do NOT remove existing entries):

```yaml
plugins:
  enabled:
    - gis-canvas
```

Run: `hermes plugins list`
Expected: `gis-canvas` listed as enabled/loaded. If missing: confirm the repo checkout is the active Hermes install (`hermes --version`, `which hermes`) — plugin discovery scans this repo's `plugins/` only when running from this checkout (bundled source); otherwise symlink `ln -s <repo>/plugins/gis-canvas ~/.hermes/plugins/gis-canvas`.

- [ ] **Step 2: Start the backend with a pinned dev token**

Run: `HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119`
Expected: web server up on port 9119.

- [ ] **Step 3: Start the frontend**

Run: `cd apps/gis-canvas && VITE_HERMES_TOKEN=dev-gis-local npm run dev`
Open: `http://localhost:5173`
Expected: "Agent ● connected" in the chat header (session created).

- [ ] **Step 4: Drive the demo**

Send: `Create a dashboard: a stat showing the number of high-severity incidents (42), a stat for total incidents (1240), and a card titled "Incidents" containing a data-table bound to mock://incidents showing id, severity and district.`

Expected:
- Activity log shows `tool.start` → `render_view` → `tool.complete`.
- Canvas renders two stats + the card with a sortable table of the 8 mock rows.

Then send: `Change the high-severity stat to 57.`
Expected: agent calls `update_view` with `setProps`; the stat re-renders showing 57; rev increments (verify via a follow-up prompt: `What is on the canvas right now?` → agent calls `canvas_get_state`).

Troubleshooting (check in this order):
1. Tools not offered to the agent → `hermes plugins list` shows gis-canvas? Toolset filtering: check that the session's enabled toolsets don't exclude `gis-canvas` (config `toolsets` keys / `hermes toolsets` if available).
2. Canvas never renders but tool.complete appears in the log → inspect the event payload in browser devtools; if the result string is nested deeper than one level, extend `extractCanvasEnvelope` (Task 7 owns it, add a failing test first with the real payload shape).
3. WS fails to connect → token mismatch; confirm the dashboard was started with `HERMES_DASHBOARD_SESSION_TOKEN` and the URL is `ws://127.0.0.1:9119/api/ws?token=dev-gis-local`.

- [ ] **Step 5: Update the two READMEs**

In both `apps/gis-canvas/README.md` and `plugins/gis-canvas/README.md`, replace the line
`Status: **scaffold only.** …` with:

```markdown
Status: **Phase 1 (skeleton canvas) implemented.** Spec:
`apps/gis-canvas/docs/2026-07-02-gis-hermes-canvas-design.md` · Plan:
`apps/gis-canvas/docs/plans/2026-07-02-phase1-skeleton-canvas.md`

Run it: `HERMES_DASHBOARD_SESSION_TOKEN=dev-gis-local hermes dashboard --no-open --port 9119`,
then `cd apps/gis-canvas && VITE_HERMES_TOKEN=dev-gis-local npm run dev` → http://localhost:5173.
Enable the plugin first: add `gis-canvas` to `plugins.enabled` in `~/.hermes/config.yaml`.
Backend tests: `uv run pytest tests/plugins/gis_canvas`. Frontend: `npm run -w @hermes/gis-canvas test`.
```

- [ ] **Step 6: Full verification pass**

Run: `uv run pytest tests/plugins/gis_canvas -v` → all green.
Run: `npm run -w @hermes/gis-canvas test && npm run -w @hermes/gis-canvas build` → all green.

- [ ] **Step 7: Commit and push**

```bash
git add apps/gis-canvas/README.md plugins/gis-canvas/README.md
git commit -m "gis: Phase 1 complete — e2e demo verified, run instructions documented

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin gis/main
```

---

## Out of scope for Phase 1 (later plans)

- Inbound `canvas.interaction` + reactive handlers + hybrid awareness summary (Phase 2 — includes verifying whether `pre_gateway_dispatch` can short-circuit).
- ESRI map/feature-table molecules, Calcite↔shadcn theming, shadcn/ui proper + `ui-ux-pro-max` styling pass (Phase 3).
- Data broker, `DataSource`/`DataHandle`, `canvas.data_fetch`, A2A adapter (Phase 4).
- Full catalog, overlays rendering, reconnect/rehydration + headless-render tests (Phase 5).
