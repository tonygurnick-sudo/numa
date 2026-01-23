import os
import os.path
import sys
import unittest
from unittest.mock import MagicMock, Mock, patch

# Add the lib directory to the Python path to find the helpers module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
sys.path.append(os.path.join(project_root, "lib/helpers"))
sys.path.append(os.path.join(project_root, "lib/bedrock"))

# Mock the jwt, bedrock, and s3_helpers modules before importing lambda_function
sys.modules["jwt"] = Mock()
sys.modules["bedrock"] = Mock()
sys.modules["bedrock.language"] = Mock()
sys.modules["s3_helpers"] = Mock()

# pylint: disable=wrong-import-position
from lambda_function import (
    calculate_costs,
    extract_parameters_with_tool,
    generate_calculation_details,
    generate_quote,
    handler,
    prepare_input_parameters,
    remove_backticks,
)


class TestLambdaFunction(unittest.TestCase):
    def test_remove_backticks(self):
        """Test that backticks are removed from text."""
        text = "This is a `test` with `backticks`"
        expected = "This is a test with backticks"
        self.assertEqual(remove_backticks(text), expected)

    def test_prepare_input_parameters(self):
        """Test that input parameters are properly formatted."""
        specs = {"width": 100, "length": 200}
        expected = "Specifications: {'width': 100, 'length': 200}"
        self.assertEqual(prepare_input_parameters(specs), expected)

    @patch("lambda_function.extract_parameters_with_tool")
    @patch("lambda_function.calculate_costs")
    @patch("lambda_function.generate_calculation_details")
    @patch("lambda_function.generate_quote")
    @patch("s3_helpers.write")
    @patch.dict("os.environ", {"BUCKET": "test-bucket"})  # Mock the BUCKET env var
    def test_handler_success(
        self,
        mock_s3_write,
        mock_generate_quote,
        mock_generate_details,
        mock_calculate_costs,
        mock_extract_parameters,
    ):
        """Test successful execution of the handler function."""
        # Setup mocks
        mock_extract_parameters.return_value = {
            "width": 100,
            "length": 200,
            "poly_type": "ACCA",
            "complexity": "S",
            "costing_model": "decrashape",
        }
        mock_calculate_costs.return_value = {
            "total": 1000,
            "subtotal": 870,
            "gst": 130,
        }
        mock_generate_details.return_value = "Calculation details"
        mock_generate_quote.return_value = "Quote"

        # Create test event and context
        event = {
            "app_id": "costing-calculator",  # Add required app_id for logging
            "job_id": "test-job",
            "specifications": {"width": 100, "length": 200},
            "output_key": "test/output.json",
        }
        context = MagicMock()

        # Call handler
        result = handler(event, context)

        # Verify calls
        mock_extract_parameters.assert_called_once()
        mock_calculate_costs.assert_called_once()
        mock_generate_details.assert_called_once()
        mock_generate_quote.assert_called_once()
        self.assertEqual(
            mock_s3_write.call_count, 3
        )  # 3 S3 writes: JSON, details, quote

        # Verify response structure
        self.assertIn("results", result)
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(len(result["results"][0]["outputs"]), 3)

    @patch("lambda_function.extract_parameters_with_tool")
    @patch("helpers.setup_step_function_lambda_logging")  # Mock the logging setup
    def test_handler_parameter_validation_error(self, _, mock_extract_parameters):
        """Test that handler handles parameter validation errors."""
        # Setup mock to raise ValueError
        mock_extract_parameters.side_effect = ValueError("Invalid parameters")

        # Create test event and context
        event = {
            "app_id": "costing-calculator",  # Add required app_id for logging
            "job_id": "test-job",
            "specifications": {"width": -100},  # Invalid width
            "output_key": "test/output.json",
        }
        context = MagicMock()

        # Call handler and check for exception
        with self.assertRaises(ValueError):
            handler(event, context)

    @patch("bedrock.BedrockClaude3Model")
    def test_extract_parameters_with_tool_success(self, mock_bedrock_model):
        """Test successful parameter extraction."""
        # Setup the mock response
        mock_instance = mock_bedrock_model.return_value
        mock_instance.run.return_value = MagicMock(
            response=[{"input": {"width": 100, "length": 200}}]
        )

        # Test the function
        input_text = "Specifications: width=100, length=200"
        result = extract_parameters_with_tool(input_text)

        # Verify the results
        self.assertEqual(result.get("width"), 100)
        self.assertEqual(result.get("length"), 200)
        mock_instance.run.assert_called_once()

    @patch("bedrock.BedrockClaude3Model")
    def test_extract_parameters_with_tool_unexpected_response(self, mock_bedrock_model):
        """Test handling of unexpected response format."""
        # Setup the mock to return unexpected format
        mock_instance = mock_bedrock_model.return_value
        mock_instance.run.return_value = MagicMock(response="Invalid response")

        # Test the function and expect an exception
        with self.assertRaises(ValueError):
            extract_parameters_with_tool("Specifications: width=100")

    def test_calculate_costs_success(self):
        """Test successful cost calculation."""
        # Create a real parameters object
        parameters = {
            "width": 100,
            "length": 200,
            "poly_type": "ACCA",
            "complexity": "S",
            "costing_model": "decrashape",
        }

        # Call the actual function with real parameters
        result = calculate_costs(parameters)

        # Verify the structure of the results
        self.assertIn("total", result)
        self.assertIn("subtotal", result)
        self.assertIn("gst", result)
        self.assertIn("material_costs", result)
        self.assertIn("labor_costs", result)

        # Basic sanity checks on the values
        self.assertGreater(result["total"], 0)
        self.assertGreater(result["subtotal"], 0)
        self.assertGreater(result["gst"], 0)

    @patch("costing_engine.get_costing_engine")
    def test_calculate_costs_error(self, mock_get_engine):
        """Test error handling in calculate_costs."""
        # Setup mock to raise exception
        mock_get_engine.side_effect = ValueError("Invalid model")

        # Test the function and expect an exception
        with self.assertRaises(ValueError):
            calculate_costs({"costing_model": "invalid"})

    @patch("bedrock.BedrockClaude3Model")
    def test_generate_calculation_details(self, mock_bedrock_model):
        """Test generation of calculation details."""
        # Setup mock
        mock_instance = mock_bedrock_model.return_value
        mock_instance.run.return_value = MagicMock(response="Calculation details")

        # Test the function
        parameters = {"width": 100}
        results = {"total": 1000}
        result = generate_calculation_details(parameters, results)

        # Verify result
        self.assertEqual(result, "Calculation details")
        mock_instance.run.assert_called_once()

    @patch("bedrock.BedrockClaude3Model")
    def test_generate_quote(self, mock_bedrock_model):
        """Test generation of quote."""
        # Setup mock
        mock_instance = mock_bedrock_model.return_value
        mock_instance.run.return_value = MagicMock(response="Quote")

        # Test the function
        parameters = {"width": 100}
        results = {"total": 1000}
        result = generate_quote(parameters, results)

        # Verify result
        self.assertEqual(result, "Quote")
        mock_instance.run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
