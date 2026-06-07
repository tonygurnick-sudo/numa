# pylint: disable=protected-access
import base64
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
                    "healthy": True,
                    "dead": None,
                    "connection_name": "nathan@arcanum.ai",
                    "connected_at": "2025-08-13T10:00:00Z",
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
        self.assertEqual(body["error"], "Pipedream API error")


class TestTriggerOperationDispatch(unittest.TestCase):
    """Handler-level dispatch tests for the four trigger lifecycle operations."""

    def setUp(self) -> None:
        self.mock_context = Mock()
        self.mock_context.function_name = "pipedream-proxy"
        self.mock_context.aws_request_id = "test-request-id-123"
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials",
            "SUPPORTED_INTEGRATIONS": '["slack", "gmail", "notion"]',
            "ENVIRONMENT": "test",
        }
        self.valid_user = "arcanum_demo_user123"
        self.valid_sts = "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity"

    def _build_request(self, operation: str, parameters: dict) -> dict:
        return {
            "operation": operation,
            "external_user_id": self.valid_user,
            "sts_proof_url": self.valid_sts,
            "parameters": parameters,
        }

    def _patch_security(self, mock_security_validator: Mock) -> None:
        instance = Mock()
        mock_security_validator.return_value = instance
        instance.validate_request.return_value = {
            "validated": True,
            "caller_account_id": "123456789012",
            "role_name": "arcanum-demo-test_pipedream-relay",
        }

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_deploy_trigger_happy_path(
        self, mock_security_validator: Mock, mock_pipedream_ops: Mock
    ) -> None:
        """Handler forwards deploy_trigger params to the operation method."""
        self._patch_security(mock_security_validator)
        ops_instance = Mock()
        mock_pipedream_ops.return_value = ops_instance
        ops_instance.deploy_trigger.return_value = {
            "id": "dc_xxx",
            "webhook_signing_key": "abc123",
        }

        event = self._build_request(
            "deploy_trigger",
            {
                "component_id": "slack-new-keyword-mention",
                "configured_props": {
                    "slack": {"authProvisionId": "apn_V1h5BYW"},
                    "keyword": "numa",
                },
                "webhook_url": "https://example.numa.arcanum.ai/api/webhooks/pipedream-events/sec",
            },
        )

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertTrue(body["success"])
        self.assertEqual(body["data"]["id"], "dc_xxx")
        ops_instance.deploy_trigger.assert_called_once_with(
            self.valid_user,
            "slack-new-keyword-mention",
            {
                "slack": {"authProvisionId": "apn_V1h5BYW"},
                "keyword": "numa",
            },
            "https://example.numa.arcanum.ai/api/webhooks/pipedream-events/sec",
        )

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_deploy_trigger_missing_params(
        self, mock_security_validator: Mock, _mock_pipedream_ops: Mock
    ) -> None:
        """Missing webhook_url or component_id is rejected as 400."""
        self._patch_security(mock_security_validator)

        event = self._build_request(
            "deploy_trigger",
            {"component_id": "slack-new-keyword-mention", "configured_props": {}},
            # webhook_url missing
        )
        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)
        self.assertEqual(response["statusCode"], 400)

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_update_deployed_trigger_active_only(
        self, mock_security_validator: Mock, mock_pipedream_ops: Mock
    ) -> None:
        """Pause/resume path: only `active` is set, configured_props omitted."""
        self._patch_security(mock_security_validator)
        ops_instance = Mock()
        mock_pipedream_ops.return_value = ops_instance
        ops_instance.update_deployed_trigger.return_value = {
            "id": "dc_xxx",
            "active": False,
        }

        event = self._build_request(
            "update_deployed_trigger",
            {"deployed_trigger_id": "dc_xxx", "active": False},
        )

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        ops_instance.update_deployed_trigger.assert_called_once_with(
            self.valid_user,
            "dc_xxx",
            configured_props=None,
            active=False,
        )

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_update_deployed_trigger_requires_one_field(
        self, mock_security_validator: Mock, _mock_pipedream_ops: Mock
    ) -> None:
        """Update with neither configured_props nor active is rejected."""
        self._patch_security(mock_security_validator)

        event = self._build_request(
            "update_deployed_trigger",
            {"deployed_trigger_id": "dc_xxx"},
        )
        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)
        self.assertEqual(response["statusCode"], 400)

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_delete_deployed_trigger_happy_path(
        self, mock_security_validator: Mock, mock_pipedream_ops: Mock
    ) -> None:
        """Delete dispatches to the underlying operation."""
        self._patch_security(mock_security_validator)
        ops_instance = Mock()
        mock_pipedream_ops.return_value = ops_instance
        ops_instance.delete_deployed_trigger.return_value = {
            "deleted": True,
            "deployed_trigger_id": "dc_xxx",
        }

        event = self._build_request(
            "delete_deployed_trigger", {"deployed_trigger_id": "dc_xxx"}
        )

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        ops_instance.delete_deployed_trigger.assert_called_once_with(
            self.valid_user, "dc_xxx"
        )

    @patch("lambda_function.PipedreamOperations")
    @patch("lambda_function.SecurityValidator")
    def test_list_triggers_happy_path(
        self, mock_security_validator: Mock, mock_pipedream_ops: Mock
    ) -> None:
        """list_triggers returns the wrapped trigger list."""
        self._patch_security(mock_security_validator)
        ops_instance = Mock()
        mock_pipedream_ops.return_value = ops_instance
        ops_instance.list_triggers.return_value = [
            {"key": "slack-new-keyword-mention"},
        ]

        event = self._build_request("list_triggers", {"app_slug": "slack"})

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(len(body["data"]["triggers"]), 1)
        ops_instance.list_triggers.assert_called_once_with("slack")


class TestTriggerOperationsMethods(unittest.TestCase):
    """Method-level tests for the four PipedreamOperations trigger methods.

    These verify the request shape (URL, headers, body) sent to Pipedream.
    """

    def setUp(self) -> None:
        self.env_vars = {
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
            "SUPPORTED_INTEGRATIONS": '["slack", "gmail"]',
            "ENVIRONMENT": "test",
        }
        env_patcher = patch.dict(os.environ, self.env_vars)
        env_patcher.start()
        self.addCleanup(env_patcher.stop)
        self.ops = PipedreamOperations()
        self.creds = {
            "client_id": "test-id",
            "client_secret": "test-secret",
            "project_id": "proj_test",
            "environment": "production",
        }

    @patch.object(PipedreamOperations, "get_access_token", return_value="tok")
    @patch.object(PipedreamOperations, "get_credentials")
    @patch("pipedream_operations.requests.post")
    def test_deploy_trigger_request_shape(
        self, mock_post: Mock, mock_creds: Mock, _mock_token: Mock
    ) -> None:
        mock_creds.return_value = self.creds
        mock_post.return_value = Mock(
            status_code=200,
            json=Mock(
                return_value={"data": {"id": "dc_abc", "webhook_signing_key": "k"}}
            ),
            raise_for_status=Mock(),
        )

        result = self.ops.deploy_trigger(
            external_user_id="acme_user1",
            component_id="slack-new-keyword-mention",
            configured_props={"keyword": "numa"},
            webhook_url="https://example.com/hook",
        )

        mock_post.assert_called_once()
        call_args = mock_post.call_args
        self.assertIn("/v1/connect/proj_test/triggers/deploy", call_args[0][0])
        self.assertEqual(call_args[1]["headers"]["x-pd-environment"], "production")
        body = call_args[1]["json"]
        self.assertEqual(body["id"], "slack-new-keyword-mention")
        self.assertEqual(body["external_user_id"], "acme_user1")
        self.assertEqual(body["webhook_url"], "https://example.com/hook")
        self.assertEqual(body["configured_props"], {"keyword": "numa"})
        self.assertEqual(result["id"], "dc_abc")
        self.assertEqual(result["webhook_signing_key"], "k")

    @patch.object(PipedreamOperations, "get_access_token", return_value="tok")
    @patch.object(PipedreamOperations, "get_credentials")
    @patch("pipedream_operations.requests.put")
    def test_update_deployed_trigger_props_only(
        self, mock_put: Mock, mock_creds: Mock, _mock_token: Mock
    ) -> None:
        mock_creds.return_value = self.creds
        mock_put.return_value = Mock(
            status_code=200,
            json=Mock(return_value={"data": {"id": "dc_abc"}}),
            raise_for_status=Mock(),
        )

        self.ops.update_deployed_trigger(
            external_user_id="acme_user1",
            deployed_trigger_id="dc_abc",
            configured_props={"keyword": "newvalue"},
        )

        mock_put.assert_called_once()
        call_args = mock_put.call_args
        self.assertIn("/v1/connect/proj_test/deployed-triggers/dc_abc", call_args[0][0])
        self.assertEqual(call_args[1]["params"], {"external_user_id": "acme_user1"})
        body = call_args[1]["json"]
        # active not sent when not specified
        self.assertNotIn("active", body)
        self.assertEqual(body["configured_props"], {"keyword": "newvalue"})

    @patch.object(PipedreamOperations, "get_access_token", return_value="tok")
    @patch.object(PipedreamOperations, "get_credentials")
    def test_update_deployed_trigger_rejects_no_op(
        self, mock_creds: Mock, _mock_token: Mock
    ) -> None:
        mock_creds.return_value = self.creds
        with self.assertRaises(ValueError):
            self.ops.update_deployed_trigger(
                external_user_id="acme_user1", deployed_trigger_id="dc_abc"
            )

    @patch.object(PipedreamOperations, "get_access_token", return_value="tok")
    @patch.object(PipedreamOperations, "get_credentials")
    @patch("pipedream_operations.requests.delete")
    def test_delete_deployed_trigger_204(
        self, mock_delete: Mock, mock_creds: Mock, _mock_token: Mock
    ) -> None:
        mock_creds.return_value = self.creds
        mock_delete.return_value = Mock(status_code=204, raise_for_status=Mock())

        result = self.ops.delete_deployed_trigger(
            external_user_id="acme_user1", deployed_trigger_id="dc_abc"
        )

        self.assertTrue(result["deleted"])
        self.assertEqual(result["deployed_trigger_id"], "dc_abc")

    @patch.object(PipedreamOperations, "get_access_token", return_value="tok")
    @patch.object(PipedreamOperations, "get_credentials")
    @patch("pipedream_operations.requests.delete")
    def test_delete_deployed_trigger_404_treated_as_success(
        self, mock_delete: Mock, mock_creds: Mock, _mock_token: Mock
    ) -> None:
        """404 means the trigger is already gone — desired end state."""
        mock_creds.return_value = self.creds
        mock_delete.return_value = Mock(status_code=404, raise_for_status=Mock())

        result = self.ops.delete_deployed_trigger(
            external_user_id="acme_user1", deployed_trigger_id="dc_abc"
        )

        self.assertTrue(result["deleted"])
        self.assertTrue(result.get("already_gone"))


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


class TestGetUserConnectionsPagination(unittest.TestCase):
    """Test cases for _get_user_connections pagination."""

    def setUp(self) -> None:
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
            "SUPPORTED_INTEGRATIONS": '["slack", "gmail"]',
            "ENVIRONMENT": "test",
        }
        # FEAT-019: clear the module-level user-connections cache between
        # tests. The cache is keyed by external_user_id and all three tests
        # in this class use "user123"; without this, whichever test runs
        # first populates the cache and the others read its data instead of
        # the mocked requests.get response.
        from pipedream_operations import _USER_CONNECTIONS_CACHE

        _USER_CONNECTIONS_CACHE.clear()

    @patch.object(PipedreamOperations, "get_access_token", return_value="test-token")
    @patch.object(
        PipedreamOperations,
        "get_credentials",
        return_value={"project_id": "prj_123", "environment": "development"},
    )
    @patch("pipedream_operations.requests.get")
    def test_single_page(self, mock_get, _mock_creds, _mock_token) -> None:
        """When count < limit, returns all connections in one request."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "data": [{"id": "apn_1", "app": {"name_slug": "slack"}}],
            "page_info": {"count": 1},
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._get_user_connections("user123")

        self.assertEqual(len(result), 1)
        mock_get.assert_called_once()

    @patch.object(PipedreamOperations, "get_access_token", return_value="test-token")
    @patch.object(
        PipedreamOperations,
        "get_credentials",
        return_value={"project_id": "prj_123", "environment": "development"},
    )
    @patch("pipedream_operations.requests.get")
    def test_multiple_pages(self, mock_get, _mock_creds, _mock_token) -> None:
        """When count == limit, paginates using after cursor."""
        page1_response = Mock()
        page1_response.json.return_value = {
            "data": [
                {"id": f"apn_{i}", "app": {"name_slug": "slack"}} for i in range(100)
            ],
            "page_info": {"count": 100, "end_cursor": "cursor_abc"},
        }
        page1_response.raise_for_status = Mock()

        page2_response = Mock()
        page2_response.json.return_value = {
            "data": [{"id": "apn_100", "app": {"name_slug": "gmail"}}],
            "page_info": {"count": 1},
        }
        page2_response.raise_for_status = Mock()

        mock_get.side_effect = [page1_response, page2_response]

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._get_user_connections("user123")

        self.assertEqual(len(result), 101)
        self.assertEqual(mock_get.call_count, 2)
        # Verify second call includes the after cursor
        second_call_params = mock_get.call_args_list[1][1].get("params", {})
        self.assertEqual(second_call_params.get("after"), "cursor_abc")

    @patch.object(PipedreamOperations, "get_access_token", return_value="test-token")
    @patch.object(
        PipedreamOperations,
        "get_credentials",
        return_value={"project_id": "prj_123", "environment": "development"},
    )
    @patch("pipedream_operations.requests.get")
    def test_no_end_cursor_stops(self, mock_get, _mock_creds, _mock_token) -> None:
        """Stops paginating when end_cursor is missing even if count == limit."""
        mock_response = Mock()
        mock_response.json.return_value = {
            "data": [
                {"id": f"apn_{i}", "app": {"name_slug": "slack"}} for i in range(100)
            ],
            "page_info": {"count": 100},  # No end_cursor
        }
        mock_response.raise_for_status = Mock()
        mock_get.return_value = mock_response

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._get_user_connections("user123")

        self.assertEqual(len(result), 100)
        mock_get.assert_called_once()

    @patch.object(PipedreamOperations, "get_access_token", return_value="test-token")
    @patch.object(
        PipedreamOperations,
        "get_credentials",
        return_value={"project_id": "prj_123", "environment": "development"},
    )
    @patch("pipedream_operations.requests.get")
    def test_api_error_raises(self, mock_get, _mock_creds, _mock_token) -> None:
        """API errors are propagated as exceptions."""
        mock_get.side_effect = Exception("Network error")

        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            with self.assertRaises(Exception) as context:
                ops._get_user_connections("user123")

        self.assertIn("Failed to fetch connections", str(context.exception))


class TestBuildConnectionStatusNewFields(unittest.TestCase):
    """Test new fields in _build_connection_status."""

    def setUp(self) -> None:
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:test",
            "SUPPORTED_INTEGRATIONS": '["slack", "gmail"]',
            "ENVIRONMENT": "test",
        }

    def test_connected_includes_new_fields(self) -> None:
        """Connected integrations include healthy, dead, connection_name, connected_at."""
        connections = [
            {
                "id": "apn_1",
                "app": {"name_slug": "slack"},
                "healthy": True,
                "dead": None,
                "name": "nathan@arcanum.ai",
                "created_at": "2025-08-13T10:00:00Z",
            }
        ]
        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._build_connection_status(connections)

        slack = next(c for c in result if c["app_name"] == "slack")
        self.assertEqual(slack["status"], "connected")
        self.assertTrue(slack["healthy"])
        self.assertIsNone(slack["dead"])
        self.assertEqual(slack["connection_name"], "nathan@arcanum.ai")
        self.assertEqual(slack["connected_at"], "2025-08-13T10:00:00Z")

    def test_not_connected_has_null_new_fields(self) -> None:
        """Not-connected integrations have None for all new fields."""
        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._build_connection_status([])  # No connections

        gmail = next(c for c in result if c["app_name"] == "gmail")
        self.assertEqual(gmail["status"], "not_connected")
        self.assertIsNone(gmail["healthy"])
        self.assertIsNone(gmail["dead"])
        self.assertIsNone(gmail["connection_name"])
        self.assertIsNone(gmail["connected_at"])

    def test_unhealthy_connection(self) -> None:
        """Unhealthy connections report healthy=False."""
        connections = [
            {
                "id": "apn_1",
                "app": {"name_slug": "gmail"},
                "healthy": False,
                "dead": True,
                "name": "old-account@example.com",
                "created_at": "2025-01-01T00:00:00Z",
            }
        ]
        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
            result = ops._build_connection_status(connections)

        gmail = next(c for c in result if c["app_name"] == "gmail")
        self.assertEqual(gmail["status"], "connected")
        self.assertFalse(gmail["healthy"])
        self.assertTrue(gmail["dead"])
        self.assertEqual(gmail["connection_name"], "old-account@example.com")


class TestBuildBinaryResult(unittest.TestCase):
    """Tests for the encode-measure-decide binary response path.

    Covers the boundary between inline base64 (small files) and the S3
    presigned URL fallback (oversize files) introduced to fix the AWS
    Lambda 6 MB sync invoke response payload limit.
    """

    def setUp(self) -> None:
        self.env_vars = {
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials",
            "BINARY_CACHE_BUCKET": "pipedream-proxy-binary-cache-prod",
        }
        self.external_user_id = "tleaft_a1b2c3d4-0000-7000-8000-000000000001"
        self.request_id = "test-request-id-abcdef"

    def _make_ops(self) -> PipedreamOperations:
        with patch.dict(os.environ, self.env_vars):
            return PipedreamOperations()

    def test_small_binary_returned_inline_unchanged_shape(self) -> None:
        """A 1 KB PDF fits inline → response uses base64_body, no S3 call."""
        content = b"%PDF-1.4 fake pdf content " + b"x" * 1000

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            ops._s3_client = mock_s3

            result = ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition='attachment; filename="report.pdf"',
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertTrue(result["binary"])
        self.assertIn("base64_body", result)
        self.assertNotIn("presigned_url", result)
        self.assertNotIn("binary_storage", result)
        self.assertEqual(result["content_type"], "application/pdf")
        self.assertEqual(result["size"], len(content))
        self.assertEqual(result["filename_hint"], "report.pdf")
        # No S3 interaction for files that fit inline.
        mock_s3.upload_fileobj.assert_not_called()
        mock_s3.generate_presigned_url.assert_not_called()
        # base64 round-trips.
        self.assertEqual(base64.b64decode(result["base64_body"]), content)

    def test_edge_under_threshold_returns_inline(self) -> None:
        """A binary just under the inline ceiling stays inline.

        With a 16 KB safety margin against the 6,291,556 B Lambda limit,
        the actual inline ceiling is ~4.49 MB raw. 4.4 MB is comfortably
        under that.
        """
        content = b"\x00" * (int(4.4 * 1024 * 1024))

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            ops._s3_client = mock_s3

            result = ops._build_binary_result(
                response_content=content,
                content_type="application/octet-stream",
                content_disposition="",
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertIn("base64_body", result)
        self.assertNotIn("presigned_url", result)
        mock_s3.upload_fileobj.assert_not_called()

    def test_edge_over_threshold_uploads_to_s3(self) -> None:
        """A binary just over the inline ceiling lands on S3 with a presigned URL."""
        # 4.8 MB raw → ~6.4 MB base64 — exceeds the 6 MB Lambda response limit.
        content = b"\x00" * (int(4.8 * 1024 * 1024))

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            mock_s3.generate_presigned_url.return_value = "https://pipedream-proxy-binary-cache-prod.s3.amazonaws.com/key?signed=yes"
            ops._s3_client = mock_s3

            result = ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition='attachment; filename="big-report.pdf"',
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertTrue(result["binary"])
        self.assertEqual(result["binary_storage"], "s3_presigned")
        self.assertIn("presigned_url", result)
        self.assertEqual(result["presigned_url_expires_in"], 900)
        self.assertNotIn("base64_body", result)
        self.assertEqual(result["size"], len(content))
        self.assertEqual(result["filename_hint"], "big-report.pdf")

        mock_s3.upload_fileobj.assert_called_once()
        upload_call = mock_s3.upload_fileobj.call_args
        # Bucket is positional arg 1; key is positional arg 2.
        self.assertEqual(upload_call.args[1], "pipedream-proxy-binary-cache-prod")
        key = upload_call.args[2]
        self.assertTrue(key.startswith(f"{self.external_user_id}/{self.request_id}/"))
        self.assertTrue(key.endswith(".pdf"))
        extra = upload_call.kwargs["ExtraArgs"]
        self.assertEqual(extra["ContentType"], "application/pdf")
        self.assertEqual(extra["ServerSideEncryption"], "AES256")
        self.assertIn(
            'attachment; filename="big-report.pdf"', extra["ContentDisposition"]
        )

        mock_s3.generate_presigned_url.assert_called_once()
        get_call = mock_s3.generate_presigned_url.call_args
        self.assertEqual(get_call.args[0], "get_object")
        self.assertEqual(get_call.kwargs["ExpiresIn"], 900)

    def test_tleaft_repro_size_uses_s3(self) -> None:
        """The exact failure size from the tleaft incident routes to S3."""
        # The customer was downloading Pipedrive attachments where the
        # base64-wrapped payload exceeded 6,291,556 bytes. A 5.5 MB raw
        # binary reproduces that.
        content = b"\x00" * (int(5.5 * 1024 * 1024))

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            mock_s3.generate_presigned_url.return_value = "https://s3.example/url"
            ops._s3_client = mock_s3

            result = ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition="",
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertEqual(result["binary_storage"], "s3_presigned")
        self.assertNotIn("base64_body", result)

    def test_large_binary_uses_s3(self) -> None:
        """A 20 MB binary uses S3 — comfortably above any plausible inline limit."""
        content = b"\x00" * (20 * 1024 * 1024)

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            mock_s3.generate_presigned_url.return_value = "https://s3.example/url"
            ops._s3_client = mock_s3

            result = ops._build_binary_result(
                response_content=content,
                content_type="application/zip",
                content_disposition="",
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertEqual(result["binary_storage"], "s3_presigned")
        self.assertNotIn("base64_body", result)
        # Content-type → .zip extension on the S3 key.
        upload_call = mock_s3.upload_fileobj.call_args
        self.assertTrue(upload_call.args[2].endswith(".zip"))

    def test_oversize_without_bucket_configured_raises(self) -> None:
        """Without BINARY_CACHE_BUCKET, oversize responses raise a clean error.

        Better to surface a structured error than let the lambda runtime
        413 the response — the latter is what the bug looked like in prod.
        """
        env_no_bucket = {
            "PIPEDREAM_SECRET_ARN": self.env_vars["PIPEDREAM_SECRET_ARN"],
            # Region is required for boto3 client construction; CI doesn't
            # inherit one, so set it explicitly. Test isn't about region.
            "AWS_DEFAULT_REGION": "us-east-1",
        }
        content = b"\x00" * (int(5.5 * 1024 * 1024))

        with patch.dict(os.environ, env_no_bucket, clear=True):
            ops = PipedreamOperations()
            with self.assertRaises(Exception) as ctx:
                ops._build_binary_result(
                    response_content=content,
                    content_type="application/pdf",
                    content_disposition="",
                    external_user_id=self.external_user_id,
                    request_id=self.request_id,
                )

        self.assertIn("too large to inline", str(ctx.exception))

    def test_filename_hint_omitted_when_no_disposition(self) -> None:
        """No Content-Disposition header → no filename_hint in the result."""
        content = b"%PDF-1.4 small"

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            ops._s3_client = Mock()

            result = ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition="",
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertNotIn("filename_hint", result)

    def test_safe_filename_strips_path_separators(self) -> None:
        """Malicious filenames with path separators are sanitized before use."""
        content = b"\x00" * (int(5.5 * 1024 * 1024))

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            mock_s3.generate_presigned_url.return_value = "https://s3.example/url"
            ops._s3_client = mock_s3

            result = ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition='attachment; filename="../../etc/passwd"',
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        # Path traversal characters scrubbed.
        self.assertNotIn("/", result["filename_hint"])
        self.assertNotIn("\\", result["filename_hint"])

    def test_request_id_missing_uses_placeholder(self) -> None:
        """A missing request_id should not crash; key uses 'no-request-id'."""
        content = b"\x00" * (int(5.5 * 1024 * 1024))

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            mock_s3.generate_presigned_url.return_value = "https://s3.example/url"
            ops._s3_client = mock_s3

            ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition="",
                external_user_id=self.external_user_id,
                request_id=None,
            )

        upload_call = mock_s3.upload_fileobj.call_args
        key = upload_call.args[2]
        self.assertIn("/no-request-id/", key)


class TestIsTextualContentType(unittest.TestCase):
    """The proxy must treat unknown/binary responses as binary, not text.

    Decoding binary as text is lossy and irreversible; it corrupted a customer
    .docx that came back from a Drive revision download.
    """

    def test_binary_types_are_not_textual(self) -> None:
        from pipedream_operations import _is_textual_content_type

        for ct in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/zip",
            "application/pdf",
            # A binary type that carries a charset must still be binary: the
            # bare charset= heuristic used to misclassify these as text and
            # corrupt the download via response.text.
            "application/pdf; charset=utf-8",
            "application/custom; charset=utf-8",
            "image/png",
            "application/octet-stream",
            "",  # absent Content-Type defaults to binary (safe)
        ):
            self.assertFalse(
                _is_textual_content_type(ct), f"{ct!r} should be treated as binary"
            )

    def test_text_types_are_textual(self) -> None:
        from pipedream_operations import _is_textual_content_type

        for ct in (
            "text/plain",
            "text/html; charset=utf-8",  # text/* base type is matched explicitly
            "application/json",
            "application/xml",
            "application/ld+json",
            "application/problem+json",
            "application/atom+xml",
            "application/x-www-form-urlencoded",
        ):
            self.assertTrue(
                _is_textual_content_type(ct), f"{ct!r} should be treated as text"
            )


class TestIsUnsafeProxyUpload(unittest.TestCase):
    """The passthrough proxy cannot do multipart media uploads."""

    def test_flags_media_upload_urls(self) -> None:
        from pipedream_operations import _is_unsafe_proxy_upload

        self.assertTrue(
            _is_unsafe_proxy_upload(
                "PATCH",
                "https://www.googleapis.com/upload/drive/v3/files/x?uploadType=multipart",
                {"filePath": "/workdir/x.docx"},
            )
        )
        self.assertTrue(
            _is_unsafe_proxy_upload(
                "POST", "https://content.dropboxapi.com/2/files/upload", None
            )
        )

    def test_flags_workdir_reference_in_body(self) -> None:
        from pipedream_operations import _is_unsafe_proxy_upload

        self.assertTrue(
            _is_unsafe_proxy_upload(
                "POST",
                "https://api.example.com/v1/things",
                {"filePath": "/workdir/tmp/report.docx"},
            )
        )

    def test_allows_reads_and_plain_writes(self) -> None:
        from pipedream_operations import _is_unsafe_proxy_upload

        # GET to an upload URL is a read (e.g. status) — allowed.
        self.assertFalse(
            _is_unsafe_proxy_upload(
                "GET", "https://www.googleapis.com/upload/drive/v3/files/x", None
            )
        )
        # Ordinary JSON write to a non-upload endpoint — allowed.
        self.assertFalse(
            _is_unsafe_proxy_upload(
                "POST",
                "https://api.example.com/v1/messages",
                {"text": "hello"},
            )
        )


class TestProxyRequestBinarySafety(unittest.TestCase):
    """End-to-end behaviour of proxy_request for the two incident vectors."""

    def setUp(self) -> None:
        self.env_vars = {
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials",
            "BINARY_CACHE_BUCKET": "pipedream-proxy-binary-cache-prod",
        }
        self.external_user_id = "tleaft_a1b2c3d4-0000-7000-8000-000000000001"

    def _make_ops(self) -> PipedreamOperations:
        with patch.dict(os.environ, self.env_vars):
            ops = PipedreamOperations()
        ops.get_credentials = Mock(  # type: ignore[method-assign]
            return_value={"project_id": "proj", "environment": "test"}
        )
        ops.get_access_token = Mock(return_value="tok")  # type: ignore[method-assign]
        return ops

    def test_upload_via_proxy_is_refused_before_any_network_call(self) -> None:
        ops = self._make_ops()
        with patch("pipedream_operations.requests.request") as mock_req:
            with self.assertRaises(Exception) as ctx:
                ops.proxy_request(
                    external_user_id=self.external_user_id,
                    account_id="acct",
                    method="PATCH",
                    upstream_url="https://www.googleapis.com/upload/drive/v3/files/abc?uploadType=multipart",
                    body={"filePath": "/workdir/tmp/notes.docx"},
                )
            self.assertIn("media upload", str(ctx.exception).lower())
            mock_req.assert_not_called()

    def test_docx_download_returned_as_binary_not_text(self) -> None:
        ops = self._make_ops()
        docx_bytes = b"PK\x03\x04" + bytes(range(256)) * 8  # non-UTF-8 bytes
        resp = Mock()
        resp.json.side_effect = ValueError("not json")
        resp.headers = {
            "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        resp.content = docx_bytes
        resp.text = "garbled-lossy-decode"
        resp.ok = True
        resp.status_code = 200

        with patch("pipedream_operations.requests.request", return_value=resp):
            result = ops.proxy_request(
                external_user_id=self.external_user_id,
                account_id="acct",
                method="GET",
                upstream_url="https://www.googleapis.com/drive/v3/files/abc/revisions/r1?alt=media",
            )

        self.assertTrue(result.get("binary"))
        self.assertNotIn("text", result)
        self.assertEqual(base64.b64decode(result["base64_body"]), docx_bytes)

    def test_text_response_still_returned_as_text(self) -> None:
        ops = self._make_ops()
        resp = Mock()
        resp.json.side_effect = ValueError("not json")
        resp.headers = {"content-type": "text/plain; charset=utf-8"}
        resp.content = b"plain body"
        resp.text = "plain body"
        resp.ok = True
        resp.status_code = 200

        with patch("pipedream_operations.requests.request", return_value=resp):
            result = ops.proxy_request(
                external_user_id=self.external_user_id,
                account_id="acct",
                method="GET",
                upstream_url="https://api.example.com/v1/ping",
            )

        self.assertEqual(result, {"text": "plain body"})


class TestBinaryResultSha256(unittest.TestCase):
    """Both binary shapes must carry a sha256 over the exact bytes.

    The hash lets the consumer verify the bytes it ends up holding (inline
    base64 or fetched from the presigned URL) match what the proxy saw. The
    oversize digest is over the EXACT bytes stored in S3 — never truncated.
    """

    def setUp(self) -> None:
        self.env_vars = {
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials",
            "BINARY_CACHE_BUCKET": "pipedream-proxy-binary-cache-prod",
        }
        self.external_user_id = "tleaft_a1b2c3d4-0000-7000-8000-000000000001"
        self.request_id = "req-sha-1"

    def _make_ops(self) -> PipedreamOperations:
        with patch.dict(os.environ, self.env_vars):
            return PipedreamOperations()

    def test_inline_result_carries_matching_sha256(self) -> None:
        import hashlib

        content = b"%PDF-1.4 small inline body " + b"y" * 500
        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            ops._s3_client = Mock()
            result = ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition='attachment; filename="x.pdf"',
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertIn("base64_body", result)
        self.assertIn("download_sha256", result)
        # Digest is over the exact bytes, and the inline base64 decodes to them.
        self.assertEqual(result["download_sha256"], hashlib.sha256(content).hexdigest())
        self.assertEqual(
            hashlib.sha256(base64.b64decode(result["base64_body"])).hexdigest(),
            result["download_sha256"],
        )

    def test_oversize_result_sha256_is_over_stored_bytes(self) -> None:
        import hashlib

        # 5.5 MB raw → base64-wrapped envelope exceeds the 6 MB Lambda limit.
        content = b"\x00\x01\x02\x03" * (int(5.5 * 1024 * 1024) // 4)

        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            mock_s3.generate_presigned_url.return_value = "https://s3.example/signed"
            ops._s3_client = mock_s3
            result = ops._build_binary_result(
                response_content=content,
                content_type="application/pdf",
                content_disposition='attachment; filename="big.pdf"',
                external_user_id=self.external_user_id,
                request_id=self.request_id,
            )

        self.assertEqual(result["binary_storage"], "s3_presigned")
        self.assertNotIn("base64_body", result)
        self.assertIn("download_url", result)
        self.assertIn("s3_key", result)
        self.assertIn("download_sha256", result)
        # The digest must match the EXACT bytes handed to upload_fileobj.
        uploaded_stream = mock_s3.upload_fileobj.call_args.args[0]
        uploaded_bytes = uploaded_stream.getvalue()
        self.assertEqual(uploaded_bytes, content)  # whole thing, not truncated
        self.assertEqual(
            result["download_sha256"], hashlib.sha256(uploaded_bytes).hexdigest()
        )


class TestOffloadOversizedResult(unittest.TestCase):
    """Oversized STRUCTURED tool results go to S3 with the fixed wire shape."""

    def setUp(self) -> None:
        self.env_vars = {
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials",
            "BINARY_CACHE_BUCKET": "pipedream-proxy-binary-cache-prod",
        }
        self.external_user_id = "tleaft_a1b2c3d4-0000-7000-8000-000000000001"

    def _make_ops(self) -> PipedreamOperations:
        with patch.dict(os.environ, self.env_vars):
            return PipedreamOperations()

    def test_offload_shape_and_sha256(self) -> None:
        import hashlib

        result = {"exports": {"rows": list(range(1000))}}
        with patch.dict(os.environ, self.env_vars):
            ops = self._make_ops()
            mock_s3 = Mock()
            mock_s3.generate_presigned_url.return_value = "https://s3.example/result"
            ops._s3_client = mock_s3
            offloaded = ops.offload_oversized_result(
                result=result,
                operation="run_action",
                external_user_id=self.external_user_id,
                request_id="req-offload-1",
            )

        # Exact fixed wire contract.
        self.assertEqual(offloaded["status"], "success")
        self.assertTrue(offloaded["oversized"])
        self.assertEqual(offloaded["result_url"], "https://s3.example/result")
        self.assertIn("result_sha256", offloaded)
        self.assertIn("result_size", offloaded)
        self.assertIn("note", offloaded)
        # No truncation: stored bytes are the full json.dumps(result), and the
        # sha256 + size describe exactly those bytes.
        expected_bytes = json.dumps(result).encode("utf-8")
        uploaded_stream = mock_s3.upload_fileobj.call_args.args[0]
        self.assertEqual(uploaded_stream.getvalue(), expected_bytes)
        self.assertEqual(offloaded["result_size"], len(expected_bytes))
        self.assertEqual(
            offloaded["result_sha256"], hashlib.sha256(expected_bytes).hexdigest()
        )
        # JSON content-type on the staged object.
        extra = mock_s3.upload_fileobj.call_args.kwargs["ExtraArgs"]
        self.assertEqual(extra["ContentType"], "application/json")
        self.assertEqual(extra["ServerSideEncryption"], "AES256")

    def test_offload_without_bucket_raises_not_truncates(self) -> None:
        env_no_bucket = {
            "PIPEDREAM_SECRET_ARN": self.env_vars["PIPEDREAM_SECRET_ARN"],
            "AWS_DEFAULT_REGION": "us-east-1",
        }
        with patch.dict(os.environ, env_no_bucket, clear=True):
            ops = PipedreamOperations()
            with self.assertRaises(Exception) as ctx:
                ops.offload_oversized_result(
                    result={"big": "x" * 10},
                    operation="run_action",
                    external_user_id=self.external_user_id,
                    request_id="req",
                )
        self.assertIn("too large to return inline", str(ctx.exception))


class TestHandlerOversizedStructuredResult(unittest.TestCase):
    """The handler must offload an oversized structured result, not 413/truncate."""

    def setUp(self) -> None:
        self.mock_context = Mock()
        self.mock_context.function_name = "pipedream-proxy"
        self.mock_context.aws_request_id = "test-req-oversize"
        self.env_vars = {
            "SECURITY_MAPPING_TABLE": "pipedream-security-mapping",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "PIPEDREAM_SECRET_ARN": "arn:aws:secretsmanager:us-east-1:123456789012:secret:pipedream-credentials",
            "BINARY_CACHE_BUCKET": "pipedream-proxy-binary-cache-prod",
            "ENVIRONMENT": "test",
        }
        self.event = {
            "operation": "run_action",
            "external_user_id": "arcanum_demo_user123",
            "sts_proof_url": "https://sts.us-east-1.amazonaws.com/?Action=GetCallerIdentity",
            "parameters": {"action_key": "x-do", "configured_props": {}},
        }

    def test_oversized_run_action_offloaded(self) -> None:
        import hashlib

        # A run_action result that serializes well past the 6 MB envelope.
        big_value = "z" * (7 * 1024 * 1024)
        big_result = {"exports": {"blob": big_value}}

        with patch.dict(os.environ, self.env_vars):
            with patch.object(
                lambda_function, "SecurityValidator"
            ) as mock_validator_cls, patch.object(
                lambda_function, "PipedreamOperations"
            ) as mock_ops_cls:
                mock_validator_cls.return_value.validate_request.return_value = {
                    "caller_account_id": "123",
                    "role_name": "role",
                }
                mock_ops = mock_ops_cls.return_value
                mock_ops.run_action.return_value = big_result
                mock_ops.offload_oversized_result.return_value = {
                    "status": "success",
                    "oversized": True,
                    "result_url": "https://s3.example/big-result",
                    "result_sha256": hashlib.sha256(
                        json.dumps(big_result).encode("utf-8")
                    ).hexdigest(),
                    "result_size": len(json.dumps(big_result).encode("utf-8")),
                    "note": "fetch from result_url",
                }

                response = lambda_function.handler(self.event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        # The returned envelope is tiny — it must NOT contain the big blob.
        self.assertLess(len(response["body"]), 4096)
        body = json.loads(response["body"])
        data = body["data"]
        self.assertTrue(data["oversized"])
        self.assertEqual(data["result_url"], "https://s3.example/big-result")
        self.assertIn("result_sha256", data)
        # The offload path was actually exercised with the full result.
        mock_ops.offload_oversized_result.assert_called_once()
        kwargs = mock_ops.offload_oversized_result.call_args.kwargs
        self.assertEqual(kwargs["result"], big_result)
        self.assertEqual(kwargs["operation"], "run_action")

    def test_small_run_action_returned_inline(self) -> None:
        """A normal-size result is returned inline; offload is not called."""
        small_result = {"exports": {"ok": True}}

        with patch.dict(os.environ, self.env_vars):
            with patch.object(
                lambda_function, "SecurityValidator"
            ) as mock_validator_cls, patch.object(
                lambda_function, "PipedreamOperations"
            ) as mock_ops_cls:
                mock_validator_cls.return_value.validate_request.return_value = {
                    "caller_account_id": "123",
                    "role_name": "role",
                }
                mock_ops = mock_ops_cls.return_value
                mock_ops.run_action.return_value = small_result

                response = lambda_function.handler(self.event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertEqual(body["data"], small_result)
        mock_ops.offload_oversized_result.assert_not_called()


if __name__ == "__main__":
    unittest.main()
