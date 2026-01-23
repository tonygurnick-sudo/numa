import os
import sys
import unittest
from unittest.mock import patch

import boto3
import moto
from aws_lambda_powertools.utilities.typing import LambdaContext

# Add the lib directory to the Python path to find the required modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))
sys.path.append(os.path.join(project_root, "lib/s3_helpers"))

# Mock custom modules that aren't standard Python packages
# pylint: disable=wrong-import-position
import unittest.mock

sys.modules["jwt"] = unittest.mock.Mock()  # type: ignore
sys.modules["bedrock"] = unittest.mock.Mock()  # type: ignore
sys.modules["bedrock.language"] = unittest.mock.Mock()  # type: ignore
sys.modules["helpers"] = unittest.mock.Mock()  # type: ignore
sys.modules["s3_helpers"] = unittest.mock.Mock()  # type: ignore

# pylint: disable=wrong-import-position,import-error
import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"  # pylint: disable=protected-access


@moto.mock_aws
@patch.dict(os.environ, {"BUCKET": "test-bucket", "LOG_TO_CONSOLE": "true"})
class TestLambdaFunction(unittest.TestCase):

    @patch("lambda_function._get_model_response", return_value="test policy content")
    def test_no_example(self, mock_get_model):
        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_client.create_bucket(Bucket=os.environ["BUCKET"])

        extracted_example_policy_key = None
        event = {
            "additional_instructions": "Keep it short",
            "app_id": "test-app-id",
            "extracted_example_policy_key": extracted_example_policy_key,
            "job_id": "test-job-id",
            "legislation_content": "",
            "output_path": "test/output",
            "policy_context": "A test policy",
        }

        result = lambda_function.handler(event, CONTEXT)

        self.assertTrue(mock_get_model.called)

        self.assertEqual(
            result,
            {
                "results": [
                    {
                        "input_reference": None,
                        "outputs": [
                            {
                                "content_type": "text/markdown",
                                "data": {
                                    "bucket": "test-bucket",
                                    "key": "test/output/draft_policy.md",
                                },
                                "location": "S3",
                                "title": "Draft Policy",
                            }
                        ],
                    }
                ]
            },
        )

    @patch("lambda_function._get_model_response", return_value="test policy content")
    def test_with_example(self, mock_get_model):
        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_client.create_bucket(Bucket=os.environ["BUCKET"])

        extracted_example_policy_key = "test-key"
        event = {
            "additional_instructions": "Keep it short",
            "app_id": "test-app-id",
            "extracted_example_policy_key": extracted_example_policy_key,
            "job_id": "test-job-id",
            "legislation_content": "",
            "output_path": "test/output",
            "policy_context": "A test policy",
        }

        s3_client.put_object(
            Key=extracted_example_policy_key,
            Body="Test example",
            Bucket=os.environ["BUCKET"],
        )

        result = lambda_function.handler(event, CONTEXT)

        self.assertTrue(mock_get_model.called)

        self.assertEqual(
            result,
            {
                "results": [
                    {
                        "input_reference": None,
                        "outputs": [
                            {
                                "content_type": "text/markdown",
                                "data": {
                                    "bucket": "test-bucket",
                                    "key": "test/output/draft_policy.md",
                                },
                                "location": "S3",
                                "title": "Draft Policy",
                            }
                        ],
                    }
                ]
            },
        )

    @patch("lambda_function._get_model_response", return_value="test policy content")
    def test_with_legislation(self, mock_get_model):
        s3_client = boto3.client("s3", region_name="us-east-1")
        s3_client.create_bucket(Bucket=os.environ["BUCKET"])

        extracted_example_policy_key = "test-key"
        event = {
            "additional_instructions": "Keep it short",
            "app_id": "test-app-id",
            "extracted_example_policy_key": extracted_example_policy_key,
            "job_id": "test-job-id",
            "legislation_content": "Some legal stuff",
            "output_path": "test/output",
            "policy_context": "A test policy",
        }

        s3_client.put_object(
            Key=extracted_example_policy_key,
            Body="Test example",
            Bucket=os.environ["BUCKET"],
        )

        result = lambda_function.handler(event, CONTEXT)

        self.assertTrue(mock_get_model.called)

        self.assertEqual(
            result,
            {
                "results": [
                    {
                        "input_reference": None,
                        "outputs": [
                            {
                                "content_type": "text/markdown",
                                "data": {
                                    "bucket": "test-bucket",
                                    "key": "test/output/draft_policy.md",
                                },
                                "location": "S3",
                                "title": "Draft Policy",
                            },
                            {
                                "content_type": "text/markdown",
                                "data": {
                                    "bucket": "test-bucket",
                                    "key": "test/output/legislative_review.md",
                                },
                                "location": "S3",
                                "title": "Legislative Review",
                            },
                        ],
                    }
                ]
            },
        )
