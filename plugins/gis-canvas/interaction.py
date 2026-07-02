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
