import datetime
import json
import os
import typing

import boto3
import structlog
from aws_lambda_powertools.utilities.data_classes import (
    APIGatewayProxyEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers

step_functions_client = boto3.client("stepfunctions")
logger = structlog.get_logger()


class StartExecutionResponse(typing.TypedDict):
    executionArn: str
    startDate: datetime.datetime


@event_source(data_class=APIGatewayProxyEvent)
def handler(
    event: APIGatewayProxyEvent,
    context: LambdaContext,
) -> helpers.ApiGatewayProxyIntegrationResponse:

    app_id, job_id, payload = helpers.get_api_gateway_parameters(event)
    helpers.setup_api_gateway_lambda_logging(context, app_id, job_id, payload)

    # Extract user ID from JWT token in Authorization header
    user_id = helpers.extract_user_id_from_token(event)
    if user_id:
        payload["user_id"] = user_id
        logger.info(f"Added user_id from token: {user_id}")

    try:
        step_function_arn = os.environ["STEP_FUNCTION_ARN"]
        logger.info(
            "Start step function",
            payload=payload,
            step_function_arn=step_function_arn,
        )

        # Generate unique execution name to avoid conflicts on follow-up runs
        # Append millisecond timestamp to ensure uniqueness while keeping job_id for session tracking
        timestamp_ms = int(
            datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000
        )
        execution_name = f"{job_id}-{timestamp_ms}"

        # Ensure user_id is included in the Step Function input
        step_function_input = {
            **payload,
            "app_id": app_id,
            "job_id": job_id,  # Keep same job_id for session continuity
        }

        # Log the input for debugging
        logger.info(
            "Step function input",
            user_id=step_function_input.get("user_id"),
            app_id=app_id,
            job_id=job_id,
            execution_name=execution_name,
        )

        response: StartExecutionResponse = step_functions_client.start_execution(
            stateMachineArn=step_function_arn,
            name=execution_name,  # Use unique execution name
            input=json.dumps(step_function_input),
        )
        logger.info("Step function started", **response)
        return {
            "statusCode": 200,
            "body": json.dumps({"job_id": job_id}),
        }
    except Exception as exception:
        logger.exception("Error while starting step function")
        return {
            "statusCode": 503,
            "body": json.dumps({"exception": str(exception)}),
        }
