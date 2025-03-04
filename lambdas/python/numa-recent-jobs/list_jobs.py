import json
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3

dynamodb = boto3.resource("dynamodb")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        elif isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


def handler(event, _context):
    """Handler for listing jobs for an app.
    Returns paginated jobs sorted by dateTime in descending order (newest first).
    """
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    try:
        # Parse pagination parameters
        query_params = event.get("queryStringParameters", {}) or {}
        limit = min(int(query_params.get("limit", 50)), 100)
        next_token = query_params.get("next_token")

        # Base scan parameters
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        scan_params = {
            "IndexName": "date-time-index",
            "FilterExpression": "#dt >= :yesterday",
            "ExpressionAttributeNames": {"#dt": "dateTime"},
            "ExpressionAttributeValues": {":yesterday": yesterday},
            "Limit": limit,
        }

        # Add pagination token if provided
        if next_token:
            try:
                scan_params["ExclusiveStartKey"] = json.loads(next_token)
            except (json.JSONDecodeError, TypeError):
                return {
                    "statusCode": 400,
                    "body": json.dumps({"error": "Invalid pagination token"}),
                }

        # Execute scan
        response = table.scan(**scan_params)

        # Sort items by dateTime in descending order
        items = sorted(response["Items"], key=lambda x: x["dateTime"], reverse=True)

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "items": items,
                    "count": len(items),
                    "next_token": json.dumps(response.get("LastEvaluatedKey")),
                },
                cls=DecimalEncoder,
            ),
        }

    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
