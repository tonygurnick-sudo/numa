import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")


def handler(event, _context):
    """Handler for getting a specific job."""
    # Common headers for CORS
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
    }

    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    try:
        path_params = event.get("pathParameters", {})
        job_id = path_params.get("jobId")

        if not job_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing job ID parameter"}),
                "headers": headers,
            }

        response = table.get_item(Key={"jobId": job_id})

        item = response.get("Item")
        if not item:
            return {
                "statusCode": 404,
                "body": json.dumps({"error": "Job not found"}),
                "headers": headers,
            }

        return {
            "statusCode": 200,
            "body": json.dumps(item),
            "headers": headers,
        }
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
