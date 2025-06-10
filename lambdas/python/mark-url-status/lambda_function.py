"""
Mark-URL-Status Lambda Function.

This Lambda updates the status of a URL in DynamoDB.
It's the final step in the web crawler Step Function workflow.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, TypedDict

import boto3
import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext


class MarkUrlEvent(TypedDict, total=False):
    """Type definition for the Mark URL Status Lambda event."""

    url: str
    userId: str
    process_result: Dict[str, Any]
    pagesAttempted: int
    pagesSuccessful: int
    linksEnqueued: int
    counter: int


logger = structlog.get_logger()
dynamodb = boto3.resource("dynamodb")

STATUS_MAP = {"success": "completed", "failed": "failed", "error": "failed"}


def _get_table():
    table_name = os.getenv("TABLE_NAME")
    if not table_name:
        raise ValueError("TABLE_NAME environment variable is not set")
    return dynamodb.Table(table_name)


def _utcnow_iso() -> str:
    return datetime.utcnow().isoformat()


def update_url_status(
    *,
    url: str,
    userId: str,
    status: str,
    pagesAttempted: int,
    pagesSuccessful: int,
    linksEnqueued: int = 0,
) -> Dict[str, Any]:
    """PATCH the DynamoDB item for (*userId*, *url*) and return result dict."""
    try:
        table = _get_table()
        now = _utcnow_iso()

        response = table.update_item(
            Key={"userId": userId, "url": url},
            UpdateExpression=(
                "SET #status = :status, "
                "updatedAt = :updatedAt, "
                "pagesAttempted = :pagesAttempted, "
                "pagesSuccessful = :pagesSuccessful, "
                "linksEnqueued = :linksEnqueued"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": status,
                ":updatedAt": now,
                ":pagesAttempted": pagesAttempted,
                ":pagesSuccessful": pagesSuccessful,
                ":linksEnqueued": linksEnqueued,
            },
            ReturnValues="ALL_NEW",
        )

        logger.info(
            "Updated URL status in DynamoDB",
            url=url,
            status=status,
            pagesAttempted=pagesAttempted,
            pagesSuccessful=pagesSuccessful,
            linksEnqueued=linksEnqueued,
        )
        return {
            "status": "success",
            "message": f"URL status updated to {status}",
            "url": url,
            "timestamp": now,
            "item": response.get("Attributes", {}),
        }

    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Error updating URL status in DynamoDB",
            url=url,
            error=str(exc),
            exc_info=True,
        )
        return {
            "status": "error",
            "message": f"Failed to update URL status: {exc}",
            "url": url,
        }


def handler(event: Dict[str, Any] | MarkUrlEvent, _: LambdaContext) -> Dict[str, Any]:
    """
    Example event (truncated):

        {
          "url": "https://example.com",
          "user_id": "user123",
          "process_result": {...},
          "pages_attempted": 1,
          "pages_successful": 1,
          "links_enqueued": 42
        }
    """
    logger.info("Received event", input=event)

    url = event.get("url")
    user_id = event.get("userId")
    if not url or not user_id:
        msg = "Missing required parameters: url or userId"
        logger.error(msg, url=url, user_id=user_id)
        return {"status": "error", "message": msg}

    # Handle possibly nested process_result
    outer_pr = event.get("process_result", {}) or {}
    inner_pr = (
        outer_pr["process_result"]
        if isinstance(outer_pr, dict) and "process_result" in outer_pr
        else outer_pr
    )
    logger.info("Process result structure", outer_pr=outer_pr, inner_pr=inner_pr)

    result_status = inner_pr.get("status", "failed")
    db_status = STATUS_MAP.get(result_status, "failed")

    pages_attempted = event.get("pagesAttempted", 0)
    pages_successful = event.get("pagesSuccessful", 0)
    links_enqueued = event.get("linksEnqueued", 0)

    logger.info(
        "Using metrics from event",
        pages_attempted=pages_attempted,
        pages_successful=pages_successful,
        links_enqueued=links_enqueued,
    )

    update_result = update_url_status(
        url=url,
        userId=user_id,
        status=db_status,
        pagesAttempted=pages_attempted,
        pagesSuccessful=pages_successful,
        linksEnqueued=links_enqueued,
    )

    counter = event.get("counter", 0) + 1

    return {
        **event,
        "update_result": update_result,
        "final_status": db_status,
        "counter": counter,
    }
