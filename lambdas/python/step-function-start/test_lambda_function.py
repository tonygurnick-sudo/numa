# pylint: disable=protected-access
import json
import os
import unittest
from unittest.mock import patch

from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEvent
from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function


@patch("lambda_function.step_function_client")
@patch.dict(os.environ, {"APP_NAME": "test-app", "LOG_TO_CONSOLE": "true"})
class TestLambdaFunction(unittest.TestCase):
    @patch.dict(os.environ, {"STEP_FUNCTION_ARN": "step-function-arn-success"})
    def test_success(self, step_function_mock):
        event = APIGatewayProxyEvent(
            {
                "body": json.dumps({"foo": "bar"}),
            }
        )

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)
        self.assertEqual(response["statusCode"], 200)
        job_id = json.loads(response["body"])["job_id"]

        step_function_mock.start_execution.assert_called_once()
        kwargs = step_function_mock.start_execution.call_args.kwargs
        self.assertEqual(kwargs["stateMachineArn"], "step-function-arn-success")
        self.assertEqual(kwargs["name"], job_id)
        input_ = json.loads(kwargs["input"])
        self.assertEqual(input_["app_name"], "test-app")
        self.assertEqual(input_["job_id"], job_id)
        self.assertEqual(input_["foo"], "bar")

    @patch.dict(os.environ, {"STEP_FUNCTION_ARN": "step-function-arn-failure"})
    def test_failure(self, step_function_mock):
        event = APIGatewayProxyEvent(
            {
                "body": json.dumps({"job_id": "test-job-id"}),
            }
        )

        context = LambdaContext()
        context._function_name = "test_function"

        step_function_mock.start_execution.side_effect = Exception("Some error")
        response = lambda_function.handler(event, context)
        self.assertEqual(response["statusCode"], 503)
        exception = json.loads(response["body"])["exception"]
        self.assertEqual(exception, "Some error")
