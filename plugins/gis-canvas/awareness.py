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
    if "active" in st:
        parts.append(f"active={st['active']}")
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
