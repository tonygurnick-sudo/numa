import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")
    def test_handler(self, mock_s3):
        test_event = {"output_bucket": "test-bucket", "execution_id": "test-123"}

        # Mock S3
        mock_paginator = MagicMock()
        mock_s3.get_paginator.return_value = mock_paginator
        mock_paginator.paginate.return_value = [{"Contents": []}]

        result = lambda_function.handler(test_event, {})

        # Assert output structure
        self.assertIn("csv_location", result)
        self.assertIn("candidates_processed", result)
        self.assertEqual(result["execution_id"], "test-123")


if __name__ == "__main__":
    unittest.main()
