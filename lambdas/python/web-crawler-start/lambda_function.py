"""Web Crawler API Lambda.

POST /start-web-crawler  -> starts the crawler Step Function
GET  /web-crawler-stats  -> aggregates crawler stats from the crawl URLs table
"""

import base64
import json
import os
import uuid
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import boto3
import structlog
from aws_lambda_powertools.utilities.data_classes import (
    APIGatewayProxyEvent,
    event_source,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from boto3.dynamodb.conditions import Key

MAX_PAGES = 10000
MAX_STATS_LIMIT = 2000
DEFAULT_KB_ID = "company"
DEFAULT_INDEX_NAME = "kbId-status-index"

logger = structlog.get_logger()
step_function_client = boto3.client("stepfunctions")
dynamodb = boto3.resource("dynamodb")


def _decode_next_token(token: Optional[str]) -> Optional[Dict[str, Any]]:
    """Decode a URL-safe base64 token into a DynamoDB key."""
    if not token:
        return None
    try:
        decoded = base64.urlsafe_b64decode(token.encode("utf-8")).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        logger.warning("Invalid nextToken provided; ignoring")
        return None


def _encode_next_token(key: Optional[Dict[str, Any]]) -> Optional[str]:
    if not key:
        return None
    return base64.urlsafe_b64encode(json.dumps(key).encode("utf-8")).decode("utf-8")


def _aggregate_domains(items) -> list[Dict[str, Any]]:
    """Aggregate page counts and last-crawled timestamps per domain."""
    domains: Dict[str, Dict[str, Any]] = {}
    for item in items:
        url = item.get("url")
        if not url:
            continue
        domain = urlparse(url).netloc
        if not domain:
            continue

        entry = domains.setdefault(
            domain, {"domain": domain, "pageCount": 0, "lastCrawled": None}
        )
        entry["pageCount"] += 1

        updated = item.get("updatedAt") or item.get("createdAt")
        if updated and (entry["lastCrawled"] is None or updated > entry["lastCrawled"]):
            entry["lastCrawled"] = updated

    # Map to deterministic shape used by FE
    data_sources = []
    for entry in domains.values():
        domain_url = f"https://{entry['domain']}"
        data_sources.append(
            {
                "dataSourceId": f"web-crawler-{entry['domain']}",
                "name": domain_url,
                "displayName": domain_url,
                "type": "Numa Web Crawler",
                "status": "ACTIVE",
                "pageCount": entry["pageCount"],
                "lastCrawled": entry["lastCrawled"],
                "isWebCrawler": True,
                "domain": entry["domain"],
                "sourceUrl": domain_url,
            }
        )
    # Sort by last crawled desc, fallback to domain
    data_sources.sort(
        key=lambda d: (d.get("lastCrawled") or "", d.get("domain") or ""), reverse=True
    )
    return data_sources


def _fetch_crawler_stats(
    kb_id: str, limit: int, next_token: Optional[str]
) -> Dict[str, Any]:
    """Query DynamoDB for completed crawl entries for a KB and aggregate per domain."""
    table_name = os.environ["CRAWL_URLS_TABLE_NAME"]
    index_name = os.environ.get("KB_STATUS_INDEX_NAME", DEFAULT_INDEX_NAME)
    table = dynamodb.Table(table_name)

    exclusive_start_key = _decode_next_token(next_token)
    capped_limit = min(limit, MAX_STATS_LIMIT)

    response = table.query(
        IndexName=index_name,
        KeyConditionExpression=Key("kbId").eq(kb_id) & Key("status").eq("completed"),
        Limit=capped_limit,
        **({"ExclusiveStartKey": exclusive_start_key} if exclusive_start_key else {}),
    )

    items = response.get("Items", [])
    domains = _aggregate_domains(items)
    encoded_next_token = _encode_next_token(response.get("LastEvaluatedKey"))

    return {
        "success": True,
        "domains": domains,
        "nextToken": encoded_next_token,
        "count": response.get("Count", 0),
    }


def _start_crawler(body: Dict[str, Any], headers: Dict[str, str]) -> Dict[str, Any]:
    user_id = body.get("userId", "anonymous")
    urls = body.get("urls", [])
    max_pages = MAX_PAGES
    max_depth = min(body.get("maxDepth", 5), 5)
    url_depth_map = body.get("urlDepthMap", {})
    kb_id = body.get("kb_id", DEFAULT_KB_ID)

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

    crawl_session_id = str(uuid.uuid4())
    execution_name = f"web-crawler-{crawl_session_id}"

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
                "crawlSessionId": crawl_session_id,
                "kbId": kb_id,
            }
            for url in urls
        ],
        "userId": user_id,
        "crawlSessionId": crawl_session_id,
        "maxPages": max_pages,
        "maxDepth": max_depth,
        "kbId": kb_id,
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
            crawl_session_id=crawl_session_id,
        )
    except Exception as e:  # noqa: BLE001
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


@event_source(data_class=APIGatewayProxyEvent)
def handler(
    event: APIGatewayProxyEvent, _: Optional[LambdaContext] = None
) -> Dict[str, Any]:
    """Start the web crawler or return crawler stats."""
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": "true",
    }

    try:
        raw_event = getattr(event, "raw_event", {}) or {}
        http_method = str(
            raw_event.get("httpMethod")
            or raw_event.get("requestContext", {}).get("httpMethod")
            or raw_event.get("requestContext", {}).get("http", {}).get("method")
            or ""
        ).upper()

        if http_method == "GET":
            query_params = raw_event.get("queryStringParameters") or {}
            kb_id = query_params.get("kb_id", DEFAULT_KB_ID)
            limit = int(query_params.get("limit", MAX_STATS_LIMIT))
            next_token = query_params.get("nextToken")

            stats = _fetch_crawler_stats(kb_id, limit, next_token)
            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps(stats),
            }

        body = json.loads(event.body) if event.body else {}
        return _start_crawler(body, headers)

    except Exception as e:  # noqa: BLE001
        logger.error("Error in web crawler handler", error=str(e), exc_info=True)
        return {
            "statusCode": 500,
            "headers": headers,
            "body": json.dumps(
                {
                    "success": False,
                    "error": "Failed to handle web crawler request",
                    "message": str(e),
                }
            ),
        }
