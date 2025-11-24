"""
Enqueue-URL Lambda Function.

This Lambda takes a URL from user input and adds it to DynamoDB with status "pending".
It's the first step in the web crawler Step Function workflow.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, NotRequired, Optional, Sequence, TypedDict

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext
from botocore.exceptions import ClientError


class EnqueueUrlEvent(TypedDict):
    """Type definition for the Enqueue URL Lambda event."""

    url: str
    userId: str
    title: NotRequired[str]
    crawlDepth: NotRequired[int]
    crawlSessionId: NotRequired[str]
    kbId: NotRequired[str]


logger = structlog.get_logger()
dynamodb = boto3.resource("dynamodb")

REQUIRED_EVENT_FIELDS: Sequence[str] = ("url", "userId")
MIN_DEPTH, MAX_DEPTH = 1, 5


class CrawlUrlRequest(TypedDict):
    url: str
    title: str
    crawlDepth: int
    userId: str
    crawlSessionId: str
    kbId: str


def _get_table():
    table_name = os.getenv("TABLE_NAME")
    if not table_name:
        raise ValueError("TABLE_NAME environment variable is not set")
    return dynamodb.Table(table_name)


def _utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def _validate_depth(depth: int) -> None:
    if depth < MIN_DEPTH or depth > MAX_DEPTH:
        raise ValueError(
            f"Crawl depth must be between {MIN_DEPTH} and {MAX_DEPTH}, got {depth}"
        )


def _validate_request(
    event: Dict[str, Any] | EnqueueUrlEvent,
) -> Optional[CrawlUrlRequest]:
    if not all(k in event for k in REQUIRED_EVENT_FIELDS):
        logger.error(
            "Missing required fields",
            required=list(REQUIRED_EVENT_FIELDS),
            received=list(event.keys()),
        )
        return None

    url = str(event.get("url", ""))

    if not url.startswith(("http://", "https://")):
        url = f"https://{url.lstrip('/')}"
        logger.info(
            "URL normalized with https:// prefix",
            original_url=event.get("url"),
            normalized_url=url,
        )

    depth = int(event.get("crawlDepth", MIN_DEPTH))
    _validate_depth(depth)

    return {
        "url": url,
        "title": event.get("title") or url,
        "crawlDepth": depth,
        "userId": str(event["userId"]),
        "crawlSessionId": str(event.get("crawlSessionId", "unknown")),
        "kbId": str(event.get("kbId", "company")),
    }


def add_url_to_dynamodb(request: CrawlUrlRequest) -> Dict[str, Any]:
    try:
        table = _get_table()
        _validate_depth(request["crawlDepth"])  # double-check even if already done

        now = _utcnow_iso()
        item = {
            "userId": request["userId"],
            "url": request["url"],
            "title": request["title"],
            "crawlDepth": request["crawlDepth"],
            "crawlSessionId": request["crawlSessionId"],
            "kbId": request["kbId"],
            "status": "pending",
            "createdAt": now,
            "updatedAt": now,
            "pagesAttempted": 0,
            "pagesSuccessful": 0,
            "linksEnqueued": 0,
        }

        table.put_item(Item=item)

        logger.info("Added URL to DynamoDB", url=request["url"], status="pending")
        return {
            "status": "success",
            "message": "URL added to queue",
            "url": request["url"],
            "timestamp": now,
        }

    except ClientError as e:
        logger.error(
            "Error adding URL to DynamoDB",
            url=request["url"],
            error=str(e),
            exc_info=True,
        )
        return {
            "status": "error",
            "message": f"Failed to add URL to queue: {e}",
            "url": request["url"],
        }

    except ValueError as e:
        logger.error("Validation error", url=request["url"], error=str(e))
        return {
            "status": "error",
            "message": str(e),
            "url": request["url"],
        }

    except Exception as e:  # noqa: BLE001
        logger.error(
            "Error adding URL to DynamoDB",
            url=request["url"],
            error=str(e),
            exc_info=True,
        )
        return {
            "status": "error",
            "message": f"Failed to add URL to queue: {e}",
            "url": request["url"],
        }


def handler(
    event: Dict[str, Any] | EnqueueUrlEvent, _: LambdaContext
) -> Dict[str, Any]:
    """
    Example event:
        {
          "url": "https://example.com",
          "title": "Example Website",
          "crawl_depth": 3,
          "user_id": "user123"
        }
    """
    logger.info("Received event", input=event)

    try:
        req = _validate_request(event)
        if not req:
            return {
                "status": "error",
                "message": "Invalid request parameters",
                "timestamp": _utcnow_iso(),
            }

        result = add_url_to_dynamodb(req)
        return {**event, **result}

    except ValueError as e:
        logger.error("Validation error", error=str(e), input_event=event)
        return {"status": "error", "message": str(e), "timestamp": _utcnow_iso()}

    except Exception as e:  # noqa: BLE001
        logger.error("Unexpected error", error=str(e), input_event=event)
        return {
            "status": "error",
            "message": f"Unexpected error: {e}",
            "timestamp": _utcnow_iso(),
        }
