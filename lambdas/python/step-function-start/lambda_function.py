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

step_function_client = boto3.client("stepfunctions")
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

    try:
        step_function_arn = os.environ["STEP_FUNCTION_ARN"]
        logger.info(
            "Start step function",
            payload=payload,
            step_function_arn=step_function_arn,
        )
        response: StartExecutionResponse = step_function_client.start_execution(
            stateMachineArn=step_function_arn,
            name=job_id,
            input=json.dumps(
                {
                    **payload,
                    "app_id": app_id,
                    "job_id": job_id,
                }
            ),
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
