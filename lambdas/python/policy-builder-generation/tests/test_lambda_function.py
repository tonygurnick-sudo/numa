import unittest
from unittest.mock import patch

from aws_lambda_powertools.utilities.typing import LambdaContext

import bedrock
import lambda_function

CONTEXT = LambdaContext()
CONTEXT._function_name = "test_function_name"  # pylint: disable=protected-access


EVENT = {
    "additional_comments": "",
    "app_name": "test_app",
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
    },
}

EXPECTED_RESPONSE = bedrock.GPTResponse(
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


class TestGeneration(unittest.TestCase):
    @patch.dict("os.environ", {"BUCKET": "test-bucket"})
    @patch("bedrock.BedrockClaude3Model.run", return_value=EXPECTED_RESPONSE)
    @patch("lambda_function.s3_client")
    def test(self, s3_mock, run_mock):
        result = lambda_function.handler(EVENT, CONTEXT)
        run_mock.assert_called_once()
        self.assertEqual(
            result["initial_policy_key"],
            "test_app/test_job/initial_policy_one",
        )
        self.assertEqual(
            result["initial_policy_explanation_key"],
            "test_app/test_job/initial_policy_explanation_one",
        )

        self.assertEqual(s3_mock.put_object.call_count, 2)
        calls = s3_mock.put_object.call_args_list
        for call in calls:
            self.assertEqual(call.kwargs["Bucket"], "test-bucket")
        self.assertEqual(
            calls[0].kwargs["Key"],
            "test_app/test_job/initial_policy_one",
        )
        self.assertEqual(
            calls[0].kwargs["Body"].decode("utf-8"),
            "policy",
        )
        self.assertEqual(
            calls[1].kwargs["Key"],
            "test_app/test_job/initial_policy_explanation_one",
        )
        self.assertEqual(
            calls[1].kwargs["Body"].decode("utf-8"),
            "explanation",
        )
