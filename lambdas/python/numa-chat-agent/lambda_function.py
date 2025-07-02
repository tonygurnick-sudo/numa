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
from numa_chat_agent.utils import extract_preview
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
    system_prompt = event.get("systemPrompt", "")
    model_id = event.get("modelId")  # Extract model ID from event, may be None
    user_auth = event.get("userAuth")

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
        # Create fresh agent with dynamic tool selection and model ID
        agent = create_fresh_agent(enabled_tools, system_prompt, model_id)

        # Run the streaming process with no time constraints
        asyncio.run(
            run_agent_stream(
                agent=agent,
                prompt=prompt,
                messages=messages,
                connection_id=connection_id,
                endpoint_url=endpoint_url,
            )
        )

        logger.info(
            "Step Functions agent processing completed successfully",
            connection_id=connection_id,
        )

        # Return success result for Step Functions
        return {
            "statusCode": 200,
            "connectionId": connection_id,
            "status": "completed",
            "message": "Agent processing completed successfully",
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
