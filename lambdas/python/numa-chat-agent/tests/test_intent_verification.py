"""Tests for the intent verification module."""

import unittest
from unittest.mock import patch

from numa_chat_agent.intent_verification import (
    IntentVerificationConfig,
    _build_guardrail_prompt,
    _call_fast_model_classifier,
    get_agent_creation_config,
    get_delete_config,
    get_recent_conversation_snippets,
    get_reply_config,
    get_send_config,
    verify_user_intent,
    verify_user_intent_with_context,
)


class TestIntentVerificationConfig(unittest.TestCase):
    """Tests for IntentVerificationConfig and predefined configs."""

    def test_agent_creation_config(self):
        config = get_agent_creation_config()
        self.assertEqual(config.action_type, "create_agent")
        self.assertIn("agent", config.action_description.lower())
        self.assertIn("create", config.denial_message.lower())

    def test_send_config(self):
        config = get_send_config("send_email")
        self.assertEqual(config.action_type, "send")
        self.assertIn("send_email", config.action_description)
        self.assertIn("send", config.denial_message.lower())

    def test_reply_config(self):
        config = get_reply_config("reply_to_message")
        self.assertEqual(config.action_type, "reply")
        self.assertIn("reply_to_message", config.action_description)
        self.assertIn("reply", config.denial_message.lower())

    def test_delete_config(self):
        config = get_delete_config("delete_email")
        self.assertEqual(config.action_type, "delete")
        self.assertIn("delete_email", config.action_description)
        self.assertIn("delete", config.denial_message.lower())


class TestBuildGuardrailPrompt(unittest.TestCase):
    """Tests for guardrail prompt building."""

    def test_agent_creation_prompt(self):
        config = get_agent_creation_config()
        prompt = _build_guardrail_prompt(
            config, "user: create an agent", "create an agent"
        )
        self.assertIn("create an agent", prompt)
        self.assertIn("YES or NO", prompt)

    def test_send_prompt(self):
        config = get_send_config("send_email")
        prompt = _build_guardrail_prompt(config, "user: send it", "send it")
        self.assertIn("send it", prompt)
        self.assertIn("YES or NO", prompt)

    def test_delete_prompt(self):
        config = get_delete_config("delete_message")
        prompt = _build_guardrail_prompt(config, "user: delete this", "delete this")
        self.assertIn("delete this", prompt)
        self.assertIn("YES or NO", prompt)
        self.assertIn("irreversible", prompt.lower())

    def test_custom_prompt_template(self):
        config = IntentVerificationConfig(
            action_type="custom",
            action_description="do something",
            denial_message="Cannot do this",
            prompt_template="Custom prompt: {action_description} - {latest_user_message}",
        )
        prompt = _build_guardrail_prompt(config, "context", "user message")
        self.assertEqual(prompt, "Custom prompt: do something - user message")


class TestCallFastModelClassifier(unittest.TestCase):
    """Tests for the fast model classifier."""

    @patch("numa_chat_agent.intent_verification.invoke_fast_model")
    def test_classifier_returns_yes_from_tool_use(self, mock_invoke):
        mock_invoke.return_value = (
            "",
            {},
            [{"name": "confirm_intent", "input": {"answer": "YES"}}],
        )
        result = _call_fast_model_classifier("test prompt")
        self.assertEqual(result, "YES")

    @patch("numa_chat_agent.intent_verification.invoke_fast_model")
    def test_classifier_returns_no_from_tool_use(self, mock_invoke):
        mock_invoke.return_value = (
            "",
            {},
            [{"name": "confirm_intent", "input": {"answer": "NO"}}],
        )
        result = _call_fast_model_classifier("test prompt")
        self.assertEqual(result, "NO")

    @patch("numa_chat_agent.intent_verification.invoke_fast_model")
    def test_classifier_falls_back_to_text_yes(self, mock_invoke):
        mock_invoke.return_value = ("YES based on context", {}, None)
        result = _call_fast_model_classifier("test prompt")
        self.assertEqual(result, "YES")

    @patch("numa_chat_agent.intent_verification.invoke_fast_model")
    def test_classifier_falls_back_to_text_no(self, mock_invoke):
        mock_invoke.return_value = ("NO the user did not ask", {}, None)
        result = _call_fast_model_classifier("test prompt")
        self.assertEqual(result, "NO")

    @patch("numa_chat_agent.intent_verification.invoke_fast_model")
    def test_classifier_defaults_to_no_on_exception(self, mock_invoke):
        mock_invoke.side_effect = Exception("API error")
        result = _call_fast_model_classifier("test prompt")
        self.assertEqual(result, "NO")

    @patch("numa_chat_agent.intent_verification.invoke_fast_model")
    def test_classifier_defaults_to_no_on_invalid_response(self, mock_invoke):
        mock_invoke.return_value = ("Some other response", {}, None)
        result = _call_fast_model_classifier("test prompt")
        self.assertEqual(result, "NO")


class TestVerifyUserIntentWithContext(unittest.TestCase):
    """Tests for verify_user_intent_with_context."""

    @patch("numa_chat_agent.intent_verification._call_fast_model_classifier")
    def test_verified_when_classifier_returns_yes(self, mock_classifier):
        mock_classifier.return_value = "YES"
        config = get_agent_creation_config()
        result = verify_user_intent_with_context(
            config, "user: create agent", "create agent"
        )
        self.assertTrue(result.verified)
        self.assertEqual(result.decision, "YES")
        self.assertIsNone(result.denial_message)

    @patch("numa_chat_agent.intent_verification._call_fast_model_classifier")
    def test_denied_when_classifier_returns_no(self, mock_classifier):
        mock_classifier.return_value = "NO"
        config = get_agent_creation_config()
        result = verify_user_intent_with_context(
            config, "assistant: hi", "some message"
        )
        self.assertFalse(result.verified)
        self.assertEqual(result.decision, "NO")
        self.assertEqual(result.denial_message, config.denial_message)

    @patch("numa_chat_agent.intent_verification._call_fast_model_classifier")
    def test_denied_on_classifier_exception(self, mock_classifier):
        mock_classifier.side_effect = Exception("API error")
        config = get_send_config("send_email")
        result = verify_user_intent_with_context(config, "context", "message")
        self.assertFalse(result.verified)
        self.assertEqual(result.decision, "NO")
        self.assertIsNotNone(result.denial_message)


class TestVerifyUserIntent(unittest.TestCase):
    """Tests for verify_user_intent (the main entry point)."""

    def test_skips_verification_without_conversation_id(self):
        config = get_agent_creation_config()
        result = verify_user_intent(config, None, "user-123")
        self.assertTrue(result.verified)
        self.assertEqual(result.decision, "SKIPPED")

    def test_skips_verification_without_user_id(self):
        config = get_agent_creation_config()
        result = verify_user_intent(config, "conv-123", None)
        self.assertTrue(result.verified)
        self.assertEqual(result.decision, "SKIPPED")

    @patch("numa_chat_agent.intent_verification.get_recent_conversation_snippets")
    @patch("numa_chat_agent.intent_verification._call_fast_model_classifier")
    def test_calls_classifier_with_fetched_context(
        self, mock_classifier, mock_snippets
    ):
        mock_snippets.return_value = ("user: yes", "yes", [])
        mock_classifier.return_value = "YES"
        config = get_agent_creation_config()

        result = verify_user_intent(config, "conv-123", "user-456")

        self.assertTrue(result.verified)
        mock_snippets.assert_called_once_with("conv-123", "user-456", max_items=24)
        mock_classifier.assert_called_once()

    @patch("numa_chat_agent.intent_verification.get_recent_conversation_snippets")
    def test_denied_on_context_fetch_error(self, mock_snippets):
        mock_snippets.side_effect = Exception("DynamoDB error")
        config = get_delete_config("delete_item")

        result = verify_user_intent(config, "conv-123", "user-456")

        self.assertFalse(result.verified)
        self.assertEqual(result.decision, "NO")


class TestGetRecentConversationSnippets(unittest.TestCase):
    """Tests for get_recent_conversation_snippets."""

    @patch("numa_chat_agent.intent_verification.NumaChatDynamoUtils")
    def test_returns_empty_when_no_items(self, mock_utils_class):
        mock_utils = mock_utils_class.return_value
        mock_utils.query_conversations.return_value = []

        transcript, latest, items = get_recent_conversation_snippets("conv-1", "user-1")

        self.assertEqual(transcript, "")
        self.assertEqual(latest, "")
        self.assertEqual(items, [])

    @patch("numa_chat_agent.intent_verification.NumaChatDynamoUtils")
    def test_extracts_user_assistant_messages(self, mock_utils_class):
        mock_utils = mock_utils_class.return_value
        mock_utils.query_conversations.return_value = [
            {"role": "user", "message_type": "text", "content": "Hello"},
            {"role": "assistant", "message_type": "text", "content": "Hi there"},
            {"role": "user", "message_type": "text", "content": "Create an agent"},
        ]

        transcript, latest, items = get_recent_conversation_snippets("conv-1", "user-1")

        self.assertIn("user: Hello", transcript)
        self.assertIn("assistant: Hi there", transcript)
        self.assertIn("user: Create an agent", transcript)
        self.assertEqual(latest, "Create an agent")
        self.assertEqual(len(items), 3)

    @patch("numa_chat_agent.intent_verification.NumaChatDynamoUtils")
    def test_filters_out_tool_messages(self, mock_utils_class):
        mock_utils = mock_utils_class.return_value
        mock_utils.query_conversations.return_value = [
            {"role": "user", "message_type": "text", "content": "Hello"},
            {"role": "assistant", "message_type": "tool_use", "content": "{}"},
            {"role": "tool", "message_type": "tool_result", "content": "{}"},
            {"role": "user", "message_type": "text", "content": "Yes"},
        ]

        transcript, latest, _ = get_recent_conversation_snippets("conv-1", "user-1")

        self.assertNotIn("tool_use", transcript)
        self.assertNotIn("tool_result", transcript)
        self.assertEqual(latest, "Yes")


if __name__ == "__main__":
    unittest.main()
