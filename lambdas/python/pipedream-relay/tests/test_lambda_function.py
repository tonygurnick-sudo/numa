"""
Tests for pipedream-relay lambda function.
"""

import json
import os
import unittest
from unittest.mock import Mock, patch

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    """Test cases for pipedream-relay lambda function."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.mock_context = Mock()
        self.mock_context.function_name = "pipedream-relay"
        self.mock_context.aws_request_id = "test-request-id-123"

        # Standard environment variables
        self.env_vars = {
            "PIPEDREAM_PROXY_LAMBDA_ARN": "arn:aws:lambda:us-east-1:123456789012:function:pipedream-proxy",
        }

        # Valid request payload
        self.valid_request = {
            "operation": "get_integration_status",
            "external_user_id": "arcanum_demo_user123",
        }

    def test_error_response_400(self) -> None:
        """Test _error_response helper with 400 status code."""
        response = lambda_function._error_response(  # pylint: disable=protected-access
            400, "Bad request"
        )

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Bad request")

    def test_error_response_403(self) -> None:
        """Test _error_response helper with 403 status code."""
        response = lambda_function._error_response(  # pylint: disable=protected-access
            403, "Access denied"
        )

        self.assertEqual(response["statusCode"], 403)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Access denied")

    def test_error_response_500(self) -> None:
        """Test _error_response helper with 500 status code."""
        response = lambda_function._error_response(  # pylint: disable=protected-access
            500, "Internal server error"
        )

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Internal server error")

    @patch("lambda_function.Session")
    def test_generate_sts_proof_url_success(self, mock_session_class) -> None:
        """Test successful STS proof URL generation."""
        # Mock session and STS client
        mock_session = Mock()
        mock_sts_client = Mock()
        mock_session_class.return_value = mock_session
        mock_session.create_client.return_value = mock_sts_client

        # Mock the presigned URL generation
        expected_url = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15&X-Amz-Algorithm=AWS4-HMAC-SHA256"
        mock_sts_client.generate_presigned_url.return_value = expected_url

        result = lambda_function.generate_sts_proof_url()

        self.assertEqual(result, expected_url)
        mock_session.create_client.assert_called_once_with(
            "sts", region_name="us-east-1"
        )
        mock_sts_client.generate_presigned_url.assert_called_once_with(
            "get_caller_identity",
            Params={},
            ExpiresIn=60,
            HttpMethod="GET",
        )

    @patch("lambda_function.Session")
    def test_generate_sts_proof_url_custom_params(self, mock_session_class) -> None:
        """Test STS proof URL generation with custom parameters."""
        mock_session = Mock()
        mock_sts_client = Mock()
        mock_session_class.return_value = mock_session
        mock_session.create_client.return_value = mock_sts_client

        expected_url = "https://sts.us-west-2.amazonaws.com/?Action=GetCallerIdentity"
        mock_sts_client.generate_presigned_url.return_value = expected_url

        result = lambda_function.generate_sts_proof_url(region="us-west-2", expires=120)

        self.assertEqual(result, expected_url)
        mock_session.create_client.assert_called_once_with(
            "sts", region_name="us-west-2"
        )
        mock_sts_client.generate_presigned_url.assert_called_once_with(
            "get_caller_identity",
            Params={},
            ExpiresIn=120,
            HttpMethod="GET",
        )

    @patch("lambda_function.Session")
    def test_generate_sts_proof_url_failure(self, mock_session_class) -> None:
        """Test STS proof URL generation failure."""
        mock_session = Mock()
        mock_sts_client = Mock()
        mock_session_class.return_value = mock_session
        mock_session.create_client.return_value = mock_sts_client

        # Mock STS client to raise an exception
        mock_sts_client.generate_presigned_url.side_effect = Exception("STS API error")

        with self.assertRaises(ValueError) as context:
            lambda_function.generate_sts_proof_url()

        self.assertIn("STS proof URL generation failed", str(context.exception))

    def test_handler_missing_environment_variable(self) -> None:
        """Test handler with missing PIPEDREAM_PROXY_LAMBDA_ARN environment variable."""
        # Don't patch environment variables, so PIPEDREAM_PROXY_LAMBDA_ARN is missing
        response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Relay configuration error")

    @patch("lambda_function.generate_sts_proof_url")
    def test_handler_sts_proof_generation_failure(self, mock_generate_sts) -> None:
        """Test handler when STS proof URL generation fails."""
        mock_generate_sts.side_effect = ValueError("STS proof URL generation failed")

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Identity verification setup failed")

    @patch("boto3.client")
    @patch("lambda_function.generate_sts_proof_url")
    def test_handler_successful_proxy_forwarding(
        self, mock_generate_sts, mock_boto_client
    ) -> None:
        """Test successful request forwarding to cross-account proxy."""
        # Mock STS proof URL generation
        mock_generate_sts.return_value = (
            "https://sts.us-east-1.amazonaws.com/test-proof-url"
        )

        # Mock Lambda client
        mock_lambda_client = Mock()
        mock_boto_client.return_value = mock_lambda_client

        # Mock successful proxy response
        proxy_response = {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "success": True,
                    "operation": "get_integration_status",
                    "data": {"connections": [], "connected_apps": []},
                }
            ),
        }
        mock_lambda_client.invoke.return_value = {
            "Payload": Mock(read=lambda: json.dumps(proxy_response).encode())
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        # Verify response
        self.assertEqual(response["statusCode"], 200)
        self.assertTrue(response["body"]["success"])
        self.assertEqual(response["body"]["operation"], "get_integration_status")

        # Verify Lambda invoke was called correctly
        mock_lambda_client.invoke.assert_called_once()
        call_args = mock_lambda_client.invoke.call_args[1]
        self.assertEqual(
            call_args["FunctionName"], self.env_vars["PIPEDREAM_PROXY_LAMBDA_ARN"]
        )
        self.assertEqual(call_args["InvocationType"], "RequestResponse")

        # Verify payload contains STS proof URL
        payload = json.loads(call_args["Payload"])
        self.assertEqual(
            payload["sts_proof_url"],
            "https://sts.us-east-1.amazonaws.com/test-proof-url",
        )
        self.assertEqual(payload["operation"], "get_integration_status")

    @patch("boto3.client")
    @patch("lambda_function.generate_sts_proof_url")
    def test_handler_lambda_execution_error(
        self, mock_generate_sts, mock_boto_client
    ) -> None:
        """Test handler when cross-account lambda execution fails."""
        mock_generate_sts.return_value = (
            "https://sts.us-east-1.amazonaws.com/test-proof-url"
        )

        mock_lambda_client = Mock()
        mock_boto_client.return_value = mock_lambda_client

        # Mock Lambda response with function error
        mock_lambda_client.invoke.return_value = {
            "FunctionError": "Unhandled",
            "Payload": Mock(
                read=lambda: json.dumps(
                    {"errorMessage": "Lambda execution failed"}
                ).encode()
            ),
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Proxy lambda execution failed")

    @patch("boto3.client")
    @patch("lambda_function.generate_sts_proof_url")
    def test_handler_proxy_error_response(
        self, mock_generate_sts, mock_boto_client
    ) -> None:
        """Test handler when proxy returns error status code."""
        mock_generate_sts.return_value = (
            "https://sts.us-east-1.amazonaws.com/test-proof-url"
        )

        mock_lambda_client = Mock()
        mock_boto_client.return_value = mock_lambda_client

        # Mock proxy returning error response
        proxy_response = {
            "statusCode": 403,
            "body": json.dumps({"success": False, "error": "Access denied"}),
        }
        mock_lambda_client.invoke.return_value = {
            "Payload": Mock(read=lambda: json.dumps(proxy_response).encode())
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        # Should return the proxy error response
        self.assertEqual(response["statusCode"], 403)
        self.assertFalse(response["body"]["success"])
        self.assertEqual(response["body"]["error"], "Access denied")

    @patch("boto3.client")
    @patch("lambda_function.generate_sts_proof_url")
    def test_handler_invalid_json_response(
        self, mock_generate_sts, mock_boto_client
    ) -> None:
        """Test handler when proxy returns invalid JSON."""
        mock_generate_sts.return_value = (
            "https://sts.us-east-1.amazonaws.com/test-proof-url"
        )

        mock_lambda_client = Mock()
        mock_boto_client.return_value = mock_lambda_client

        # Mock proxy returning invalid JSON in body
        proxy_response = {"statusCode": 200, "body": "not valid json"}
        mock_lambda_client.invoke.return_value = {
            "Payload": Mock(read=lambda: json.dumps(proxy_response).encode())
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Invalid proxy response format")

    @patch("boto3.client")
    @patch("lambda_function.generate_sts_proof_url")
    def test_handler_boto3_exception(self, mock_generate_sts, mock_boto_client) -> None:
        """Test handler when boto3 Lambda invoke fails."""
        mock_generate_sts.return_value = (
            "https://sts.us-east-1.amazonaws.com/test-proof-url"
        )

        mock_lambda_client = Mock()
        mock_boto_client.return_value = mock_lambda_client

        # Mock boto3 exception
        mock_lambda_client.invoke.side_effect = Exception("Network error")

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Internal relay error")


if __name__ == "__main__":
    unittest.main()
