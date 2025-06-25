# pylint: disable=protected-access,wrong-import-position,unused-argument
import json
import os
import os.path
import sys
import unittest
from unittest.mock import Mock, patch

# Add the lib directory to the Python path to find the helpers module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))

# Mock the jwt module to avoid dependency issues
sys.modules["jwt"] = Mock()

import boto3
import moto
from aws_lambda_powertools.utilities.typing import LambdaContext

# Import after mocking
import helpers  # pylint: disable=wrong-import-position,unused-import,import-error
import lambda_function  # pylint: disable=wrong-import-position


@patch.dict(os.environ, {"APP_ID": "test-app", "LOG_TO_CONSOLE": "true"})
class TestLambdaFunction(unittest.TestCase):
    @moto.mock_aws
    @patch.dict(os.environ, {"APP_ID": "test-app-id", "BUCKET": "test-bucket-success"})
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    def test_success(self, mock_extract_user_id):
        mock_object = b'{"status": "SUCCESS", "result": {"foo": "bar"}}'

        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_client.create_bucket(Bucket=os.environ["BUCKET"])
        s3_client.put_object(
            Key="test-app-id/test-user-id/test-job-id/status.json",
            Body=mock_object,
            Bucket=os.environ["BUCKET"],
        )
        event = {
            "queryStringParameters": {
                "job_id": "test-job-id",
            },
            "headers": {"Authorization": "test-token"},
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 200)
        status_response = json.loads(response["body"])
        self.assertEqual(status_response["status"], "SUCCESS")
        self.assertEqual(status_response["result"]["foo"], "bar")

    @moto.mock_aws
    @patch.dict(os.environ, {"APP_ID": "test-app-id", "BUCKET": "test-bucket-success"})
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    def test_not_found(self, mock_extract_user_id):
        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_client.create_bucket(Bucket=os.environ["BUCKET"])
        event = {
            "queryStringParameters": {
                "job_id": "test-job-id",
            },
            "headers": {"Authorization": "test-token"},
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 404)

    @patch.dict(os.environ, {"APP_ID": "test-app-id", "BUCKET": "test-bucket-success"})
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    def test_bad_bucket(self, mock_extract_user_id):
        event = {
            "queryStringParameters": {
                "job_id": "test-job-id",
            },
            "headers": {"Authorization": "test-token"},
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        # The Lambda now returns 404 for bucket not found errors
        self.assertEqual(response["statusCode"], 404)

    @patch.dict(
        os.environ, {"APP_ID": "test-app-id", "BUCKET": "test-bucket-exception"}
    )
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    @patch("lambda_function.s3_client")
    def test_exception(self, mock_s3_client, mock_extract_user_id):
        # Set up the mock S3 client to raise an exception
        mock_s3_client.get_object.side_effect = Exception("Test exception")

        event = {
            "queryStringParameters": {
                "job_id": "test-job-id",
            },
            "headers": {"Authorization": "test-token"},
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        # General exceptions should result in 503 status code
        self.assertEqual(response["statusCode"], 503)
        status_response = json.loads(response["body"])
        self.assertEqual(status_response["status"], "UNKNOWN")
        self.assertTrue("Test exception" in status_response["message"])
