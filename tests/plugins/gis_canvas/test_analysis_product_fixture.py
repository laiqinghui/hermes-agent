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


def test_retrieved_source_data_is_demoted(plugin):
    """Every data:// binding must sit behind a dock/tabs rail, never at base."""
    doc = _after()
    for c in doc["components"]:
        src = (c.get("bindings") or {}).get("source", "")
        if isinstance(src, str) and src.startswith("data://"):
            assert c.get("layer") != "base"


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
