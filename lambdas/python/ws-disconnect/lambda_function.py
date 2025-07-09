"""
WebSocket $disconnect handler
Removes connection ID from DynamoDB when client disconnects
Enhanced to stop any running Step Function executions
"""

import json
import os

import boto3
import structlog

logger = structlog.get_logger()
CONNECTION_TABLE = os.environ["CONNECTION_TABLE"]
dynamodb = boto3.resource("dynamodb")
stepfunctions = boto3.client("stepfunctions")


def validate_websocket_event(event):
    """Validate that this is a legitimate WebSocket API Gateway event"""
    try:
        request_context = event.get("requestContext", {})

        # Check for required WebSocket API Gateway fields
        required_fields = ["connectionId", "apiId", "stage", "routeKey"]
        for field in required_fields:
            if not request_context.get(field):
                raise ValueError(f"Missing required WebSocket field: {field}")

        # Verify this is a $disconnect route
        if request_context.get("routeKey") != "$disconnect":
            raise ValueError(f"Invalid route key: {request_context.get('routeKey')}")

        # Check for WebSocket-specific event structure
        if "headers" not in event:
            raise ValueError("Missing headers - not a valid API Gateway event")

        return True
    except (KeyError, TypeError) as e:
        raise ValueError(f"Invalid WebSocket event structure: {str(e)}") from e


def handler(event, _):
    """Handle WebSocket $disconnect route with authentication and Step Function cleanup"""
    try:
        # First, validate this is a legitimate WebSocket API Gateway event
        validate_websocket_event(event)

        connection_id = event["requestContext"]["connectionId"]

        # Extract user information from REQUEST authorizer context
        authorizer_context = event.get("requestContext", {}).get("authorizer", {})
        authenticated_user_sub = authorizer_context.get("sub")

        if not authenticated_user_sub:
            logger.error(
                "Disconnect rejected - missing authentication context",
                connection_id=connection_id,
            )
            return {
                "statusCode": 401,
                "body": json.dumps(
                    {
                        "error": "Authentication required",
                        "message": "Disconnect requires valid JWT token",
                    }
                ),
            }

        table = dynamodb.Table(  # pyright: ignore[reportAttributeAccessIssue] - boto3 type inference issue in CI/CD
            CONNECTION_TABLE
        )

        # Get connection info first to verify ownership and check for running executions
        try:
            response = table.get_item(Key={"connectionId": connection_id})
            connection_item = response.get("Item", {})

            # Verify the connection belongs to the authenticated user
            connection_user_sub = connection_item.get("userSub")
            if connection_user_sub != authenticated_user_sub:
                logger.error(
                    "Disconnect rejected - user does not own connection",
                    connection_id=connection_id,
                    authenticated_user=authenticated_user_sub,
                    connection_owner=connection_user_sub,
                )
                return {
                    "statusCode": 403,
                    "body": json.dumps(
                        {
                            "error": "Forbidden",
                            "message": "Cannot disconnect connection owned by another user",
                        }
                    ),
                }

            execution_arn = connection_item.get("executionArn")

            # Stop any running Step Function execution for this connection
            if execution_arn:
                try:
                    stepfunctions.stop_execution(
                        executionArn=execution_arn,
                        error="Connection disconnected",
                        cause="WebSocket connection was closed by client",
                    )
                    logger.info(
                        "Stopped Step Function execution due to disconnect",
                        connection_id=connection_id,
                        execution_arn=execution_arn,
                    )
                except stepfunctions.exceptions.ExecutionDoesNotExist:
                    # Execution already completed, which is fine
                    logger.info(
                        "Step Function execution already completed",
                        execution_arn=execution_arn,
                    )
                except Exception as sf_exc:
                    logger.error(
                        "Failed to stop Step Function execution",
                        execution_arn=execution_arn,
                        error=str(sf_exc),
                    )

        except Exception as get_exc:
            # If we can't get the connection item, just log and continue with cleanup
            logger.warning(
                "Could not retrieve connection item for cleanup", error=str(get_exc)
            )

        # Remove connection from DynamoDB
        table.delete_item(Key={"connectionId": connection_id})

        logger.info(
            "Connection disconnected and cleaned up",
            connection_id=connection_id,
            user_sub=authenticated_user_sub,
        )

        return {"statusCode": 200, "body": json.dumps({"message": "Disconnected"})}

    except ValueError as e:
        # Security validation failures
        logger.error(
            "Disconnect security validation failed", error=str(e), exc_info=True
        )
        return {
            "statusCode": 403,
            "body": json.dumps({"error": "Forbidden - Invalid request"}),
        }
    except Exception as e:
        logger.error("Disconnect handling failed", error=str(e), exc_info=True)
        return {"statusCode": 500, "body": json.dumps({"error": "Disconnect failed"})}
