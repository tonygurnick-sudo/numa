"""Tests for material tool verification in the Pipedream router."""

import os
from unittest.mock import MagicMock, patch

# Set up environment before imports
os.environ.setdefault("BUCKET", "test-bucket")
os.environ.setdefault("AWS_REGION", "us-east-1")
os.environ.setdefault("CLIENT_NAME", "acme")

# pylint: disable=wrong-import-position
from numa_chat_agent.intent_verification import IntentVerificationResult
from numa_chat_agent.mcp.providers.pipedream.router import (
    PipedreamToolDefinition,
    ToolsOnlyIntegrationRouter,
    _get_material_tool_config,
    _is_material_tool,
)


class TestIsMaterialTool:
    """Tests for the _is_material_tool function."""

    def test_send_tool_is_material(self):
        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ):
            assert _is_material_tool("send_email") is True
            assert _is_material_tool("send_message") is True
            assert _is_material_tool("slack_send_direct_message") is True

    def test_reply_tool_is_material(self):
        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ):
            assert _is_material_tool("reply_to_email") is True
            assert _is_material_tool("reply_message") is True
            assert _is_material_tool("auto_reply") is True

    def test_delete_tool_is_material(self):
        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ):
            assert _is_material_tool("delete_email") is True
            assert _is_material_tool("delete_message") is True
            assert _is_material_tool("bulk_delete") is True

    def test_non_material_tools(self):
        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ):
            assert _is_material_tool("list_emails") is False
            assert _is_material_tool("get_message") is False
            assert _is_material_tool("search_files") is False
            assert _is_material_tool("read_inbox") is False

    def test_case_insensitive_matching(self):
        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ):
            assert _is_material_tool("SEND_EMAIL") is True
            assert _is_material_tool("Send_Message") is True
            assert _is_material_tool("DELETE_Item") is True

    def test_disabled_via_env_var(self):
        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            False,
        ):
            assert _is_material_tool("send_email") is False
            assert _is_material_tool("delete_message") is False
            assert _is_material_tool("reply_to_email") is False


class TestGetMaterialToolConfig:
    """Tests for the _get_material_tool_config function."""

    def test_delete_tool_config(self):
        config = _get_material_tool_config("delete_email")
        assert config.action_type == "delete"
        assert "delete" in config.denial_message.lower()

    def test_reply_tool_config(self):
        config = _get_material_tool_config("reply_to_message")
        assert config.action_type == "reply"
        assert "reply" in config.denial_message.lower()

    def test_send_tool_config(self):
        config = _get_material_tool_config("send_email")
        assert config.action_type == "send"
        assert "send" in config.denial_message.lower()

    def test_delete_takes_precedence_over_send(self):
        # If a tool has both "delete" and "send" in name, delete should take precedence
        config = _get_material_tool_config("delete_and_send")
        assert config.action_type == "delete"

    def test_reply_takes_precedence_over_send(self):
        # If a tool has both "reply" and "send" in name, reply should take precedence
        config = _get_material_tool_config("reply_and_send")
        assert config.action_type == "reply"


class TestRouterMaterialToolVerification:
    """Tests for material tool verification in the router execute method."""

    def test_material_tool_denied_when_not_verified(self):
        """Material tool should be denied when intent is not verified."""
        router = ToolsOnlyIntegrationRouter(
            integration_name="gmail",
            mcp_client=MagicMock(),
            tool_definitions=[
                PipedreamToolDefinition(
                    name="send_email",
                    description="Send an email",
                    schema={"type": "object", "properties": {}},
                )
            ],
            model_id="test-model",
            external_user_id="acme_user123",
        )

        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.get_current_user_auth",
            return_value={"sub": "user-123", "conversation_id": "conv-1"},
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.verify_user_intent",
            return_value=IntentVerificationResult(
                verified=False,
                decision="NO",
                denial_message="Please confirm you want to send.",
            ),
        ):
            result = router.execute("send_email", "Send a test email")

            assert result["status"] == "denied"
            assert result["integration"] == "gmail"
            assert result["tool"] == "send_email"
            assert "confirm" in result["message"].lower()

    def test_material_tool_proceeds_when_verified(self):
        """Material tool should proceed when intent is verified."""
        mock_mcp_client = MagicMock()
        mock_mcp_client.call_tool_sync.return_value = {"status": "sent", "id": "123"}

        router = ToolsOnlyIntegrationRouter(
            integration_name="gmail",
            mcp_client=mock_mcp_client,
            tool_definitions=[
                PipedreamToolDefinition(
                    name="send_email",
                    description="Send an email",
                    schema={"type": "object", "properties": {}},
                )
            ],
            model_id="test-model",
            external_user_id="acme_user123",
        )

        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.get_current_user_auth",
            return_value={"sub": "user-123", "conversation_id": "conv-1"},
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.verify_user_intent",
            return_value=IntentVerificationResult(
                verified=True,
                decision="YES",
                denial_message=None,
            ),
        ), patch.object(
            router, "_generate_payload", return_value={}
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.postprocess_tool_result",
            return_value={"status": "success"},
        ):
            result = router.execute("send_email", "Send a test email")

            assert result["status"] == "success"

    def test_non_material_tool_skips_verification(self):
        """Non-material tools should skip verification entirely."""
        mock_mcp_client = MagicMock()
        mock_mcp_client.call_tool_sync.return_value = {"emails": []}

        router = ToolsOnlyIntegrationRouter(
            integration_name="gmail",
            mcp_client=mock_mcp_client,
            tool_definitions=[
                PipedreamToolDefinition(
                    name="list_emails",
                    description="List emails",
                    schema={"type": "object", "properties": {}},
                )
            ],
            model_id="test-model",
            external_user_id="acme_user123",
        )

        mock_verify = MagicMock()

        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.verify_user_intent",
            mock_verify,
        ), patch.object(
            router, "_generate_payload", return_value={}
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.postprocess_tool_result",
            return_value={"emails": []},
        ):
            router.execute("list_emails", "List my emails")

            # verify_user_intent should NOT have been called
            mock_verify.assert_not_called()

    def test_verification_skipped_when_no_user_context(self):
        """Verification should be skipped when no user context is available."""
        mock_mcp_client = MagicMock()
        mock_mcp_client.call_tool_sync.return_value = {"status": "sent"}

        router = ToolsOnlyIntegrationRouter(
            integration_name="gmail",
            mcp_client=mock_mcp_client,
            tool_definitions=[
                PipedreamToolDefinition(
                    name="send_email",
                    description="Send an email",
                    schema={"type": "object", "properties": {}},
                )
            ],
            model_id="test-model",
            external_user_id="acme_user123",
        )

        mock_verify = MagicMock()

        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            True,
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.get_current_user_auth",
            return_value={},  # No user context
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.verify_user_intent",
            mock_verify,
        ), patch.object(
            router, "_generate_payload", return_value={}
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.postprocess_tool_result",
            return_value={"status": "success"},
        ):
            result = router.execute("send_email", "Send a test email")

            # verify_user_intent should NOT have been called
            mock_verify.assert_not_called()
            assert result["status"] == "success"

    def test_verification_disabled_via_env_skips_check(self):
        """When verification is disabled, material tools should proceed without check."""
        mock_mcp_client = MagicMock()
        mock_mcp_client.call_tool_sync.return_value = {"status": "sent"}

        router = ToolsOnlyIntegrationRouter(
            integration_name="gmail",
            mcp_client=mock_mcp_client,
            tool_definitions=[
                PipedreamToolDefinition(
                    name="send_email",
                    description="Send an email",
                    schema={"type": "object", "properties": {}},
                )
            ],
            model_id="test-model",
            external_user_id="acme_user123",
        )

        mock_verify = MagicMock()

        with patch(
            "numa_chat_agent.mcp.providers.pipedream.router.MATERIAL_TOOL_VERIFICATION_ENABLED",
            False,  # Disabled
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.verify_user_intent",
            mock_verify,
        ), patch.object(
            router, "_generate_payload", return_value={}
        ), patch(
            "numa_chat_agent.mcp.providers.pipedream.router.postprocess_tool_result",
            return_value={"status": "success"},
        ):
            result = router.execute("send_email", "Send a test email")

            # verify_user_intent should NOT have been called
            mock_verify.assert_not_called()
            assert result["status"] == "success"
