# pylint: disable=protected-access
import json
import os
import unittest
from unittest.mock import MagicMock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function


@patch("lambda_function.s3_client")
@patch.dict(os.environ, {"APP_NAME": "test-app", "LOG_TO_CONSOLE": "true"})
class TestLambdaFunction(unittest.TestCase):
    @patch.dict(os.environ, {"BUCKET": "test-bucket-success"})
    def test_success(self, s3_mock):
        mock_object = b'{"status": "SUCCESS", "result": {"foo": "bar"}}'
        s3_mock.get_object.return_value = {"Body": MagicMock(read=lambda: mock_object)}
        event = {
            "queryStringParameters": {
                "job_id": "test-job-id",
            },
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 200)
        status_response = json.loads(response["body"])
        self.assertEqual(status_response["status"], "SUCCESS")
        self.assertEqual(status_response["result"]["foo"], "bar")

        s3_mock.get_object.assert_called_once()
        kwargs = s3_mock.get_object.call_args.kwargs
        self.assertEqual(kwargs["Bucket"], "test-bucket-success")
        self.assertEqual(kwargs["Key"], "test-app/test-job-id/status.json")

    @patch.dict(os.environ, {"BUCKET": "test-bucket-failure"})
    def test_failure(self, s3_mock):
        event = {
            "job_id": "test-job-id",
        }

        context = LambdaContext()
        context._function_name = "test_function"

        s3_mock.get_object.side_effect = Exception("Some error")
        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 503)
        status_response = json.loads(response["body"])
        self.assertEqual(status_response["status"], "UNKNOWN")
        self.assertEqual(status_response["message"], "Some error")
