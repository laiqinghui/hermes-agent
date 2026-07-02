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
