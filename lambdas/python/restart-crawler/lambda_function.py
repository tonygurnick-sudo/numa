"""
Restart-Crawler Lambda Function.

This Lambda starts a new execution of the web crawler Step Function to continue
processing URLs when approaching the 25K event history limit.
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

from prm import client as prm_client

logger = structlog.get_logger()
sfn = prm_client("stepfunctions")


def handler(event: Dict[str, Any], _: LambdaContext) -> Dict[str, Any]:
    """
    Start a new execution of the web crawler Step Function.

    Parameters:
    - event: Event data containing the input state for the new execution
    - _: Lambda context

    Returns:
    - Dict with status information about the new execution
    """
    logger.info("Received event to restart crawler", input_event=event)

    # Extract the state machine ARN from the event
    state_machine_arn = event.get("stateMachineArn")
    if not state_machine_arn:
        logger.error("Missing state machine ARN")
        return {
            "status": "error",
            "message": "Missing state machine ARN",
        }

    # Extract the input for the new execution
    input_data = event.get("input", {})

    # Set the continuation flag
    input_data["continue"] = True

    # Keep the URLs, userId, crawlSessionId, crawlDepth, and counter, but start a new event counter
    # We remove process_result and other temporary state data
    clean_input = {
        "continue": True,
        "userId": input_data.get("userId", "anonymous"),
        "crawlSessionId": input_data.get("crawlSessionId", "unknown"),
        "counter": input_data.get("counter", 0),
    }

    # Generate a unique execution name
    execution_name = f"continuation-{str(uuid.uuid4())}"

    try:
        # Start a new execution
        response = sfn.start_execution(
            stateMachineArn=state_machine_arn,
            name=execution_name,
            input=json.dumps(clean_input),
        )

        logger.info(
            "Started new crawler execution",
            execution_arn=response["executionArn"],
            execution_name=execution_name,
            crawl_session_id=clean_input.get("crawlSessionId"),
        )

        return {
            "status": "success",
            "message": "Started new crawler execution",
            "executionArn": response["executionArn"],
            "executionName": execution_name,
        }
    except Exception as e:
        logger.error("Error starting new execution", error=str(e), exc_info=True)
        return {
            "status": "error",
            "message": f"Error starting new execution: {str(e)}",
        }
