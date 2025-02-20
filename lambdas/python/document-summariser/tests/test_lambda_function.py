import unittest
from unittest.mock import patch

from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"  # pylint: disable=protected-access


class TestLambdaFunction(unittest.TestCase):
    @patch("s3_helpers.read", return_value="test-document")
    @patch(
        "lambda_function._summarise",
        return_value={"markdown_summary": "test-summary"},
    )
    @patch("s3_helpers.write")
    def test_handler(self, write_mock, _summarise_mock, _read_mock):
        test_event = {
            "app_id": "test-app",
            "input_key": "test-in-key",
            "output_key": "test-out-key",
        }

        result = lambda_function.handler(test_event, CONTEXT)

        self.assertEqual(result, {"output_key": "test-out-key"})
        write_mock.assert_called_once_with(
            "test-out-key",
            b"test-summary",
        )


if __name__ == "__main__":
    unittest.main()
