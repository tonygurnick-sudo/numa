# pylint: disable=protected-access,wrong-import-position,unused-argument
import os
import os.path
import sys
import unittest
from unittest.mock import patch

# Add the lib directory to the Python path to find the bedrock, helpers, and s3_helpers modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/s3_helpers"))

# Mock the modules before importing lambda_function
from unittest import mock

from aws_lambda_powertools.utilities.typing import LambdaContext

sys.modules["bedrock"] = mock.Mock()
sys.modules["helpers"] = mock.Mock()
sys.modules["s3_helpers"] = mock.Mock()
sys.modules["jwt"] = mock.Mock()

# pylint: disable=import-error
import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"  # pylint: disable=protected-access


class TestLambdaFunction(unittest.TestCase):
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    @patch("s3_helpers.read", return_value="test-document")
    @patch(
        "lambda_function._summarise",
        return_value={"markdown_summary": "test-summary"},
    )
    @patch("s3_helpers.write")
    def test_handler(
        self, write_mock, _summarise_mock, _read_mock, _extract_user_id_mock
    ):
        test_event = {
            "app_id": "test-app",
            "input_key": "test-in-key",
            "job_id": "test-job",
            "output_key": "test-out-key",
        }

        result = lambda_function.handler(test_event, CONTEXT)

        self.assertEqual(result, {"output_key": "test-out-key"})
        write_mock.assert_called_once_with(
            "test-out-key",
            b"test-summary",
            content_type="text/markdown",
        )


if __name__ == "__main__":
    unittest.main()
