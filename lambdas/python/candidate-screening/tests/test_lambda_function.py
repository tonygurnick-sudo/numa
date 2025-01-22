import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")
    def test_read_file_from_s3(self, mock_s3):
        mock_s3.get_object.return_value = {
            "Body": MagicMock(read=lambda: b"test content")
        }

        result = lambda_function.read_file_from_s3("test-bucket", "test-key")

        self.assertEqual(result, "test content")
        mock_s3.get_object.assert_called_with(Bucket="test-bucket", Key="test-key")

    @patch("lambda_function.s3_client")
    def test_save_results_to_s3(self, mock_s3):
        test_data = {"test": "data"}

        lambda_function.save_results_to_s3("test-bucket", "test-key", test_data)

        mock_s3.put_object.assert_called_once()
