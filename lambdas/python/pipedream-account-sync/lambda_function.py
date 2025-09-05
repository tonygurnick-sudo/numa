"""
Pipedream Account Sync Lambda - Synchronizes allowed client accounts.

This lambda runs hourly to sync the allowed client accounts from the deployer account's
client config table to the proxy account's allowed accounts table.

Architecture:
- Runs in proxy account (965745962688)
- Assumes cross-account role in deployer account
- Syncs client account IDs from numa-client-config table
- Updates pipedream-allowed-accounts table with ACTIVE/SUSPENDED status
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

logger = structlog.get_logger()


def _parse_dynamodb_item(item: Dict[str, Any]) -> Dict[str, Any]:
    """Parse DynamoDB item format to regular dict."""
    parsed_item = {}
    for key, value in item.items():
        if "S" in value:
            parsed_item[key] = value["S"]
        elif "M" in value:
            # Handle nested map (config object)
            nested_dict = {}
            for nested_key, nested_value in value["M"].items():
                if "S" in nested_value:
                    nested_dict[nested_key] = nested_value["S"]
            parsed_item[key] = nested_dict
    return parsed_item


def _extract_account_info(item: Any) -> tuple[str, str] | None:
    """Extract account ID and client name from DynamoDB item with type safety.

    Returns:
        Tuple of (account_id, client_name) if valid, None otherwise
    """
    if not isinstance(item, dict):
        return None

    config = item.get("config", {})
    if not isinstance(config, dict):
        return None

    client_account_id = config.get("clientAccountId")
    client_name = item.get("clientName", "unknown")

    if not (
        client_account_id
        and isinstance(client_account_id, str)
        and isinstance(client_name, str)
    ):
        return None

    return client_account_id, client_name


def handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """
    Sync client accounts from deployer account to proxy allowed accounts table.
    Uses direct DynamoDB access via resource policy.

    This function:
    1. Scans numa-client-config table for all client configurations (via resource policy)
    2. Extracts unique clientAccountId values
    3. Updates local allowed accounts table with ACTIVE status for current accounts
    4. Marks removed accounts as SUSPENDED (retains for audit trail)
    """
    try:

        # Simple logging setup following non-pipedream lambda pattern
        logger.info(
            "Starting account sync operation",
            request_event=event,
            function_name=context.function_name,
            request_id=context.aws_request_id,
            environment=os.environ.get("ENVIRONMENT", "unknown"),
        )

        # Get configuration - only need allowed accounts table now
        allowed_accounts_table = os.environ.get("ALLOWED_ACCOUNTS_TABLE")
        if not allowed_accounts_table:
            raise ValueError("Missing ALLOWED_ACCOUNTS_TABLE environment variable")

        logger.info(
            "Configuration loaded", allowed_accounts_table=allowed_accounts_table
        )

        # Get client account IDs directly (no role assumption)
        account_id_to_client_name = get_client_account_ids_direct()
        current_account_ids = set(account_id_to_client_name.keys())

        # Update allowed accounts table (unchanged)
        sync_results = update_allowed_accounts_table(
            allowed_accounts_table, account_id_to_client_name
        )

        logger.info(
            "Account sync completed successfully",
            current_accounts_count=len(current_account_ids),
            accounts_added=sync_results["added"],
            accounts_suspended=sync_results["suspended"],
            accounts_activated=sync_results["activated"],
            accounts_failed=sync_results["failed"],
        )

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "success": True,
                    "accounts_processed": len(current_account_ids),
                    "accounts_added": sync_results["added"],
                    "accounts_suspended": sync_results["suspended"],
                    "accounts_activated": sync_results["activated"],
                    "accounts_failed": sync_results["failed"],
                    "current_account_ids": list(account_id_to_client_name.keys()),
                }
            ),
        }

    except Exception as e:
        logger.exception("Account sync failed", error=str(e))
        return {
            "statusCode": 500,
            "body": json.dumps(
                {
                    "success": False,
                    "error": str(e),
                }
            ),
        }


def get_client_account_ids_direct() -> Dict[str, str]:
    """Get client account IDs directly from numa-client-config table via resource policy."""
    try:
        # Get the cross-account table ARN from environment
        table_arn = os.environ.get("NUMA_CLIENT_CONFIG_TABLE_ARN")
        if not table_arn:
            raise ValueError(
                "Missing NUMA_CLIENT_CONFIG_TABLE_ARN environment variable"
            )

        # Create DynamoDB client for cross-account access
        dynamodb_client = boto3.client("dynamodb", region_name="us-east-1")

        logger.info("Scanning client config table for account IDs", table_arn=table_arn)

        # Scan the entire table using client API with full ARN
        account_id_to_client_name = {}
        response = dynamodb_client.scan(TableName=table_arn)

        while True:
            items = response.get("Items", [])
            for item in items:
                parsed_item = _parse_dynamodb_item(item)
                account_info = _extract_account_info(parsed_item)
                if account_info:
                    account_id, client_name = account_info
                    account_id_to_client_name[account_id] = client_name
                    logger.debug(
                        "Found client account",
                        client_name=client_name,
                        account_id=account_id,
                    )

            # Handle pagination
            if "LastEvaluatedKey" not in response:
                break
            response = dynamodb_client.scan(
                TableName=table_arn, ExclusiveStartKey=response["LastEvaluatedKey"]
            )

        logger.info(
            "Retrieved client account IDs from config table",
            account_count=len(account_id_to_client_name),
            account_ids=list(account_id_to_client_name.keys()),
        )

        return account_id_to_client_name

    except Exception as e:
        logger.error("Failed to get client account IDs", error=str(e))
        raise Exception(f"Failed to retrieve client account IDs: {str(e)}") from e


def update_allowed_accounts_table(
    table_name: str, account_id_to_client_name: Dict[str, str]
) -> Dict[str, int]:
    """Update the allowed accounts table with current account IDs and client names."""
    try:
        dynamodb = boto3.resource("dynamodb")
        table = dynamodb.Table(table_name)

        logger.info("Updating allowed accounts table", table_name=table_name)

        # Get existing accounts from the table
        existing_accounts = {}
        response = table.scan()

        while True:
            for item in response.get("Items", []):
                account_id = item["account_id"]
                existing_accounts[account_id] = item
                logger.debug(
                    "Found existing account",
                    account_id=account_id,
                    status=item.get("status"),
                )

            # Handle pagination
            if "LastEvaluatedKey" not in response:
                break
            response = table.scan(ExclusiveStartKey=response["LastEvaluatedKey"])

        logger.info(
            "Retrieved existing accounts", existing_count=len(existing_accounts)
        )

        now = datetime.now(timezone.utc).isoformat()
        sync_results = {"added": 0, "suspended": 0, "activated": 0, "failed": 0}
        current_account_ids = set(account_id_to_client_name.keys())

        # Upsert current accounts (add new or update existing to ACTIVE status)
        for account_id, client_name in account_id_to_client_name.items():
            try:
                existing_account = existing_accounts.get(account_id)
                was_suspended = (
                    existing_account and existing_account.get("status") == "SUSPENDED"
                )
                was_new = account_id not in existing_accounts
                existing_client_name = (
                    existing_account.get("client_name") if existing_account else None
                )

                # Upsert account with ACTIVE status - handles add, activate, and update cases
                table.put_item(
                    Item={
                        "account_id": account_id,
                        "status": "ACTIVE",
                        "client_name": client_name,
                        "last_updated": now,
                        "notes": "Auto-synced from deployer account",
                    }
                )

                # Track what type of operation this was for logging and metrics
                if was_new:
                    sync_results["added"] += 1
                    logger.info(
                        "Added new account",
                        account_id=account_id,
                        client_name=client_name,
                    )
                elif was_suspended:
                    sync_results["activated"] += 1
                    logger.info(
                        "Reactivated account",
                        account_id=account_id,
                        client_name=client_name,
                    )
                else:
                    # Account was already active - just log if client name changed
                    if existing_client_name != client_name:
                        logger.info(
                            "Updated account client name",
                            account_id=account_id,
                            old_client_name=existing_client_name,
                            new_client_name=client_name,
                        )
                    else:
                        logger.debug(
                            "Refreshed account timestamp",
                            account_id=account_id,
                            client_name=client_name,
                        )

            except Exception as e:
                sync_results["failed"] += 1
                logger.error(
                    "Failed to upsert account",
                    account_id=account_id,
                    client_name=client_name,
                    error=str(e),
                )

        # Suspend accounts that are no longer in the config
        for account_id, item in existing_accounts.items():
            if account_id not in current_account_ids and item.get("status") == "ACTIVE":
                try:
                    table.update_item(
                        Key={"account_id": account_id},
                        UpdateExpression="SET #status = :status, last_updated = :timestamp",
                        ExpressionAttributeNames={"#status": "status"},
                        ExpressionAttributeValues={
                            ":status": "SUSPENDED",
                            ":timestamp": now,
                        },
                    )
                    sync_results["suspended"] += 1
                    client_name = str(item.get("client_name", "unknown"))
                    logger.info(
                        "Suspended account that was removed from config",
                        account_id=account_id,
                        client_name=client_name,
                    )
                except Exception as e:
                    sync_results["failed"] += 1
                    client_name = str(item.get("client_name", "unknown"))
                    logger.error(
                        "Failed to suspend account",
                        account_id=account_id,
                        client_name=client_name,
                        error=str(e),
                    )

        logger.info(
            "Allowed accounts table updated successfully",
            sync_results=sync_results,
        )

        return sync_results

    except Exception as e:
        logger.error("Failed to update allowed accounts table", error=str(e))
        raise Exception(f"Failed to update allowed accounts table: {str(e)}") from e
