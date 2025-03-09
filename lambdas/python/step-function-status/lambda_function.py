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

    key = f"/{app_id}/{job_id}/status.json"
    try:
        bucket = os.environ["BUCKET"]
        logger.info("Get step function status")
        s3_file_object = s3_client.get_object(Bucket=bucket, Key=key)

        status_json: str = s3_file_object["Body"].read().decode("utf-8")
        return {
            "statusCode": 200,
            "body": status_json,
        }
    except exceptions.ClientError as exception:
        if exception.response.get("Error", {}).get("Code", "") == "NoSuchKey":
            logger.exception(f"Requested step function status {key} not found")
            return {"statusCode": 404, "body": __error_json("Job not found")}

        logger.exception("Boto3 error while getting step function status")
        return {"statusCode": 503, "body": __error_json("")}
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
