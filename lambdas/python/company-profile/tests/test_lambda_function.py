# pylint: disable=protected-access,wrong-import-position,import-error
import os
import os.path
import sys
import unittest
from unittest.mock import Mock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

# Add the lib directory to the Python path to find the helpers module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))

# Mock the jwt, s3_helpers, and bedrock modules before importing lambda_function
sys.modules["jwt"] = Mock()
sys.modules["s3_helpers"] = Mock()
sys.modules["bedrock"] = Mock()

import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"


class TestLambdaFunction(unittest.TestCase):
    @patch.dict("os.environ", {"BUCKET": "test-bucket"})
    @patch(
        "lambda_function.s3_helpers.read", return_value="Technical resume content..."
    )
    @patch("s3_helpers.write")
    @patch(
        "lambda_function._create_profile",
        return_value={
            "profile_summary": "Senior Software Engineer with 10 years experience",
            "profile_details": {
                "name": "John Doe",
                "email": "john@example.com",
            },
            "about": "Experienced engineer specializing in Python",
            "document_analysis": "Shows strong technical background",
            "metadata": {"model": "claude-3"},
        },
    )
    def test_handler(self, _create_profile_mock, write_mock, _read_mock):
        test_event = {
            "app_id": "company-profile",
            "job_id": "test-job",
            "about": "Senior Software Engineer",
            "contact_information": "Name: John Doe\nEmail: john@example.com",
            "input_keys": [],
            "output_key": "some/key/on/s3",
        }

        result = lambda_function.handler(test_event, CONTEXT)

        self.assertEqual(
            result["results"][0],
            {
                "input_reference": None,
                "outputs": [
                    {
                        "content_type": "application/json",
                        "data": {"bucket": "test-bucket", "key": "some/key/on/s3"},
                        "location": "S3",
                        "title": "Company Profile",
                    }
                ],
            },
        )
        write_mock.assert_called_once()

    def test_create_profile(self):
        mock_model = Mock()
        mock_model.run.return_value = Mock(
            response=[
                {
                    "input": {
                        "profile_summary": "Senior Software Engineer with 10 years experience",
                        "profile_details": {
                            "name": "John Doe",
                            "email": "john@example.com",
                        },
                        "about": "Experienced engineer specializing in Python",
                        "document_analysis": "Shows strong technical background",
                    }
                }
            ],
            metadata={"model": "claude-3"},
        )

        with patch(
            "lambda_function.bedrock.BedrockClaude3Model", return_value=mock_model
        ):
            result = lambda_function._create_profile(
                about="Senior Software Engineer",
                contact_information="Name: John Doe\nEmail: john@example.com",
                file_content="Technical resume content...",
            )

            self.assertIn("profile_summary", result)
            self.assertIn("profile_details", result)
            self.assertIn("about", result)
            self.assertIn("document_analysis", result)
            self.assertIn("metadata", result)

            mock_model.run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
