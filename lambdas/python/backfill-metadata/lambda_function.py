"""Backfill metadata for existing files in default KB.

This Lambda iterates through existing files in documents/company/ and creates
.metadata.json sidecar files for those that don't have them yet.

This enables existing files to work with the new metadata filtering system.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

import boto3
import structlog
from botocore.exceptions import ClientError

logger = structlog.get_logger()

# Initialize AWS clients
s3 = boto3.client("s3")


def handler(event, context):
    """
    Backfill metadata for existing files in default KB.

    Iterates through documents/company/ prefix and creates .metadata.json
    sidecar files for any files that don't have them.
    """
    try:
        # Explicitly mark Lambda parameters as unused in this handler
        del event, context
        bucket_name = os.environ.get("BUCKET_NAME", "")
        client_name = os.environ.get("CLIENT_NAME", "")

        if not bucket_name or not client_name:
            raise ValueError("BUCKET_NAME and CLIENT_NAME must be set")

        prefix = "documents/"

        logger.info(
            "Starting metadata backfill",
            bucket=bucket_name,
            prefix=prefix,
            client_name=client_name,
        )

        # List all objects in the company KB prefix
        paginator = s3.get_paginator("list_objects_v2")
        pages = paginator.paginate(Bucket=bucket_name, Prefix=prefix)

        files_processed = 0
        metadata_created = 0
        metadata_skipped = 0

        for page in pages:
            contents_any: Any = (
                page.get("Contents") if isinstance(page, Mapping) else None
            )
            if not contents_any:
                continue

            for obj in contents_any:
                # Each object is a mapping with optional 'Key'
                key_val: Optional[str] = None
                if isinstance(obj, Mapping):
                    maybe_key = obj.get("Key")
                    if isinstance(maybe_key, str):
                        key_val = maybe_key
                if not key_val:
                    # Skip entries without a concrete key
                    continue
                key = key_val
                files_processed += 1

                # Skip directories and existing metadata files
                if key.endswith("/") or key.endswith(".metadata.json"):
                    continue

                # Check if metadata file already exists
                metadata_key = f"{key}.metadata.json"
                try:
                    s3.head_object(Bucket=bucket_name, Key=metadata_key)
                    # Metadata exists, skip
                    metadata_skipped += 1
                    logger.debug("Metadata exists, skipping", file=key)
                    continue
                except ClientError as e:
                    # Safely extract error code from ClientError response
                    error_code: Optional[str] = None
                    resp: Any = getattr(e, "response", None)
                    if isinstance(resp, dict):
                        err_info = resp.get("Error")
                        if isinstance(err_info, dict):
                            code_val = err_info.get("Code")
                            if isinstance(code_val, str):
                                error_code = code_val
                    if error_code != "404":
                        # Unexpected error, log and continue
                        logger.warning(
                            "Error checking metadata", file=key, error=str(e)
                        )
                        continue
                    # Metadata doesn't exist, create it

                # Get file last modified date for uploaded_at
                last_modified_any: Any = (
                    obj.get("LastModified") if isinstance(obj, Mapping) else None
                )
                if isinstance(last_modified_any, datetime):
                    uploaded_at = last_modified_any.isoformat()
                else:
                    uploaded_at = datetime.now(timezone.utc).isoformat()

                # Create metadata payload compatible with S3 Vectors filterable attributes
                path_parts = key.split("/")
                kb_id = "company"
                uploader_id = "system"

                if len(path_parts) > 1:
                    top_level = path_parts[1]
                    if top_level.startswith("kb-") and len(top_level) > 3:
                        kb_id = top_level[len("kb-") :]
                    elif top_level:
                        kb_id = top_level

                if len(path_parts) > 2 and path_parts[2]:
                    uploader_id = path_parts[2]

                metadata_attributes = {
                    "tenant_id": client_name,
                    "kb_id": kb_id,
                    "uploader_id": uploader_id,
                    "uploaded_at": uploaded_at,
                    "backfilled": "true",
                }

                # Write metadata file
                try:
                    s3.put_object(
                        Bucket=bucket_name,
                        Key=metadata_key,
                        Body=json.dumps(
                            {"metadataAttributes": metadata_attributes}, indent=2
                        ),
                        ContentType="application/json",
                    )
                    metadata_created += 1
                    logger.info("Created metadata", file=key, metadata_key=metadata_key)
                except ClientError as e:
                    logger.error(
                        "Failed to create metadata",
                        file=key,
                        error=str(e),
                        exc_info=True,
                    )

        logger.info(
            "Metadata backfill completed",
            files_processed=files_processed,
            metadata_created=metadata_created,
            metadata_skipped=metadata_skipped,
        )

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "status": "success",
                    "files_processed": files_processed,
                    "metadata_created": metadata_created,
                    "metadata_skipped": metadata_skipped,
                }
            ),
        }

    except (ValueError, ClientError) as e:
        logger.error("Metadata backfill failed", error=str(e), exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps(
                {
                    "status": "error",
                    "message": f"Metadata backfill failed: {str(e)}",
                }
            ),
        }
