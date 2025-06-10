import json
import unittest
from unittest.mock import MagicMock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

from lambda_function import handler


class TestRestartCrawler(unittest.TestCase):
    @patch("lambda_function.sfn")
    def test_handler_success(self, mock_sfn):
        """Test the happy path through the handler"""
        mock_execution_arn = (
            "arn:aws:states:us-west-2:123456789012:execution:test-crawler:execution-id"
        )
        mock_sfn.start_execution.return_value = {"executionArn": mock_execution_arn}

        event = {
            "stateMachineArn": "arn:aws:states:us-west-2:123456789012:stateMachine:test-crawler",
            "input": {
                "userId": "user123",
                "counter": 5000,
                "eventCounter": 23000,
                "process_result": {"some": "data"},
            },
        }
        mock_context = MagicMock(spec=LambdaContext)
        result = handler(event, mock_context)

        self.assertEqual(result["status"], "success")
        self.assertTrue("executionArn" in result)

        # Verify that the start_execution was called with the right parameters
        mock_sfn.start_execution.assert_called_once()
        call_args = mock_sfn.start_execution.call_args[1]
        self.assertEqual(call_args["stateMachineArn"], event["stateMachineArn"])

        # Check that the input to the new execution has the continue flag set
        input_data = json.loads(call_args["input"])
        self.assertTrue(input_data["continue"])
        self.assertEqual(input_data["userId"], "user123")
        self.assertEqual(input_data["counter"], 5000)
        # Verify that temporary state was removed
        self.assertNotIn("process_result", input_data)

    @patch("lambda_function.sfn")
    def test_handler_missing_arn(self, mock_sfn):
        """Test handler handles missing state machine ARN"""
        event = {}
        mock_context = MagicMock(spec=LambdaContext)
        result = handler(event, mock_context)

        self.assertEqual(result["status"], "error")
        self.assertIn("Missing state machine ARN", result["message"])
        mock_sfn.start_execution.assert_not_called()

    @patch("lambda_function.sfn")
    def test_handler_exception(self, mock_sfn):
        """Test handler handles exceptions"""
        mock_sfn.start_execution.side_effect = Exception("Test error")

        event = {
            "stateMachineArn": "arn:aws:states:us-west-2:123456789012:stateMachine:test-crawler",
            "input": {"userId": "user123"},
        }
        mock_context = MagicMock(spec=LambdaContext)
        result = handler(event, mock_context)

        self.assertEqual(result["status"], "error")
        self.assertIn("Error starting new execution", result["message"])
