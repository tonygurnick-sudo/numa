# test_lambda_function.py
# pylint: disable=protected-access
import json
import unittest
from unittest.mock import MagicMock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):

    @patch("lambda_function.bedrock.BedrockClaude3Model")
    @patch("lambda_function.s3")
    def test_handler_happy_path(self, mock_s3_client, mock_bedrock_model):
        """
        Test that the handler successfully processes a valid event
        and writes the JSON result to S3.
        """
        mock_bedrock_instance = MagicMock()
        # Mock LLM response
        mock_bedrock_instance.run.return_value.response = [
            {
                "input": {
                    "linkedin_variation": "LinkedIn ad content",
                    "seek_variation": "Seek ad content",
                }
            }
        ]
        mock_bedrock_model.return_value = mock_bedrock_instance

        # mock_s3 = MagicMock()
        # mock_s3_client.return_value = mock_s3

        # Valid event
        event = {
            "job_ad_context": {
                "description_of_job_ad": "We need a software engineer...",
                "example_job_ads": "Some example job ads",
                "phrases_or_policies_to_include": "Some policies",
                "tone_of_voice": "inviting",
            },
            "company_profile": {
                "company_name": "Arcanum AI",
                "industry": "Artificial Intelligence",
                "description": "AI solutions provider...",
                "company_values": "Innovative, Inclusive...",
            },
            "output_bucket": "test-bucket",
            "output_key": "test/key.json",
        }

        response = lambda_function.handler(event, {})
        # Check calls
        mock_bedrock_model.assert_called_once()
        mock_bedrock_instance.run.assert_called_once()

        mock_s3_client.put_object.assert_called_once()
        call_kwargs = mock_s3_client.put_object.call_args.kwargs
        self.assertEqual(call_kwargs["Bucket"], "test-bucket")
        self.assertEqual(call_kwargs["Key"], "test/key.json")

        # Validate JSON body
        body_json = json.loads(call_kwargs["Body"])
        self.assertIn("linkedin_ad", body_json)
        self.assertIn("seek_ad", body_json)

        # Check the return
        self.assertEqual(response["output_bucket"], "test-bucket")
        self.assertEqual(response["output_key"], "test/key.json")

    @patch("lambda_function.bedrock.BedrockClaude3Model")
    @patch("lambda_function.s3")
    def test_missing_description_of_job_ad(self, mock_s3_client, mock_bedrock_model):
        """
        Test that the handler raises a KeyError if description_of_job_ad is missing.
        """
        mock_bedrock_instance = MagicMock()
        mock_bedrock_instance.run.return_value.response = [
            {
                "input": {
                    "linkedin_variation": "LinkedIn content",
                    "seek_variation": "Seek content",
                }
            }
        ]
        mock_bedrock_model.return_value = mock_bedrock_instance

        mock_s3 = MagicMock()
        mock_s3_client.return_value = mock_s3

        # We have a 'job_ad_context' but no 'description_of_job_ad'
        event = {
            "job_ad_context": {
                # "description_of_job_ad": "We need a developer...", # intentionally omitted
            },
            "company_profile": {
                "company_name": "Arcanum AI",
                "industry": "Artificial Intelligence",
                "description": "AI solutions provider...",
                "company_values": "Innovative, Inclusive...",
            },
            "output_bucket": "test-bucket",
            "output_key": "test/key.json",
        }

        with self.assertRaises(KeyError) as cm:
            lambda_function.handler(event, {})
        self.assertIn(
            "Missing 'description_of_job_ad' in 'job_ad_context'", str(cm.exception)
        )

    @patch("lambda_function.bedrock.BedrockClaude3Model")
    @patch("lambda_function.s3")
    def test_missing_output_fields(self, mock_s3_client, mock_bedrock_model):
        """
        Test that the handler raises a KeyError if output_bucket or output_key is missing.
        """
        mock_bedrock_instance = MagicMock()
        mock_bedrock_instance.run.return_value.response = [
            {
                "input": {
                    "linkedin_variation": "LinkedIn content",
                    "seek_variation": "Seek content",
                }
            }
        ]
        mock_bedrock_model.return_value = mock_bedrock_instance

        mock_s3 = MagicMock()
        mock_s3_client.return_value = mock_s3

        # Missing output_key
        event = {
            "job_ad_context": {
                "description_of_job_ad": "We need a software engineer..."
            },
            "company_profile": {
                "company_name": "Arcanum AI",
                "industry": "Artificial Intelligence",
                "description": "AI solutions provider...",
                "company_values": "Innovative, Inclusive...",
            },
            "output_bucket": "test-bucket",
        }

        with self.assertRaises(KeyError) as cm:
            lambda_function.handler(event, {})
        self.assertIn("output_key is missing in event", str(cm.exception))

    @patch("lambda_function.bedrock.BedrockClaude3Model")
    @patch("lambda_function.s3")
    def test_handler_empty_event(self, mock_s3_client, mock_bedrock_model):
        """
        Test the handler with an empty event. We expect a KeyError for missing
        output_bucket at the very least.
        """
        mock_bedrock_instance = MagicMock()
        mock_bedrock_instance.run.return_value.response = [
            {
                "input": {
                    "linkedin_variation": "LinkedIn ad content",
                    "seek_variation": "Seek ad content",
                }
            }
        ]
        mock_bedrock_model.return_value = mock_bedrock_instance

        mock_s3 = MagicMock()
        mock_s3_client.return_value = mock_s3

        event = {}  # completely empty

        with self.assertRaises(KeyError) as cm:
            lambda_function.handler(event, {})
        # For example, you might expect the code to first check output_bucket
        self.assertIn("output_bucket is missing in event", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
