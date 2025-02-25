# pylint: disable=protected-access
import sys
import unittest
from unittest.mock import Mock, patch

sys.modules["helpers"] = Mock()
sys.modules["bedrock"] = Mock()
sys.modules["s3_helpers"] = Mock()
sys.modules["structlog"] = Mock()

import lambda_function


class TestLambdaFunction(unittest.TestCase):
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
