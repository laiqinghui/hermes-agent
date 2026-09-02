import pathlib

import yaml

PLUGIN_DIR = pathlib.Path(__file__).resolve().parents[3] / "plugins" / "gis-canvas"


class FakeCtx:
    def __init__(self):
        self.tools = {}
        self.hooks = {}

    def register_tool(self, name, toolset, schema, handler, **kwargs):
        self.tools[name] = {"toolset": toolset, "schema": schema, "handler": handler, **kwargs}

    def register_hook(self, event, handler):
        self.hooks.setdefault(event, []).append(handler)


def test_manifest_declares_tools_and_kind():
    manifest = yaml.safe_load((PLUGIN_DIR / "plugin.yaml").read_text())
    assert manifest["name"] == "gis-canvas"
    assert manifest["kind"] == "standalone"
    assert set(manifest["provides_tools"]) == {
        "render_view", "update_view", "canvas_get_state", "data_discover", "data_query"}


def test_register_registers_all_tools(plugin):
    import sys
    _ = plugin.tools_canvas  # ensure submodule loaded before register() resolves it
    _ = plugin.tools_data
    pkg = sys.modules["gis_canvas_plugin"]
    ctx = FakeCtx()
    pkg.register(ctx)
    assert set(ctx.tools) == {
        "render_view", "update_view", "canvas_get_state", "data_discover", "data_query"}
    for name, entry in ctx.tools.items():
        assert entry["toolset"] == "gis-canvas"
        assert entry["schema"]["name"] == name
        assert callable(entry["handler"])
        assert entry["description"]


def test_tool_descriptions_teach_the_catalog(plugin):
    schema = plugin.tools_canvas.RENDER_VIEW_SCHEMA
    for keyword in ("card", "stat", "data-table", "area", "bindings.source",
                    "select", "handlers", "reactive", "controls", "filter"):
        assert keyword in schema["description"]


def test_tool_descriptions_teach_esri(plugin):
    d = plugin.tools_canvas.RENDER_VIEW_SCHEMA["description"]
    for kw in ("esri:map", "esri:legend", "esri:feature-table", "layers", "mock://", "FeatureServer"):
        assert kw in d


def test_gateway_fenced_block_declares_the_canvas_rpcs():
    server = PLUGIN_DIR.parents[1] / "tui_gateway" / "server.py"
    text = server.read_text(encoding="utf-8")
    start = text.index("# >>> gis-canvas")
    end = text.index("# <<< gis-canvas >>>")
    block = text[start:end]
    for m in ("canvas.interaction", "canvas.data_fetch", "canvas.get", "canvas.list"):
        assert f'@method("{m}")' in block, f"{m} missing from the fenced gis-canvas block"
