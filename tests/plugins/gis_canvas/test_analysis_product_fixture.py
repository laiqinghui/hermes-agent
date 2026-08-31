"""The 31 Aug session produced a full intelligence product but rendered only its source
tables. render-spec-after.json is the same investigation drawn as an analysis product;
this pins the target so the two primitives cannot silently regress."""
import json
import pathlib

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "gis-canvas" / "session-2026-08-31"


def _after() -> dict:
    return json.loads((FIXTURE / "render-spec-after.json").read_text(encoding="utf-8"))


def _types(doc: dict) -> list[str]:
    found: list[str] = []

    def walk(node: dict) -> None:
        found.append(node["type"])
        for child in node.get("children", []) or []:
            walk(child)
        for nodes in (node.get("slots") or {}).values():
            for child in nodes:
                walk(child)

    for c in doc["components"]:
        walk(c)
    return found


def test_analysis_product_canvas_is_valid(plugin):
    assert plugin.validator.validate_doc(_after()) == []


def test_analysis_product_leads_with_judgments_not_source_data(plugin):
    doc = _after()
    base = [c for c in doc["components"] if c.get("layer") == "base"]
    assert len(base) == 1
    assert base[0]["type"] == "note", "the answer, not a retrieved table, must be the base layer"


def test_analysis_product_carries_prose_and_computed_rows(plugin):
    doc = _after()
    types = _types(doc)
    assert types.count("note") >= 2, "expected key judgments plus caveats"
    inline = [c for c in doc["components"]
              if c["type"] == "data-table" and "rows" in (c.get("props") or {})]
    assert inline, "the computed gap/tasking table must be inline, not a handle"


def _base_layer_data_bindings(doc: dict) -> list[str]:
    """IDs of every data://-bound node whose effective layer is base.

    Walks children and slot children too, inheriting the nearest ancestor's
    *explicit* layer when a nested node doesn't declare its own -- so a
    data:// table tucked inside a tabs slot is checked against the layer it
    actually renders behind, not silently skipped.

    A missing "layer" key is NOT treated as base: a top-level component with
    no layer is grid-positioned via its "area" and is explicitly not base
    (the validator requires "area" precisely when "layer" is absent). Only
    an explicit layer == "base" (its own, or inherited from an ancestor that
    declared one) counts.
    """
    violations: list[str] = []

    def walk(node: dict, inherited_layer: str | None) -> None:
        effective_layer = node.get("layer", inherited_layer)
        src = (node.get("bindings") or {}).get("source", "")
        if isinstance(src, str) and src.startswith("data://") and effective_layer == "base":
            violations.append(node.get("id", "<unknown>"))
        for child in node.get("children", []) or []:
            walk(child, effective_layer)
        for nodes in (node.get("slots") or {}).values():
            for child in nodes:
                walk(child, effective_layer)

    for c in doc["components"]:
        walk(c, c.get("layer"))
    return violations


def test_retrieved_source_data_is_demoted(plugin):
    """Every data:// binding must sit behind a dock/tabs rail, never at base."""
    doc = _after()
    assert _base_layer_data_bindings(doc) == []

    # Adversarial case: a data://-bound node at base layer that is nested
    # inside a slot, not top-level. A components-only (non-recursive) version
    # of _base_layer_data_bindings would never see this node and would wrongly
    # report no violations -- this pins the recursion itself, not just the
    # real fixture (which happens to have no nested base-layer data binding).
    nested_violation_doc = {
        "components": [
            {
                "id": "tabs-1",
                "type": "tabs",
                "layer": "dock",
                "slots": {
                    "panels": [
                        {
                            "id": "sneaky-table",
                            "type": "data-table",
                            "layer": "base",
                            "bindings": {"source": "data://sneaky-handle"},
                        }
                    ]
                },
            }
        ]
    }
    assert _base_layer_data_bindings(nested_violation_doc) == ["sneaky-table"]


def test_before_and_after_come_from_the_same_session(plugin):
    """Guards against the fixture drifting onto invented handles."""
    before = json.loads((FIXTURE / "render-spec-before.json").read_text(encoding="utf-8"))
    manifest = json.loads((FIXTURE / "handles-manifest.json").read_text(encoding="utf-8"))
    known = {e["handle"] for e in manifest}

    def sources(doc: dict) -> set[str]:
        out: set[str] = set()

        def walk(node: dict) -> None:
            src = (node.get("bindings") or {}).get("source")
            if isinstance(src, str) and src.startswith("data://"):
                out.add(src)
            for nodes in (node.get("slots") or {}).values():
                for child in nodes:
                    walk(child)

        for c in doc["components"]:
            walk(c)
        return out

    assert sources(_after()) <= known
    assert before["components"], "before-spec fixture must not be empty"
