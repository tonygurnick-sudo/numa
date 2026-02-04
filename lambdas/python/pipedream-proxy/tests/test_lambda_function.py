# pylint: disable=protected-access
import json
import os
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

import lambda_function
from pipedream_operations import PipedreamOperations
from security_validator import SecurityValidationError


class TestLambdaFunction(unittest.TestCase):
    """Test cases for the pipedream-proxy lambda function."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.mock_context = Mock()
        self.mock_context.function_name = "pipedream-proxy"
        self.mock_context.aws_request_id = "test-request-id-123"

        # Standard environment variables
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials",
            "SUPPORTED_INTEGRATIONS": '["slack", "gmail", "notion"]',
            "ENVIRONMENT": "test",
        }

        # Valid request payload
        self.valid_request = {
            "operation": "get_integration_status",
            "external_user_id": "arcanum_demo_user123",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20230813%2Fus-east-1%2Fsts%2Faws4_request&X-Amz-Date=20230813T100000Z&X-Amz-Expires=60&X-Amz-SignedHeaders=host&X-Amz-Signature=example",
        }

    def test_handler_missing_operation(self) -> None:
        """Test handler with missing operation parameter."""
        event = {
            "external_user_id": "arcanum_demo_user123",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Missing required parameter: operation")

    def test_handler_missing_external_user_id(self) -> None:
        """Test handler with missing external_user_id parameter."""
        event = {
            "operation": "get_integration_status",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Missing required parameter: external_user_id")

    def test_handler_missing_sts_proof_url(self) -> None:
        """Test handler with missing sts_proof_url parameter."""
        event = {
            "operation": "get_integration_status",
            "external_user_id": "arcanum_demo_user123",
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Missing required parameter: sts_proof_url")

    def test_handler_unsupported_operation(self) -> None:
        """Test handler with unsupported operation."""
        event = {
            "operation": "unsupported_operation",
            "external_user_id": "arcanum_demo_user123",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Unsupported operation: unsupported_operation")

    def test_handler_invalid_external_user_id_format(self) -> None:
        """Test handler with invalid external_user_id format (no underscore)."""
        event = {
            "operation": "get_integration_status",
            "external_user_id": "invalidformat",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Invalid external_user_id format")

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_handler_security_validation_failure(
        self, mock_security_validator, _mock_pipedream_ops
    ) -> None:
        """Test handler when security validation fails."""
        mock_validator_instance = Mock()
        mock_security_validator.return_value = mock_validator_instance
        mock_validator_instance.validate_request.side_effect = SecurityValidationError(
            "Access denied"
        )

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 403)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Access denied")

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_handler_generate_connect_token_success(
        self, mock_security_validator, mock_pipedream_ops
    ) -> None:
        """Test successful generate_connect_token operation."""
        # Mock security validation success
        mock_validator_instance = Mock()
        mock_security_validator.return_value = mock_validator_instance
        mock_validator_instance.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "arcanum-demo-test_pipedream-relay",
        }

        # Mock pipedream operations success
        mock_pipedream_instance = Mock()
        mock_pipedream_ops.return_value = mock_pipedream_instance
        mock_pipedream_instance.generate_connect_token.return_value = {
            "connectToken": "pd_oauth_connect_abc123def456",
            "externalUserId": "arcanum_demo_user123",
            "expiresAt": "2025-08-13T11:30:00Z",
            "connectLinkUrl": "https://api.pipedream.com/connect/oauth/abc123",
        }

        event = {
            "operation": "generate_connect_token",
            "external_user_id": "arcanum_demo_user123",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertTrue(body["success"])
        self.assertEqual(body["operation"], "generate_connect_token")
        self.assertIn("connectToken", body["data"])
        self.assertEqual(body["data"]["externalUserId"], "arcanum_demo_user123")

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_handler_get_integration_status_success(
        self, mock_security_validator, mock_pipedream_ops
    ) -> None:
        """Test successful get_integration_status operation."""
        # Mock security validation success
        mock_validator_instance = Mock()
        mock_security_validator.return_value = mock_validator_instance
        mock_validator_instance.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "arcanum-demo-test_pipedream-relay",
        }

        # Mock pipedream operations success
        mock_pipedream_instance = Mock()
        mock_pipedream_ops.return_value = mock_pipedream_instance
        mock_pipedream_instance.get_integration_status.return_value = {
            "connections": [
                {
                    "app_name": "slack",
                    "status": "connected",
                    "pipedream_account_id": "pa_abc123",
                    "last_auth_check": "2025-08-13T10:00:00Z",
                    "mcp_server_url": "https://remote.mcp.pipedream.net/arcanum_demo_user123/slack",
                }
            ],
            "external_user_id": "arcanum_demo_user123",
            "connected_apps": ["slack"],
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertTrue(body["success"])
        self.assertEqual(body["operation"], "get_integration_status")
        self.assertIn("connections", body["data"])
        self.assertEqual(len(body["data"]["connected_apps"]), 1)

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_handler_create_mcp_client_success(
        self, mock_security_validator, mock_pipedream_ops
    ) -> None:
        """Test successful create_mcp_client operation."""
        # Mock security validation success
        mock_validator_instance = Mock()
        mock_security_validator.return_value = mock_validator_instance
        mock_validator_instance.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "arcanum-demo-test_pipedream-relay",
        }

        # Mock pipedream operations success
        mock_pipedream_instance = Mock()
        mock_pipedream_ops.return_value = mock_pipedream_instance
        mock_pipedream_instance.create_mcp_client.return_value = {
            "base_url": "https://remote.mcp.pipedream.net/arcanum_demo_user123/slack",
            "headers": {
                "Authorization": "Bearer pd_oauth_access_token_xyz",
                "x-pd-project-id": "prj_abc123def456",
                "x-pd-environment": "production",
            },
            "app_name": "slack",
            "external_user_id": "arcanum_demo_user123",
        }

        event = {
            "operation": "create_mcp_client",
            "external_user_id": "arcanum_demo_user123",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
            "parameters": {"app_name": "slack"},
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertTrue(body["success"])
        self.assertEqual(body["operation"], "create_mcp_client")
        self.assertIn("base_url", body["data"])
        self.assertEqual(body["data"]["app_name"], "slack")

    @patch("lambda_function.SecurityValidator")
    def test_handler_create_mcp_client_missing_app_name(
        self, mock_security_validator
    ) -> None:
        """Test create_mcp_client operation with missing app_name parameter."""
        # Mock security validation success to get past that step
        mock_validator_instance = Mock()
        mock_security_validator.return_value = mock_validator_instance
        mock_validator_instance.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "arcanum-demo-test_pipedream-relay",
        }

        event = {
            "operation": "create_mcp_client",
            "external_user_id": "arcanum_demo_user123",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/...",
        }

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 400)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(
            body["error"], "create_mcp_client operation requires app_name parameter"
        )

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_handler_pipedream_operations_failure(
        self, mock_security_validator, mock_pipedream_ops
    ) -> None:
        """Test handler when Pipedream operations fail."""
        # Mock security validation success
        mock_validator_instance = Mock()
        mock_security_validator.return_value = mock_validator_instance
        mock_validator_instance.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "arcanum-demo-test_pipedream-relay",
        }

        # Mock pipedream operations failure
        mock_pipedream_instance = Mock()
        mock_pipedream_ops.return_value = mock_pipedream_instance
        mock_pipedream_instance.get_integration_status.side_effect = Exception(
            "Pipedream API error"
        )

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(self.valid_request, self.mock_context)

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertEqual(body["error"], "Internal server error")


class TestPipedreamOperations(unittest.TestCase):
    """Test cases for PipedreamOperations class."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.secret_arn = (
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials"
        )
        self.supported_integrations = '["slack", "gmail", "notion"]'

        self.env_vars = {
            "PIPEDREAM_SECRET_ARN": self.secret_arn,
            "SUPPORTED_INTEGRATIONS": self.supported_integrations,
        }

        # Mock credentials
        self.mock_credentials = {
            "client_id": "test_client_id",
            "client_secret": "test_client_secret",
            "project_id": "prj_test123",
            "environment": "production",
        }

    @patch("boto3.client")
    def test_get_credentials_success(self, mock_boto_client) -> None:
        """Test successful credentials retrieval from Secrets Manager."""
        mock_secrets_client = Mock()
        mock_boto_client.return_value = mock_secrets_client

        mock_secrets_client.get_secret_value.return_value = {
            "SecretString": json.dumps(self.mock_credentials)
        }

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            credentials = ops.get_credentials()

        self.assertEqual(credentials, self.mock_credentials)
        mock_secrets_client.get_secret_value.assert_called_once_with(
            SecretId=self.secret_arn
        )

    @patch("boto3.client")
    def test_get_credentials_invalid_json(self, mock_boto_client) -> None:
        """Test credentials retrieval with invalid JSON."""
        mock_secrets_client = Mock()
        mock_boto_client.return_value = mock_secrets_client

        mock_secrets_client.get_secret_value.return_value = {
            "SecretString": "not valid json"
        }

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()

            with self.assertRaises(ValueError) as context:
                ops.get_credentials()

            self.assertIn(
                "Failed to retrieve Pipedream credentials", str(context.exception)
            )

    @patch("boto3.client")
    def test_get_credentials_not_dict(self, mock_boto_client) -> None:
        """Test credentials retrieval when JSON is not a dict."""
        mock_secrets_client = Mock()
        mock_boto_client.return_value = mock_secrets_client

        mock_secrets_client.get_secret_value.return_value = {
            "SecretString": json.dumps(["not", "a", "dict"])
        }

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()

            with self.assertRaises(ValueError) as context:
                ops.get_credentials()

            self.assertIn("Credentials must be a JSON object", str(context.exception))

    @patch("boto3.client")
    def test_get_credentials_secrets_manager_failure(self, mock_boto_client) -> None:
        """Test credentials retrieval when Secrets Manager fails."""
        mock_secrets_client = Mock()
        mock_boto_client.return_value = mock_secrets_client

        mock_secrets_client.get_secret_value.side_effect = ClientError(
            {
                "Error": {
                    "Code": "ResourceNotFoundException",
                    "Message": "Secret not found",
                }
            },
            "GetSecretValue",
        )

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()

            with self.assertRaises(ValueError) as context:
                ops.get_credentials()

            self.assertIn(
                "Failed to retrieve Pipedream credentials", str(context.exception)
            )

    @patch("requests.post")
    @patch("pipedream_operations.PipedreamOperations.get_credentials")
    def test_get_access_token_success(self, mock_get_credentials, mock_post) -> None:
        """Test successful OAuth access token retrieval."""
        mock_get_credentials.return_value = self.mock_credentials

        mock_response = Mock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {"access_token": "test_access_token"}
        mock_post.return_value = mock_response

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            token = ops.get_access_token()

        self.assertEqual(token, "test_access_token")

        mock_post.assert_called_once_with(
            "https://api.pipedream.com/v1/oauth/token",
            headers={
                "Content-Type": "application/json",
                "x-pd-environment": "production",
            },
            json={
                "grant_type": "client_credentials",
                "client_id": "test_client_id",
                "client_secret": "test_client_secret",
            },
            timeout=10,
        )

    @patch("requests.post")
    @patch("pipedream_operations.PipedreamOperations.get_credentials")
    def test_get_access_token_api_failure(
        self, mock_get_credentials, mock_post
    ) -> None:
        """Test OAuth access token retrieval with API failure."""
        mock_get_credentials.return_value = self.mock_credentials

        mock_post.side_effect = Exception("Network error")

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()

            with self.assertRaises(Exception) as context:
                ops.get_access_token()

            self.assertIn("Pipedream OAuth error", str(context.exception))


class TestInjectAuthProvisionId(unittest.TestCase):
    """Test cases for _inject_auth_provision_id auth resolution."""

    def setUp(self) -> None:
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
            "SUPPORTED_INTEGRATIONS": '["jira", "slack", "trello"]',
            "ENVIRONMENT": "test",
        }
        self.mock_connections = [
            {"id": "apn_jira123", "app": {"name_slug": "jira"}},
            {"id": "apn_slack456", "app": {"name_slug": "slack"}},
            {"id": "apn_salesforce789", "app": {"name_slug": "salesforce_rest_api"}},
        ]

    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_normal_match_by_prop_key(self, mock_connections) -> None:
        """Prop key 'jira' maps directly to the jira connection."""
        mock_connections.return_value = self.mock_connections

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "jira-get-issue",
                {"jira": {"authProvisionId": "auto"}, "cloudId": "abc"},
            )

        self.assertEqual(result["jira"]["authProvisionId"], "apn_jira123")
        self.assertEqual(result["cloudId"], "abc")

    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_fallback_app_key_resolves_via_action_key(self, mock_connections) -> None:
        """Legacy prop key 'app' falls back to action_key 'jira-create-issue' -> jira."""
        mock_connections.return_value = self.mock_connections

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "jira-create-issue",
                {"app": {"authProvisionId": "auto"}, "cloudId": "abc"},
            )

        self.assertEqual(result["app"]["authProvisionId"], "apn_jira123")

    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_fallback_with_underscore_slug(self, mock_connections) -> None:
        """Action key 'salesforce_rest_api-create-record' resolves to salesforce_rest_api."""
        mock_connections.return_value = self.mock_connections

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "salesforce_rest_api-create-record",
                {"app": {"authProvisionId": "auto"}},
            )

        self.assertEqual(result["app"]["authProvisionId"], "apn_salesforce789")

    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_no_match_raises_error(self, mock_connections) -> None:
        """Raises ValueError when no connection matches."""
        mock_connections.return_value = self.mock_connections

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            with self.assertRaises(ValueError):
                ops._inject_auth_provision_id(
                    "user1",
                    "unknown_app-do-thing",
                    {"app": {"authProvisionId": "auto"}},
                )

    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_non_auto_props_untouched(self, mock_connections) -> None:
        """Props without authProvisionId 'auto' are not modified."""
        mock_connections.return_value = self.mock_connections

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "jira-get-issue",
                {"cloudId": "abc", "issueKey": "NUMA-1"},
            )

        self.assertEqual(result, {"cloudId": "abc", "issueKey": "NUMA-1"})
        mock_connections.assert_not_called()

    @patch.object(PipedreamOperations, "_get_expected_auth_key")
    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_auth_key_normalization_jira_to_app(
        self, mock_connections, mock_expected_key
    ) -> None:
        """Auth key 'jira' should be normalized to 'app' for jira-create-issue."""
        mock_connections.return_value = self.mock_connections
        mock_expected_key.return_value = "app"  # Schema says use 'app'

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "jira-create-issue",
                {"jira": {"authProvisionId": "auto"}, "cloudId": "abc"},
            )

        # Should have normalized "jira" -> "app"
        self.assertNotIn("jira", result)
        self.assertEqual(result["app"]["authProvisionId"], "apn_jira123")
        self.assertEqual(result["cloudId"], "abc")

    @patch.object(PipedreamOperations, "_get_expected_auth_key")
    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_auth_key_no_normalization_when_matches(
        self, mock_connections, mock_expected_key
    ) -> None:
        """Auth key 'jira' should stay 'jira' when schema expects 'jira'."""
        mock_connections.return_value = self.mock_connections
        mock_expected_key.return_value = "jira"  # Schema says use 'jira'

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "jira-get-issue",
                {"jira": {"authProvisionId": "auto"}, "issueIdOrKey": "NUMA-1"},
            )

        # Should keep "jira" unchanged
        self.assertEqual(result["jira"]["authProvisionId"], "apn_jira123")
        self.assertEqual(result["issueIdOrKey"], "NUMA-1")

    @patch.object(PipedreamOperations, "_get_expected_auth_key")
    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_auth_key_already_correct(
        self, mock_connections, mock_expected_key
    ) -> None:
        """Auth key 'app' should stay 'app' when schema expects 'app'."""
        mock_connections.return_value = self.mock_connections
        mock_expected_key.return_value = "app"  # Schema says use 'app'

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "jira-create-issue",
                {"app": {"authProvisionId": "auto"}},
            )

        # Should keep "app" unchanged (already correct)
        self.assertEqual(result["app"]["authProvisionId"], "apn_jira123")

    @patch.object(PipedreamOperations, "_get_expected_auth_key")
    @patch.object(PipedreamOperations, "_get_user_connections")
    def test_auth_key_normalization_fallback_when_schema_unavailable(
        self, mock_connections, mock_expected_key
    ) -> None:
        """When schema is unavailable, original key is used unchanged."""
        mock_connections.return_value = self.mock_connections
        mock_expected_key.return_value = None  # Schema not found

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._inject_auth_provision_id(
                "user1",
                "jira-get-issue",
                {"jira": {"authProvisionId": "auto"}},
            )

        # Should use original key when schema unavailable
        self.assertEqual(result["jira"]["authProvisionId"], "apn_jira123")


if __name__ == "__main__":
    unittest.main()
