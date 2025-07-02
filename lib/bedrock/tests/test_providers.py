"""Tests for AmazonProvider and model provider registry."""

import unittest

from bedrock.model_providers import AmazonProvider, provider_registry


class TestProviders(unittest.TestCase):
    """Test cases for model providers."""

    def setUp(self):
        """Set up test data."""
        self.sample_claude_tool = {
            "name": "calculator",
            "description": "A simple calculator tool",
            "input_schema": {
                "type": "object",
                "properties": {
                    "operation": {"type": "string", "description": "Math operation"},
                    "a": {"type": "number", "description": "First number"},
                    "b": {"type": "number", "description": "Second number"},
                },
                "required": ["operation", "a", "b"],
            },
        }

        self.sample_messages = [
            {"role": "user", "content": [{"type": "text", "text": "Calculate 2 + 2"}]}
        ]

        self.sample_model_args = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "temperature": 0.1,
            "top_p": 0.9,
            "tools": [self.sample_claude_tool],
            "tool_choice": {"type": "tool", "name": "calculator"},
        }

    def test_wrap_tool_for_nova(self):
        """Test Claude tool to Nova tool conversion."""
        amazon_provider = AmazonProvider()
        nova_tool = (
            amazon_provider._wrap_tool_for_nova(  # pylint: disable=protected-access
                self.sample_claude_tool
            )
        )

        expected_nova_tool = {
            "toolSpec": {
                "name": "calculator",
                "description": "A simple calculator tool",
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": {
                            "operation": {
                                "type": "string",
                                "description": "Math operation",
                            },
                            "a": {"type": "number", "description": "First number"},
                            "b": {"type": "number", "description": "Second number"},
                        },
                        "required": ["operation", "a", "b"],
                    }
                },
            }
        }

        self.assertEqual(nova_tool, expected_nova_tool)

    def test_wrap_tool_for_nova_no_description(self):
        """Test tool conversion when description is missing."""
        tool_without_desc = {
            "name": "test_tool",
            "input_schema": {"type": "object", "properties": {}},
        }

        amazon_provider = AmazonProvider()
        nova_tool = (
            amazon_provider._wrap_tool_for_nova(  # pylint: disable=protected-access
                tool_without_desc
            )
        )
        self.assertEqual(nova_tool["toolSpec"]["description"], "")
        self.assertEqual(nova_tool["toolSpec"]["name"], "test_tool")

    def test_translate_tool_choice_specific(self):
        """Test tool choice translation for specific tool."""
        claude_choice = {"type": "tool", "name": "calculator"}
        amazon_provider = AmazonProvider()
        nova_choice = (
            amazon_provider._translate_tool_choice(  # pylint: disable=protected-access
                claude_choice
            )
        )

        expected = {"tool": {"name": "calculator"}}
        self.assertEqual(nova_choice, expected)

    def test_translate_tool_choice_any(self):
        """Test tool choice translation for any tool."""
        amazon_provider = AmazonProvider()

        # Test with None
        nova_choice = (
            amazon_provider._translate_tool_choice(  # pylint: disable=protected-access
                None
            )
        )
        self.assertEqual(nova_choice, {"any": {}})

        # Test with auto type
        claude_choice = {"type": "auto"}
        nova_choice = (
            amazon_provider._translate_tool_choice(  # pylint: disable=protected-access
                claude_choice
            )
        )
        self.assertEqual(nova_choice, {"any": {}})

    def test_convert_inference_config(self):
        """Test inference parameter conversion."""
        model_args = {
            "max_tokens": 2048,
            "temperature": 0.1,
            "top_p": 0.9,
            "top_k": 50,
            "stop_sequences": ["Human:", "AI:"],
            "anthropic_version": "bedrock-2023-05-31",  # Should be ignored
            "tools": [],  # Should be ignored
        }

        amazon_provider = AmazonProvider()
        inference_config = amazon_provider._convert_inference_config(  # pylint: disable=protected-access
            model_args
        )

        expected = {
            "maxTokens": 2048,
            "temperature": 0.1,
            "topP": 0.9,
            "topK": 50,
            "stopSequences": ["Human:", "AI:"],
        }

        self.assertEqual(inference_config, expected)

    def test_provider_registry_integration(self):
        """Test that the provider registry works correctly with request builder."""
        # Test Claude provider
        claude_model_id = "us.anthropic.claude-3-5-sonnet-20240620-v1:0"
        claude_provider = provider_registry.get_provider(claude_model_id)
        self.assertEqual(claude_provider.provider_name, "anthropic")

        # Test Nova provider
        nova_model_id = "us.amazon.nova-premier-v1:0"
        nova_provider = provider_registry.get_provider(nova_model_id)
        self.assertEqual(nova_provider.provider_name, "amazon")

        # Test request normalization through provider
        claude_request = claude_provider.normalize_request(
            self.sample_messages, self.sample_model_args
        )
        self.assertIn("tools", claude_request)
        self.assertIn("anthropic_version", claude_request)

        nova_request = nova_provider.normalize_request(
            self.sample_messages, self.sample_model_args
        )
        self.assertIn("toolConfig", nova_request)
        self.assertIn("inferenceConfig", nova_request)
        self.assertNotIn("anthropic_version", nova_request)


if __name__ == "__main__":
    unittest.main()
