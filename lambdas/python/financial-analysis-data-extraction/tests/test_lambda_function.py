# pylint: disable=protected-access
import json
import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.bedrock.BedrockClaude3Model.run")
    def test_handler(self, mock_bedrock_model, mock_s3_helpers):

        fake_file_data = {"pages": [{"text": "First page text"}]}
        mock_s3_helpers.read.return_value = json.dumps(fake_file_data).encode("utf-8")
        mock_bedrock_model.return_value.response = [
            {
                "input": {
                    "data": json.dumps(
                        [
                            {
                                "content": [
                                    {"text": "mock bedrock response"},
                                ],
                            },
                        ],
                    ),
                },
            }
        ]

        event = {
            "app_id": "test_app_id",
            "job_id": "test_job_id",
            "input_key": "extracted/mydoc.json",
            "output_key": "structured/mydoc.json",
        }
        context = MagicMock(aws_request_id="fake-request-id-12345")
        result = lambda_function.handler(event, context)

        mock_s3_helpers.read.assert_called_once_with("extracted/mydoc.json")

        self.assertGreaterEqual(mock_s3_helpers.write.call_count, 1)
        mock_s3_helpers.write.assert_called_once_with(
            "structured/mydoc.json",
            b'[{"content": [{"text": "mock bedrock response"}]}]',
            content_type="application/json",
        )

        self.assertEqual(result["output_key"], "structured/mydoc.json")

    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.bedrock.BedrockClaude3Model.run")
    def test_string_extracted_data(self, mock_bedrock_model, mock_s3_helpers):

        fake_file_data = {"pages": [{"text": "First page text"}]}
        mock_s3_helpers.read.return_value = json.dumps(fake_file_data).encode("utf-8")
        mock_bedrock_model.return_value.response = [
            {
                "input": {
                    "data": json.dumps(
                        [{"content": [{"text": "string mock bedrock response"}]}]
                    )
                },
            }
        ]

        event = {
            "app_id": "test_app_id",
            "job_id": "test_job_id",
            "input_key": "extracted/mydoc.json",
            "output_key": "structured/mydoc.json",
        }
        context = MagicMock(aws_request_id="fake-request-id-12345")
        result = lambda_function.handler(event, context)

        mock_s3_helpers.read.assert_called_once_with("extracted/mydoc.json")

        self.assertGreaterEqual(mock_s3_helpers.write.call_count, 1)
        mock_s3_helpers.write.assert_called_once_with(
            "structured/mydoc.json",
            b'[{"content": [{"text": "string mock bedrock response"}]}]',
            content_type="application/json",
        )

        self.assertEqual(result["output_key"], "structured/mydoc.json")
