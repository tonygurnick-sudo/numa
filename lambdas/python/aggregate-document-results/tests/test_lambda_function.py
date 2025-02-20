import unittest
from unittest.mock import patch

from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"  # pylint: disable=protected-access


class TestLambdaFunction(unittest.TestCase):
    @patch("s3_helpers.read", side_effect=[b"bar", b"foo"])
    @patch("s3_helpers.write")
    def test_handler(self, write_mock, _read_mock):
        test_event = {
            "app_id": "test-app",
            "output_key": "test-key",
            "key_suffix": ".foobar.json",
            "input_keys": [
                "some/path/foo-file.foobar.json",
                "some/other/path/bar-file.foobar.json",
            ],
        }

        result = lambda_function.handler(test_event, CONTEXT)

        expected_content = (
            "# Document Summaries\n"
            "\n"
            "## Document 1: bar-file\n"
            "bar\n"
            "\n---\n"
            "\n"
            "## Document 2: foo-file\n"
            "foo\n"
            "\n---\n"
        )
        self.assertEqual(
            result,
            {
                "content": expected_content,
                "output_key": "test-key",
            },
        )
        write_mock.assert_called_once_with(
            "test-key",
            expected_content.encode("utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
