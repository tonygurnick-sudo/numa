import os
import os.path
import sys
import unittest
from unittest.mock import Mock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

# Add the lib directory to the Python path to find the required modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))

# Mock the jwt module before importing helpers (which is imported by lambda_function)
sys.modules["jwt"] = Mock()

# pylint: disable=wrong-import-position
import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"  # pylint: disable=protected-access


class TestLambdaFunction(unittest.TestCase):
    @patch("os.environ", {"BUCKET": "test-bucket"})
    def test_handler(self):
        test_event = {
            "app_id": "test-app",
            "job_id": "test-job",
            "output_path": "test-app/test-job",
            "key_suffix": ".md",
            "input_keys": [
                "some/path/foo-file.md",
                "some/other/path/bar-file.md",
            ],
        }

        result = lambda_function.handler(test_event, CONTEXT)

        expected_result = {
            "results": [
                {
                    "input_reference": None,
                    "outputs": [
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": "test-bucket",
                                "key": "some/other/path/bar-file.md",
                            },
                            "location": "S3",
                            "title": "Summary: bar-file",
                        },
                        {
                            "content_type": "text/markdown",
                            "data": {
                                "bucket": "test-bucket",
                                "key": "some/path/foo-file.md",
                            },
                            "location": "S3",
                            "title": "Summary: foo-file",
                        },
                    ],
                }
            ]
        }
        self.assertEqual(result, expected_result)


if __name__ == "__main__":
    unittest.main()
