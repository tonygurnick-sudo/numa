import logging
import os

import boto3
import structlog

logger = structlog.get_logger()

s3_client = boto3.client("s3")


def read(key) -> bytes:
    bucket = os.environ["BUCKET"]
    logger.info(f"Read: bucket={bucket}, key={key}")
    try:
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read()
        logger.debug("Read successful")
        return content
    except Exception:
        logger.exception("Error reading from S3")
        raise


def write(
    key: str,
    content: bytes,
    content_type: str = "text/plain",
) -> None:
    bucket = os.environ["BUCKET"]
    logger.info(f"Write: bucket={bucket}, key={key}")
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
        )
        logger.debug("Write successful")
    except Exception:
        logger.exception("Error writing to S3")
        raise


def list_objects(prefix: str = "") -> list[str]:
    bucket = os.environ["BUCKET"]
    logger.info(f"Listing objects in bucket={bucket} with prefix={prefix}")
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        keys = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            if "Contents" in page:
                for obj in page["Contents"]:
                    keys.append(obj["Key"])
        logger.debug("List objects successful", keys=keys)
        return keys
    except Exception:
        logger.exception("Error listing objects in S3")
        raise
