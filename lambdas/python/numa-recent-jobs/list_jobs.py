import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")


def handler(_event, _context):
    """Handler for listing jobs for an app."""
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    try:
        # Query using the date-time-index for most recent jobs first
        response = table.scan(IndexName="date-time-index")

        return {"statusCode": 200, "body": json.dumps(response["Items"])}

    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
