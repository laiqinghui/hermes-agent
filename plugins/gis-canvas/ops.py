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
