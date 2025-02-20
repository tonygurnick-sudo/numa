import unittest
from unittest.mock import patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    @patch("lambda_function.s3_client")
    @patch("lambda_function.get_model_response", return_value="test policy content")
    def test_policy_generation(self, mock_get_model, mock_s3):
        event = {
            "policy_area": "Security",
            "additional_instructions": "Test",
            "output_bucket": "test-bucket",
            "execution_id": "123",
        }

        mock_s3.put_object.return_value = {}

        result = lambda_function.handler(event, None)

        self.assertTrue(mock_get_model.called)

        self.assertEqual(
            result,
            {
                "output_bucket": "test-bucket",
                "output_key": "policy_drafts/123/draft_Security.json",
            },
        )


if __name__ == "__main__":
    unittest.main()
