import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")


def handler(event, _context):
    """Handler for updating a specific job."""
    table = dynamodb.Table(os.environ["DYNAMODB_TABLE"])
    try:
        path_params = event.get("pathParameters", {})
        job_id = path_params.get("job_id")

        if not job_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing job ID parameter"}),
            }

        body = json.loads(event.get("body", "{}"))
        update_expression = []
        expression_values = {}
        expression_names = {}

        for key, value in body.items():
            if key not in ["jobID", "dateTime"]:  # Protect primary keys
                update_expression.append(f"#{key} = :{key}")
                expression_values[f":{key}"] = value
                expression_names[f"#{key}"] = key

        if not update_expression:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "No valid fields to update"}),
            }

        response = table.update_item(
            Key={"jobID": job_id},
            UpdateExpression="SET " + ", ".join(update_expression),
            ExpressionAttributeValues=expression_values,
            ExpressionAttributeNames=expression_names,
            ReturnValues="ALL_NEW",
        )

        return {"statusCode": 200, "body": json.dumps(response.get("Attributes", {}))}
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
