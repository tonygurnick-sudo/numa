import json
import unittest
from unittest.mock import MagicMock, patch

from lambda_function import extract_full_document, extraction_page_by_page, handler


class TestLambdaFunction(unittest.TestCase):
    @patch(
        "lambda_function.configurations",
        {
            "personal_finance": {
                "tools": ["finance_tool"],
                "tool_name": "print_data",
                "tool_array_key": "data",
                "prompt": "Extract relevant financial data from {document}",
            }
        },
    )
    @patch("bedrock.BedrockClaude3Model")
    def test_handler_single_extraction(self, mock_model):
        # Mocking the model's response
        mock_response = MagicMock()
        mock_response.run.return_value.response = [
            {"input": {"data": [{"field": "value"}]}}
        ]
        mock_model.return_value = mock_response

        event = {
            "content": "This is some sample content",
            "config": "personal_finance",
            "data_extraction_type": "full_document",
        }
        context = {}

        result = handler(event, context)
        expected_result = [{"field": "value"}]

        self.assertEqual(result, expected_result)
        mock_response.run.assert_called_once()

    @patch(
        "lambda_function.configurations",
        {
            "personal_finance": {
                "tools": ["finance_tool"],
                "tool_name": "print_data",
                "tool_array_key": "data",
                "prompt": "Extract relevant financial data from {document}",
            }
        },
    )
    @patch("bedrock.BedrockClaude3Model")
    def test_handler_multiple_extraction(self, mock_model):
        # Mocking the model's response for each page
        mock_response = MagicMock()
        mock_response.run.return_value.response = [
            {"input": {"data": [{"field": "value"}]}}
        ]
        mock_model.return_value = mock_response

        event = {
            "content": {"pages": ["Page 1 content", "Page 2 content"]},
            "config": "personal_finance",
            "data_extraction_type": "page_by_page",
        }
        context = {}

        result = handler(event, context)
        expected_result = [{"field": "value"}, {"field": "value"}]

        self.assertEqual(result, expected_result)
        self.assertEqual(mock_response.run.call_count, 2)

    def test_handler_invalid_config(self):
        # Test for unknown configuration
        event = {
            "content": "This is some sample content",
            "config": "unknown_config",
            "data_extraction_type": "full_document",
        }
        test_context = {}  # Rename to avoid conflict

        with self.assertRaises(ValueError) as exception_context:
            handler(event, test_context)
        self.assertIn(
            "Unknown config 'unknown_config'", str(exception_context.exception)
        )

    def test_handler_invalid_extraction_type(self):
        # Test for invalid data_extraction_type
        event = {
            "content": "This is some sample content",
            "config": "personal_finance",
            "data_extraction_type": "invalid_type",
        }
        test_context = {}  # Rename to avoid conflict

        with self.assertRaises(ValueError) as exception_context:
            handler(event, test_context)
        self.assertIn(
            "Unknown data_extraction_type 'invalid_type'",
            str(exception_context.exception),
        )

    @patch("bedrock.BedrockClaude3Model")
    def test_extraction_single_result_string_response(self, mock_model):
        # Mocking a string response that requires json.loads()
        mock_response = MagicMock()
        mock_response.run.return_value.response = [
            {"input": {"data": json.dumps([{"field": "value"}])}}
        ]
        mock_model.return_value = mock_response

        model = mock_model()
        prompt = "Extract relevant data from {document}"
        extracted_data = "Sample content"
        result = extract_full_document(
            model, prompt, extracted_data, tool_array_key="data"
        )
        expected_result = [{"field": "value"}]

        self.assertEqual(result, expected_result)

    @patch("bedrock.BedrockClaude3Model")
    def test_extraction_multiple_results(self, mock_model):
        # Mocking a multi-page response with distinct results for each page
        mock_response = MagicMock()
        mock_response.response = [{"input": {"data": [{"field": "value1"}]}}]

        # Set side effect for multiple pages to simulate distinct responses per page
        mock_model.return_value.run.side_effect = [
            mock_response,
            MagicMock(response=[{"input": {"data": [{"field": "value2"}]}}]),
        ]

        model = mock_model()
        prompt = "Extract relevant data from {document}"
        extracted_data = {"pages": ["Page 1 content", "Page 2 content"]}
        result = extraction_page_by_page(
            model, prompt, extracted_data, tool_array_key="data"
        )
        expected_result = [{"field": "value1"}, {"field": "value2"}]

        self.assertEqual(result, expected_result)
        self.assertEqual(mock_model.return_value.run.call_count, 2)

    @patch("bedrock.BedrockClaude3Model")
    def test_extraction_result_with_unknown_replacement(self, mock_model):
        # Test replacement of <UNKNOWN> with "unknown" in the response
        mock_response = MagicMock()
        mock_response.run.return_value.response = [
            {
                "input": {
                    "data": json.dumps([{"field": "<UNKNOWN>"}]).replace(
                        '"<UNKNOWN>"', "<UNKNOWN>"
                    )
                }
            }
        ]
        mock_model.return_value = mock_response

        model = mock_model()
        prompt = "Extract relevant data from {document}"
        extracted_data = "Sample content"
        result = extract_full_document(
            model, prompt, extracted_data, tool_array_key="data"
        )
        expected_result = [{"field": "unknown"}]

        self.assertEqual(result, expected_result)

    @patch("bedrock.BedrockClaude3Model")
    def test_extraction_with_invalid_json_response(self, mock_model):
        # Mock a response that is not valid JSON and causes a json.loads() error
        mock_response = MagicMock()
        mock_response.run.return_value.response = [{"input": {"data": "Invalid JSON"}}]
        mock_model.return_value = mock_response

        model = mock_model()
        prompt = "Extract relevant data from {document}"
        extracted_data = "Sample content"

        with self.assertRaises(json.JSONDecodeError):
            extract_full_document(model, prompt, extracted_data, tool_array_key="data")


if __name__ == "__main__":
    unittest.main()
