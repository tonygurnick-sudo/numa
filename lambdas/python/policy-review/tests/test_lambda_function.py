import unittest
from unittest.mock import patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")
    def test_read_file_from_s3(self, mock_s3):
        mock_s3.get_object.return_value = {"Body": b"test content"}
        result = lambda_function.read_file_from_s3("test-bucket", "test-key")
        self.assertEqual(result, "test content")
