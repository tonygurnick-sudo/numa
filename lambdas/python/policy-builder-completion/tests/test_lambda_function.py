import io
import os
import os.path
import sys
import unittest
from unittest.mock import Mock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

# Add the lib directory to the Python path to find the required modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))

# Mock the modules to avoid dependency issues
sys.modules["jwt"] = Mock()
sys.modules["bedrock"] = Mock()
sys.modules["s3_helpers"] = Mock()
sys.modules["markdown_to_pdf"] = Mock()
sys.modules["markdown_to_pdf"].markdown_to_pdf = Mock(  # type: ignore
    return_value=io.BytesIO(b"PDF content")
)
sys.modules["markdown_to_pdf"].markdown_to_html = Mock(  # type: ignore
    return_value="<html>HTML content</html>"
)
sys.modules["markdown_to_pdf"].html_to_pdf = Mock(  # type: ignore
    return_value=io.BytesIO(b"PDF content")
)

# Import after mocking
import lambda_function  # pylint: disable=wrong-import-position

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"  # pylint: disable=protected-access


EVENT = {
    "additional_comments": "",
    "app_id": "test_app",
    "custom_additional_instructions": "",
    "default_additional_instructions": "",
    "domain_area": "",
    "input_bucket": "",
    "input_files": {
        "exemplar_policy": "",
        "board_assurance_statement": "",
        "board_assurance_statement_guidelines": "",
    },
    "job_id": "test_job",
    "organisation_context": "",
    "organisation_name": "",
    "policy_principles": "",
    "policy_structure_overview": "",
    "user_id": "test-user-id",
    "policy_structure_list": [
        {
            "policy_area": "one",
            "policy_area_description": "",
        },
        {
            "policy_area": "two",
            "policy_area_description": "",
        },
    ],
    "data_single_area": {
        "policy_area": "one",
        "initial_policy_key": "",
        "initial_policy_explanation_key": "",
        "expert_review_key": "",
        "expert_review_explanation_key": "",
    },
    "data_all_areas": [
        {
            "initial_policy_key": "",
            "initial_policy_explanation_key": "",
            "expert_review_key": "",
            "expert_review_explanation_key": "",
            "legal_review_feedback_key": "",
            "legal_review_implementation_explanation_key": "",
            "legal_review_implementation_key": "",
        },
        {
            "initial_policy_key": "",
            "initial_policy_explanation_key": "",
            "expert_review_key": "",
            "expert_review_explanation_key": "",
            "legal_review_feedback_key": "",
            "legal_review_implementation_explanation_key": "",
            "legal_review_implementation_key": "",
        },
    ],
}


# Create a properly structured mock response that won't cause 'not subscriptable' errors
class MockResponse:
    def __init__(self):
        self.response = [
            {
                "input": {
                    "title": "",
                    "introduction": "",
                    "definitions": "",
                    "table_of_contents": "",
                    "conclusion": "",
                }
            }
        ]


EXPECTED_RESPONSE = MockResponse()


class TestCompletePolicy(unittest.TestCase):
    @patch.dict("os.environ", {"BUCKET": "test-bucket", "AWS_REGION": "us-east-1"})
    @patch("bedrock.BedrockClaude3Model")
    @patch("lambda_function.s3_client")
    def test(self, s3_mock, mock_model_class):
        # Set up the mock model
        mock_model = Mock()
        mock_model.run.return_value = EXPECTED_RESPONSE
        mock_model_class.return_value = mock_model
        result = lambda_function.handler(EVENT, CONTEXT)
        mock_model.run.assert_called_once()
        self.assertDictEqual(
            result,
            {"final_policy_pdf_key": "test_app/test-user-id/test_job/final_policy.pdf"},
        )

        self.assertEqual(s3_mock.upload_fileobj.call_count, 1)
        _pdf, bucket, key = s3_mock.upload_fileobj.call_args.args

        self.assertEqual(bucket, "test-bucket")
        self.assertEqual(key, "test_app/test-user-id/test_job/final_policy.pdf")
