import json
import os
from datetime import datetime

try:  # Python < 3.11 compatibility
    from datetime import UTC  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - legacy runtimes
    from datetime import timezone

    UTC = timezone.utc
from uuid import uuid4

import boto3

dynamodb = boto3.resource("dynamodb")


def handler(event, _context):
    """Handler for creating a new job."""
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])

    # Common headers for CORS
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
    }

    try:
        # Parse request body
        body = json.loads(event.get("body", "{}"))

        # Get user_id from body
        user_id = body.get("userId")

        # Validate required fields
        if not user_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "userId is required"}),
                "headers": headers,
            }

        # Use provided jobId if available otherwise generate new
        job_id = body.get("jobId", str(uuid4()))
        timestamp = datetime.now(UTC).isoformat()

        # Normalise job name (fallback to timestamp-based label)
        raw_name = body.get("name", "")
        if isinstance(raw_name, str):
            normalized_name = raw_name.strip()
        else:
            normalized_name = ""

        if not normalized_name:
            normalized_name = f"Run {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}"

        body["name"] = normalized_name

        # Create the item with required fields, including all fields from the request body
        item = {
            "jobId": job_id,
            "userId": user_id,
            "dateTime": timestamp,
            "createdAt": timestamp,
            **body,  # Include all fields from the request body
        }

        # Save to DynamoDB
        table.put_item(Item=item)

        return {"statusCode": 201, "body": json.dumps(item), "headers": headers}

    except json.JSONDecodeError:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "Invalid JSON in request body"}),
            "headers": headers,
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)}),
            "headers": headers,
        }
