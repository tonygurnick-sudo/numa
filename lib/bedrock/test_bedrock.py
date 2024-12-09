import unittest
from unittest.mock import MagicMock, patch

from bedrock import (
    BedrockClaude3Model,
    GPTResponse,
    UnsupportedFiletypeError,
    get_text_from_image,
)


class TestBedrock(unittest.TestCase):
    @patch("bedrock.boto3.client")
    def test_invoke_model_success(self, mock_boto_client):
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(
                read=lambda: '{"content": [{"text": "response text"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'
            )
        }

        model = BedrockClaude3Model()
        response = model.run_with_messages([])

        self.assertIsInstance(response, GPTResponse)
        self.assertEqual(response.response[0]["text"], "response text")
        self.assertEqual(response.metadata["input_tokens"], 10)
        self.assertEqual(response.metadata["output_tokens"], 5)
        mock_bedrock.invoke_model.assert_called_once()

    @patch("bedrock.boto3.client")
    def test_invoke_model_failure(self, mock_boto_client):
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.side_effect = Exception("Model invocation failed")

        model = BedrockClaude3Model()
        with self.assertRaises(Exception):
            model.run("")

    @patch("bedrock.boto3.client")
    def test_run_with_messages_success(self, mock_boto_client):
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(
                read=lambda: '{"content": [{"text": "response text"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'  # noqa: E501
            )
        }

        model = BedrockClaude3Model()
        response = model.run_with_messages(
            [{"role": "user", "content": [{"type": "text", "text": "Hello"}]}]
        )

        self.assertIsInstance(response, GPTResponse)
        self.assertEqual(response.response[0]["text"], "response text")
        self.assertEqual(response.metadata["input_tokens"], 10)
        self.assertEqual(response.metadata["output_tokens"], 5)

    @patch("bedrock.boto3.client")
    def test_process_response_invalid_format(self, mock_boto_client):
        # Mock invalid JSON format in response
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(read=lambda: "Invalid JSON")
        }

        model = BedrockClaude3Model()
        with self.assertRaises(Exception):
            model.run_with_messages([])


class TestExtractTextFromImageUsingVisionModel(unittest.TestCase):
    @patch("bedrock.s3_client.get_object")
    @patch("bedrock.filetype.guess")
    @patch("bedrock.BedrockClaude3Model.run_with_messages")
    def test_extract_text_success(
        self, mock_run_with_messages, mock_guess, mock_get_object
    ):
        # Mock S3 get_object response
        mock_get_object.return_value = {
            "Body": MagicMock(read=lambda: b"fake_image_data")
        }

        # Mock filetype guess response
        mock_guess.return_value = MagicMock(mime="image/jpeg")

        # Mock BedrockClaude3Model response
        mock_response = GPTResponse(response=[{"text": "Extracted text"}], metadata={})
        mock_run_with_messages.return_value = mock_response

        result = get_text_from_image("test-bucket", "test-key")

        self.assertEqual(result, "Extracted text")
        mock_get_object.assert_called_once_with(Bucket="test-bucket", Key="test-key")
        mock_guess.assert_called_once()
        mock_run_with_messages.assert_called_once()

    @patch("bedrock.s3_client.get_object")
    @patch("bedrock.filetype.guess")
    def test_extract_text_unsupported_filetype(self, mock_guess, mock_get_object):
        # Mock S3 get_object response
        mock_get_object.return_value = {
            "Body": MagicMock(read=lambda: b"fake_image_data")
        }

        # Mock filetype guess response to return None
        mock_guess.return_value = None

        with self.assertRaises(UnsupportedFiletypeError):
            get_text_from_image("test-bucket", "test-key")

        mock_get_object.assert_called_once_with(Bucket="test-bucket", Key="test-key")
        mock_guess.assert_called_once()


if __name__ == "__main__":
    unittest.main()
