"""Web Crawler Start Lambda Function."""

import json
import os
import uuid
from typing import Any, Dict, Optional

import boto3
import structlog
from aws_lambda_powertools.utilities.data_classes import (
    APIGatewayProxyEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

MAX_PAGES = 10000

logger = structlog.get_logger()
step_function_client = boto3.client("stepfunctions")


@event_source(data_class=APIGatewayProxyEvent)
def handler(
    event: APIGatewayProxyEvent, _: Optional[LambdaContext] = None
) -> Dict[str, Any]:
    """Start the web crawler step function execution."""
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
    }

    try:

        body = json.loads(event.body) if event.body else {}
        user_id = body.get("userId", "anonymous")
        urls = body.get("urls", [])
        max_pages = MAX_PAGES
        max_depth = min(body.get("maxDepth", 5), 5)
        url_depth_map = body.get("urlDepthMap", {})

        if not urls:
            return {
                "statusCode": 400,
                "headers": headers,
                "body": json.dumps(
                    {
                        "success": False,
                        "error": "No URLs provided",
                        "message": "Please provide at least one URL to crawl",
                    }
                ),
            }

        execution_name = f"web-crawler-{str(uuid.uuid4())}"

        try:
            state_machine_arn = os.environ["WEB_CRAWLER_STATE_MACHINE_ARN"]
        except KeyError:
            logger.error("Missing environment variable: WEB_CRAWLER_STATE_MACHINE_ARN")
            return {
                "statusCode": 500,
                "headers": headers,
                "body": json.dumps(
                    {
                        "success": False,
                        "error": "Configuration error",
                        "message": "The web crawler is not properly configured.",
                    }
                ),
            }

        step_function_input = {
            "urls": [
                {
                    "url": url,
                    "crawlDepth": min(int(url_depth_map.get(url, max_depth)), 5),
                    "userId": user_id,
                }
                for url in urls
            ],
            "userId": user_id,
            "maxPages": max_pages,
            "maxDepth": max_depth,
        }

        try:
            response = step_function_client.start_execution(
                stateMachineArn=state_machine_arn,
                name=execution_name,
                input=json.dumps(step_function_input),
            )

            logger.info(
                "Started web crawler execution",
                execution_arn=response["executionArn"],
                execution_name=execution_name,
            )
        except Exception as e:
            logger.error("Failed to start step function", error=str(e), exc_info=True)
            return {
                "statusCode": 500,
                "headers": headers,
                "body": json.dumps(
                    {
                        "success": False,
                        "error": "Failed to start web crawler",
                        "message": f"Error starting step function: {str(e)}",
                    }
                ),
            }

        return {
            "statusCode": 200,
            "headers": headers,
            "body": json.dumps(
                {
                    "success": True,
                    "message": "Web crawler started successfully",
                    "executionArn": response["executionArn"],
                    "executionName": execution_name,
                }
            ),
        }

    except Exception as e:
        logger.error("Error starting web crawler", error=str(e), exc_info=True)
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps(
                {
                    "success": False,
                    "error": "Failed to start web crawler",
                    "message": str(e),
                }
            ),
        }
