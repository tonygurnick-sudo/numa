import json
import os
import traceback

import boto3
import structlog
from aws_lambda_powertools.utilities.data_classes import (
    APIGatewayProxyEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore import exceptions

import helpers

s3_client = boto3.client("s3")
logger = structlog.get_logger()


@event_source(data_class=APIGatewayProxyEvent)
def handler(
    event: APIGatewayProxyEvent,
    context: LambdaContext,
) -> helpers.ApiGatewayProxyIntegrationResponse:

    app_id, job_id, payload = helpers.get_api_gateway_parameters(event)
    helpers.setup_api_gateway_lambda_logging(context, app_id, job_id, payload)

    # Extract user_id from the JWT token in the Authorization header
    user_id = helpers.extract_user_id_from_token(event)

    # Add user_id to payload for logging
    if user_id:
        payload["user_id"] = user_id
    else:
        logger.error("User ID is required")
        return {
            "statusCode": 401,
            "body": json.dumps({"error": "User ID is required"}),
        }

    bucket = os.environ["BUCKET"]

    # Use the path format with user_id
    key = f"{app_id}/{user_id}/{job_id}/status.json"

    try:
        s3_file_object = s3_client.get_object(Bucket=bucket, Key=key)
        status_json: str = s3_file_object["Body"].read().decode("utf-8")
        return {
            "statusCode": 200,
            "body": status_json,
        }
    except exceptions.ClientError as e:
        logger.error("Error retrieving status file", error=str(e))
        return {
            "statusCode": 404,
            "body": json.dumps({"error": "Status not found"}),
        }
    except Exception as exception:
        logger.exception("Error while getting step function status")
        message = traceback.format_exception_only(exception)[-1].strip()
        return {"statusCode": 503, "body": __error_json(message)}


def __error_json(message: str) -> str:
    error_json: helpers.StepFunctionErrorStatus = {
        "status": "UNKNOWN",
        "message": message,
    }
    return json.dumps(error_json)
