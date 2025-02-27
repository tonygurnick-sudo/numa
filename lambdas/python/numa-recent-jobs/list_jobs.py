import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import boto3
from boto3.dynamodb.conditions import Attr, Key

dynamodb = boto3.resource("dynamodb")


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """Handler for listing jobs for an app.

    Returns paginated jobs except those that are:
    1. In 'running' status AND
    2. Started more than 30 minutes ago

    These are likely stale jobs where the user navigated away or the job failed.
    Uses DynamoDB Query with filter expression for efficiency.

    Query Parameters:
    - limit: Optional[int] - Number of items per page (default: 10, max: 50)
    - next_token: Optional[str] - Token for next page of results

    Returns:
    - items: List of job items
    - next_token: Token for next page (if more results exist)
    """
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    try:
        # Parse pagination parameters
        query_params = event.get("queryStringParameters", {})
        limit = min(int(query_params.get("limit", 10)), 50)  # Max 50 items per page
        next_token = query_params.get("next_token")

        # Get current time in UTC and calculate cutoff
        current_time = datetime.now(timezone.utc)
        cutoff_time = (current_time - timedelta(minutes=30)).isoformat()

        # Base query parameters
        query_params = {
            "IndexName": "date-time-index",
            # Use KeyConditionExpression to get jobs within last 24 hours for efficiency
            "KeyConditionExpression": Key("dateTime").gte(
                (current_time - timedelta(days=1)).isoformat()
            ),
            # Use FilterExpression to exclude stale running jobs
            "FilterExpression": Attr("status").ne("running")
            | Attr("startedAt").gte(cutoff_time),
            # Sort in descending order (newest first)
            "ScanIndexForward": False,
            "Limit": limit,
        }

        # Add pagination token if provided
        if next_token:
            try:
                query_params["ExclusiveStartKey"] = json.loads(next_token)
            except (json.JSONDecodeError, TypeError):
                return {
                    "statusCode": 400,
                    "body": json.dumps({"error": "Invalid pagination token"}),
                }

        # Execute query
        response = table.query(**query_params)

        # Prepare response
        result = {"items": response["Items"], "count": len(response["Items"])}

        # Add next_token if there are more results
        if "LastEvaluatedKey" in response:
            result["next_token"] = json.dumps(response["LastEvaluatedKey"])

        return {"statusCode": 200, "body": json.dumps(result)}

    except ValueError as ve:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": f"Invalid parameter: {str(ve)}"}),
        }
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
