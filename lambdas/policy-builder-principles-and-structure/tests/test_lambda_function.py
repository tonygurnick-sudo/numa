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
}

EXPECTED_RESPONSE = bedrock.GPTResponse(
    [
        {
            "input": {
                "policy_principles": "policy principles",
                "policy_structure_list": "policy structure list",
                "policy_structure_overview": "policy structure overview",
            }
        }
    ],
    {},
)


class TestGetPrinsiplesAndStructure(unittest.TestCase):
    @patch.dict("os.environ", {"BUCKET": "test-bucket"})
    @patch("bedrock.BedrockClaude3Model.run", return_value=EXPECTED_RESPONSE)
    @patch("lambda_function.s3_client")
    def test(self, s3_mock, run_mock):
        result = lambda_function.handler(EVENT, CONTEXT)
        run_mock.assert_called_once()
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
