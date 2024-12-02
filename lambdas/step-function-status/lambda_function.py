import json
import os

import boto3
import structlog

import helpers

s3_client = boto3.client("s3")
logger = structlog.get_logger()


def handler(event: dict, context: dict) -> helpers.ApiGatewayProxyIntegrationResponse:
    helpers.setup_logging()
    job_id = event["job_id"]
    structlog.contextvars.bind_contextvars(
        job_id=job_id,
        function_name=context["function_name"],
    )

    app_name = os.environ["APP_NAME"]
    bucket = os.environ["BUCKET"]
    logger.info("Get step function status")
    try:
        s3_file_object = s3_client.get_object(
            Bucket=bucket,
            Key=f"{app_name}/{job_id}/status.json",
        )

        status_json: str = s3_file_object["Body"].read().decode("utf-8")
        return {
            "statusCode": 200,
            "body": status_json,
        }
    except Exception as exception:
        logger.exception("Error while getting step function status")
        error_json: helpers.StepFunctionErrorStatus = {
            "status": "UNKNOWN",
            "message": str(exception),
        }
        return {
            "statusCode": 503,
            "body": json.dumps(error_json),
        }
