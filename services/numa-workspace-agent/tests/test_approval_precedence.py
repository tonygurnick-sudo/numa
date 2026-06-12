"""
Per-integration approval precedence (TASK-127 follow-up, dev 0aa88fc56).

The user's per-slug approval overrides (set on the Integrations page) only
apply while the agent leaves its Integrations category as "Use default". An
agent that explicitly sets an Integrations mode — via the per-category
``approvalModes`` map or the legacy single ``approvalMode`` field — wins
uniformly for every slug, so ``resolve_per_integration_approval_modes`` must
return an empty map in that case.

Dev shipped this rule without a test (its old home, test_lambda_client.py,
was deleted with the MCP layer) — this file is the coverage.
"""

from unittest.mock import patch

from numa_workspace_agent.agent_config import (
    AgentConfig,
    AgentToolsConfig,
    _agent_overrides_integrations,
    resolve_per_integration_approval_modes,
)

USER_OVERRIDES = {"gmail": "never", "slack": "always"}


def _agent(tools_config: AgentToolsConfig) -> AgentConfig:
    return AgentConfig(
        agent_id="agt_test",
        title="Test Agent",
        system_prompt="",
        user_welcome_message=None,
        tools_config=tools_config,
        reference_files=[],
        version=1,
    )


@patch(
    "numa_workspace_agent.agent_config.fetch_integration_approval_modes",
    return_value=USER_OVERRIDES,
)
class TestResolvePerIntegrationApprovalModes:
    def test_no_agent_returns_user_overrides(self, _fetch):
        assert resolve_per_integration_approval_modes("sub-1", None) == USER_OVERRIDES

    def test_agent_with_default_categories_defers_to_user(self, _fetch):
        agent = _agent(AgentToolsConfig())
        assert resolve_per_integration_approval_modes("sub-1", agent) == USER_OVERRIDES

    def test_agent_category_mode_suppresses_user_overrides(self, _fetch):
        agent = _agent(AgentToolsConfig(approval_modes={"integrations": "never"}))
        assert resolve_per_integration_approval_modes("sub-1", agent) == {}

    def test_legacy_single_mode_suppresses_user_overrides(self, _fetch):
        agent = _agent(AgentToolsConfig(approval_mode="always"))
        assert resolve_per_integration_approval_modes("sub-1", agent) == {}

    def test_integrations_use_default_defers_to_user(self, _fetch):
        # "Use default" is stored as None in the per-category map.
        agent = _agent(AgentToolsConfig(approval_modes={"integrations": None}))
        assert resolve_per_integration_approval_modes("sub-1", agent) == USER_OVERRIDES

    def test_other_category_set_does_not_suppress(self, _fetch):
        # An explicit mode on a DIFFERENT category must not silence the
        # user's per-integration preferences.
        agent = _agent(AgentToolsConfig(approval_modes={"files": "never"}))
        assert resolve_per_integration_approval_modes("sub-1", agent) == USER_OVERRIDES

    def test_invalid_agent_mode_defers_to_user(self, _fetch):
        agent = _agent(
            AgentToolsConfig(
                approval_mode="bogus",
                approval_modes={"integrations": "also-bogus"},
            )
        )
        assert resolve_per_integration_approval_modes("sub-1", agent) == USER_OVERRIDES


class TestAgentOverridesIntegrations:
    def test_none_agent_is_false(self):
        assert _agent_overrides_integrations(None) is False

    def test_category_map_wins(self):
        agent = _agent(
            AgentToolsConfig(approval_modes={"integrations": "non_destructive"})
        )
        assert _agent_overrides_integrations(agent) is True

    def test_legacy_field_wins(self):
        agent = _agent(AgentToolsConfig(approval_mode="never"))
        assert _agent_overrides_integrations(agent) is True

    def test_defaults_are_false(self):
        assert _agent_overrides_integrations(_agent(AgentToolsConfig())) is False
