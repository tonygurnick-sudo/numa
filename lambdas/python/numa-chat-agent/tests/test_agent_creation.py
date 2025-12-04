import unittest
from unittest.mock import patch

from numa_chat_agent.intent_verification import IntentVerificationResult
from numa_chat_agent.tools.agent_creation import (
    AgentPayload,
    AgentToolsConfig,
    create_agent_tool,
)


class TestAgentCreationTool(unittest.TestCase):
    @patch("numa_chat_agent.tools.agent_creation.get_current_user_auth")
    def test_create_agent_tool_requires_user_context(self, mock_auth):
        mock_auth.return_value = {}
        result = create_agent_tool(title="Test", system_prompt="Prompt")  # type: ignore[arg-type]
        self.assertEqual(result["status"], "error")

    @patch("numa_chat_agent.tools.agent_creation._assert_env_ready")
    @patch("numa_chat_agent.tools.agent_creation.verify_user_intent_with_context")
    @patch(
        "numa_chat_agent.tools.agent_creation.get_recent_conversation_snippets",
        return_value=("assistant: hi", "", []),
    )
    @patch(
        "numa_chat_agent.tools.agent_creation.get_current_user_auth",
        return_value={"sub": "user-123", "conversation_id": "conv-1"},
    )
    def test_create_agent_tool_denied_without_confirmation(
        self, _mock_auth, _mock_history, mock_verify, _mock_env
    ):
        mock_verify.return_value = IntentVerificationResult(
            verified=False,
            decision="NO",
            denial_message="Please confirm explicitly.",
        )
        result = create_agent_tool(title="Test", system_prompt="Prompt")  # type: ignore[arg-type]
        self.assertEqual(result["status"], "denied")
        self.assertIn("confirm", result["message"].lower())

    @patch("numa_chat_agent.tools.agent_creation._assert_env_ready")
    @patch("numa_chat_agent.tools.agent_creation._put_workspace_agent")
    @patch("numa_chat_agent.tools.agent_creation._put_user_agent")
    @patch(
        "numa_chat_agent.tools.agent_creation._normalise_reference_files",
        return_value=([], []),
    )
    @patch("numa_chat_agent.tools.agent_creation.verify_user_intent_with_context")
    @patch(
        "numa_chat_agent.tools.agent_creation.get_recent_conversation_snippets",
        return_value=("user: create an agent", "please create an agent", []),
    )
    @patch(
        "numa_chat_agent.tools.agent_creation._check_policy_allows_visibility",
        return_value=("personal", None),
    )
    @patch("numa_chat_agent.tools.agent_creation.AgentPayload.from_kwargs")
    @patch(
        "numa_chat_agent.tools.agent_creation.get_current_user_auth",
        return_value={"sub": "user-123", "conversation_id": "conv-1"},
    )
    def test_create_agent_tool_success_personal(
        self,
        _mock_auth,
        mock_payload_from_kwargs,
        _mock_policy,
        _mock_history,
        mock_verify,
        _mock_normalise,
        mock_put_user,
        mock_put_workspace,
        _mock_env,
    ):
        mock_verify.return_value = IntentVerificationResult(
            verified=True,
            decision="YES",
            denial_message=None,
        )
        payload = AgentPayload(
            title="Test Agent",
            system_prompt="Do A",
            visibility="personal",
            description=None,
            user_welcome_message=None,
            estimated_time_saved_minutes=None,
            agent_type="task",
            required_integrations=None,
            tools_config=AgentToolsConfig(),
            reference_files=None,
            created_by_name="Tester",
        )
        mock_payload_from_kwargs.return_value = payload

        mock_put_user.return_value = {}
        mock_put_workspace.return_value = {}

        result = create_agent_tool(title="Test Agent", system_prompt="Prompt")  # type: ignore[arg-type]

        self.assertEqual(result["status"], "success")
        self.assertIn("agent", result)
        self.assertEqual(result["agent"]["visibility"], "personal")
        mock_put_user.assert_called_once()
        mock_put_workspace.assert_not_called()


if __name__ == "__main__":
    unittest.main()
