"""
Tests for agent type configurations and base dataclass.

Covers AgentTypeConfig defaults and the built-in type configurations.
"""

import pytest
from numa_workspace_agent.agent_types import (
    AgentTypeConfig,
    get_agent_type_config,
)

# ---------------------------------------------------------------------------
# AgentTypeConfig defaults
# ---------------------------------------------------------------------------


class TestAgentTypeConfigDefaults:
    """Test that AgentTypeConfig default values are sensible."""

    def test_default_response_mode(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.response_mode == "stream"

    def test_default_tools_are_empty_lists(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.tools == []
        assert config.allowed_tools == []
        assert config.disallowed_tools == []

    def test_default_mcp_disabled(self):
        # Phase 6: the in-process MCP tool layer was deleted and the enable_*_mcp
        # flags now default to False on every agent type (capabilities are served
        # via the `numa` CLI / Bash instead).
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.enable_scripts_mcp is False
        assert config.enable_integrations_mcp is False
        assert config.enable_numa_mcp is False
        assert config.enable_connect_mcp is False
        assert config.enable_vault_mcp is False

    def test_default_allowed_numa_operations_is_none(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.allowed_numa_operations is None  # None = all allowed

    def test_default_plugins_path(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.plugins_path == "/app/plugins/numa"

    def test_default_kb_settings(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.default_kbs is None
        assert config.restrict_kbs is False

    def test_default_integration_settings(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.default_integrations is None
        assert config.restrict_integrations is False

    def test_default_system_prompt_builder_is_none(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.system_prompt_builder is None

    def test_default_identity_override_is_none(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.identity_override is None

    def test_default_workspace_setup_is_none(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.workspace_setup is None

    def test_default_s3_prefix_template(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert "{user_sub}" in config.s3_prefix_template
        assert "{conversation_id}" in config.s3_prefix_template

    def test_default_pipeline_fields(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.pipeline_steps is None
        assert config.pipeline_result_mode == "last_step_text"

    def test_default_limits(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        # Default raised 50 -> 200 in commit ee7a45b7 ("Jakarta hotfix
        # replication: max_turns, region prefix, Lambda memory/timeout").
        assert config.max_turns == 200
        assert config.max_thinking_tokens == 10_000

    def test_default_model_is_none(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.default_model is None

    def test_independent_list_instances(self):
        """Each config should get its own list instances (no shared state)."""
        config_a = AgentTypeConfig(type_id="a", display_name="A")
        config_b = AgentTypeConfig(type_id="b", display_name="B")
        config_a.tools.append("Read")
        assert "Read" not in config_b.tools


# ---------------------------------------------------------------------------
# Built-in agent types
# ---------------------------------------------------------------------------


class TestNumaChatType:
    """Tests for the numa-chat built-in type."""

    def test_registered(self):
        config = get_agent_type_config("numa-chat")
        assert config.type_id == "numa-chat"

    def test_stream_mode(self):
        config = get_agent_type_config("numa-chat")
        assert config.response_mode == "stream"

    def test_mcp_servers_disabled(self):
        """Phase 6: the in-process MCP tool layer was deleted. numa-chat no longer
        enables any MCP server — integrations/numa/connect capabilities are served
        via the `numa` CLI / Bash instead."""
        config = get_agent_type_config("numa-chat")
        assert config.enable_scripts_mcp is False
        assert config.enable_integrations_mcp is False
        assert config.enable_numa_mcp is False
        assert config.enable_connect_mcp is False

    def test_execute_script_not_in_allowed_tools(self):
        """The chat agent must not list mcp__scripts__execute_script — the tool
        is intentionally disabled; the security-hook loosening + prompt flip
        steered the model to Write+Bash+Edit instead."""
        config = get_agent_type_config("numa-chat")
        assert "mcp__scripts__execute_script" not in config.allowed_tools

    def test_has_all_sdk_tools(self):
        config = get_agent_type_config("numa-chat")
        for tool in ["Read", "Write", "Edit", "Glob", "Grep", "Bash"]:
            assert tool in config.tools

    def test_numa_operations_unrestricted(self):
        # Phase 6: enable_numa_mcp is now False everywhere (MCP layer removed),
        # but allowed_numa_operations stays None so the CLI surfaces all operations.
        config = get_agent_type_config("numa-chat")
        assert config.enable_numa_mcp is False
        assert config.allowed_numa_operations is None  # None = all operations

    def test_no_restrictions(self):
        config = get_agent_type_config("numa-chat")
        assert config.restrict_kbs is False
        assert config.restrict_integrations is False

    def test_no_pipeline(self):
        config = get_agent_type_config("numa-chat")
        assert config.pipeline_steps is None


class TestNumaSupportType:
    """Tests for the numa-chat-support built-in type (FEAT-204)."""

    def test_registered(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.type_id == "numa-chat-support"
        assert config.display_name == "Numa Support"

    def test_stream_mode(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.response_mode == "stream"

    def test_custom_prompt_and_identity(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.system_prompt_builder is not None
        assert config.identity_override is not None
        assert "Numa Support" in config.identity_override

    def test_prompt_builder_includes_support_workflow(self):
        config = get_agent_type_config("numa-chat-support")
        prompt = config.system_prompt_builder(
            identity_override=config.identity_override
        )
        assert "Support Workflow" in prompt
        assert "customersuccess@arcanum.ai" in prompt
        assert "numa-environment.md" in prompt

    def test_no_mcp_surface(self):
        # The MCP layer is gone on this branch — the numa CLI replaced it.
        # Email escalation now runs through `numa integrations`, not the
        # Pipedream integrations MCP.
        config = get_agent_type_config("numa-chat-support")
        assert config.enable_numa_mcp is False
        assert config.enable_integrations_mcp is False
        assert config.enable_scripts_mcp is False
        assert config.enable_connect_mcp is False
        assert config.enable_vault_mcp is False
        assert not any(t.startswith("mcp__") for t in config.allowed_tools)

    def test_cli_categories_scoped_to_support(self):
        # Phase-5 server-side allow-list: KB search (files), web search (web),
        # and email escalation (integrations — scoped to the user's connected
        # Gmail/Outlook by the frontend). No agents / memory / ops from a
        # support conversation.
        config = get_agent_type_config("numa-chat-support")
        assert config.allowed_cli_commands == ["files", "web", "integrations"]

    def test_bash_is_numa_cli_only(self):
        # Bash exists purely as the numa-CLI transport: the allowlist admits
        # Bash(numa:*) and nothing else, and allowed_cli_commands being set
        # forces acceptEdits (no bypassPermissions) — so arbitrary code
        # execution stays off even though Bash is in the tool list.
        config = get_agent_type_config("numa-chat-support")
        assert "Bash" in config.tools
        bash_entries = [t for t in config.allowed_tools if t.startswith("Bash")]
        assert bash_entries == ["Bash(numa:*)"]
        assert config.allowed_cli_commands is not None  # → acceptEdits

    def test_restricted_to_support_kb(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.restrict_kbs is True
        assert config.default_kbs == [{"id": "numa-support", "name": "Numa Support"}]

    def test_integrations_not_restricted(self):
        # Not restricted to a fixed default set: the frontend passes through
        # only the user's connected email integration(s), so email sending is
        # advertised only when the user actually has it connected.
        config = get_agent_type_config("numa-chat-support")
        assert config.restrict_integrations is False
        assert not config.default_integrations

    def test_escalation_prompt_offers_to_send_email(self):
        config = get_agent_type_config("numa-chat-support")
        prompt = config.system_prompt_builder(
            identity_override=config.identity_override
        )
        assert "Offer to send it for them" in prompt


class TestResearchAgentType:
    """Tests for the research-agent built-in type."""

    def test_registered(self):
        config = get_agent_type_config("research-agent")
        assert config.type_id == "research-agent"

    def test_no_integrations(self):
        config = get_agent_type_config("research-agent")
        assert config.enable_integrations_mcp is False
        assert config.restrict_integrations is True

    def test_numa_mcp_disabled(self):
        # Phase 6: the MCP tool layer was removed; enable_numa_mcp is now False.
        config = get_agent_type_config("research-agent")
        assert config.enable_numa_mcp is False


class TestDocumentSummariserType:
    """Tests for the document-summariser built-in type."""

    def test_registered(self):
        config = get_agent_type_config("document-summariser")
        assert config.type_id == "document-summariser"

    def test_sync_mode(self):
        config = get_agent_type_config("document-summariser")
        assert config.response_mode == "sync"

    def test_restricted_tools(self):
        config = get_agent_type_config("document-summariser")
        # Should only have file reading + Write (no Bash, no MCP)
        assert "Read" in config.tools
        assert "Write" in config.tools
        assert "Bash" not in config.tools
        assert "Edit" not in config.tools

    def test_no_mcp(self):
        config = get_agent_type_config("document-summariser")
        assert config.enable_scripts_mcp is False
        assert config.enable_integrations_mcp is False

    def test_result_file_mode(self):
        config = get_agent_type_config("document-summariser")
        assert config.pipeline_result_mode == "result_file"

    def test_low_turns(self):
        config = get_agent_type_config("document-summariser")
        assert config.max_turns <= 10

    def test_has_custom_prompt_builder(self):
        config = get_agent_type_config("document-summariser")
        assert config.system_prompt_builder is not None
        assert callable(config.system_prompt_builder)

    def test_custom_prompt_builder_extends_default(self):
        """The summariser prompt builder should include the summariser addendum."""
        config = get_agent_type_config("document-summariser")
        prompt = config.system_prompt_builder(
            working_dir="/workdir",
        )
        assert "document summariser" in prompt.lower()
        assert "result.json" in prompt


class TestTonyComedianType:
    """Tests for the tony-comedian built-in type."""

    def test_registered(self):
        config = get_agent_type_config("tony-comedian")
        assert config.type_id == "tony-comedian"

    def test_has_identity_override(self):
        config = get_agent_type_config("tony-comedian")
        assert config.identity_override is not None
        assert "Tony Gurnick" in config.identity_override

    def test_identity_override_does_not_mention_numa_identity(self):
        config = get_agent_type_config("tony-comedian")
        assert "You are Numa" not in config.identity_override

    def test_prompt_builder_uses_identity_override(self):
        """Tony's prompt should contain his identity, not Numa's."""
        config = get_agent_type_config("tony-comedian")
        prompt = config.system_prompt_builder(
            working_dir="/workdir",
            identity_override=config.identity_override,
        )
        # Should contain Tony's identity
        assert "Tony Gurnick" in prompt
        # Should NOT contain Numa's identity
        assert "CRITICAL IDENTITY INSTRUCTION: You are Numa" not in prompt
        # Should still contain workspace sections
        assert "Workspace Environment" in prompt

    def test_prompt_builder_includes_comedy_rules(self):
        config = get_agent_type_config("tony-comedian")
        prompt = config.system_prompt_builder(
            working_dir="/workdir",
            identity_override=config.identity_override,
        )
        assert "Comedy Rules" in prompt


# ---------------------------------------------------------------------------
# Phase 5 — per-agent-type CLI allow-list (allowed_cli_commands)
# ---------------------------------------------------------------------------


class TestCliAllowlist:
    """The Nolia default-restriction declared in agent_types/__init__.py.

    Parity anchor for the server-side enforcement in numa-cli-api
    (lambdas/node/numa-cli-api/src/tools/policy.ts). Both sides restrict every
    `nolia*` type to the `docs` category and leave everything else
    unrestricted — keep them in sync.
    """

    def test_default_is_unrestricted(self):
        assert (
            AgentTypeConfig(type_id="x", display_name="X").allowed_cli_commands is None
        )

    def test_all_nolia_types_restricted_to_docs(self):
        from numa_workspace_agent.agent_types import all_agent_configs

        nolia = [c for c in all_agent_configs() if c.type_id.startswith("nolia")]
        assert nolia, "expected nolia types to be registered"
        for cfg in nolia:
            assert cfg.allowed_cli_commands == ["docs"], (
                f"{cfg.type_id} should be restricted to ['docs'], "
                f"got {cfg.allowed_cli_commands}"
            )

    def test_non_nolia_types_unrestricted(self):
        from numa_workspace_agent.agent_types import all_agent_configs

        # Types may opt INTO a restriction explicitly (numa-chat-support
        # scopes itself to KB search, web search, and email escalation via
        # integrations); this test guards against the Phase-5 Nolia default
        # leaking onto everything else.
        explicitly_restricted = {"numa-chat-support": ["files", "web", "integrations"]}

        for cfg in all_agent_configs():
            if cfg.type_id.startswith("nolia"):
                continue
            expected = explicitly_restricted.get(cfg.type_id)
            assert cfg.allowed_cli_commands == expected, (
                f"{cfg.type_id} should have allowed_cli_commands={expected}, "
                f"got {cfg.allowed_cli_commands}"
            )

    def test_numa_chat_unrestricted(self):
        assert get_agent_type_config("numa-chat").allowed_cli_commands is None
