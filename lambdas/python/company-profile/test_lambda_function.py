# pylint: disable=protected-access
import unittest
from unittest.mock import Mock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"


class TestLambdaFunction(unittest.TestCase):
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
            "details": "Name: John Doe\nEmail: john@example.com",
            "about": "Senior Software Engineer",
            "documentation_text": "Technical resume content...",
        }

        result = lambda_function.handler(test_event, CONTEXT)

        self.assertEqual(result, {"output_key": "profiles/john_doe_profile.json"})
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
            input_data = {
                "details": "Name: John Doe\nEmail: john@example.com",
                "about": "Senior Software Engineer",
                "file_content": "Technical resume content...",
            }

            result = lambda_function._create_profile(input_data)

            self.assertIn("profile_summary", result)
            self.assertIn("profile_details", result)
            self.assertIn("about", result)
            self.assertIn("document_analysis", result)
            self.assertIn("metadata", result)

            mock_model.run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
