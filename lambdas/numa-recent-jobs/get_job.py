import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")


def handler(event, _context):
    """Handler for getting a specific job."""
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    try:
        path_params = event.get("pathParameters", {})
        job_id = path_params.get("job_id")

        if not job_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing job ID parameter"}),
            }

        response = table.get_item(Key={"jobID": job_id})

        item = response.get("Item")
        if not item:
            return {"statusCode": 404, "body": json.dumps({"error": "Job not found"})}

        return {"statusCode": 200, "body": json.dumps(item)}
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
