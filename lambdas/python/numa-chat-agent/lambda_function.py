"""
Numa Chat Agent Lambda Handler

A modular WebSocket-powered Lambda function for real-time streaming chat with AI capabilities.
This function is designed to run as a Step Functions worker to handle extended execution times
beyond the 30-second API Gateway timeout constraint.

Features:
- Real-time streaming chat via WebSocket
- Dynamic tool selection (query_knowledge_base, web_search)
- User authentication support for Q Business
- Modular architecture for maintainability
- Content summarization using Claude Haiku
- Dynamic model selection with frontend control

Environment Variables:
- MODEL_ID: Default Claude model to use if not specified in request (default: anthropic.claude-sonnet-4-20250514-v1:0)
- Q_APPLICATION_ID: Q Business application ID
- Q_RETRIEVER_ID: Q Business retriever ID
- BEDROCK_KNOWLEDGE_BASE_ID: Bedrock knowledge base ID
- PREFERRED_KNOWLEDGE_BASE: 'q' or 'bedrock' (default: q)
- CONNECTION_TABLE: DynamoDB table for WebSocket connections
- WS_API_ENDPOINT_OVERRIDE: Optional WebSocket endpoint override
"""

import asyncio

import structlog

from numa_chat_agent import (
    build_websocket_endpoint,
    clear_current_user_auth,
    create_fresh_agent,
    run_agent_stream,
    set_current_user_auth,
)
from numa_chat_agent.config import FALLBACK_MODEL_ID, is_quota_limit_error
from numa_chat_agent.utils import (
    convert_tool_blocks_to_text,
    extract_preview,
    process_messages_with_file_refs,
)
from numa_chat_agent.websocket import send_error_message

# Initialize structured logger
logger = structlog.get_logger()


def handler(event, _ctx):
    """
    Step Functions worker handler for agent processing with extended execution time.

    Args:
        event (dict): Step Functions input containing:
            - connectionId (str): WebSocket connection ID
            - requestContext (dict): API Gateway context for WebSocket endpoint
            - prompt (str): User's input prompt
            - messages (list, optional): Conversation history
            - enabledTools (list, optional): Array of enabled tool names
            - systemPrompt (str, optional): System instructions
            - modelId (str, optional): Model ID to use for this request; if not provided,
              falls back to MODEL_ID environment variable
            - userAuth (dict, optional): User authentication context
        _ctx: Lambda context object (unused)

    Returns:
        dict: Step Functions result with statusCode, connectionId, status, and message/error
    """
    # Extract Step Functions input
    connection_id = event["connectionId"]
    request_context = event["requestContext"]
    prompt = event["prompt"]
    messages = event.get("messages", [])
    enabled_tools = event.get("enabledTools", ["query_knowledge_base", "web_search"])
    enabled_connections = event.get("enabledConnections", [])
    system_prompt = event.get("systemPrompt", "")
    model_id = event.get("modelId")  # Extract model ID from event, may be None
    user_auth = event.get("userAuth")

    logger.info(
        "Extracted enabled_connections from event",
        connection_id=connection_id,
        enabled_connections=enabled_connections,
        enabled_connections_type=type(enabled_connections),
        enabled_connections_length=(
            len(enabled_connections) if enabled_connections else 0
        ),
    )

    # Convert tool blocks to text when no tools are enabled
    # This prevents ValidationException when conversation history contains tool blocks
    # but no toolConfig is provided
    if not enabled_tools:
        messages = convert_tool_blocks_to_text(messages)

    # Process file references to load content from S3
    # This prevents large files from being passed through WebSocket, avoiding payload size limits
    messages = process_messages_with_file_refs(messages)

    # Build WebSocket endpoint URL for API Gateway Management API
    endpoint_url = build_websocket_endpoint(request_context)

    # Set global user auth for tools to access
    set_current_user_auth(user_auth)

    logger.info(
        "Step Functions agent processing started",
        connection_id=connection_id,
        prompt_preview=extract_preview(prompt),
        enabled_tools=enabled_tools,
        has_system_prompt=bool(system_prompt),
        model_id=model_id,
        has_user_auth=bool(user_auth),
        user_email=user_auth.get("email") if user_auth else None,
        endpoint_url=endpoint_url,
    )

    try:
        # Try with primary model first, fallback if quota errors occur
        current_model_id = model_id
        used_fallback = False

        try:
            # Create fresh agent with dynamic tool selection and primary model ID
            agent, mcp_clients = create_fresh_agent(
                enabled_tools,
                system_prompt,
                current_model_id,
                messages,
                enabled_connections,
            )

            # Run the streaming process with no time constraints
            asyncio.run(
                run_agent_stream(
                    agent=agent,
                    prompt=prompt,
                    messages=messages,
                    connection_id=connection_id,
                    endpoint_url=endpoint_url,
                    mcp_clients=mcp_clients,
                )
            )

        except Exception as primary_error:
            # Check if this is a quota/throttling error that should trigger fallback
            if is_quota_limit_error(primary_error):
                logger.warning(
                    "Primary model hit quota limit, switching to fallback model",
                    connection_id=connection_id,
                    primary_model_id=current_model_id,
                    fallback_model_id=FALLBACK_MODEL_ID,
                    error=str(primary_error),
                )

                # Switch to fallback model and try again
                current_model_id = FALLBACK_MODEL_ID
                used_fallback = True

                # Create fresh agent with fallback model
                agent, mcp_clients = create_fresh_agent(
                    enabled_tools,
                    system_prompt,
                    current_model_id,
                    messages,
                    enabled_connections,
                )

                # Run the streaming process with fallback model
                asyncio.run(
                    run_agent_stream(
                        agent=agent,
                        prompt=prompt,
                        messages=messages,
                        connection_id=connection_id,
                        endpoint_url=endpoint_url,
                        mcp_clients=mcp_clients,
                    )
                )

                logger.info(
                    "Successfully switched to fallback model",
                    connection_id=connection_id,
                    fallback_model_id=current_model_id,
                )
            else:
                # Not a quota error, re-raise the original exception
                raise primary_error

        logger.info(
            "Step Functions agent processing completed successfully",
            connection_id=connection_id,
            model_id=current_model_id,
            used_fallback=used_fallback,
        )

        # Return success result for Step Functions
        return {
            "statusCode": 200,
            "connectionId": connection_id,
            "status": "completed",
            "message": "Agent processing completed successfully",
            "modelUsed": current_model_id,
            "usedFallback": used_fallback,
        }

    except Exception as exc:
        logger.error(
            "Step Functions agent processing failed",
            connection_id=connection_id,
            error=str(exc),
            exc_info=True,
        )

        # Send error to WebSocket
        try:
            send_error_message(
                connection_id, endpoint_url, f"Agent processing failed: {str(exc)}"
            )
        except Exception as post_exc:
            logger.error("Failed to send error to WebSocket", error=str(post_exc))

        # Return error result for Step Functions
        return {
            "statusCode": 500,
            "connectionId": connection_id,
            "status": "failed",
            "error": str(exc),
        }

    finally:
        # Reset global user auth to prevent leaking between executions
        clear_current_user_auth()
