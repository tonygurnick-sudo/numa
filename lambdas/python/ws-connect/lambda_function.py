"""
WebSocket $connect handler
Stores connection ID in DynamoDB when client connects
Includes user authentication context from REQUEST authorizer
"""

import json
import os
import time

import boto3
import structlog

logger = structlog.get_logger()
CONNECTION_TABLE = os.environ["CONNECTION_TABLE"]
dynamodb = boto3.resource("dynamodb")


def validate_websocket_event(event):
    """Validate that this is a legitimate WebSocket API Gateway event"""
    try:
        request_context = event.get("requestContext", {})

        # Check for required WebSocket API Gateway fields
        required_fields = ["connectionId", "apiId", "stage", "routeKey"]
        for field in required_fields:
            if not request_context.get(field):
                raise ValueError(f"Missing required WebSocket field: {field}")

        # Verify this is a $connect route
        if request_context.get("routeKey") != "$connect":
            raise ValueError(f"Invalid route key: {request_context.get('routeKey')}")

        # Check for WebSocket-specific event structure
        if "headers" not in event:
            raise ValueError("Missing headers - not a valid API Gateway event")

        return True
    except (KeyError, TypeError) as e:
        raise ValueError(f"Invalid WebSocket event structure: {str(e)}") from e


def handler(event, context):
    """Handle WebSocket $connect route with mandatory authentication"""
    try:
        # First, validate this is a legitimate WebSocket API Gateway event
        validate_websocket_event(event)

        connection_id = event["requestContext"]["connectionId"]

        # Extract user information from REQUEST authorizer context
        authorizer_context = event.get("requestContext", {}).get("authorizer", {})

        # Reject connections without proper authentication context
        if not authorizer_context.get("sub"):
            logger.error(
                "Connection rejected - missing authentication context",
                connection_id=connection_id,
                authorizer_context_keys=(
                    list(authorizer_context.keys()) if authorizer_context else []
                ),
            )
            return {
                "statusCode": 401,
                "body": json.dumps(
                    {
                        "error": "Authentication required",
                        "message": "Connection must include valid JWT token",
                    }
                ),
            }

        user_info = {
            "sub": authorizer_context.get("sub"),
            "email": authorizer_context.get("email"),
            "cognito:groups": (
                authorizer_context.get("groups", "").split(",")
                if authorizer_context.get("groups")
                else []
            ),
            "token_use": authorizer_context.get("token_use"),
        }

        # Store connection with user info in DynamoDB
        table = dynamodb.Table(  # pyright: ignore[reportAttributeAccessIssue] - boto3 type inference issue in CI/CD
            CONNECTION_TABLE
        )
        item = {
            "connectionId": connection_id,
            "timestamp": context.aws_request_id,
            "connectedAt": int(time.time()),
            "userSub": user_info.get("sub"),
            "userEmail": user_info.get("email"),
            "userGroups": user_info.get("cognito:groups", []),
        }

        # Only add non-empty values
        item = {k: v for k, v in item.items() if v is not None and v != ""}

        table.put_item(Item=item)

        logger.info(
            "Authenticated connection established",
            connection_id=connection_id,
            user_sub=user_info.get("sub"),
            user_email=user_info.get("email"),
            user_groups=user_info.get("cognito:groups"),
        )

        return {
            "statusCode": 200,
            "body": json.dumps({"message": "Connected and authenticated"}),
        }

    except ValueError as e:
        # Security validation failures
        logger.error(
            "Connection security validation failed", error=str(e), exc_info=True
        )
        return {
            "statusCode": 403,
            "body": json.dumps({"error": "Forbidden - Invalid request"}),
        }
    except Exception as e:
        logger.error("Connection failed", error=str(e), exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": "Connection failed"})}
