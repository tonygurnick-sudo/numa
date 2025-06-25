# pylint: disable=protected-access,wrong-import-position,unused-argument,unused-variable
import json
import os
import os.path
import sys
import unittest
from unittest.mock import Mock, patch

# Add the lib directory to the Python path to find the helpers module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))

# Mock the jwt module before importing helpers (which is imported by lambda_function)
sys.modules["jwt"] = Mock()

from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function


@patch.dict(os.environ, {"APP_ID": "test-app", "LOG_TO_CONSOLE": "true"})
class TestLambdaFunction(unittest.TestCase):
    @patch.dict(os.environ, {"STEP_FUNCTION_ARN": "step-function-arn-success"})
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    @patch("lambda_function.step_functions_client")
    def test_success(self, mock_step_functions_client, mock_extract_user_id):
        event = {
            "body": json.dumps({"foo": "bar", "job_id": "test-job-id"}),
            "headers": {"Authorization": "test-token"},
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 200)
        status_response = json.loads(response["body"])
        self.assertEqual(status_response["job_id"], "test-job-id")

        # Verify that the step function was started with the correct input
        mock_step_functions_client.start_execution.assert_called_once()
        _, kwargs = mock_step_functions_client.start_execution.call_args
        self.assertEqual(kwargs["stateMachineArn"], "step-function-arn-success")
        input_ = json.loads(kwargs["input"])
        self.assertEqual(input_["app_id"], "test-app")
        self.assertEqual(input_["job_id"], "test-job-id")
        self.assertEqual(input_["foo"], "bar")
        self.assertEqual(input_["user_id"], "test-user-id")

    @patch.dict(os.environ, {"STEP_FUNCTION_ARN": "step-function-arn-failure"})
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    @patch("lambda_function.step_functions_client")
    def test_failure(self, mock_step_functions_client, mock_extract_user_id):
        event = {
            "body": json.dumps({"job_id": "test-job-id"}),
            "headers": {"Authorization": "test-token"},
        }

        context = LambdaContext()
        context._function_name = "test_function"

        # Mock a failure when starting the step function
        mock_step_functions_client.start_execution.side_effect = Exception(
            "Test exception"
        )

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 503)
        error_response = json.loads(response["body"])
        self.assertEqual(error_response["exception"], "Test exception")
