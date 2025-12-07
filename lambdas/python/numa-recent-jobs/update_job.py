import json
import os
from datetime import datetime

try:  # Python < 3.11 compatibility
    from datetime import UTC  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - legacy runtimes
    from datetime import timezone

    UTC = timezone.utc

from prm import resource as prm_resource

dynamodb = prm_resource("dynamodb")


def handler(event, _context):
    """Handler for updating a specific job."""
    # Common headers for CORS
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "PUT,OPTIONS",
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

        body = json.loads(event.get("body", "{}"))
        update_expression = []
        expression_values = {}
        expression_names = {}

        for key, value in body.items():
            if key not in ["jobId", "dateTime"]:  # Protect primary keys
                expression_names[f"#{key}"] = key

                if key == "name":
                    if isinstance(value, str):
                        value = value.strip()
                    else:
                        value = ""
                    if not value:
                        value = f"Run {datetime.now(UTC).strftime('%Y-%m-%d %H:%M')}"

                update_expression.append(f"#{key} = :{key}")
                expression_values[f":{key}"] = value

        if not update_expression:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "No valid fields to update"}),
                "headers": headers,
            }

        response = table.update_item(
            Key={"jobId": job_id},
            UpdateExpression="SET " + ", ".join(update_expression),
            ExpressionAttributeValues=expression_values,
            ExpressionAttributeNames=expression_names,
            ReturnValues="ALL_NEW",
        )

        return {
            "statusCode": 200,
            "body": json.dumps(response.get("Attributes", {})),
            "headers": headers,
        }
    except Exception as e:
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
