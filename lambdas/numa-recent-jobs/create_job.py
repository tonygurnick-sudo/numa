import json
import os
from datetime import UTC, datetime
from uuid import uuid4

import boto3

dynamodb = boto3.resource("dynamodb")


def handler(event, _context):
    """Handler for creating a new job."""
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    try:
        body = json.loads(event.get("body", "{}"))
        job_id = str(uuid4())
        timestamp = datetime.now(UTC).isoformat()

        item = {"jobID": job_id, "dateTime": timestamp, **body}

        table.put_item(Item=item)

        return {"statusCode": 200, "body": json.dumps(item)}
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
