"""
List KB Files handler for workspace agent.

Provides lightweight S3 listing of top-level files/folders in knowledge bases.
Used to inject file awareness into system prompts without running full KB searches.

This is an INTERNAL handler (not exposed to LLM) - it's imported by lambda_function.py
and called directly, NOT copied to /workdir/tools/ like the CLI tools.

Security:
- All operations validate kb_id against allowed_kbs list (fail-closed)
- Server-side DynamoDB permission verification via verify_kb_access
"""

import os
from typing import Any, Dict, List, Union

import structlog

from prm import client as prm_client
from tools.kb_permissions import verify_kb_access

logger = structlog.get_logger()

# Environment variables
REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")

# Constants
MAX_ITEMS_PER_KB = 30  # Limit items shown per KB to keep prompts concise
SYSTEM_KB_IDS = {"company", "numa-support"}


def _get_s3_kb_id(kb_id: str) -> str:
    """
    Get S3-compatible KB ID (prepend 'kb-' for non-company KBs).

    S3 paths use 'documents/company/' for company KB
    and 'documents/kb-{uuid}/' for user KBs.
    """
    if kb_id in SYSTEM_KB_IDS:
        return kb_id
    if kb_id.startswith("kb-"):
        return kb_id
    return f"kb-{kb_id}"


def _get_s3_prefix(kb_id: str) -> str:
    """Get S3 prefix for a knowledge base."""
    s3_kb_id = _get_s3_kb_id(kb_id)
    return f"documents/{s3_kb_id}/"


def _format_size(size_bytes: Union[int, float]) -> str:
    """Format file size in human-readable format."""
    size = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def _list_top_level(
    bucket: str, prefix: str, max_items: int = MAX_ITEMS_PER_KB
) -> Dict[str, Any]:
    """
    List top-level files and folders in an S3 prefix using delimiter.

    Uses Delimiter='/' for efficient top-level-only listing (no recursive scan).

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix (e.g., "documents/company/")
        max_items: Maximum items to return

    Returns:
        Dict with:
            - files: List of {name, size, size_formatted}
            - folders: List of folder names
            - total_count: Total items found (before limiting)
            - truncated: Whether results were truncated
    """
    s3_client = prm_client("s3", region=REGION)

    files: List[Dict[str, Any]] = []
    folders: List[str] = []
    total_count = 0

    try:
        # Use delimiter for efficient top-level listing
        paginator = s3_client.get_paginator("list_objects_v2")

        for page in paginator.paginate(Bucket=bucket, Prefix=prefix, Delimiter="/"):
            # Get folders (CommonPrefixes)
            for common_prefix in page.get("CommonPrefixes", []):
                folder_path = common_prefix.get("Prefix", "")
                # Extract folder name from prefix
                # e.g., "documents/company/HR Policies/" -> "HR Policies"
                if folder_path.endswith("/"):
                    folder_path = folder_path[:-1]
                folder_name = folder_path.split("/")[-1]
                if folder_name:
                    total_count += 1
                    if len(folders) + len(files) < max_items:
                        folders.append(folder_name)

            # Get files (Contents at this level only)
            for obj in page.get("Contents", []):
                key = obj["Key"]
                # Skip the prefix itself (directory marker)
                if key == prefix:
                    continue

                filename = key[len(prefix) :]  # Remove prefix to get relative path

                # Skip if this is a nested file (has / in relative path)
                if "/" in filename:
                    continue

                # Skip metadata sidecar files
                if filename.endswith(".metadata.json"):
                    continue

                # Skip empty filenames
                if not filename:
                    continue

                total_count += 1
                if len(folders) + len(files) < max_items:
                    files.append(
                        {
                            "name": filename,
                            "size": obj["Size"],
                            "size_formatted": _format_size(obj["Size"]),
                        }
                    )

        logger.info(
            "Top-level listing complete",
            bucket=bucket,
            prefix=prefix,
            files_count=len(files),
            folders_count=len(folders),
            total_count=total_count,
            truncated=total_count > max_items,
        )

        return {
            "files": files,
            "folders": folders,
            "total_count": total_count,
            "truncated": total_count > max_items,
        }

    except Exception as e:
        logger.error(
            "Failed to list top-level contents",
            bucket=bucket,
            prefix=prefix,
            error=str(e),
            exc_info=True,
        )
        return {
            "files": [],
            "folders": [],
            "total_count": 0,
            "truncated": False,
            "error": str(e),
        }


def handle_list_kb_files(params: Dict[str, Any]) -> Dict[str, Any]:
    """
    List top-level files and folders for all allowed knowledge bases.

    This is an internal handler called by the workspace agent to populate
    system prompt context. It lists all KBs in a single invocation for efficiency.

    Parameters:
        kb_ids (list[str], required): List of KB IDs to list (e.g., ["company", "uuid-123"])
        __user_sub (str, internal): User's Cognito sub for server-side permission verification

    Returns:
        Dict with:
            - listings: Dict mapping kb_id -> {files, folders, total_count, truncated}
            - kb_count: Number of KBs processed
            - errors: List of any errors encountered

    Example response:
        {
            "listings": {
                "company": {
                    "files": [{"name": "policy.pdf", "size": 1234567, "size_formatted": "1.2 MB"}],
                    "folders": ["HR Policies", "Engineering"],
                    "total_count": 156,
                    "truncated": true
                },
                "kb-abc123": {
                    "files": [...],
                    "folders": [...],
                    "total_count": 8,
                    "truncated": false
                }
            },
            "kb_count": 2,
            "errors": []
        }
    """
    kb_ids = params.get("kb_ids", [])
    user_sub = params.get("__user_sub", "")

    if not kb_ids:
        raise ValueError("Missing required parameter: kb_ids")

    if not DATA_BUCKET_NAME:
        raise ValueError("DATA_BUCKET_NAME not configured")

    logger.info(
        "Listing files for knowledge bases",
        kb_ids=kb_ids,
        user_sub=user_sub[:8] + "..." if user_sub else "",
    )

    listings: Dict[str, Dict[str, Any]] = {}
    errors: List[Dict[str, str]] = []

    for kb_id in kb_ids:
        try:
            # Server-side permission verification
            if user_sub and not verify_kb_access(user_sub, kb_id):
                logger.warning(
                    "KB access denied for listing",
                    user_sub=user_sub[:8] + "...",
                    kb_id=kb_id,
                )
                errors.append({"kb_id": kb_id, "error": "Access denied"})
                continue

            # Get S3 prefix and list top-level contents
            prefix = _get_s3_prefix(kb_id)
            listing = _list_top_level(DATA_BUCKET_NAME, prefix)

            if "error" in listing:
                errors.append({"kb_id": kb_id, "error": listing["error"]})
            else:
                listings[kb_id] = listing

        except Exception as e:
            logger.error(
                "Failed to list KB files",
                kb_id=kb_id,
                error=str(e),
                exc_info=True,
            )
            errors.append({"kb_id": kb_id, "error": str(e)})

    logger.info(
        "KB file listings complete",
        kb_count=len(listings),
        error_count=len(errors),
        total_files=sum(len(l.get("files", [])) for l in listings.values()),
        total_folders=sum(len(l.get("folders", [])) for l in listings.values()),
    )

    return {
        "listings": listings,
        "kb_count": len(listings),
        "errors": errors,
    }
