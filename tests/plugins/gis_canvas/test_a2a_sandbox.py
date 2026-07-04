import os

import pytest

URL = os.environ.get("DATA_AGENT_URL", "http://localhost:2024")


def _sandbox_up() -> bool:
    try:
        import httpx
        httpx.get(f"{URL}/.well-known/agent-card.json", timeout=3.0).raise_for_status()
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _sandbox_up(), reason="Data Agent sandbox not reachable")


def _src(plugin):
    ds = plugin.datasource
    return ds.A2ADataSource(URL, ds.default_auth_provider)


def test_live_discover_returns_datasets(plugin):
    datasets = _src(plugin).discover("scenario:discover what datasets are available")
    assert datasets and all("view_name" in d for d in datasets)


def test_live_clarify_then_resume(plugin):
    src = _src(plugin)
    first = src.query("scenario:clarify I want some data")
    assert first.clarification and first.context_id
    resumed = src.query("vessel_traffic", context_id=first.context_id)
    assert resumed.clarification is None  # conversation advanced past the interrupt
