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
    "select": {
        "container": False,
        "slots": set(),
        "required_props": ["field", "options"],
        "required_bindings": [],
    },
    "tabs": {
        "container": True,
        "slots": set(),          # dynamic: one slot per props.tabs id (see dynamic_slots)
        "dynamic_slots": True,
        "required_props": ["tabs"],
        "required_bindings": [],
    },
    "esri:map": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": ["layers"],
    },
    "esri:legend": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": [],
    },
    "esri:layer-list": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": [],
    },
    "esri:feature-table": {
        "container": False, "slots": set(),
        "required_props": [], "required_bindings": ["layer"],
    },
}

# Allowed keys inside each component type's user-owned `state` object.
# Used to validate inbound interactions (interaction.py).
STATE_KEYS: dict[str, set[str]] = {
    "card": set(),
    "stat": set(),
    "data-table": {"rowSelection", "sort", "columnFilters", "columnVisibility", "page", "filter"},
    "select": {"value"},
    "tabs": {"active"},
    "esri:map": {"selection", "extent"},
    "esri:legend": set(),
    "esri:layer-list": set(),
    "esri:feature-table": {"selection"},
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
            layer = node.get("layer")
            if layer == "base":
                pass  # base: full-bleed, needs neither area nor anchor
            elif layer == "dock":
                if not node.get("edge"):
                    errors.append(f"'{node_id}': dock component requires edge")
            elif layer == "float":
                if not node.get("anchor"):
                    errors.append(f"'{node_id}': float component requires anchor")
            else:
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
        tab_ids = None
        if entry.get("dynamic_slots"):
            raw_tabs = props.get("tabs")
            tab_ids = {t.get("id") for t in (raw_tabs if isinstance(raw_tabs, list) else []) if isinstance(t, dict)}
        for slot_name, slot_kids in slots.items():
            if entry["container"]:
                if entry.get("dynamic_slots"):
                    if slot_name not in tab_ids:
                        errors.append(
                            f"'{node_id}' ({node_type}): slot '{slot_name}' has no matching tab in props.tabs"
                        )
                elif slot_name not in entry["slots"]:
                    errors.append(f"'{node_id}' ({node_type}): unknown slot '{slot_name}'")
            kids.extend(slot_kids)
        for kid in kids:
            walk(kid, depth + 1, top_level=False)

    base_count = sum(1 for c in doc.get("components", []) if c.get("layer") == "base")
    if base_count > 1:
        errors.append(f"at most one 'base' component allowed, found {base_count}")

    for comp in doc.get("components", []):
        walk(comp, 1, top_level=True)
    for overlay in doc.get("overlays", []):
        walk(overlay, 1, top_level=False)  # overlays are portals: no grid area

    return errors
