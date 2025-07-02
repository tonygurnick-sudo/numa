import unittest
from unittest.mock import MagicMock, patch

from lambda_function import handler


class TestLambdaFunction(unittest.TestCase):
    """Tests for the main Lambda handler"""

    def setUp(self):
        """Set up test fixtures"""
        self.mock_event = {
            "connectionId": "test-connection-123",
            "requestContext": {
                "domainName": "test.execute-api.us-east-1.amazonaws.com"
            },
            "prompt": "What is the company policy on remote work?",
            "messages": [{"role": "user", "content": "Previous message"}],
            "enabledTools": ["query_knowledge_base", "web_search"],
            "systemPrompt": "You are a helpful assistant",
            "userAuth": {
                "idToken": "mock-id-token",
                "email": "user@example.com",
                "groups": ["admin"],
                "groups_config": {
                    "admin": {"roleArn": "arn:aws:iam::123:role/TestRole"}
                },
            },
        }
        self.mock_context = MagicMock()

    @patch("lambda_function.run_agent_stream")
    @patch("lambda_function.create_fresh_agent")
    @patch("lambda_function.build_websocket_endpoint")
    @patch("lambda_function.set_current_user_auth")
    @patch("lambda_function.clear_current_user_auth")
    def test_handler_success(
        self,
        mock_clear_auth,
        mock_set_auth,
        mock_build_endpoint,
        mock_create_agent,
        mock_run_stream,
    ):
        """Test successful handler execution with all parameters"""
        # Setup mocks
        mock_build_endpoint.return_value = (
            "https://test.execute-api.us-east-1.amazonaws.com"
        )
        mock_agent = MagicMock()
        mock_create_agent.return_value = mock_agent
        mock_run_stream.return_value = None

        # Execute handler
        result = handler(self.mock_event, self.mock_context)

        # Verify calls
        mock_set_auth.assert_called_once_with(self.mock_event["userAuth"])
        mock_build_endpoint.assert_called_once_with(self.mock_event["requestContext"])
        mock_create_agent.assert_called_once_with(
            self.mock_event["enabledTools"], self.mock_event["systemPrompt"], None
        )
        mock_clear_auth.assert_called_once()

        # Verify response
        self.assertEqual(result["statusCode"], 200)
        self.assertEqual(result["connectionId"], "test-connection-123")
        self.assertEqual(result["status"], "completed")

    @patch("lambda_function.create_fresh_agent")
    def test_handler_missing_connection_id(self, _):
        """Test handler with missing required connectionId"""
        event = {
            "requestContext": {
                "domainName": "test.execute-api.us-east-1.amazonaws.com"
            },
            "prompt": "Test prompt",
        }

        with self.assertRaises(KeyError):
            handler(event, self.mock_context)

    @patch("lambda_function.run_agent_stream")
    @patch("lambda_function.create_fresh_agent")
    @patch("lambda_function.build_websocket_endpoint")
    @patch("lambda_function.set_current_user_auth")
    @patch("lambda_function.clear_current_user_auth")
    def test_handler_defaults(
        self,
        _mock_clear_auth,
        mock_set_auth,
        mock_build_endpoint,
        mock_create_agent,
        _mock_run_stream,
    ):
        """Test handler with minimal parameters (defaults applied)"""
        minimal_event = {
            "connectionId": "test-connection-123",
            "requestContext": {
                "domainName": "test.execute-api.us-east-1.amazonaws.com"
            },
            "prompt": "Test prompt",
        }

        mock_build_endpoint.return_value = (
            "https://test.execute-api.us-east-1.amazonaws.com"
        )
        mock_agent = MagicMock()
        mock_create_agent.return_value = mock_agent

        result = handler(minimal_event, self.mock_context)

        # Verify defaults were used
        mock_create_agent.assert_called_once_with(
            ["query_knowledge_base", "web_search"],  # Default tools
            "",  # Default empty system prompt
            None,  # Default model_id
        )
        mock_set_auth.assert_called_once_with(None)  # No user auth

        self.assertEqual(result["statusCode"], 200)

    @patch("lambda_function.create_fresh_agent")
    @patch("lambda_function.build_websocket_endpoint")
    @patch("lambda_function.set_current_user_auth")
    @patch("lambda_function.clear_current_user_auth")
    def test_handler_agent_creation_failure(
        self, mock_clear_auth, _mock_set_auth, mock_build_endpoint, mock_create_agent
    ):
        """Test handler when agent creation fails"""
        mock_build_endpoint.return_value = (
            "https://test.execute-api.us-east-1.amazonaws.com"
        )
        mock_create_agent.side_effect = ValueError("Agent creation failed")

        # Mock the error WebSocket sending
        with patch("lambda_function.send_error_message") as mock_send_error:
            mock_send_error.return_value = True

            result = handler(self.mock_event, self.mock_context)

            # Verify error response
            self.assertEqual(result["statusCode"], 500)
            self.assertEqual(result["status"], "failed")
            self.assertIn("Agent creation failed", result["error"])

        # Verify cleanup was called
        mock_clear_auth.assert_called_once()

    @patch("lambda_function.run_agent_stream")
    @patch("lambda_function.create_fresh_agent")
    @patch("lambda_function.build_websocket_endpoint")
    @patch("lambda_function.set_current_user_auth")
    @patch("lambda_function.clear_current_user_auth")
    def test_handler_streaming_failure(
        self,
        mock_clear_auth,
        _mock_set_auth,
        mock_build_endpoint,
        mock_create_agent,
        mock_run_stream,
    ):
        """Test handler when streaming fails"""
        mock_build_endpoint.return_value = (
            "https://test.execute-api.us-east-1.amazonaws.com"
        )
        mock_agent = MagicMock()
        mock_create_agent.return_value = mock_agent
        mock_run_stream.side_effect = RuntimeError("Streaming failed")

        with patch("lambda_function.send_error_message") as mock_send_error:
            mock_send_error.return_value = True

            result = handler(self.mock_event, self.mock_context)

            # Verify error response
            self.assertEqual(result["statusCode"], 500)
            self.assertEqual(result["status"], "failed")
            self.assertIn("Streaming failed", result["error"])

        # Verify cleanup was called
        mock_clear_auth.assert_called_once()

    @patch("lambda_function.run_agent_stream")
    @patch("lambda_function.create_fresh_agent")
    @patch("lambda_function.build_websocket_endpoint")
    @patch("lambda_function.set_current_user_auth")
    @patch("lambda_function.clear_current_user_auth")
    def test_handler_user_auth_context(
        self,
        mock_clear_auth,
        mock_set_auth,
        mock_build_endpoint,
        mock_create_agent,
        _mock_run_stream,
    ):
        """Test that user authentication context is properly managed"""
        mock_build_endpoint.return_value = (
            "https://test.execute-api.us-east-1.amazonaws.com"
        )
        mock_agent = MagicMock()
        mock_create_agent.return_value = mock_agent

        handler(self.mock_event, self.mock_context)

        # Verify user auth was set with correct data
        mock_set_auth.assert_called_once_with(self.mock_event["userAuth"])

        # Verify user auth was cleared in finally block
        mock_clear_auth.assert_called_once()

    @patch("lambda_function.run_agent_stream")
    @patch("lambda_function.create_fresh_agent")
    @patch("lambda_function.build_websocket_endpoint")
    @patch("lambda_function.set_current_user_auth")
    @patch("lambda_function.clear_current_user_auth")
    def test_handler_websocket_error_sending_fails(
        self,
        mock_clear_auth,
        _mock_set_auth,
        mock_build_endpoint,
        mock_create_agent,
        mock_run_stream,
    ):
        """Test handler when both main processing and error WebSocket sending fail"""
        mock_build_endpoint.return_value = (
            "https://test.execute-api.us-east-1.amazonaws.com"
        )
        mock_agent = MagicMock()
        mock_create_agent.return_value = mock_agent
        mock_run_stream.side_effect = RuntimeError("Streaming failed")

        with patch("lambda_function.send_error_message") as mock_send_error:
            mock_send_error.side_effect = Exception("WebSocket send failed")

            result = handler(self.mock_event, self.mock_context)

            # Should still return error response even if WebSocket fails
            self.assertEqual(result["statusCode"], 500)
            self.assertEqual(result["status"], "failed")

        # Verify cleanup was still called
        mock_clear_auth.assert_called_once()


if __name__ == "__main__":
    unittest.main()
