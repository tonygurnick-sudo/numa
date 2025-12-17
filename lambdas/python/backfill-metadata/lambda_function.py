"""Backfill metadata for existing files in knowledge bases.

This Lambda iterates through existing files in documents/ and either creates
or deletes .metadata.json sidecar files based on the preferred knowledge base:

- For Q Business clients (PREFERRED_KNOWLEDGE_BASE=q):
  - Deletes metadata files under documents/company/ (Q doesn't use them)
  - Creates metadata files under documents/kb-{id}/ (user KBs use Bedrock)

- For Bedrock clients (PREFERRED_KNOWLEDGE_BASE=bedrock):
  - Creates metadata files for all prefixes

This enables proper metadata filtering for Bedrock KB while avoiding issues
with Q Business which doesn't use metadata sidecars.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

import structlog
from botocore.exceptions import ClientError

from prm import client as prm_client

logger = structlog.get_logger()

# Initialize AWS clients
s3 = prm_client("s3")


def _is_company_prefix(key: str) -> bool:
    """Check if a key is under the company KB prefix (documents/company/)."""
    parts = key.split("/")
    return len(parts) > 1 and parts[1] == "company"


def _delete_company_metadata(bucket_name: str) -> dict:
    """Delete all .metadata.json files under documents/company/ prefix.

    Used for Q Business clients where metadata sidecars cause issues.
    Returns stats about deleted files.
    """
    paginator = s3.get_paginator("list_objects_v2")
    pages = paginator.paginate(Bucket=bucket_name, Prefix="documents/company/")

    metadata_deleted = 0
    errors = 0

    for page in pages:
        contents = page.get("Contents") if isinstance(page, Mapping) else None
        if not contents:
            continue

        for obj in contents:
            key = obj.get("Key") if isinstance(obj, Mapping) else None
            if not key or not isinstance(key, str):
                continue

            # Only delete .metadata.json files
            if not key.endswith(".metadata.json"):
                continue

            try:
                s3.delete_object(Bucket=bucket_name, Key=key)
                metadata_deleted += 1
                logger.info("Deleted metadata sidecar", key=key)
            except ClientError as e:
                logger.error("Failed to delete metadata", key=key, error=str(e))
                errors += 1

    return {"metadata_deleted": metadata_deleted, "errors": errors}


def handler(event, context):
    """
    Backfill or cleanup metadata for existing files.

    For Q Business clients: Deletes metadata under documents/company/ and
    creates metadata under documents/kb-{id}/.

    For Bedrock clients: Creates metadata for all files that don't have it.
    """
    try:
        # Explicitly mark Lambda parameters as unused in this handler
        del event, context
        bucket_name = os.environ.get("BUCKET_NAME", "")
        client_name = os.environ.get("CLIENT_NAME", "")
        preferred_kb = os.environ.get("PREFERRED_KNOWLEDGE_BASE", "bedrock")

        if not bucket_name or not client_name:
            raise ValueError("BUCKET_NAME and CLIENT_NAME must be set")

        prefix = "documents/"

        logger.info(
            "Starting metadata backfill",
            bucket=bucket_name,
            prefix=prefix,
            client_name=client_name,
            preferred_knowledge_base=preferred_kb,
        )

        # For Q Business clients, first delete metadata under documents/company/
        metadata_deleted = 0
        if preferred_kb == "q":
            logger.info(
                "Q Business detected - deleting metadata under documents/company/"
            )
            delete_stats = _delete_company_metadata(bucket_name)
            metadata_deleted = delete_stats["metadata_deleted"]
            logger.info(
                "Deleted company metadata sidecars",
                metadata_deleted=metadata_deleted,
                errors=delete_stats["errors"],
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

                # For Q Business clients, skip creating metadata for company KB
                # (we already deleted existing ones above)
                if preferred_kb == "q" and _is_company_prefix(key):
                    logger.debug("Skipping company file for Q Business", file=key)
                    metadata_skipped += 1
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
            metadata_deleted=metadata_deleted,
            preferred_knowledge_base=preferred_kb,
        )

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "status": "success",
                    "files_processed": files_processed,
                    "metadata_created": metadata_created,
                    "metadata_skipped": metadata_skipped,
                    "metadata_deleted": metadata_deleted,
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
