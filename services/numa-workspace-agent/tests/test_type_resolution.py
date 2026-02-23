"""
Tests for type resolution in create_agent_options().

Verifies that create_agent_options() correctly applies agent type config
settings: tools, allowed_tools, MCP enable/disable, plugins_path,
max_turns, system_prompt_builder, and default_model.

These tests mock out the credential/boto3 calls since they need AWS.
"""

from unittest.mock import patch

import pytest
from numa_workspace_agent.agent_types.base import AgentTypeConfig
from numa_workspace_agent.agent_types.registry import register_agent_type
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


class TestCreateAgentOptionsDefaults:
    """Test that create_agent_options uses numa-chat defaults when no type provided."""

    def test_defaults_to_numa_chat(self):
        options = create_agent_options()
        # numa-chat has all SDK tools enabled
        assert "Read" in options.tools
        assert "Write" in options.tools
        assert "Bash" in options.tools

    def test_max_turns_from_numa_chat(self):
        options = create_agent_options()
        assert options.max_turns == 50


class TestCreateAgentOptionsWithType:
    """Test that agent type config overrides are applied correctly."""

    def test_custom_tools(self):
        config = AgentTypeConfig(
            type_id="test-tools",
            display_name="Test Tools",
            tools=["Read", "Glob"],
            allowed_tools=["Read", "Glob"],
            enable_scripts_mcp=False,
            enable_integrations_mcp=False,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert options.tools == ["Read", "Glob"]
        assert "Bash" not in options.tools

    def test_custom_allowed_tools(self):
        config = AgentTypeConfig(
            type_id="test-allowed",
            display_name="Test Allowed",
            tools=["Read"],
            allowed_tools=["Read", "Glob"],
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert options.allowed_tools == ["Read", "Glob"]

    def test_mcp_scripts_disabled(self):
        config = AgentTypeConfig(
            type_id="test-no-scripts",
            display_name="No Scripts",
            enable_scripts_mcp=False,
            enable_integrations_mcp=False,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert "scripts" not in options.mcp_servers

    def test_mcp_scripts_enabled(self):
        config = AgentTypeConfig(
            type_id="test-with-scripts",
            display_name="With Scripts",
            enable_scripts_mcp=True,
            enable_integrations_mcp=False,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert "scripts" in options.mcp_servers

    def test_mcp_integrations_disabled(self):
        config = AgentTypeConfig(
            type_id="test-no-int",
            display_name="No Int",
            enable_scripts_mcp=False,
            enable_integrations_mcp=False,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert "integrations" not in options.mcp_servers

    def test_mcp_integrations_enabled(self):
        config = AgentTypeConfig(
            type_id="test-with-int",
            display_name="With Int",
            enable_scripts_mcp=False,
            enable_integrations_mcp=True,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert "integrations" in options.mcp_servers

    def test_custom_max_turns(self):
        config = AgentTypeConfig(
            type_id="test-turns",
            display_name="Custom Turns",
            max_turns=5,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert options.max_turns == 5

    def test_custom_plugins_path(self):
        config = AgentTypeConfig(
            type_id="test-plugins",
            display_name="Custom Plugins",
            plugins_path="/custom/plugins",
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert any(
            p.get("path") == "/custom/plugins"
            for p in options.plugins
            if isinstance(p, dict)
        )

    def test_custom_system_prompt_builder(self):
        def custom_builder(**kwargs) -> str:
            return "CUSTOM SYSTEM PROMPT"

        config = AgentTypeConfig(
            type_id="test-prompt",
            display_name="Custom Prompt",
            system_prompt_builder=custom_builder,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert options.system_prompt == "CUSTOM SYSTEM PROMPT"

    def test_none_system_prompt_builder_uses_default(self):
        config = AgentTypeConfig(
            type_id="test-default-prompt",
            display_name="Default Prompt",
            system_prompt_builder=None,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        # Default prompt should contain workspace-related content
        assert "Numa" in options.system_prompt or len(options.system_prompt) > 100

    def test_default_model_override(self):
        config = AgentTypeConfig(
            type_id="test-model",
            display_name="Custom Model",
            default_model="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        )
        register_agent_type(config)

        # No model passed in request — type default should be used
        options = create_agent_options(agent_type_config=config)
        assert options.model == "us.anthropic.claude-haiku-4-5-20251001-v1:0"

    def test_request_model_overrides_type_default(self):
        config = AgentTypeConfig(
            type_id="test-model-override",
            display_name="Model Override",
            default_model="us.anthropic.claude-haiku-4-5-20251001-v1:0",
        )
        register_agent_type(config)

        # Request-level model should take precedence
        options = create_agent_options(
            agent_type_config=config,
            model="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        )
        assert options.model == "us.anthropic.claude-sonnet-4-5-20250929-v1:0"

    def test_thinking_tokens_from_type(self):
        config = AgentTypeConfig(
            type_id="test-thinking",
            display_name="Custom Thinking",
            max_thinking_tokens=3000,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        # max_thinking_tokens is passed via env
        assert options.env.get("MAX_THINKING_TOKENS") == "3000"

    def test_disallowed_tools(self):
        config = AgentTypeConfig(
            type_id="test-disallowed",
            display_name="With Disallowed",
            disallowed_tools=["Bash", "Write"],
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert options.disallowed_tools == ["Bash", "Write"]

    def test_identity_override_applied_to_system_prompt(self):
        """identity_override replaces IDENTITY_AND_ROLE in the prompt."""
        custom_identity = "You are a test bot created for testing purposes."
        config = AgentTypeConfig(
            type_id="test-identity",
            display_name="Identity Test",
            identity_override=custom_identity,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert custom_identity in options.system_prompt
        assert (
            "CRITICAL IDENTITY INSTRUCTION: You are Numa" not in options.system_prompt
        )
        # Other sections should still be present
        assert "Workspace Environment" in options.system_prompt

    def test_identity_override_none_uses_default_identity(self):
        """When identity_override is None, default Numa identity is used."""
        config = AgentTypeConfig(
            type_id="test-no-identity",
            display_name="No Identity Override",
            identity_override=None,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert "CRITICAL IDENTITY INSTRUCTION: You are Numa" in options.system_prompt

    def test_identity_override_with_custom_builder(self):
        """Custom system_prompt_builder receives identity_override via kwargs."""
        custom_identity = "You are a custom test agent."

        def capture_builder(**kwargs):
            from numa_workspace_agent.prompts import build_workspace_system_prompt

            return build_workspace_system_prompt(**kwargs)

        config = AgentTypeConfig(
            type_id="test-builder-identity",
            display_name="Builder Identity",
            system_prompt_builder=capture_builder,
            identity_override=custom_identity,
        )
        register_agent_type(config)

        options = create_agent_options(agent_type_config=config)
        assert custom_identity in options.system_prompt
        assert (
            "CRITICAL IDENTITY INSTRUCTION: You are Numa" not in options.system_prompt
        )
