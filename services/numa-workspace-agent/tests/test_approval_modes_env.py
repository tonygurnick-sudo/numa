"""
NUMA_APPROVAL_MODES emission in create_agent_options().

The numa CLI has no bootstrap context on disk in workspace-IAM mode — its
HITL gate reads the user's resolved approval policy from this env var. If it
is absent the CLI fails safe to `non_destructive` and gates EVERY write op
regardless of the user's saved settings (the BUG this guards against: the
MCP-layer deletion left the resolved modes dead in sdk_runner's parameters,
so "Auto-approve all" users still got approval cards for every write).
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


class TestApprovalModesEnv:
    def test_categories_and_overrides_emitted(self):
        options = create_agent_options(
            approval_mode="never",
            numa_tool_approval_mode={
                "agents": "never",
                "memories": "never",
                "knowledgeBases": "non_destructive",
                "ops": "always",
                "connectors": "never",
            },
            integration_approval_modes={"gmail": "never", "slack": "always"},
        )
        payload = json.loads(options.env["NUMA_APPROVAL_MODES"])
        assert payload["categories"] == {
            "agents": "never",
            "memories": "never",
            "knowledgeBases": "non_destructive",
            "ops": "always",
            "connectors": "never",
            "integrations": "never",
        }
        assert payload["integration_overrides"] == {
            "gmail": "never",
            "slack": "always",
        }

    def test_integrations_category_comes_from_approval_mode(self):
        options = create_agent_options(
            approval_mode="non_destructive",
            numa_tool_approval_mode={"memories": "never"},
        )
        payload = json.loads(options.env["NUMA_APPROVAL_MODES"])
        assert payload["categories"]["integrations"] == "non_destructive"
        assert payload["categories"]["memories"] == "never"
        assert payload["integration_overrides"] == {}

    def test_absent_modes_omit_env_var(self):
        # No modes resolved (e.g. a caller that predates the threading) —
        # the var is omitted and the CLI falls back to its own fail-safe.
        options = create_agent_options()
        assert "NUMA_APPROVAL_MODES" not in options.env

    def test_empty_overrides_with_categories_still_emits(self):
        # Agent-level Integrations override suppresses per-slug overrides
        # upstream (resolve_per_integration_approval_modes returns {}) — the
        # categories map must still reach the CLI.
        options = create_agent_options(
            approval_mode="always",
            numa_tool_approval_mode={"memories": "never"},
            integration_approval_modes={},
        )
        payload = json.loads(options.env["NUMA_APPROVAL_MODES"])
        assert payload["categories"]["integrations"] == "always"
        assert payload["integration_overrides"] == {}
