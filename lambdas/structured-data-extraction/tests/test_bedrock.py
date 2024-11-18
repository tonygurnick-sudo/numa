import unittest
from unittest.mock import MagicMock, patch

from bedrock import BedrockClaude3Model, BedrockModelFailedException, GPTResponse


class TestBedrock(unittest.TestCase):
    @patch("bedrock.boto3.client")
    def test_invoke_model_success(self, mock_boto_client):
        mock_bedrock = mock_boto_client.return_value
        mock_bedrock.invoke_model.return_value = {
            "body": MagicMock(
                read=lambda: '{"content": [{"text": "response text"}], "usage": {"input_tokens": 10, "output_tokens": 5}}'  # noqa: E501
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
        with self.assertRaises(BedrockModelFailedException) as context:
            model.run("")

        self.assertEqual(str(context.exception), "Could not invoke model")

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
        with self.assertRaises(BedrockModelFailedException) as context:
            model.run_with_messages([])

        self.assertEqual(str(context.exception), "Invalid response format")


if __name__ == "__main__":
    unittest.main()
