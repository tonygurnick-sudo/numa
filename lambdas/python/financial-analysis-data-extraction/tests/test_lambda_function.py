# pylint: disable=protected-access
import json
import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")  # patch the s3_client object directly
    @patch("lambda_function.bedrock.BedrockClaude3Model")  # patch the Bedrock model
    def test_handler(self, mock_bedrock_model, mock_s3_client):
        # S3 response for get_object
        fake_file_data = {"pages": [{"text": "First page text"}]}
        mock_s3_client.get_object.return_value = {
            "Body": MagicMock(
                read=MagicMock(return_value=json.dumps(fake_file_data).encode("utf-8"))
            )
        }

        # Mock bedrock
        mock_bedrock_model.invoke_model.return_value = {
            "body": MagicMock(
                read=MagicMock(
                    return_value=json.dumps(
                        {"content": [{"text": "some mock bedrock response"}]}
                    ).encode("utf-8")
                )
            )
        }

        # Call the lambda
        event = {
            "input_bucket": "my-input-bucket",
            "input_key": "documents/mydoc.json",
            # optional output_bucket, etc.
        }
        context = MagicMock(aws_request_id="fake-request-id-12345")
        result = lambda_function.handler(event, context)

        # Assert S3 get_object should have been called with the input bucket/key
        mock_s3_client.get_object.assert_called_once_with(
            Bucket="my-input-bucket", Key="documents/mydoc.json"
        )

        # Assert S3 put_object should be called for the final JSON extraction results and the .md summary files
        # Confirm at least we have a call
        self.assertGreaterEqual(mock_s3_client.put_object.call_count, 1)

        # Assert the return from handler is a dict with keys: input_bucket, input_key, output_bucket, output_key.
        self.assertIn("input_bucket", result)
        self.assertIn("input_key", result)
        self.assertIn("output_bucket", result)
        self.assertIn("output_key", result)
        self.assertEqual(result["input_bucket"], "my-input-bucket")
        self.assertEqual(result["input_key"], "documents/mydoc.json")
        # If output_bucket isn't in the event, we use input_bucket by default:
        self.assertEqual(result["output_bucket"], "my-input-bucket")
        self.assertTrue(result["output_key"].endswith(".json"))

    def test_extraction_page_by_page_with_mock_model(self):
        """
        Test the extraction_page_by_page() helper in isolation
        using a mock model that returns static data.
        """
        fake_model = MagicMock()
        fake_model.run.return_value.response = [
            {"input": {"data": [{"field": "value from page1"}]}}
        ]

        # Provide two pages to simulate reading them in a loop
        pages_data = {"pages": [{"text": "page1 text"}, {"text": "page2 text"}]}

        # Call the function
        results = lambda_function.extraction_page_by_page(
            model=fake_model,
            prompt="Some prompt: {document}",
            extracted_data=pages_data,
            tool_array_key="data",
        )

        # We expect the model to be called twice, once per page
        self.assertEqual(fake_model.run.call_count, 2)
        # Each call returns the same mock data, so we end up with 2 items
        self.assertEqual(len(results), 2)
        self.assertIn("field", results[0])

    @patch("lambda_function.s3_client")
    @patch("lambda_function.bedrock.BedrockClaude3Model")
    def test_handler_string_extracted_data(self, mock_bedrock_model, mock_s3_client):
        """
        Test when the extracted_data from S3 is just a string,
        not a dict with pages.
        """
        # Suppose the file is just "some text"
        mock_s3_client.get_object.return_value = {
            "Body": MagicMock(read=MagicMock(return_value=b'"some text in a string"'))
        }
        # bedrock mock again
        mock_bedrock_model.invoke_model.return_value = {
            "body": MagicMock(
                read=MagicMock(
                    return_value=json.dumps(
                        {"content": [{"text": "mock bedrock response"}]}
                    ).encode("utf-8")
                )
            )
        }

        event = {"input_bucket": "my-input-bucket", "input_key": "simple_text.json"}
        context = MagicMock(aws_request_id="test-req-123")
        response = lambda_function.handler(event, context)
        self.assertIn("input_bucket", response)
        self.assertIn("output_bucket", response)
        self.assertEqual(response["input_bucket"], "my-input-bucket")
