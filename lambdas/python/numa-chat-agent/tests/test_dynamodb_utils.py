"""
Unit tests for DynamoDB utilities - conversation handling migration.

Tests the core functions added/changed in the backend conversation handling migration.
"""

import sys
import unittest
from unittest.mock import Mock

from numa_chat_agent.dynamodb_utils import (
    MAX_CONVERSATION_TURNS,
    MAX_WORDS,
    format_messages_for_chat,
    group_messages_by_conversation_turns,
    truncate_conversation_history,
    validate_and_clean_tool_pairs,
    word_count,
)

# Mock external dependencies before importing
sys.modules["structlog"] = Mock()
sys.modules["boto3"] = Mock()


class TestConversationMemoryFunctions(unittest.TestCase):
    """Test conversation memory management functions."""

    def test_word_count(self):
        """Test word counting for memory limits."""
        self.assertEqual(word_count("hello world"), 2)
        self.assertEqual(word_count("  hello   world  "), 2)
        self.assertEqual(word_count(""), 0)
        self.assertEqual(word_count(None), 0)

    def test_group_messages_by_conversation_turns(self):
        """Test turn-based grouping for memory management."""
        messages = [
            {"role": "user", "message_type": "text", "content": "Hello"},
            {"role": "assistant", "message_type": "text", "content": "Hi"},
            {"role": "assistant", "message_type": "tool_call", "tool_name": "search"},
            {"role": "user", "message_type": "tool_result", "content": "Result"},
            {"role": "assistant", "message_type": "text", "content": "Done"},
            {"role": "user", "message_type": "text", "content": "Thanks"},
        ]

        turns = group_messages_by_conversation_turns(messages)

        # Should have 2 turns: first conversation + tool sequence, second user message
        self.assertEqual(len(turns), 2)
        self.assertEqual(len(turns[0]), 5)  # Complete interaction
        self.assertEqual(len(turns[1]), 1)  # New user message

    def test_truncate_conversation_history_by_turns(self):
        """Test new turn-based truncation (key migration feature)."""
        # Create 35 separate user messages (exceeds MAX_CONVERSATION_TURNS of 30)
        messages = []
        for i in range(35):
            messages.append(
                {
                    "role": "user",
                    "message_type": "text",
                    "content": f"Message {i}",
                    "timestamp": i,
                }
            )

        truncated = truncate_conversation_history(messages)

        # Should be limited by turn count
        turns = group_messages_by_conversation_turns(truncated)
        self.assertLessEqual(len(turns), MAX_CONVERSATION_TURNS)

        # Should keep most recent messages
        self.assertIn("Message", truncated[-1]["content"])

    def test_truncate_conversation_history_by_word_limit(self):
        """Test new 25K word limit (increased from 7.5K)."""
        # Create messages exceeding 25K words
        messages = []
        for i in range(10):
            # 3000 words each = 30K total words > 25K limit
            content = " ".join(["word"] * 3000)
            messages.append(
                {
                    "role": "user",
                    "message_type": "text",
                    "content": content,
                    "timestamp": i,
                }
            )

        truncated = truncate_conversation_history(messages)

        # Should be truncated due to word limit
        total_words = sum(word_count(msg.get("content", "")) for msg in truncated)
        self.assertLessEqual(total_words, MAX_WORDS)

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

    def test_memory_constants_updated(self):
        """Test new memory limits are properly set."""
        self.assertEqual(MAX_WORDS, 25000)  # Increased from 7500
        self.assertEqual(MAX_CONVERSATION_TURNS, 30)  # New turn-based limit


if __name__ == "__main__":
    unittest.main()
