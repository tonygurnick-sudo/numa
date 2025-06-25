import os
import sys
import unittest
from unittest.mock import Mock, patch

from aws_lambda_powertools.utilities.typing import LambdaContext

# Add the lib directory to the Python path to find the required modules
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))
sys.path.append(os.path.join(project_root, "lib/s3_helpers"))

# Mock custom modules that aren't standard Python packages
# pylint: disable=wrong-import-position
import unittest.mock

sys.modules["jwt"] = unittest.mock.Mock()  # type: ignore
sys.modules["bedrock"] = unittest.mock.Mock()  # type: ignore
sys.modules["helpers"] = unittest.mock.Mock()  # type: ignore
sys.modules["s3_helpers"] = unittest.mock.Mock()  # type: ignore

# pylint: disable=wrong-import-position,import-error
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
    "user_id": "test-user-id",
}


# Create a properly structured mock response that won't cause 'not subscriptable' errors
class MockResponse:
    def __init__(self):
        self.response = [
            {
                "input": {
                    "policy_principles": "policy principles",
                    "policy_structure_list": "policy structure list",
                    "policy_structure_overview": "policy structure overview",
                }
            }
        ]


EXPECTED_RESPONSE = MockResponse()


class TestGetPrinsiplesAndStructure(unittest.TestCase):
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
            result["policy_principles"],
            "policy principles",
        )
        self.assertEqual(
            result["policy_structure_list"],
            "policy structure list",
        )
        self.assertEqual(
            result["policy_structure_overview"],
            "policy structure overview",
        )

        s3_mock.assert_not_called()
