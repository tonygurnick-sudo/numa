import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")
    def test_read_file_from_s3(self, mock_s3):
        mock_body = MagicMock()
        mock_body.read.return_value = b"test content"

        mock_s3.get_object.return_value = {"Body": mock_body}

        result = lambda_function.read_file_from_s3("test-bucket", "test-key")
        self.assertEqual(result, "test content")

        mock_s3.get_object.assert_called_once_with(Bucket="test-bucket", Key="test-key")
