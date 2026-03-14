"""Shared transcription client for Python callers.

Provides direct DynamoDB + SQS writes for submitting transcription jobs
and checking status, avoiding HTTP overhead for internal callers.
"""

import json
import time
import uuid
from typing import Any

import boto3


def submit_transcription(
    *,
    file_bucket: str,
    file_key: str,
    file_name: str,
    file_size: int,
    user_sub: str,
    client_name: str,
    table_name: str,
    queue_url: str,
    region: str = "us-east-1",
) -> dict[str, Any]:
    """Submit a transcription job directly via DynamoDB + SQS.

    Returns {"job_id": "JOB#...", "status": "QUEUED"}.
    """
    import os

    dynamodb = boto3.resource("dynamodb", region_name=region)
    sqs = boto3.client("sqs", region_name=region)
    table = dynamodb.Table(table_name)

    now = int(time.time() * 1000)
    job_id = f"JOB#{time.strftime('%Y-%m-%dT%H:%M:%S')}#{uuid.uuid4().hex[:8]}"
    file_ext = os.path.splitext(file_key.lower())[1]
    ttl = int(time.time()) + (90 * 24 * 60 * 60)  # 90 days

    item = {
        "userSub": user_sub,
        "jobId": job_id,
        "fileName": file_name,
        "fileKey": file_key,
        "fileSize": file_size,
        "fileExtension": file_ext,
        "status": "QUEUED",
        "clientName": client_name,
        "createdAt": now,
        "updatedAt": now,
        "expiresAt": ttl,
    }

    table.put_item(Item=item)

    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps(
            {
                "jobId": job_id,
                "userSub": user_sub,
                "fileName": file_name,
                "fileKey": file_key,
                "fileExtension": file_ext,
                "fileSize": file_size,
                "dataBucket": file_bucket,
                "clientName": client_name,
            }
        ),
    )

    return {"job_id": job_id, "status": "QUEUED"}


def get_transcription_status(
    *,
    user_sub: str,
    job_id: str,
    table_name: str,
    region: str = "us-east-1",
) -> dict[str, Any] | None:
    """Get the current status of a transcription job.

    Returns the full job item dict, or None if not found.
    """
    dynamodb = boto3.resource("dynamodb", region_name=region)
    table = dynamodb.Table(table_name)

    resp = table.get_item(Key={"userSub": user_sub, "jobId": job_id})
    return resp.get("Item")
