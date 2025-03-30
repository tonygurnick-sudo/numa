import unittest
from unittest.mock import patch

from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
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
}


EXPECTED_RESPONSE_ONE = bedrock.GPTResponse(
    [
        {
            "input": {
                "legal_policy_review": "legal_policy_review",
                "legal_references": "legal_references",
            }
        }
    ],
    {},
)
EXPECTED_RESPONSE_TWO = bedrock.GPTResponse(
    [
        {
            "input": {
                "policy": "policy",
                "explanation": "explanation",
            }
        }
    ],
    {},
)


class TestLegalReview(unittest.TestCase):
    @patch.dict("os.environ", {"BUCKET": "test-bucket", "AWS_REGION": "us-east-1"})
    @patch(
        "bedrock.BedrockClaude3Model.run",
        side_effect=[EXPECTED_RESPONSE_ONE, EXPECTED_RESPONSE_TWO],
    )
    @patch("lambda_function.s3_client")
    def test(self, s3_mock, run_mock):
        result = lambda_function.handler(EVENT, CONTEXT)
        self.assertEqual(run_mock.call_count, 2)
        self.assertEqual(
            result["legal_review_feedback_key"],
            "test_app/test_job/legal_review_feedback_one",
        )
        self.assertEqual(
            result["legal_review_implementation_explanation_key"],
            "test_app/test_job/legal_review_implementation_explanation_one",
        )
        self.assertEqual(
            result["legal_review_implementation_key"],
            "test_app/test_job/legal_review_implementation_one",
        )

        self.assertEqual(s3_mock.put_object.call_count, 3)
        calls = s3_mock.put_object.call_args_list
        for call in calls:
            self.assertEqual(call.kwargs["Bucket"], "test-bucket")
        self.assertEqual(
            calls[0].kwargs["Key"],
            "test_app/test_job/legal_review_feedback_one",
        )
        self.assertEqual(
            calls[0].kwargs["Body"].decode("utf-8"),
            "legal_policy_review",
        )
        self.assertEqual(
            calls[1].kwargs["Key"],
            "test_app/test_job/legal_review_implementation_one",
        )
        self.assertEqual(
            calls[1].kwargs["Body"].decode("utf-8"),
            "policy",
        )
        self.assertEqual(
            calls[2].kwargs["Key"],
            "test_app/test_job/legal_review_implementation_explanation_one",
        )
        self.assertEqual(
            calls[2].kwargs["Body"].decode("utf-8"),
            "explanation",
        )
