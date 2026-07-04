"""Hermes plugin entry point for the GIS generative canvas (Phase 1).

Enable via ~/.hermes/config.yaml:
    plugins:
      enabled:
        - gis-canvas
"""


def register(ctx):
    from .tools_canvas import TOOL_DEFS
    from .tools_data import DATA_TOOL_DEFS
    from .hooks import on_pre_llm_call

    for name, schema, handler, description, emoji in TOOL_DEFS + DATA_TOOL_DEFS:
        ctx.register_tool(
            name=name,
            toolset="gis-canvas",
            schema=schema,
            handler=handler,
            description=description,
            emoji=emoji,
        )

    ctx.register_hook("pre_llm_call", on_pre_llm_call)
