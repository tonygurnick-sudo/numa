# pylint: disable=protected-access
import json
import os
import unittest
from unittest.mock import patch

import boto3
import moto
from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function


@patch.dict(os.environ, {"APP_ID": "test-app", "LOG_TO_CONSOLE": "true"})
class TestLambdaFunction(unittest.TestCase):
    @moto.mock_aws
    @patch.dict(os.environ, {"APP_ID": "test-app-id", "BUCKET": "test-bucket-success"})
    def test_success(self):
        mock_object = b'{"status": "SUCCESS", "result": {"foo": "bar"}}'

        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_client.create_bucket(Bucket=os.environ["BUCKET"])
        s3_client.put_object(
            Key="test-app-id/test-job-id/status.json",
            Body=mock_object,
            Bucket=os.environ["BUCKET"],
        )
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

    @moto.mock_aws
    @patch.dict(os.environ, {"APP_ID": "test-app-id", "BUCKET": "test-bucket-success"})
    def test_not_found(self):
        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_client.create_bucket(Bucket=os.environ["BUCKET"])
        event = {
            "queryStringParameters": {
                "job_id": "test-job-id",
            },
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 404)

    @patch.dict(os.environ, {"APP_ID": "test-app-id", "BUCKET": "test-bucket-success"})
    def test_bad_bucket(self):
        event = {
            "queryStringParameters": {
                "job_id": "test-job-id",
            },
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 503)

    def test_exception(self):
        event = {
            "job_id": "test-job-id",
        }

        context = LambdaContext()
        context._function_name = "test_function"

        response = lambda_function.handler(event, context)  # type: ignore # pyright gets this wrong
        self.assertEqual(response["statusCode"], 503)
        status_response = json.loads(response["body"])
        self.assertEqual(status_response["status"], "UNKNOWN")
        self.assertEqual(status_response["message"], "KeyError: 'BUCKET'")
