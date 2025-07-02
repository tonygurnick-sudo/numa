import unittest
from unittest.mock import MagicMock, patch

from numa_chat_agent.tools import (
    AVAILABLE_TOOLS,
    get_available_tool_names,
    get_tools_for_agent,
    query_knowledge_base,
    validate_enabled_tools,
    web_search,
)


class TestTools(unittest.TestCase):
    """Tests for agent tools and registry"""

    @patch("numa_chat_agent.tools.query_knowledge_base_impl")
    def test_query_knowledge_base_tool(self, mock_impl):
        """Test query_knowledge_base tool wrapper"""
        # Setup mock response
        mock_impl.return_value = {
            "status": "success",
            "content": [{"json": {"summarised_content": "Test content"}}],
        }

        # Call the tool
        result = query_knowledge_base(
            query="test query", user_intent="test intent", max_results=5  # type: ignore # Strands @tool decorator modifies function signature
        )

        # Verify the implementation was called correctly
        mock_impl.assert_called_once_with("test query", "test intent", 5)

        # Verify the result
        self.assertEqual(result["status"], "success")
        self.assertIn("content", result)

    @patch("numa_chat_agent.tools.web_search_impl")
    def test_web_search_tool(self, mock_impl):
        """Test web_search tool wrapper"""
        # Setup mock response
        mock_impl.return_value = {
            "status": "success",
            "content": [{"json": {"summarised_content": "Search results"}}],
        }

        # Call the tool
        result = web_search(
            query="test search", user_intent="test intent", max_results=3  # type: ignore[arg-type] # Test intentionally passes non-string to verify error handling
        )

        # Verify the implementation was called correctly
        mock_impl.assert_called_once_with("test search", "test intent", 3)

        # Verify the result
        self.assertEqual(result["status"], "success")
        self.assertIn("content", result)

    def test_tool_registry_completeness(self):
        """Test that all tools are registered in AVAILABLE_TOOLS"""
        # Verify expected tools are present
        expected_tools = ["query_knowledge_base", "web_search"]

        for tool_name in expected_tools:
            self.assertIn(tool_name, AVAILABLE_TOOLS)
            self.assertTrue(callable(AVAILABLE_TOOLS[tool_name]))

        # Verify registry contains expected number of tools
        self.assertEqual(len(AVAILABLE_TOOLS), len(expected_tools))

    def test_get_available_tool_names(self):
        """Test getting list of available tool names"""
        tool_names = get_available_tool_names()

        # Should return a list
        self.assertIsInstance(tool_names, list)

        # Should contain expected tools
        self.assertIn("query_knowledge_base", tool_names)
        self.assertIn("web_search", tool_names)

        # Should match registry keys
        self.assertEqual(set(tool_names), set(AVAILABLE_TOOLS.keys()))

    def test_validate_enabled_tools_all_valid(self):
        """Test validation of all valid tool names"""
        valid_tools = ["query_knowledge_base", "web_search"]
        invalid_tools = validate_enabled_tools(valid_tools)

        # Should return empty list for all valid tools
        self.assertEqual(invalid_tools, [])

    def test_validate_enabled_tools_some_invalid(self):
        """Test validation with some invalid tool names"""
        mixed_tools = [
            "query_knowledge_base",
            "invalid_tool",
            "web_search",
            "another_invalid",
        ]
        invalid_tools = validate_enabled_tools(mixed_tools)

        # Should return only the invalid tools
        self.assertEqual(set(invalid_tools), {"invalid_tool", "another_invalid"})

    def test_validate_enabled_tools_all_invalid(self):
        """Test validation with all invalid tool names"""
        invalid_tools_input = ["fake_tool", "nonexistent_tool"]
        invalid_tools = validate_enabled_tools(invalid_tools_input)

        # Should return all tools as invalid
        self.assertEqual(set(invalid_tools), set(invalid_tools_input))

    def test_get_tools_for_agent_all_tools(self):
        """Test getting all tools for agent (default behavior)"""
        tools = get_tools_for_agent()

        # Should return list of callable tools
        self.assertIsInstance(tools, list)
        self.assertEqual(len(tools), len(AVAILABLE_TOOLS))

        # All items should be callable
        for tool in tools:
            self.assertTrue(callable(tool))

    def test_get_tools_for_agent_specific_tools(self):
        """Test getting specific subset of tools for agent"""
        enabled_tools = ["web_search"]
        tools = get_tools_for_agent(enabled_tools)

        # Should return only requested tools
        self.assertIsInstance(tools, list)
        self.assertEqual(len(tools), 1)
        self.assertTrue(callable(tools[0]))

    def test_get_tools_for_agent_empty_list(self):
        """Test getting tools with empty enabled list"""
        tools = get_tools_for_agent([])

        # Should return empty list
        self.assertEqual(tools, [])

    @patch("numa_chat_agent.tools.structlog.get_logger")
    def test_get_tools_for_agent_invalid_tools(self, mock_logger):
        """Test getting tools with invalid tool names (should filter and warn)"""
        # Setup mock logger
        mock_logger_instance = MagicMock()
        mock_logger.return_value = mock_logger_instance

        enabled_tools = ["query_knowledge_base", "invalid_tool", "web_search"]
        tools = get_tools_for_agent(enabled_tools)

        # Should return only valid tools
        self.assertEqual(len(tools), 2)

        # Should have logged a warning
        mock_logger_instance.warning.assert_called_once()

        # Warning should mention invalid tools
        call_args = mock_logger_instance.warning.call_args
        self.assertIn("invalid_tools", call_args[1])
        self.assertEqual(call_args[1]["invalid_tools"], ["invalid_tool"])

    def test_get_tools_for_agent_none_input(self):
        """Test getting tools with None input (should default to all)"""
        tools = get_tools_for_agent(None)

        # Should behave same as get_tools_for_agent() with no args
        default_tools = get_tools_for_agent()
        self.assertEqual(len(tools), len(default_tools))

    def test_tool_function_attributes(self):
        """Test that tool functions have expected attributes from @tool decorator"""
        # Note: This depends on how the strands @tool decorator works
        # These tests verify the tools are properly decorated

        kb_tool = AVAILABLE_TOOLS["query_knowledge_base"]
        search_tool = AVAILABLE_TOOLS["web_search"]

        # Both should be callable
        self.assertTrue(callable(kb_tool))
        self.assertTrue(callable(search_tool))

        # Should have function names
        self.assertEqual(kb_tool.__name__, "query_knowledge_base")
        self.assertEqual(search_tool.__name__, "web_search")


if __name__ == "__main__":
    unittest.main()
