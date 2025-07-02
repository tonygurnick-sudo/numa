import json
import os
import unittest
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from bedrock import (
    BedrockClaude3Model,
    GPTResponse,
    QuotaLimitError,
    UnsupportedFiletypeError,
    get_text_from_image,
)
from bedrock.bedrock_model_config import (
    MODEL_MAP,
    ModelInfo,
    ModelTypes,
    Region,
    get_fallback_sequence,
    get_model_id,
    is_quota_limit_error,
)
from bedrock.model_providers import provider_registry


def normalize_content_for_test(response_data, model_id):
    """Helper function to normalize content using the provider abstraction for testing"""
    provider = provider_registry.get_provider(model_id)
    normalized_content = provider.normalize_response(response_data)

    # Convert to legacy format for test compatibility
    legacy_format = []
    for content in normalized_content:
        if content.type == "text":
            legacy_format.append({"type": "text", "text": content.text})
        elif content.type == "tool_use":
            tool_dict = {
                "type": "tool_use",
                "name": content.name,
                "input": content.input,
            }
            if content.id:
                tool_dict["id"] = content.id
            legacy_format.append(tool_dict)

    return legacy_format


class TestBedrock(unittest.TestCase):
    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_invoke_model_success(self, mock_boto_client):
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(
                read=lambda: '{"content": [{"type": "text", "text": "response text"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'
            )
        }

        model = BedrockClaude3Model()

        # Set up proper Claude model info for the test
        mock_model_info = ModelInfo(
            model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0",
            provider="anthropic",
            name="Claude 3.5 Sonnet",
        )
        model.fallback_sequence = [mock_model_info]
        model.current_model_id = mock_model_info.model_id
        model.primary_model_id = mock_model_info.model_id

        response = model.run_with_messages([])

        self.assertIsInstance(response, GPTResponse)
        # After normalization, response should be in normalized format
        self.assertEqual(response.response[0]["type"], "text")
        self.assertEqual(response.response[0]["text"], "response text")
        self.assertEqual(response.metadata["input_tokens"], 10)
        self.assertEqual(response.metadata["output_tokens"], 5)
        mock_bedrock.invoke_model.assert_called_once()

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_invoke_model_failure(self, mock_boto_client):
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.side_effect = Exception("Model invocation failed")

        model = BedrockClaude3Model()
        with self.assertRaises(Exception):
            model.run("")

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_run_with_messages_success(self, mock_boto_client):
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(
                read=lambda: '{"content": [{"type": "text", "text": "response text"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'  # noqa: E501
            )
        }

        model = BedrockClaude3Model()

        # Set up proper Claude model info for the test
        mock_model_info = ModelInfo(
            model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0",
            provider="anthropic",
            name="Claude 3.5 Sonnet",
        )
        model.fallback_sequence = [mock_model_info]
        model.current_model_id = mock_model_info.model_id
        model.primary_model_id = mock_model_info.model_id

        response = model.run_with_messages(
            [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}]
        )

        self.assertIsInstance(response, GPTResponse)
        # After normalization, response should be in normalized format
        self.assertEqual(response.response[0]["type"], "text")
        self.assertEqual(response.response[0]["text"], "response text")
        self.assertEqual(response.metadata["input_tokens"], 10)
        self.assertEqual(response.metadata["output_tokens"], 5)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_process_response_invalid_format(self, mock_boto_client):
        # Mock invalid JSON format in response
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(read=lambda: "Invalid JSON")
        }

        model = BedrockClaude3Model()
        with self.assertRaises(Exception):
            model.run_with_messages([])


class TestExtractTextFromImageUsingVisionModel(unittest.TestCase):
    @patch("bedrock.s3_client.get_object")
    @patch("bedrock.filetype.guess")
    @patch("bedrock.BedrockClaude3Model.run_with_messages")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_extract_text_success(
        self, mock_run_with_messages, mock_guess, mock_get_object
    ):
        # Mock S3 get_object response
        mock_get_object.return_value = {
            "Body": MagicMock(read=lambda: b"fake_image_data")
        }

        # Mock filetype guess response
        mock_guess.return_value = MagicMock(mime="image/jpeg")

        # Mock BedrockClaude3Model response
        mock_response = GPTResponse(response=[{"text": "Extracted text"}], metadata={})
        mock_run_with_messages.return_value = mock_response

        result = get_text_from_image("test-bucket", "test-key")

        self.assertEqual(result, "Extracted text")
        mock_get_object.assert_called_once_with(Bucket="test-bucket", Key="test-key")
        mock_guess.assert_called_once()
        mock_run_with_messages.assert_called_once()

    @patch("bedrock.s3_client.get_object")
    @patch("bedrock.filetype.guess")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_extract_text_unsupported_filetype(self, mock_guess, mock_get_object):
        # Mock S3 get_object response
        mock_get_object.return_value = {
            "Body": MagicMock(read=lambda: b"fake_image_data")
        }

        # Mock filetype guess response to return None
        mock_guess.return_value = None

        with self.assertRaises(UnsupportedFiletypeError):
            get_text_from_image("test-bucket", "test-key")

        mock_get_object.assert_called_once_with(Bucket="test-bucket", Key="test-key")
        mock_guess.assert_called_once()


class TestBedrockFallback(unittest.TestCase):
    """Tests for the fallback functionality in BedrockClaude3Model."""

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_fallback_initialization(self, _mock_boto_client):
        """Test BedrockClaude3Model initialization with fallback parameters."""
        model = BedrockClaude3Model(
            model_type=ModelTypes.DEFAULT,
            enable_fallback=True,
            claude_only=False,
            max_retries=5,
            retry_delay=2.0,
        )

        self.assertTrue(model.enable_fallback)
        self.assertFalse(model.claude_only)
        self.assertEqual(model.max_retries, 5)
        self.assertEqual(model.retry_delay, 2.0)
        self.assertTrue(len(model.fallback_sequence) > 0)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_fallback_disabled(self, _mock_boto_client):
        """Test BedrockClaude3Model with fallback disabled."""
        model = BedrockClaude3Model(enable_fallback=False)

        self.assertFalse(model.enable_fallback)
        # When fallback is disabled, should still have the primary model
        self.assertEqual(len(model.fallback_sequence), 1)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_claude_only_filter(self, _mock_boto_client):
        """Test that claude_only filters the fallback sequence correctly."""
        model_all = BedrockClaude3Model(enable_fallback=True, claude_only=False)
        self.assertFalse(model_all.claude_only)
        model_claude = BedrockClaude3Model(enable_fallback=True, claude_only=True)
        self.assertTrue(model_claude.claude_only)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_quota_limit_fallback_success(self, mock_boto_client):
        """Test successful fallback when quota limit is hit."""
        mock_bedrock = mock_boto_client.return_value

        # First call fails with quota error, second succeeds
        quota_error = ClientError(
            error_response={
                "Error": {"Code": "ThrottlingException", "Message": "Throttled"}
            },
            operation_name="InvokeModel",
        )

        mock_bedrock.invoke_model.side_effect = [
            quota_error,  # First model fails
            {  # Second model succeeds
                "body": MagicMock(
                    read=lambda: '{"content": [{"type": "text", "text": "fallback response"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'
                )
            },
        ]

        model = BedrockClaude3Model(enable_fallback=True)

        # Mock the fallback sequence to ensure we have Claude as fallback
        claude_model_info = ModelInfo(
            model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0",
            provider="anthropic",
            name="Claude 3.5 Sonnet",
        )
        nova_model_info = ModelInfo(
            model_id="us.amazon.nova-premier-v1:0",
            provider="amazon",
            name="Nova Premier",
        )
        model.fallback_sequence = [
            nova_model_info,
            claude_model_info,
        ]  # Nova first, Claude fallback
        model.current_model_id = nova_model_info.model_id
        model.primary_model_id = nova_model_info.model_id

        response = model.run_with_messages(
            [{"role": "user", "content": [{"type": "text", "text": "test"}]}]
        )

        self.assertIsInstance(response, GPTResponse)
        # After normalization, response should be in normalized format
        self.assertEqual(response.response[0]["type"], "text")
        self.assertEqual(response.response[0]["text"], "fallback response")
        self.assertEqual(mock_bedrock.invoke_model.call_count, 2)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_all_models_quota_exhausted(self, mock_boto_client):
        """Test QuotaLimitError when all models are exhausted."""
        mock_bedrock = mock_boto_client.return_value

        # All calls fail with quota error
        quota_error = ClientError(
            error_response={
                "Error": {
                    "Code": "ServiceQuotaExceededException",
                    "Message": "Quota exceeded",
                }
            },
            operation_name="InvokeModel",
        )
        mock_bedrock.invoke_model.side_effect = quota_error

        model = BedrockClaude3Model(enable_fallback=True)

        with self.assertRaises(QuotaLimitError):
            model.run_with_messages(
                [{"role": "user", "content": [{"type": "text", "text": "test"}]}]
            )

        # Should have tried multiple models
        self.assertGreater(mock_bedrock.invoke_model.call_count, 1)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_non_quota_error_retry(self, mock_boto_client):
        """Test retry logic for non-quota errors."""
        mock_bedrock = mock_boto_client.return_value

        # First call fails with non-quota error, second succeeds
        non_quota_error = ClientError(
            error_response={
                "Error": {"Code": "ValidationException", "Message": "Invalid parameter"}
            },
            operation_name="InvokeModel",
        )

        mock_bedrock.invoke_model.side_effect = [
            non_quota_error,  # First attempt fails
            {  # Retry succeeds
                "body": MagicMock(
                    read=lambda: '{"content": [{"type": "text", "text": "retry success"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'
                )
            },
        ]

        model = BedrockClaude3Model(enable_fallback=True, max_retries=3)

        # Set up proper Claude model info for the test
        mock_model_info = ModelInfo(
            model_id="us.anthropic.claude-3-5-sonnet-20241022-v2:0",
            provider="anthropic",
            name="Claude 3.5 Sonnet",
        )
        model.fallback_sequence = [mock_model_info]
        model.current_model_id = mock_model_info.model_id
        model.primary_model_id = mock_model_info.model_id

        response = model.run_with_messages(
            [{"role": "user", "content": [{"type": "text", "text": "test"}]}]
        )

        self.assertIsInstance(response, GPTResponse)
        # After normalization, response should be in normalized format
        self.assertEqual(response.response[0]["type"], "text")
        self.assertEqual(response.response[0]["text"], "retry success")
        self.assertEqual(mock_bedrock.invoke_model.call_count, 2)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "ap-southeast-2"})
    def test_sydney_region_fallback(self, _mock_boto_client):
        """Test fallback sequence for Sydney region."""
        model = BedrockClaude3Model(enable_fallback=True)
        sequence = (
            model._get_model_sequence()  # pylint: disable=protected-access # Testing regional fallback
        )

        # Should have multiple models in sequence
        self.assertGreater(len(sequence), 1)

        # Primary model should be Sydney Claude model
        expected_primary = MODEL_MAP[Region.AP_SOUTHEAST_2][ModelTypes.DEFAULT]
        self.assertEqual(model.primary_model_id, expected_primary)

    def test_model_used_tracking(self):
        """Test that GPTResponse tracks which model was used."""
        response = GPTResponse(
            response=[{"text": "test"}],
            metadata={"input_tokens": 10, "output_tokens": 5},
            model_used="test-model-id",
        )

        self.assertEqual(response.model_used, "test-model-id")

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_reset_to_primary_model(self, _mock_boto_client):
        """Test resetting to primary model."""
        model = BedrockClaude3Model(enable_fallback=True)
        original_primary = model.primary_model_id

        # Change current model
        model.current_model_id = "different-model"
        self.assertNotEqual(model.current_model_id, original_primary)

        # Reset to primary
        model.reset_to_primary_model()
        self.assertEqual(model.current_model_id, original_primary)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_request_builder_integration_nova(self, mock_boto_client):
        """Test that Nova models automatically get tool conversion."""
        mock_bedrock = mock_boto_client.return_value

        # Mock successful Nova response
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(
                read=lambda: '{"content": [{"type": "text", "text": "Nova response with tools"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'
            )
        }

        # Create model with tools that should be converted for Nova
        model_args = {
            "tools": [
                {
                    "name": "test_tool",
                    "description": "A test tool",
                    "input_schema": {
                        "type": "object",
                        "properties": {"param": {"type": "string"}},
                        "required": ["param"],
                    },
                }
            ],
            "tool_choice": {"type": "tool", "name": "test_tool"},
            "max_tokens": 1000,
        }

        model = BedrockClaude3Model(
            model_type=ModelTypes.DEFAULT, model_args=model_args, enable_fallback=True
        )

        # Force fallback to Nova model by making first two Claude models fail
        quota_error = ClientError(
            error_response={
                "Error": {"Code": "ThrottlingException", "Message": "Throttled"}
            },
            operation_name="InvokeModel",
        )
        mock_bedrock.invoke_model.side_effect = [
            quota_error,  # Claude 3.7 Sonnet fails (index 0)
            quota_error,  # Claude 3.5 Sonnet V2 fails (index 1)
            mock_bedrock.invoke_model.return_value,  # Nova Premier succeeds (index 2)
        ]

        model.run("Test message with tools")

        # Should have called invoke_model three times (two Claude fails, Nova success)
        self.assertEqual(mock_bedrock.invoke_model.call_count, 3)

        # Check that the third call (Nova Premier) has proper tool conversion
        third_call = mock_bedrock.invoke_model.call_args_list[2]
        request_body = json.loads(third_call[1]["body"])

        # Nova request should have toolConfig instead of tools
        self.assertIn("toolConfig", request_body)
        self.assertNotIn("tools", request_body)
        self.assertIn("inferenceConfig", request_body)

        # Verify tool conversion
        tool_config = request_body["toolConfig"]
        self.assertIn("tools", tool_config)
        self.assertIn("toolChoice", tool_config)

        # Check tool format conversion
        nova_tool = tool_config["tools"][0]
        self.assertIn("toolSpec", nova_tool)
        self.assertEqual(nova_tool["toolSpec"]["name"], "test_tool")

        # Check tool choice conversion
        self.assertEqual(tool_config["toolChoice"], {"tool": {"name": "test_tool"}})

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_normalize_content_claude_text(self, _mock_boto_client):
        """Test content normalization for Claude text responses."""
        # Real Claude text response from our test
        claude_result = {
            "id": "msg_bdrk_01VoQqUQmDh2dQWfRAN4yiBJ",
            "type": "message",
            "role": "assistant",
            "model": "claude-3-5-sonnet-20241022",
            "content": [{"type": "text", "text": "SUCCESS"}],
            "stop_reason": "end_turn",
            "stop_sequence": None,
            "usage": {"input_tokens": 19, "output_tokens": 4},
        }

        model_id = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"
        normalized = normalize_content_for_test(claude_result, model_id)

        expected = [{"type": "text", "text": "SUCCESS"}]
        self.assertEqual(normalized, expected)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_normalize_content_nova_text(self, _mock_boto_client):
        """Test content normalization for Nova text responses."""
        # Real Nova text response from our test
        nova_result = {
            "output": {
                "message": {
                    "content": [
                        {"text": "SUCCESS\n\nI have provided the response you"}
                    ],
                    "role": "assistant",
                }
            },
            "stopReason": "max_tokens",
            "usage": {
                "inputTokens": 11,
                "outputTokens": 10,
                "totalTokens": 21,
                "cacheReadInputTokenCount": 0,
                "cacheWriteInputTokenCount": 0,
            },
        }

        model_id = "us.amazon.nova-premier-v1:0"
        normalized = normalize_content_for_test(nova_result, model_id)

        expected = [
            {"type": "text", "text": "SUCCESS\n\nI have provided the response you"}
        ]
        self.assertEqual(normalized, expected)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_normalize_content_claude_tool_call(self, _mock_boto_client):
        """Test content normalization for Claude tool call responses."""
        # Real Claude tool call response from our test
        claude_result = {
            "id": "msg_bdrk_01BkStptntNrDkRKzqk2rJw9",
            "type": "message",
            "role": "assistant",
            "model": "claude-3-5-sonnet-20241022",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_bdrk_01WjHj69KazViq1E4jrWKBj3",
                    "name": "get_weather",
                    "input": {"location": "Sydney"},
                }
            ],
            "stop_reason": "tool_use",
            "stop_sequence": None,
            "usage": {"input_tokens": 391, "output_tokens": 33},
        }

        model_id = "us.anthropic.claude-3-5-sonnet-20241022-v2:0"
        normalized = normalize_content_for_test(claude_result, model_id)

        expected = [
            {
                "type": "tool_use",
                "id": "toolu_bdrk_01WjHj69KazViq1E4jrWKBj3",
                "name": "get_weather",
                "input": {"location": "Sydney"},
            }
        ]
        self.assertEqual(normalized, expected)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_normalize_content_nova_tool_call(self, _mock_boto_client):
        """Test content normalization for Nova tool call responses."""
        # Real Nova tool call response from our test
        nova_result = {
            "output": {
                "message": {
                    "content": [
                        {
                            "toolUse": {
                                "name": "get_weather",
                                "toolUseId": "eecd08f9-e1d3-4bff-aa6c-f0556ab3d4c1",
                                "input": {"location": "Sydney"},
                            }
                        }
                    ],
                    "role": "assistant",
                }
            },
            "stopReason": "tool_use",
            "usage": {
                "inputTokens": 692,
                "outputTokens": 7,
                "totalTokens": 699,
                "cacheReadInputTokenCount": 0,
                "cacheWriteInputTokenCount": 0,
            },
        }

        model_id = "us.amazon.nova-premier-v1:0"
        normalized = normalize_content_for_test(nova_result, model_id)

        expected = [
            {
                "type": "tool_use",
                "name": "get_weather",
                "input": {"location": "Sydney"},
                "id": "eecd08f9-e1d3-4bff-aa6c-f0556ab3d4c1",
            }
        ]
        self.assertEqual(normalized, expected)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_normalize_content_mixed_response(self, _mock_boto_client):
        """Test content normalization for responses with both text and tool calls."""
        # Example Nova response with both text and tool call
        nova_result = {
            "output": {
                "message": {
                    "content": [
                        {"text": "I'll help you get the weather information."},
                        {
                            "toolUse": {
                                "name": "get_weather",
                                "toolUseId": "test-id-123",
                                "input": {"location": "Sydney"},
                            }
                        },
                        {"text": "Let me check that for you."},
                    ],
                    "role": "assistant",
                }
            },
            "stopReason": "tool_use",
            "usage": {"inputTokens": 50, "outputTokens": 20, "totalTokens": 70},
        }

        model_id = "us.amazon.nova-premier-v1:0"
        normalized = normalize_content_for_test(nova_result, model_id)

        expected = [
            {"type": "text", "text": "I'll help you get the weather information."},
            {
                "type": "tool_use",
                "name": "get_weather",
                "input": {"location": "Sydney"},
                "id": "test-id-123",
            },
            {"type": "text", "text": "Let me check that for you."},
        ]
        self.assertEqual(normalized, expected)

    @patch("bedrock.boto3.client")
    @patch.dict(os.environ, {"AWS_REGION": "us-east-1"})
    def test_normalize_content_downstream_compatibility(self, _mock_boto_client):
        """Test that normalized content works with downstream code patterns."""
        # Test the document summarizer pattern: response.response[0]["input"]
        nova_tool_result = {
            "output": {
                "message": {
                    "content": [
                        {
                            "toolUse": {
                                "name": "summarize_document",
                                "toolUseId": "summary-id-456",
                                "input": {
                                    "markdown_summary": "**Summary:**\n- Key point 1\n- Key point 2"
                                },
                            }
                        }
                    ],
                    "role": "assistant",
                }
            },
            "stopReason": "tool_use",
            "usage": {"inputTokens": 100, "outputTokens": 50, "totalTokens": 150},
        }

        model_id = "us.amazon.nova-premier-v1:0"
        normalized = normalize_content_for_test(nova_tool_result, model_id)

        # Verify the downstream pattern works
        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["type"], "tool_use")
        self.assertEqual(normalized[0]["name"], "summarize_document")

        # This is the key pattern used in document-summariser lambda
        tool_input = normalized[0]["input"]
        self.assertEqual(
            tool_input["markdown_summary"], "**Summary:**\n- Key point 1\n- Key point 2"
        )

        # Verify the exact pattern: response.response[0]["input"]
        # (This would be: normalized[0]["input"] in our test context)
        summary_result = normalized[0]["input"]
        self.assertIn("markdown_summary", summary_result)
        self.assertIsInstance(summary_result["markdown_summary"], str)


class TestBedrockModelConfig(unittest.TestCase):
    """Tests for the bedrock_model_config module and its functions."""

    def test_model_map_completeness(self):
        """Test get_model_id with valid enum values."""
        # Test every combination in the MODEL_MAP
        for region in Region:
            for model_type in ModelTypes:
                model_id = get_model_id(region, model_type)
                self.assertIsInstance(model_id, str)
                self.assertTrue(len(model_id) > 0)

    def test_default_parameter(self):
        """Test the default parameter behavior of get_model_id."""
        # Should use DEFAULT if no model_type is provided
        with_param = get_model_id(Region.US_EAST_1, ModelTypes.DEFAULT)
        without_param = get_model_id(Region.US_EAST_1)

        # Check that both calls return the same value
        self.assertEqual(with_param, without_param)

        # Also check that the actual value is correct
        expected_model_id = MODEL_MAP[Region.US_EAST_1][ModelTypes.DEFAULT]
        self.assertEqual(with_param, expected_model_id)

    def test_fallback_sequence_retrieval(self):
        """Test get_fallback_sequence function."""
        # Test US East 1
        us_sequence = get_fallback_sequence(Region.US_EAST_1)
        self.assertIsInstance(us_sequence, list)
        self.assertGreater(len(us_sequence), 0)

        for model_info in us_sequence:
            self.assertIsInstance(model_info, ModelInfo)
            self.assertIsInstance(model_info.model_id, str)
            self.assertIsInstance(model_info.provider, str)
            self.assertIsInstance(model_info.name, str)

        # Test Sydney
        au_sequence = get_fallback_sequence(Region.AP_SOUTHEAST_2)
        self.assertIsInstance(au_sequence, list)
        self.assertGreater(len(au_sequence), 0)

    def test_fallback_sequence_claude_only(self):
        """Test get_fallback_sequence with claude_only=True."""
        us_all = get_fallback_sequence(Region.US_EAST_1, claude_only=False)
        us_claude_only = get_fallback_sequence(Region.US_EAST_1, claude_only=True)

        # Claude-only should be subset of all models
        self.assertLessEqual(len(us_claude_only), len(us_all))

        # All models in claude-only sequence should support Claude tools
        for model_info in us_claude_only:
            self.assertTrue("claude" in model_info.model_id.lower())

    def test_is_quota_limit_error(self):
        """Test quota limit error detection."""
        # Test quota errors
        quota_errors = [
            ClientError(
                error_response={
                    "Error": {"Code": "ThrottlingException", "Message": "Throttled"}
                },
                operation_name="InvokeModel",
            ),
            ClientError(
                error_response={
                    "Error": {
                        "Code": "ServiceQuotaExceededException",
                        "Message": "Quota exceeded",
                    }
                },
                operation_name="InvokeModel",
            ),
            ClientError(
                error_response={
                    "Error": {
                        "Code": "ModelNotReadyException",
                        "Message": "Model not ready",
                    }
                },
                operation_name="InvokeModel",
            ),
        ]

        for error in quota_errors:
            self.assertTrue(is_quota_limit_error(error))

        # Test non-quota errors
        non_quota_errors = [
            ClientError(
                error_response={
                    "Error": {
                        "Code": "ValidationException",
                        "Message": "Invalid parameter",
                    }
                },
                operation_name="InvokeModel",
            ),
            ClientError(
                error_response={
                    "Error": {
                        "Code": "AccessDeniedException",
                        "Message": "Access denied",
                    }
                },
                operation_name="InvokeModel",
            ),
        ]

        for error in non_quota_errors:
            self.assertFalse(is_quota_limit_error(error))

        # Test non-ClientError
        regular_error = Exception("Regular error")
        self.assertFalse(is_quota_limit_error(regular_error))

    def test_invalid_region_fallback_sequence(self):
        """Test error handling for invalid region in fallback sequence."""
        with self.assertRaises(ValueError):
            # This should fail since we're using an invalid region
            # Cast to Region to satisfy type checker but the function will still raise ValueError
            get_fallback_sequence("invalid-region")  # type: ignore


if __name__ == "__main__":
    unittest.main()
