"""
Unit tests for DynamoDB utilities.

Tests message formatting and validation for conversation handling.
"""

import sys
import unittest
from unittest.mock import Mock

from numa_chat_agent.dynamodb_utils import (
    format_messages_for_chat,
    validate_and_clean_tool_pairs,
)

# Mock external dependencies before importing
sys.modules["structlog"] = Mock()
sys.modules["boto3"] = Mock()


class TestConversationMemoryFunctions(unittest.TestCase):
    """Test conversation message formatting and validation."""

    def test_tool_validation_removes_orphaned_calls(self):
        """Test tool validation for backend conversation loading."""
        messages = [
            {
                "role": "assistant",
                "content": [
                    {
                        "toolUse": {
                            "toolUseId": "orphaned123",
                            "name": "test_tool",
                            "input": {},
                        }
                    }
                ],
            }
        ]

        cleaned = validate_and_clean_tool_pairs(messages)
        self.assertEqual(len(cleaned), 0)

    def test_tool_validation_preserves_valid_pairs(self):
        """Test tool validation preserves complete pairs."""
        messages = [
            {
                "role": "assistant",
                "content": [
                    {
                        "toolUse": {
                            "toolUseId": "valid123",
                            "name": "test_tool",
                            "input": {},
                        }
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "toolResult": {
                            "toolUseId": "valid123",
                            "content": [{"text": "Valid result"}],
                        }
                    }
                ],
            },
        ]

        cleaned = validate_and_clean_tool_pairs(messages)
        self.assertEqual(len(cleaned), 2)

    def test_format_messages_for_chat_text(self):
        """Test message formatting for backend conversation loading."""
        messages = [
            {
                "message_type": "text",
                "content": "Hello",
                "role": "user",
                "timestamp": 1,
            },
            {
                "message_type": "text",
                "content": "Hi there!",
                "role": "assistant",
                "timestamp": 2,
            },
        ]

        formatted = format_messages_for_chat(messages, load_files=False)

        expected = [
            {"role": "user", "content": [{"text": "Hello"}]},
            {"role": "assistant", "content": [{"text": "Hi there!"}]},
        ]

        self.assertEqual(formatted, expected)

    def test_format_messages_for_chat_tools(self):
        """Test tool message formatting for backend."""
        messages = [
            {
                "message_type": "tool_call",
                "tool_use_id": "tool123",
                "tool_name": "test_tool",
                "tool_payload": {"input": {"query": "test"}},
                "timestamp": 1,
            },
            {
                "message_type": "tool_result",
                "tool_use_id": "tool123",
                "tool_payload": {
                    "content": [{"text": "Tool result"}],
                    "status": "success",
                },
                "timestamp": 2,
            },
        ]

        formatted = format_messages_for_chat(messages, load_files=False)

        # Should format as proper Bedrock tool blocks
        self.assertEqual(len(formatted), 2)
        self.assertEqual(formatted[0]["role"], "assistant")
        self.assertIn("toolUse", formatted[0]["content"][0])
        self.assertEqual(formatted[1]["role"], "user")
        self.assertIn("toolResult", formatted[1]["content"][0])


if __name__ == "__main__":
    unittest.main()
