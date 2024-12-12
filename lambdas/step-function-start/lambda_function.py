import datetime
import json
import os
import typing
import uuid

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

import helpers

step_function_client = boto3.client("stepfunctions")
logger = structlog.get_logger()


class StartExecutionResponse(typing.TypedDict):
    executionArn: str
    startDate: datetime.datetime


def handler(
    event: dict,
    context: LambdaContext,
) -> helpers.ApiGatewayProxyIntegrationResponse:
    helpers.setup_logging()
    job_id = str(uuid.uuid4())
    structlog.contextvars.bind_contextvars(
        job_id=job_id,
        function_name=context.function_name,
    )

    app_name = os.environ["APP_NAME"]
    step_function_arn = os.environ["STEP_FUNCTION_ARN"]
    logger.info("Start step function", **event, step_function_arn=step_function_arn)
    try:
        response: StartExecutionResponse = step_function_client.start_execution(
            stateMachineArn=step_function_arn,
            name=job_id,
            input=json.dumps({**event, "app_name": app_name, "job_id": job_id}),
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
