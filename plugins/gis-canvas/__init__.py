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
