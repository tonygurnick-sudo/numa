"""
Dual-method slug dedup in create_agent_options().

A slug must reach the conversation under exactly ONE connection method — the
numa CLI routes `numa integrations <cmd> <slug>` off NUMA_ENABLED_INTEGRATIONS
(pipedream) vs NUMA_ENABLED_NATIVE_CONNECTORS (native), and a slug in both
makes that routing ambiguous. When a payload carries both (stale frontend
state / double-enabled catalog), sdk_config keeps the pipedream row and drops
the native duplicate, logging DUAL_METHOD_SLUG_DEDUP.
"""

import json
from unittest.mock import patch

import pytest
from numa_workspace_agent.sdk_config import create_agent_options


@pytest.fixture(autouse=True)
def mock_credentials():
    """Mock AWS credential calls so tests don't need real AWS."""
    with (
        patch(
            "numa_workspace_agent.sdk_config._get_local_credentials", return_value={}
        ),
        patch(
            "numa_workspace_agent.sdk_config._get_cross_account_credentials",
            return_value=None,
        ),
    ):
        yield


def _env_for(enabled_integrations):
    options = create_agent_options(enabled_integrations=enabled_integrations)
    return options.env


class TestDualMethodDedup:
    def test_dual_method_slug_keeps_pipedream_drops_native(self):
        env = _env_for(
            [
                {"slug": "google_drive", "method": "pipedream"},
                {"slug": "google_drive", "method": "native"},
            ]
        )
        assert json.loads(env["NUMA_ENABLED_INTEGRATIONS"]) == ["google_drive"]
        assert json.loads(env["NUMA_ENABLED_NATIVE_CONNECTORS"]) == []

    def test_distinct_slugs_pass_through_untouched(self):
        env = _env_for(
            [
                {"slug": "gmail", "method": "pipedream"},
                {"slug": "synergy", "method": "native"},
            ]
        )
        assert json.loads(env["NUMA_ENABLED_INTEGRATIONS"]) == ["gmail"]
        assert json.loads(env["NUMA_ENABLED_NATIVE_CONNECTORS"]) == ["synergy"]

    def test_native_only_slug_survives(self):
        env = _env_for([{"slug": "google_drive", "method": "native"}])
        assert "NUMA_ENABLED_INTEGRATIONS" not in env
        assert json.loads(env["NUMA_ENABLED_NATIVE_CONNECTORS"]) == ["google_drive"]

    def test_mixed_overlap_only_drops_the_duplicate(self):
        env = _env_for(
            [
                {"slug": "google_drive", "method": "pipedream"},
                {"slug": "google_drive", "method": "native"},
                {"slug": "synergy", "method": "native"},
                {"slug": "gmail", "method": "pipedream"},
            ]
        )
        assert json.loads(env["NUMA_ENABLED_INTEGRATIONS"]) == [
            "google_drive",
            "gmail",
        ]
        assert json.loads(env["NUMA_ENABLED_NATIVE_CONNECTORS"]) == ["synergy"]
