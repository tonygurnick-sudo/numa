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


EXPECTED_RESPONSE = bedrock.GPTResponse(
    [
        {
            "input": {
                "title": "",
                "introduction": "",
                "definitions": "",
                "table_of_contents": "",
                "conclusion": "",
            }
        }
    ],
    {},
)


class TestCompletePolicy(unittest.TestCase):
    @patch.dict("os.environ", {"BUCKET": "test-bucket"})
    @patch("bedrock.BedrockClaude3Model.run", return_value=EXPECTED_RESPONSE)
    @patch("lambda_function.s3_client")
    def test(self, s3_mock, run_mock):
        result = lambda_function.handler(EVENT, CONTEXT)
        run_mock.assert_called_once()
        self.assertDictEqual(
            result,
            {"final_policy_pdf_key": "test_app/test_job/final_policy.pdf"},
        )

        self.assertEqual(s3_mock.upload_fileobj.call_count, 1)
        _pdf, bucket, key = s3_mock.upload_fileobj.call_args.args

        self.assertEqual(bucket, "test-bucket")
        self.assertEqual(key, "test_app/test_job/final_policy.pdf")
