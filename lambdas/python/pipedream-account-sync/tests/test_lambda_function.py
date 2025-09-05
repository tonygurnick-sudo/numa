import json
import os
import unittest
from datetime import datetime, timezone
from typing import Any, Dict
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

import lambda_function


class TestLambdaFunction(unittest.TestCase):
    """Test cases for the pipedream-account-sync lambda function."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.mock_context = Mock()
        self.mock_context.function_name = "pipedream-account-sync"
        self.mock_context.aws_request_id = "test-request-id-123"

        # Standard environment variables (simplified for resource policy approach)
        self.env_vars = {
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "NUMA_CLIENT_CONFIG_TABLE_ARN": "arn:aws:dynamodb:us-east-1:123456789012:table/numa-client-config",
            "ENVIRONMENT": "test",
            "LOG_LEVEL": "INFO",
        }

    def test_handler_missing_environment_variables(self) -> None:
        """Test handler with missing required environment variables."""
        event: Dict[str, Any] = {}

        with patch.dict(os.environ, {}, clear=True):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 500)
        body = json.loads(response["body"])
        self.assertFalse(body["success"])
        self.assertIn(
            "Missing ALLOWED_ACCOUNTS_TABLE environment variable", body["error"]
        )

    @patch("lambda_function.update_allowed_accounts_table")
    @patch("lambda_function.get_client_account_ids_direct")
    def test_handler_success(self, mock_get_accounts, mock_update_table) -> None:
        """Test successful handler execution."""
        # Mock successful responses
        mock_get_accounts.return_value = {
            "111111111111": "client1",
            "222222222222": "client2",
        }

        mock_update_table.return_value = {
            "added": 1,
            "suspended": 0,
            "activated": 1,
            "failed": 0,
        }

        event: Dict[str, Any] = {}

        with patch.dict(os.environ, self.env_vars):
            response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertTrue(body["success"])
        self.assertEqual(body["accounts_processed"], 2)
        self.assertEqual(body["accounts_added"], 1)
        self.assertEqual(body["accounts_suspended"], 0)
        self.assertEqual(body["accounts_activated"], 1)
        self.assertEqual(body["accounts_failed"], 0)


class TestGetClientAccountIds(unittest.TestCase):
    """Test cases for get_client_account_ids_direct function."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.env_vars = {
            "NUMA_CLIENT_CONFIG_TABLE_ARN": "arn:aws:dynamodb:us-east-1:123456789012:table/numa-client-config"
        }

    @patch("boto3.client")
    def test_get_client_account_ids_direct_success(self, mock_boto_client) -> None:
        """Test successful client account ID retrieval."""
        mock_dynamodb_client = Mock()
        mock_boto_client.return_value = mock_dynamodb_client

        # Mock DynamoDB client response format
        mock_dynamodb_client.scan.return_value = {
            "Items": [
                {
                    "clientName": {"S": "client1"},
                    "config": {"M": {"clientAccountId": {"S": "111111111111"}}},
                },
                {
                    "clientName": {"S": "client2"},
                    "config": {"M": {"clientAccountId": {"S": "222222222222"}}},
                },
                {
                    "clientName": {"S": "client3"},
                    "config": {"M": {}},
                },  # Missing clientAccountId
            ]
        }

        with patch.dict(os.environ, self.env_vars):
            result = lambda_function.get_client_account_ids_direct()

        expected = {"111111111111": "client1", "222222222222": "client2"}

        self.assertEqual(result, expected)

        mock_boto_client.assert_called_once_with("dynamodb", region_name="us-east-1")
        mock_dynamodb_client.scan.assert_called_once_with(
            TableName="arn:aws:dynamodb:us-east-1:123456789012:table/numa-client-config"
        )

    @patch("boto3.client")
    def test_get_client_account_ids_direct_with_pagination(
        self, mock_boto_client
    ) -> None:
        """Test client account ID retrieval with pagination."""
        mock_dynamodb_client = Mock()
        mock_boto_client.return_value = mock_dynamodb_client

        # First scan call
        mock_dynamodb_client.scan.side_effect = [
            {
                "Items": [
                    {
                        "clientName": {"S": "client1"},
                        "config": {"M": {"clientAccountId": {"S": "111111111111"}}},
                    }
                ],
                "LastEvaluatedKey": {"clientName": {"S": "client1"}},
            },
            {
                "Items": [
                    {
                        "clientName": {"S": "client2"},
                        "config": {"M": {"clientAccountId": {"S": "222222222222"}}},
                    }
                ]
            },
        ]

        with patch.dict(os.environ, self.env_vars):
            result = lambda_function.get_client_account_ids_direct()

        expected = {"111111111111": "client1", "222222222222": "client2"}

        self.assertEqual(result, expected)
        self.assertEqual(mock_dynamodb_client.scan.call_count, 2)

    @patch("boto3.client")
    def test_get_client_account_ids_direct_empty_table(self, mock_boto_client) -> None:
        """Test client account ID retrieval from empty table."""
        mock_dynamodb_client = Mock()
        mock_boto_client.return_value = mock_dynamodb_client

        mock_dynamodb_client.scan.return_value = {"Items": []}

        with patch.dict(os.environ, self.env_vars):
            result = lambda_function.get_client_account_ids_direct()

        self.assertEqual(result, {})

    @patch("boto3.client")
    def test_get_client_account_ids_direct_dynamodb_failure(
        self, mock_boto_client
    ) -> None:
        """Test client account ID retrieval with DynamoDB failure."""
        mock_dynamodb_client = Mock()
        mock_boto_client.return_value = mock_dynamodb_client

        mock_dynamodb_client.scan.side_effect = ClientError(
            {
                "Error": {
                    "Code": "ResourceNotFoundException",
                    "Message": "Table not found",
                }
            },
            "Scan",
        )

        with patch.dict(os.environ, self.env_vars):
            with self.assertRaises(Exception) as context:
                lambda_function.get_client_account_ids_direct()

        self.assertIn("Failed to retrieve client account IDs", str(context.exception))


class TestUpdateAllowedAccountsTable(unittest.TestCase):
    """Test cases for update_allowed_accounts_table function."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.table_name = "pipedream-allowed-accounts"
        self.account_mapping = {"111111111111": "client1", "222222222222": "client2"}

    @patch("boto3.resource")
    def test_update_allowed_accounts_table_new_accounts(
        self, mock_boto_resource
    ) -> None:
        """Test updating table with new accounts."""
        mock_dynamodb = Mock()
        mock_table = Mock()
        mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        # Empty existing table
        mock_table.scan.return_value = {"Items": []}

        with patch("lambda_function.datetime") as mock_datetime:
            mock_now = datetime(2025, 8, 27, 12, 0, 0, tzinfo=timezone.utc)
            mock_datetime.now.return_value = mock_now
            mock_datetime.timezone = timezone

            result = lambda_function.update_allowed_accounts_table(
                self.table_name, self.account_mapping
            )

        expected_result = {"added": 2, "suspended": 0, "activated": 0, "failed": 0}
        self.assertEqual(result, expected_result)

        # Verify put_item calls
        self.assertEqual(mock_table.put_item.call_count, 2)

    @patch("boto3.resource")
    def test_update_allowed_accounts_table_suspend_removed_accounts(
        self, mock_boto_resource
    ) -> None:
        """Test suspending accounts that are no longer in config."""
        mock_dynamodb = Mock()
        mock_table = Mock()
        mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        # Existing accounts - one will be suspended
        mock_table.scan.return_value = {
            "Items": [
                {
                    "account_id": "111111111111",
                    "status": "ACTIVE",
                    "client_name": "client1",
                },
                {
                    "account_id": "333333333333",
                    "status": "ACTIVE",
                    "client_name": "old_client",
                },
            ]
        }

        with patch("lambda_function.datetime") as mock_datetime:
            mock_now = datetime(2025, 8, 27, 12, 0, 0, tzinfo=timezone.utc)
            mock_datetime.now.return_value = mock_now
            mock_datetime.timezone = timezone

            result = lambda_function.update_allowed_accounts_table(
                self.table_name, self.account_mapping
            )

        expected_result = {"added": 1, "suspended": 1, "activated": 0, "failed": 0}
        self.assertEqual(result, expected_result)

    @patch("boto3.resource")
    def test_update_allowed_accounts_table_reactivate_suspended_accounts(
        self, mock_boto_resource
    ) -> None:
        """Test reactivating previously suspended accounts."""
        mock_dynamodb = Mock()
        mock_table = Mock()
        mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        # Existing suspended account
        mock_table.scan.return_value = {
            "Items": [
                {
                    "account_id": "111111111111",
                    "status": "SUSPENDED",
                    "client_name": "client1",
                }
            ]
        }

        with patch("lambda_function.datetime") as mock_datetime:
            mock_now = datetime(2025, 8, 27, 12, 0, 0, tzinfo=timezone.utc)
            mock_datetime.now.return_value = mock_now
            mock_datetime.timezone = timezone

            result = lambda_function.update_allowed_accounts_table(
                self.table_name, self.account_mapping
            )

        expected_result = {"added": 1, "suspended": 0, "activated": 1, "failed": 0}
        self.assertEqual(result, expected_result)

    @patch("boto3.resource")
    def test_update_allowed_accounts_table_update_existing_active(
        self, mock_boto_resource
    ) -> None:
        """Test updating existing active accounts."""
        mock_dynamodb = Mock()
        mock_table = Mock()
        mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        # Existing active account
        mock_table.scan.return_value = {
            "Items": [
                {
                    "account_id": "111111111111",
                    "status": "ACTIVE",
                    "client_name": "old_name",
                }
            ]
        }

        with patch("lambda_function.datetime") as mock_datetime:
            mock_now = datetime(2025, 8, 27, 12, 0, 0, tzinfo=timezone.utc)
            mock_datetime.now.return_value = mock_now
            mock_datetime.timezone = timezone

            result = lambda_function.update_allowed_accounts_table(
                self.table_name, self.account_mapping
            )

        expected_result = {"added": 1, "suspended": 0, "activated": 0, "failed": 0}
        self.assertEqual(result, expected_result)

        # Verify put_item call for existing account (our implementation uses put_item for all upserts)
        mock_table.put_item.assert_called()

    @patch("boto3.resource")
    def test_update_allowed_accounts_table_dynamodb_failure(
        self, mock_boto_resource
    ) -> None:
        """Test update table with DynamoDB failure."""
        mock_dynamodb = Mock()
        mock_table = Mock()
        mock_boto_resource.return_value = mock_dynamodb
        mock_dynamodb.Table.return_value = mock_table

        mock_table.scan.side_effect = ClientError(
            {
                "Error": {
                    "Code": "ResourceNotFoundException",
                    "Message": "Table not found",
                }
            },
            "Scan",
        )

        with self.assertRaises(Exception) as context:
            lambda_function.update_allowed_accounts_table(
                self.table_name, self.account_mapping
            )

        self.assertIn("Failed to update allowed accounts table", str(context.exception))


class TestIntegrationScenarios(unittest.TestCase):
    """Integration test scenarios combining multiple functions."""

    def setUp(self) -> None:
        """Set up test fixtures."""
        self.mock_context = Mock()
        self.mock_context.function_name = "pipedream-account-sync"
        self.mock_context.aws_request_id = "integration-test-123"

        self.env_vars = {
            "DEPLOYER_ACCOUNT_ID": "123456789012",
            "CROSS_ACCOUNT_ROLE_ARN": "arn:aws:iam::123456789012:role/pipedream-sync-role",
            "EXTERNAL_ID": "test-external-id",
            "ALLOWED_ACCOUNTS_TABLE": "pipedream-allowed-accounts",
            "NUMA_CLIENT_CONFIG_TABLE_ARN": "arn:aws:dynamodb:us-east-1:123456789012:table/numa-client-config",
            "ENVIRONMENT": "test",
        }

    @patch("boto3.resource")
    @patch("boto3.client")
    def test_complete_sync_workflow(self, mock_boto_client, mock_boto_resource) -> None:
        """Test complete synchronization workflow from end to end."""
        # Mock DynamoDB client for cross-account config table access
        mock_dynamodb_client = Mock()
        mock_boto_client.return_value = mock_dynamodb_client

        # Mock config table response in DynamoDB client format
        mock_dynamodb_client.scan.return_value = {
            "Items": [
                {
                    "clientName": {"S": "active_client"},
                    "config": {"M": {"clientAccountId": {"S": "111111111111"}}},
                },
                {
                    "clientName": {"S": "new_client"},
                    "config": {"M": {"clientAccountId": {"S": "222222222222"}}},
                },
            ]
        }

        # Mock DynamoDB resource for local allowed accounts table
        mock_dynamodb_resource = Mock()
        mock_boto_resource.return_value = mock_dynamodb_resource

        # Mock allowed accounts table
        mock_allowed_table = Mock()
        mock_dynamodb_resource.Table.return_value = mock_allowed_table
        mock_allowed_table.scan.return_value = {
            "Items": [
                {
                    "account_id": "111111111111",
                    "status": "ACTIVE",
                    "client_name": "active_client",
                },
                {
                    "account_id": "333333333333",
                    "status": "ACTIVE",
                    "client_name": "removed_client",
                },
            ]
        }

        event: Dict[str, Any] = {}

        with patch("lambda_function.datetime") as mock_datetime:
            mock_now = datetime(2025, 8, 27, 12, 0, 0, tzinfo=timezone.utc)
            mock_datetime.now.return_value = mock_now
            mock_datetime.timezone = timezone

            with patch.dict(os.environ, self.env_vars):
                response = lambda_function.handler(event, self.mock_context)

        self.assertEqual(response["statusCode"], 200)
        body = json.loads(response["body"])
        self.assertTrue(body["success"])
        self.assertEqual(body["accounts_processed"], 2)
        self.assertEqual(body["accounts_added"], 1)  # new_client added
        self.assertEqual(body["accounts_suspended"], 1)  # removed_client suspended
        self.assertEqual(body["accounts_activated"], 0)

        # Verify account IDs in response
        expected_accounts = ["111111111111", "222222222222"]
        self.assertEqual(sorted(body["current_account_ids"]), sorted(expected_accounts))


if __name__ == "__main__":
    unittest.main()
