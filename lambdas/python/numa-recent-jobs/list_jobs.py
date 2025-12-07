import json
import os
from datetime import datetime
from decimal import Decimal

from boto3.dynamodb.conditions import Key

from prm import resource as prm_resource

dynamodb = prm_resource("dynamodb")


class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        elif isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


def handler(event, _context):
    """List jobs for a specific user."""
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }

    try:
        # Parse and validate all parameters
        params = event.get("queryStringParameters", {}) or {}

        try:
            # Required parameters
            user_id = params.get("userId")
            if not user_id:
                raise ValueError("userId is required")

            # Optional parameters with defaults
            limit = min(int(params.get("limit", 50)), 100)
            next_token = params.get("next_token")

            if next_token:
                next_token = json.loads(next_token)

        except (ValueError, json.JSONDecodeError) as e:
            error_msg = str(e) if str(e) != "" else "Invalid request parameters"
            return {
                "statusCode": 400,
                "body": json.dumps({"error": error_msg}),
                "headers": headers,
            }

        # Set up and execute query
        query_kwargs = {
            "IndexName": "user-date-index",
            "KeyConditionExpression": Key("userId").eq(user_id),
            "ScanIndexForward": False,  # Newest first
            "Limit": limit,
        }

        if next_token:
            query_kwargs["ExclusiveStartKey"] = next_token

        response = dynamodb.Table(os.environ["DYNAMODB_TABLE"]).query(**query_kwargs)

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "items": response.get("Items", []),
                    "next_token": (
                        json.dumps(response["LastEvaluatedKey"])
                        if "LastEvaluatedKey" in response
                        else None
                    ),
                },
                cls=DecimalEncoder,
            ),
            "headers": headers,
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)}),
            "headers": headers,
        }
