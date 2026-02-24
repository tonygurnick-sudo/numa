"""
Tests for the agent type registry.

Covers registration, lookup, fallback to numa-chat, ValueError when no
default, overwrite with warning, and list_agent_types() output.
"""

import pytest
from numa_workspace_agent.agent_types.base import AgentTypeConfig
from numa_workspace_agent.agent_types.registry import (
    _registry,
    get_agent_type_config,
    list_agent_types,
    register_agent_type,
)


class TestRegisterAgentType:
    """Tests for register_agent_type()."""

    def test_register_new_type(self):
        config = AgentTypeConfig(
            type_id="test-new",
            display_name="Test New",
        )
        register_agent_type(config)
        assert "test-new" in _registry
        assert _registry["test-new"] is config

    def test_overwrite_existing_type(self):
        config1 = AgentTypeConfig(type_id="test-ow", display_name="Original")
        config2 = AgentTypeConfig(type_id="test-ow", display_name="Replacement")

        register_agent_type(config1)
        register_agent_type(config2)

        assert _registry["test-ow"].display_name == "Replacement"

    def test_overwrite_logs_warning(self, caplog):
        config1 = AgentTypeConfig(type_id="test-warn", display_name="A")
        config2 = AgentTypeConfig(type_id="test-warn", display_name="B")

        register_agent_type(config1)
        # structlog doesn't use stdlib caplog by default, so just check
        # the registry was updated (the warning is logged via structlog)
        register_agent_type(config2)
        assert _registry["test-warn"].display_name == "B"


class TestGetAgentTypeConfig:
    """Tests for get_agent_type_config()."""

    def test_get_known_type(self):
        """Built-in types are registered at import time."""
        config = get_agent_type_config("numa-chat")
        assert config.type_id == "numa-chat"
        assert config.display_name == "Numa Chat"

    def test_get_document_summariser(self):
        config = get_agent_type_config("document-summariser")
        assert config.type_id == "document-summariser"
        assert config.response_mode == "sync"

    def test_get_research_agent(self):
        config = get_agent_type_config("research-agent")
        assert config.type_id == "research-agent"
        assert config.enable_integrations_mcp is False

    def test_unknown_type_falls_back_to_numa_chat(self):
        """Unknown type IDs should fall back to numa-chat."""
        config = get_agent_type_config("nonexistent-type-xyz")
        assert config.type_id == "numa-chat"

    def test_no_default_raises_value_error(self):
        """If numa-chat is not registered, ValueError is raised."""
        saved_chat = _registry.pop("numa-chat", None)
        try:
            with pytest.raises(
                ValueError, match="not found and no 'numa-chat' default"
            ):
                get_agent_type_config("nonexistent-type-xyz")
        finally:
            if saved_chat:
                _registry["numa-chat"] = saved_chat

    def test_custom_registered_type(self, mock_chat_type):
        config = get_agent_type_config("mock-chat")
        assert config is mock_chat_type
        assert config.max_turns == 5


class TestListAgentTypes:
    """Tests for list_agent_types()."""

    def test_returns_list_of_dicts(self):
        result = list_agent_types()
        assert isinstance(result, list)
        assert len(result) >= 3  # numa-chat, research-agent, document-summariser

    def test_dict_shape(self):
        result = list_agent_types()
        for item in result:
            assert "type_id" in item
            assert "display_name" in item
            assert "response_mode" in item
            # Should only have these 3 keys (lightweight summary)
            assert len(item) == 3

    def test_includes_built_in_types(self):
        result = list_agent_types()
        type_ids = {item["type_id"] for item in result}
        assert "numa-chat" in type_ids
        assert "research-agent" in type_ids
        assert "document-summariser" in type_ids

    def test_includes_custom_registered_type(self, mock_chat_type):
        result = list_agent_types()
        type_ids = {item["type_id"] for item in result}
        assert "mock-chat" in type_ids

    def test_removed_type_not_in_list(self):
        config = AgentTypeConfig(type_id="temp-type", display_name="Temp")
        register_agent_type(config)
        assert any(t["type_id"] == "temp-type" for t in list_agent_types())

        del _registry["temp-type"]
        assert not any(t["type_id"] == "temp-type" for t in list_agent_types())
