import logging
import os
from typing import Optional

import boto3
import structlog

logger = structlog.get_logger()

s3_client = boto3.client("s3")


def read(key: str, bucket: Optional[str] = None) -> bytes:
    bucket_name = bucket or os.environ["BUCKET"]
    logger.info(f"Read: bucket={bucket_name}, key={key}")
    try:
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
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
    bucket: Optional[str] = None,
) -> None:
    bucket_name = bucket or os.environ["BUCKET"]
    logger.info(f"Write: bucket={bucket_name}, key={key}")
    try:
        s3_client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=content,
            ContentType=content_type,
        )
        logger.debug("Write successful")
    except Exception:
        logger.exception("Error writing to S3")
        raise


def list_objects(prefix: str = "", bucket: Optional[str] = None) -> list[str]:
    bucket_name = bucket or os.environ["BUCKET"]
    logger.info(f"Listing objects in bucket={bucket_name} with prefix={prefix}")
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        keys = []
        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            if "Contents" in page:
                for obj in page["Contents"]:
                    keys.append(obj["Key"])
        logger.debug("List objects successful", keys=keys)
        return keys
    except Exception:
        logger.exception("Error listing objects in S3")
        raise
