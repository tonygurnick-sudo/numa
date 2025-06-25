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
sys.path.append(os.path.join(project_root, "lib/s3_helpers"))

# Mock the modules before importing lambda_function
sys.modules["jwt"] = Mock()  # type: ignore
sys.modules["bedrock"] = Mock()  # type: ignore
sys.modules["helpers"] = Mock()  # type: ignore
sys.modules["s3_helpers"] = Mock()  # type: ignore

# pylint: disable=wrong-import-position,import-error
import helpers  # pylint: disable=unused-import
import lambda_function

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
    },
}


# Create a properly structured mock response that won't cause 'not subscriptable' errors
class MockResponse:
    def __init__(self):
        self.response = [
            {
                "input": {
                    "policy": "policy",
                    "explanation": "explanation",
                }
            }
        ]


EXPECTED_RESPONSE = MockResponse()


class TestExpertReview(unittest.TestCase):
    @patch.dict("os.environ", {"BUCKET": "test-bucket", "AWS_REGION": "us-east-1"})
    @patch("helpers.extract_user_id_from_token", return_value="test-user-id")
    @patch("bedrock.BedrockClaude3Model")
    @patch("lambda_function.s3_client")
    def test(
        self, s3_mock, mock_model_class, extract_user_id_mock
    ):  # pylint: disable=unused-argument
        # Set up the mock model
        mock_model = Mock()
        mock_model.run.return_value = EXPECTED_RESPONSE
        mock_model_class.return_value = mock_model

        result = lambda_function.handler(EVENT, CONTEXT)
        mock_model.run.assert_called_once()
        self.assertEqual(
            result["expert_review_key"],
            "test_app/test-user-id/test_job/expert_review_one",
        )
        self.assertEqual(
            result["expert_review_explanation_key"],
            "test_app/test-user-id/test_job/expert_review_explanation_one",
        )

        self.assertEqual(s3_mock.put_object.call_count, 2)
        calls = s3_mock.put_object.call_args_list
        for call in calls:
            self.assertEqual(call.kwargs["Bucket"], "test-bucket")
        self.assertEqual(
            calls[0].kwargs["Key"],
            "test_app/test-user-id/test_job/expert_review_one",
        )
        self.assertEqual(
            calls[0].kwargs["Body"].decode("utf-8"),
            "policy",
        )
        self.assertEqual(
            calls[1].kwargs["Key"],
            "test_app/test-user-id/test_job/expert_review_explanation_one",
        )
        self.assertEqual(
            calls[1].kwargs["Body"].decode("utf-8"),
            "explanation",
        )
