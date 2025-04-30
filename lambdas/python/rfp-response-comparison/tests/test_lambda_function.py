import json
import os

# Mock required modules
import sys
import types
import unittest
from unittest.mock import Mock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

# Create mock modules with type ignore comments for mypy
for mod in ["bedrock", "helpers", "s3_helpers", "prompts", "tools"]:
    sys.modules[mod] = types.SimpleNamespace()  # type: ignore[assignment]

# Add attributes to mock modules with type ignore comments
sys.modules["prompts"].COMPARISON_PROMPT = "COMPARISON_PROMPT {summaries} {framework}"  # type: ignore[attr-defined]
sys.modules["tools"].COMPARISON_TOOL = "COMPARISON_TOOL"  # type: ignore[attr-defined]
sys.modules["helpers"].setup_step_function_lambda_logging = lambda event, context: None  # type: ignore[attr-defined]

# Import the lambda function directly
import lambda_function


class TestRfpResponseComparison(unittest.TestCase):
    @patch.dict(os.environ, {"BUCKET": "test-bucket"})
    @patch("lambda_function.s3_helpers")
    @patch("lambda_function.bedrock")
    def test_basic_aggregation(self, bedrock_mock, s3_helpers_mock):
        # Simulate two extracted response JSONs
        response1 = {
            "pages": [
                {"page_number": 1, "text": "Page 1 text."},
                {"page_number": 2, "text": "Page 2 text."},
            ]
        }
        response2 = {"pages": [{"page_number": 1, "text": "Another doc page 1."}]}

        # Mock S3 helper reads - return bytes to match real s3_helpers.read function
        def s3_read_side_effect(key):
            if key == "response1.json":
                return json.dumps(response1).encode("utf-8")
            elif key == "response2.json":
                return json.dumps(response2).encode("utf-8")
            elif key == "framework.json":
                return "Framework text".encode("utf-8")
            return "".encode("utf-8")

        s3_helpers_mock.read.side_effect = s3_read_side_effect
        s3_helpers_mock.write = Mock()
        # Mock Bedrock model
        mock_model = Mock()
        mock_model.run.return_value = Mock(
            response=[{"input": {"comparison": "Comparison result!"}}]
        )
        bedrock_mock.BedrockClaude3Model.return_value = mock_model
        event = {
            "extracted_keys": ["response1.json", "response2.json"],
            "framework": "framework.json",
            "output_path": "output/path",
        }

        # Create a mock LambdaContext
        context = Mock(spec=LambdaContext)
        context.function_name = "test-function"

        result = lambda_function.handler(event, context)
        self.assertIn("results", result)
        self.assertEqual(
            result["results"][0]["outputs"][0]["data"],
            {"bucket": "test-bucket", "key": "output/path/comparison.md"},
        )
        s3_helpers_mock.write.assert_called_once()


if __name__ == "__main__":
    unittest.main()
