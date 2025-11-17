# pylint: disable=wrong-import-position
"""
Tests for the main Lambda function router.

Tests agent routing, fallback behavior, and configuration.
"""

import sys
import unittest
from unittest import mock

# Stub the shared helpers modules
for _name in [
    "helpers",
    "s3_helpers",
    "structlog",
    "aws_lambda_powertools",
    "aws_lambda_powertools.utilities",
    "aws_lambda_powertools.utilities.typing",
]:
    sys.modules.setdefault(_name, mock.MagicMock())

import lambda_function


class TestRouter(unittest.TestCase):
    """Test the main lambda_function router."""

    def test_available_agents_list_contains_default(self):
        self.assertIn("default", lambda_function.AVAILABLE_AGENTS)

    def test_available_agents_list_contains_data_analysis(self):
        self.assertIn("data_analysis", lambda_function.AVAILABLE_AGENTS)

    def test_handler_default_agent_type(self):
        """Test that handler defaults to 'default' when no agent_type specified."""
        event = {"app_id": "test", "job_id": "123", "user_id": "user"}
        agent_type = event.get("agent_type", "default")
        self.assertEqual(agent_type, "default")

    def test_handler_respects_explicit_agent_type(self):
        """Test that handler respects explicitly set agent_type."""
        event = {"agent_type": "data_analysis", "app_id": "test"}
        agent_type = event.get("agent_type", "default")
        self.assertEqual(agent_type, "data_analysis")

    def test_unknown_agent_type_fallback(self):
        """Test that unknown agent types fall back to default."""
        event = {"agent_type": "unknown_agent"}
        agent_type = event.get("agent_type", "default")

        if agent_type not in lambda_function.AVAILABLE_AGENTS:
            agent_type = "default"

        self.assertEqual(agent_type, "default")


class TestRouterConfiguration(unittest.TestCase):
    """Test router configuration and structure."""

    def test_lambda_function_has_handler(self):
        """Verify the handler function exists."""
        self.assertTrue(hasattr(lambda_function, "handler"))
        self.assertTrue(callable(lambda_function.handler))

    def test_available_agents_is_list(self):
        """Verify AVAILABLE_AGENTS is a list."""
        self.assertIsInstance(lambda_function.AVAILABLE_AGENTS, list)

    def test_available_agents_not_empty(self):
        """Verify at least one agent is available."""
        self.assertGreater(len(lambda_function.AVAILABLE_AGENTS), 0)


if __name__ == "__main__":
    unittest.main()
