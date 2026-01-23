# pylint: disable=protected-access,wrong-import-position,import-error
import json
import os
import os.path
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

# Add the lib directory to the Python path to find the helpers module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))
sys.path.append(os.path.join(project_root, "lib/s3_helpers"))

# Mock the modules before importing lambda_function
sys.modules["jwt"] = Mock()  # type: ignore
sys.modules["bedrock"] = Mock()  # type: ignore
sys.modules["bedrock.language"] = Mock()  # type: ignore
sys.modules["helpers"] = Mock()  # type: ignore
sys.modules["s3_helpers"] = Mock()  # type: ignore

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.bedrock.BedrockClaude3Model")
    @patch.dict("os.environ", {"AWS_REGION": "us-east-1"})
    def test_handler(self, mock_bedrock_model_class, mock_s3_helpers):
        # Create a mock model instance with properly structured response
        mock_model = Mock()
        mock_response = Mock()
        mock_response.response = [
            {
                "input": {
                    "data": json.dumps(
                        [{"content": [{"text": "mock bedrock response"}]}]
                    )
                }
            }
        ]
        mock_model.run.return_value = mock_response
        mock_bedrock_model_class.return_value = mock_model

        # Mock S3 response
        fake_file_data = {"pages": [{"text": "First page text"}]}
        mock_s3_helpers.read.return_value = json.dumps(fake_file_data).encode("utf-8")

        event = {
            "app_id": "test_app_id",
            "job_id": "test_job_id",
            "input_key": "extracted/mydoc.json",
            "output_key": "structured/mydoc.json",
        }
        context = MagicMock(aws_request_id="fake-request-id-12345")
        result = lambda_function.handler(event, context)

        mock_s3_helpers.read.assert_called_once_with("extracted/mydoc.json")

        mock_s3_helpers.write.assert_called_once_with(
            "structured/mydoc.json",
            b'[{"content": [{"text": "mock bedrock response"}]}]',
            content_type="application/json",
        )

        self.assertEqual(result["output_key"], "structured/mydoc.json")

    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.bedrock.BedrockClaude3Model")
    @patch.dict("os.environ", {"AWS_REGION": "us-east-1"})
    def test_string_extracted_data(self, mock_bedrock_model_class, mock_s3_helpers):
        # Create a mock model instance with properly structured response
        mock_model = Mock()
        mock_response = Mock()
        mock_response.response = [
            {
                "input": {
                    "data": json.dumps(
                        [{"content": [{"text": "string mock bedrock response"}]}]
                    )
                }
            }
        ]
        mock_model.run.return_value = mock_response
        mock_bedrock_model_class.return_value = mock_model

        fake_file_data = {"pages": [{"text": "First page text"}]}
        mock_s3_helpers.read.return_value = json.dumps(fake_file_data).encode("utf-8")

        event = {
            "app_id": "test_app_id",
            "job_id": "test_job_id",
            "input_key": "extracted/mydoc.json",
            "output_key": "structured/mydoc.json",
        }
        context = MagicMock(aws_request_id="fake-request-id-12345")
        result = lambda_function.handler(event, context)

        mock_s3_helpers.read.assert_called_once_with("extracted/mydoc.json")

        mock_s3_helpers.write.assert_called_once_with(
            "structured/mydoc.json",
            b'[{"content": [{"text": "string mock bedrock response"}]}]',
            content_type="application/json",
        )

        self.assertEqual(result["output_key"], "structured/mydoc.json")
