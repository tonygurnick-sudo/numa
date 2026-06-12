"""
Tests for agent type configurations and base dataclass.

Covers AgentTypeConfig defaults, TOOL_FILE_MAP structure, ALWAYS_COPY
entries, and the built-in type configurations.
"""

import pytest
from numa_workspace_agent.agent_types import (
    ALWAYS_COPY,
    TOOL_FILE_MAP,
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

    def test_default_mcp_enabled(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.enable_scripts_mcp is True
        assert config.enable_integrations_mcp is True
        assert config.enable_numa_mcp is True

    def test_default_allowed_numa_operations_is_none(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.allowed_numa_operations is None  # None = all allowed

    def test_default_numa_tools(self):
        config = AgentTypeConfig(type_id="test", display_name="Test")
        assert config.enabled_numa_tools == []
        assert config.tools_source_dirs == ["numa"]

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
# TOOL_FILE_MAP and ALWAYS_COPY
# ---------------------------------------------------------------------------


class TestToolFileMap:
    """Test the tool name → file mapping."""

    def test_all_known_tools_present(self):
        expected_tools = [
            "numa_files_search",
            "web_search",
            "agents",
            "convert_document",
            "extract_content",
        ]
        for tool in expected_tools:
            assert tool in TOOL_FILE_MAP, f"Tool {tool!r} missing from TOOL_FILE_MAP"

    def test_legacy_knowledge_search_alias(self):
        """The legacy `knowledge_search` key still resolves to the renamed reference doc."""
        assert "knowledge_search" in TOOL_FILE_MAP
        assert TOOL_FILE_MAP["knowledge_search"] == ["numa_files.py"]
        assert TOOL_FILE_MAP["numa_files_search"] == ["numa_files.py"]

    def test_all_values_are_lists(self):
        for tool_name, files in TOOL_FILE_MAP.items():
            assert isinstance(files, list), f"{tool_name} value should be a list"
            assert len(files) > 0, f"{tool_name} should have at least one file"

    def test_all_file_values_are_strings(self):
        for tool_name, files in TOOL_FILE_MAP.items():
            for f in files:
                assert isinstance(f, str), f"{tool_name} file entry should be string"
                assert f.endswith(".py"), f"{tool_name} file {f!r} should be a .py file"


class TestAlwaysCopy:
    """Test the always-copy list."""

    def test_always_copy_is_empty(self):
        # helpers/ was removed when tool files became documentation-only.
        # ALWAYS_COPY should be empty since there are no shared modules.
        assert len(ALWAYS_COPY) == 0


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

    def test_mcp_servers_enabled(self):
        """numa-chat keeps integrations/numa/connect MCP servers. The scripts MCP
        server (execute_script) was removed — model now uses Write+Bash+Edit."""
        config = get_agent_type_config("numa-chat")
        assert config.enable_scripts_mcp is False
        assert config.enable_integrations_mcp is True
        assert config.enable_numa_mcp is True
        assert config.enable_connect_mcp is True

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

    def test_has_numa_tool_docs(self):
        config = get_agent_type_config("numa-chat")
        assert "agents" in config.enabled_numa_tools
        assert "memories" in config.enabled_numa_tools

    def test_numa_mcp_enabled_with_all_operations(self):
        config = get_agent_type_config("numa-chat")
        assert config.enable_numa_mcp is True
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

    def test_only_numa_mcp_enabled(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.enable_numa_mcp is True
        assert config.enable_scripts_mcp is False
        assert config.enable_integrations_mcp is False
        assert config.enable_connect_mcp is False
        assert config.enable_vault_mcp is False

    def test_numa_operations_scoped_to_support(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.allowed_numa_operations is not None
        assert "numa_files" in config.allowed_numa_operations
        assert "web_search" in config.allowed_numa_operations
        # No agent management or memories from a support conversation
        assert "agents" not in config.allowed_numa_operations
        assert "memories" not in config.allowed_numa_operations

    def test_no_bash_or_code_execution(self):
        config = get_agent_type_config("numa-chat-support")
        assert "Bash" not in config.tools
        assert not any(t.startswith("Bash") for t in config.allowed_tools)
        assert "mcp__scripts__execute_script" not in config.allowed_tools

    def test_restricted_to_support_kb(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.restrict_kbs is True
        assert config.default_kbs == [{"id": "numa-support", "name": "Numa Support"}]

    def test_no_integrations(self):
        config = get_agent_type_config("numa-chat-support")
        assert config.restrict_integrations is True

    def test_tool_docs_resolve_in_tool_file_map(self):
        config = get_agent_type_config("numa-chat-support")
        for tool_name in config.enabled_numa_tools:
            assert tool_name in TOOL_FILE_MAP


class TestResearchAgentType:
    """Tests for the research-agent built-in type."""

    def test_registered(self):
        config = get_agent_type_config("research-agent")
        assert config.type_id == "research-agent"

    def test_no_integrations(self):
        config = get_agent_type_config("research-agent")
        assert config.enable_integrations_mcp is False
        assert config.restrict_integrations is True

    def test_numa_mcp_enabled(self):
        config = get_agent_type_config("research-agent")
        assert config.enable_numa_mcp is True

    def test_no_tool_docs(self):
        config = get_agent_type_config("research-agent")
        # Research agent has MCP access but no reference docs copied
        assert config.enabled_numa_tools == []


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

    def test_no_numa_tools(self):
        config = get_agent_type_config("document-summariser")
        assert config.enabled_numa_tools == []
        assert config.tools_source_dirs == []

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
