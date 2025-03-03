import json
import os
from datetime import datetime, timezone
from typing import Any, Dict

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """Handler for listing jobs for an app.

    Returns paginated jobs sorted by dateTime in descending order (newest first).
    Uses DynamoDB Query for efficient pagination.

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
        limit = min(int(query_params.get("limit", 50)), 100)  # Max 100 items per page
        next_token = query_params.get("next_token")

        # Get current time in UTC
        current_time = datetime.now(timezone.utc)

        # Base query parameters
        query_params = {
            "IndexName": "date-time-index",
            # Get jobs within last 24 hours for efficiency
            "KeyConditionExpression": Key("dateTime").gte(
                (current_time - timedelta(days=1)).isoformat()
            ),
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

        return {"statusCode": 200, "body": json.dumps(response["Items"])}

    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
