import unittest
from typing import Any, Dict, cast
from unittest.mock import MagicMock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

from lambda_function import STATUS_MAP, handler


class TestMarkUrlStatus(unittest.TestCase):
    def test_status_map_values(self):
        """Test that the status mapping is correctly defined"""
        self.assertEqual(STATUS_MAP["success"], "completed")
        self.assertEqual(STATUS_MAP["failed"], "failed")
        self.assertEqual(STATUS_MAP["error"], "failed")

    def test_handler_missing_parameters(self):
        """Test handler rejects missing parameters"""
        mock_context = MagicMock(spec=LambdaContext)
        result = handler(cast(Dict[str, Any], {}), mock_context)

        self.assertEqual(result["status"], "error")
        self.assertIn("Missing required parameters", result["message"])

    @patch("lambda_function.update_url_status")
    def test_handler_extracts_status_from_process_result(self, mock_update):
        """Test handler correctly extracts status from nested process_result"""
        mock_update.return_value = {"status": "success"}

        event = cast(
            Dict[str, Any],
            {
                "url": "https://example.com",
                "userId": "user123",
                "process_result": {"process_result": {"status": "success"}},
            },
        )

        mock_context = MagicMock(spec=LambdaContext)
        result = handler(event, mock_context)

        self.assertEqual(result["final_status"], "completed")

    @patch("lambda_function.update_url_status")
    def test_handler_counter_increment(self, mock_update):
        """Test handler increments the counter"""
        mock_update.return_value = {"status": "success"}

        event = cast(
            Dict[str, Any],
            {
                "url": "https://example.com",
                "userId": "user123",
                "process_result": {"status": "success"},
                "counter": 5,
            },
        )

        mock_context = MagicMock(spec=LambdaContext)
        result = handler(event, mock_context)

        self.assertEqual(result["counter"], 6)
