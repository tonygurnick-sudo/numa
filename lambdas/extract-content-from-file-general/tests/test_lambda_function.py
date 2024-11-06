import unittest
from unittest.mock import MagicMock, patch

from lambda_function import lambda_handler


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")
    @patch("bedrock.get_text_from_image")
    @patch("textract.get_text_from_document")
    def test_lambda_handler_txt_file(
        self, mock_textract, mock_vision_model, mock_s3_client
    ):
        # Basic test for a TXT file
        mock_s3_client.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"Sample text content")
        }
        event = {"bucket": "test-bucket", "key": "test.txt"}

        response = lambda_handler(event, {})

        self.assertEqual(response["text"], "Sample text content")
        mock_s3_client.get_object.assert_called_once_with(
            Bucket="test-bucket", Key="test.txt"
        )
        mock_textract.assert_not_called()
        mock_vision_model.assert_not_called()

    @patch("lambda_function.s3_client")
    def test_lambda_handler_empty_txt_file(self, mock_s3_client):
        # Test for empty TXT file
        mock_s3_client.get_object.return_value = {"Body": MagicMock(read=lambda: b"")}
        event = {"bucket": "test-bucket", "key": "empty.txt"}

        response = lambda_handler(event, {})

        self.assertEqual(response["text"], "")
        mock_s3_client.get_object.assert_called_once_with(
            Bucket="test-bucket", Key="empty.txt"
        )

    @patch("lambda_function.s3_client")
    def test_lambda_handler_unsupported_filetype_error(self, mock_s3_client):
        # Test handling of unsupported filetype error
        event = {"bucket": "test-bucket", "key": "unsupported.xyz"}

        response = lambda_handler(event, {})

        self.assertEqual(
            response["error"], "Unsupported file format for unsupported.xyz"
        )
        self.assertEqual(response["bucket"], "test-bucket")
        self.assertEqual(response["key"], "unsupported.xyz")
        mock_s3_client.get_object.assert_not_called()

    @patch("lambda_function.s3_client")
    @patch("textract.get_text_from_document")
    @patch("bedrock.get_text_from_image")
    def test_lambda_handler_exception_handling(
        self, mock_vision_model, mock_textract, mock_s3_client
    ):
        # Test overall exception handling with unexpected error
        mock_s3_client.get_object.side_effect = Exception("S3 error")
        event = {"bucket": "test-bucket", "key": "error.txt"}

        response = lambda_handler(event, {})

        self.assertEqual(response["error"], "S3 error")
        self.assertEqual(response["bucket"], "test-bucket")
        self.assertEqual(response["key"], "error.txt")
        mock_s3_client.get_object.assert_called_once_with(
            Bucket="test-bucket", Key="error.txt"
        )
        mock_textract.assert_not_called()
        mock_vision_model.assert_not_called()


if __name__ == "__main__":
    unittest.main()
