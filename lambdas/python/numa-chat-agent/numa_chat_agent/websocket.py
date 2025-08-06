"""
WebSocket module for Numa Chat Agent.

Handles WebSocket connection management, message posting, and agent streaming
integration for real-time communication with clients.
"""

import json
from typing import Any, Dict

import structlog

from .config import (
    CONNECTION_TABLE,
    WS_API_ENDPOINT_OVERRIDE,
    get_apigateway_management_client,
    get_dynamodb_resource,
)
from .utils import safe_json_convert

logger = structlog.get_logger()


def build_websocket_endpoint(request_context: dict) -> str:
    """
    Build WebSocket endpoint URL from request context.

    Args:
        request_context (dict): API Gateway request context

    Returns:
        str: WebSocket management API endpoint URL
    """
    if WS_API_ENDPOINT_OVERRIDE:
        return WS_API_ENDPOINT_OVERRIDE.rstrip("/")

    domain_name = request_context["domainName"]
    return f"https://{domain_name}"


def post_to_connection(
    connection_id: str, payload: Dict[str, Any], endpoint_url: str
) -> bool:
    """
    Post a message to a WebSocket connection.

    Args:
        connection_id (str): WebSocket connection ID
        payload (dict): Message payload to send
        endpoint_url (str): WebSocket management API endpoint

    Returns:
        bool: True if successful, False if connection is stale or failed
    """
    try:
        client = get_apigateway_management_client(endpoint_url)

        # Make payload JSON safe
        safe_payload = json.loads(json.dumps(payload, default=safe_json_convert))

        client.post_to_connection(
            ConnectionId=connection_id, Data=json.dumps(safe_payload).encode()
        )
        return True

    except Exception as exc:
        # Check if it's a GoneException (stale connection)
        if hasattr(exc, "__class__") and exc.__class__.__name__ == "GoneException":
            logger.info(
                "Stale WebSocket connection detected", connection_id=connection_id
            )
            # Clean up stale connection from DynamoDB if table is configured
            if CONNECTION_TABLE:
                try:
                    ddb = get_dynamodb_resource()
                    ddb.Table(CONNECTION_TABLE).delete_item(
                        Key={"connectionId": connection_id}
                    )
                    logger.info(
                        "Cleaned up stale connection from DynamoDB",
                        connection_id=connection_id,
                    )
                except Exception as cleanup_exc:
                    logger.warning(
                        "Failed to clean up stale connection",
                        connection_id=connection_id,
                        error=str(cleanup_exc),
                    )
            return False

        # Handle all other exceptions
        logger.error(
            "Failed to post to WebSocket connection",
            connection_id=connection_id,
            error=str(exc),
            exc_info=True,
        )
        return False


async def run_agent_stream(
    agent, prompt: str, messages, connection_id: str, endpoint_url: str
) -> None:
    """
    Run agent streaming with WebSocket message forwarding.

    Args:
        agent: Strands Agent instance
        prompt (str): User's input prompt
        messages (list): Conversation history
        connection_id (str): WebSocket connection ID
        endpoint_url (str): WebSocket management API endpoint
    """
    # Send start message
    if not post_to_connection(connection_id, {"type": "start"}, endpoint_url):
        logger.error(
            "Failed to send start message, aborting stream", connection_id=connection_id
        )
        return

    try:
        logger.info(
            "Starting agent stream",
            connection_id=connection_id,
            messages_count=len(messages),
            prompt_preview=prompt[:100],
        )

        async for event in agent.stream_async(prompt, messages=messages):
            # Forward every Strands event with type wrapper
            if isinstance(event, dict):
                # Remove 'messages' field to prevent large payloads (frontend doesn't need it)
                filtered_event = {k: v for k, v in event.items() if k != "messages"}
                event_with_type = {"type": "event", **filtered_event}
                success = post_to_connection(
                    connection_id, event_with_type, endpoint_url
                )

                if not success:
                    logger.warning(
                        "Failed to send event, stopping stream",
                        connection_id=connection_id,
                    )
                    break

            # Check if turn is finished
            if event.get("complete") or event.get("messageStop"):
                logger.info("Agent stream completed", connection_id=connection_id)
                break

    except Exception as exc:
        logger.error(
            "Agent streaming error",
            connection_id=connection_id,
            error=str(exc),
            exc_info=True,
        )

        # Send error message to client
        error_sent = post_to_connection(
            connection_id, {"type": "error", "error": str(exc)}, endpoint_url
        )

        if not error_sent:
            logger.error(
                "Failed to send error message to client", connection_id=connection_id
            )


def send_completion_message(
    connection_id: str, endpoint_url: str, status: str = "completed"
) -> bool:
    """
    Send completion message to WebSocket client.

    Args:
        connection_id (str): WebSocket connection ID
        endpoint_url (str): WebSocket management API endpoint
        status (str): Completion status ("completed" or "failed")

    Returns:
        bool: True if message sent successfully
    """
    completion_payload = {
        "type": "completion",
        "status": status,
        "message": f"Agent processing {status}",
    }

    return post_to_connection(connection_id, completion_payload, endpoint_url)


def send_error_message(
    connection_id: str, endpoint_url: str, error_message: str
) -> bool:
    """
    Send error message to WebSocket client.

    Args:
        connection_id (str): WebSocket connection ID
        endpoint_url (str): WebSocket management API endpoint
        error_message (str): Error message to send

    Returns:
        bool: True if message sent successfully
    """
    error_payload = {"type": "error", "error": error_message}

    return post_to_connection(connection_id, error_payload, endpoint_url)
