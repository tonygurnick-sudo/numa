"""
List KB Files handler for workspace agent.

Provides lightweight S3 listing of top-level files/folders in knowledge bases.
Used to inject file awareness into system prompts without running full KB searches.

This is an INTERNAL handler (not exposed to LLM) - it's imported by lambda_function.py
and called directly, NOT copied to /workdir/tools/ like the CLI tools.

Security:
- All operations validate kb_id against allowed_kbs list (fail-closed)
- Server-side DynamoDB permission verification via verify_kb_access
- Requires authenticated user context for all KB listing operations
"""

import os
from typing import Any, Dict, List, Union

import structlog

from prm import client as prm_client
from tools.kb_permissions import is_root_kb, verify_kb_access
from tools.response_size import inline_or_spill

logger = structlog.get_logger()

# Environment variables
REGION = os.getenv("AWS_REGION", "us-east-1")
CLIENT_NAME = os.getenv("CLIENT_NAME", "")
DATA_BUCKET_NAME = os.getenv("DATA_BUCKET_NAME", "")

# Constants
MAX_ITEMS_PER_KB = 30  # Limit items shown per KB to keep prompts concise
SYSTEM_KB_IDS = {"company", "numa-support"}
MAX_KB_ID_LENGTH = 128


def _get_s3_kb_id(kb_id: str, user_sub: str = "") -> str:
    """
    Get S3-compatible KB ID (prepend 'kb-' for non-company KBs).

    S3 paths use 'documents/company/' for company KB,
    'documents/kb-{uuid}/' for user KBs, and
    'documents/kb-{user_sub}/' for root files.
    """
    if kb_id in SYSTEM_KB_IDS:
        return kb_id
    # Root KB: kb_id is the user's sub
    if user_sub and is_root_kb(kb_id, user_sub):
        return f"kb-{kb_id}"
    if kb_id.startswith("kb-"):
        return kb_id
    return f"kb-{kb_id}"


def _contains_control_chars(value: str) -> bool:
    """Check whether a string contains ASCII control characters."""
    return any(ord(char) < 32 or ord(char) == 127 for char in value)


def _validate_kb_id(kb_id: Any, field_name: str = "kb_id") -> str:
    """Validate KB IDs before using them in permission checks and S3 prefixes."""
    if not isinstance(kb_id, str):
        raise ValueError(f"{field_name} must be a string")

    normalized = kb_id.strip()
    if not normalized:
        raise ValueError(f"{field_name} cannot be empty")

    if len(normalized) > MAX_KB_ID_LENGTH:
        raise ValueError(f"{field_name} is too long")

    if "/" in normalized or "\\" in normalized or ".." in normalized:
        raise ValueError(f"Invalid {field_name}: path separators are not allowed")

    if _contains_control_chars(normalized):
        raise ValueError(f"Invalid {field_name}: contains control characters")

    return normalized


def _get_s3_prefix(kb_id: str, user_sub: str = "") -> str:
    """Get S3 prefix for a knowledge base."""
    s3_kb_id = _get_s3_kb_id(kb_id, user_sub)
    return f"documents/{s3_kb_id}/"


def _validate_subpath(value: Any) -> str:
    """Validate an optional subfolder path (allows '/' separators, blocks
    traversal and control chars). Returns a normalized path with no leading or
    trailing slashes, or "" when not provided."""
    if value is None or value == "":
        return ""
    if not isinstance(value, str):
        raise ValueError("subpath must be a string")
    normalized = value.strip().strip("/")
    if not normalized:
        return ""
    if ".." in normalized or "\\" in normalized:
        raise ValueError("Invalid subpath: traversal is not allowed")
    if _contains_control_chars(normalized):
        raise ValueError("Invalid subpath: contains control characters")
    return normalized


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


def _list_recursive(bucket: str, prefix: str, max_items: int) -> Dict[str, Any]:
    """
    Recursively list every file under ``prefix`` (a full ``ls -R``-style tree).

    Unlike :func:`_list_top_level`, this walks all depths (no Delimiter) and
    returns each file's path RELATIVE to ``prefix`` in ``name`` (e.g.
    ``"reports/2024/q3.pdf"``) so the caller can render the hierarchy. Every
    intermediate directory is surfaced in ``folders`` too, so empty subfolders
    (zero-byte markers) remain visible.

    Args:
        bucket: S3 bucket name
        prefix: S3 prefix to walk (e.g. "documents/company/" or a sub-path)
        max_items: Cap on files returned (folders are always returned in full)

    Returns:
        Dict with files, folders, total_count, truncated (same shape as
        :func:`_list_top_level`).
    """
    s3_client = prm_client("s3", region=REGION)

    files: List[Dict[str, Any]] = []
    folders: set[str] = set()
    total_count = 0

    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                relpath = key[len(prefix) :]

                # Directory markers (zero-byte, trailing slash) → record the
                # folder so empty subfolders stay visible, then skip.
                if key.endswith("/"):
                    folder = relpath.rstrip("/")
                    if folder:
                        folders.add(folder)
                    continue

                if not relpath or relpath.endswith(".metadata.json"):
                    continue

                # Surface every ancestor directory of this file.
                if "/" in relpath:
                    parent = relpath.rsplit("/", 1)[0]
                    parts = parent.split("/")
                    for i in range(len(parts)):
                        folders.add("/".join(parts[: i + 1]))

                total_count += 1
                if len(files) < max_items:
                    files.append(
                        {
                            "name": relpath,
                            "size": obj["Size"],
                            "size_formatted": _format_size(obj["Size"]),
                        }
                    )

        logger.info(
            "Recursive listing complete",
            bucket=bucket,
            prefix=prefix,
            files_count=len(files),
            folders_count=len(folders),
            total_count=total_count,
            truncated=total_count > max_items,
        )

        return {
            "files": files,
            "folders": sorted(folders),
            "total_count": total_count,
            "truncated": total_count > max_items,
        }

    except Exception as e:
        logger.error(
            "Failed to list recursively",
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


def _spill_listings_response(response: Dict[str, Any]) -> Dict[str, Any]:
    """Return a list_kb_files response inline when it fits, else spill it
    losslessly to S3.

    Each per-KB listing is already capped to ``MAX_ITEMS_PER_KB`` for prompt
    conciseness, so this rarely fires — but with many KBs the aggregate can
    still exceed the 6 MB synchronous Lambda payload cap. We never drop any of
    the listed items here: when the serialized response would overflow, the
    **full** result JSON is written to S3 (the DATA bucket this handler already
    reads from), sha256'd, and returned as the oversized envelope with a
    presigned GET URL. A no-op for responses already under budget.
    """
    return inline_or_spill(
        response,
        s3_client=prm_client("s3", region=REGION),
        bucket=DATA_BUCKET_NAME,
        note=(
            "Full KB listings exceeded the inline response limit; "
            "fetch result_url to get the complete JSON (verify with result_sha256)."
        ),
    )


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
    if not isinstance(kb_ids, list):
        raise ValueError("kb_ids must be a list")

    if not isinstance(user_sub, str) or not user_sub.strip():
        raise ValueError("Access denied: User identity required for KB operations")
    user_sub = user_sub.strip()

    if not DATA_BUCKET_NAME:
        raise ValueError("DATA_BUCKET_NAME not configured")

    # Optional listing controls. Defaults reproduce the original top-level,
    # 30-item behaviour used to inject prompt context; the CLI `show` command
    # opts into deeper / fuller listings via these params.
    recursive = bool(params.get("recursive", False))
    subpath = _validate_subpath(params.get("subpath"))
    try:
        max_items = int(params.get("max_items", MAX_ITEMS_PER_KB))
    except (TypeError, ValueError):
        max_items = MAX_ITEMS_PER_KB
    max_items = max(1, max_items)

    logger.info(
        "Listing files for knowledge bases",
        kb_ids=kb_ids,
        user_sub=user_sub[:8] + "..." if user_sub else "",
    )

    listings: Dict[str, Dict[str, Any]] = {}
    errors: List[Dict[str, str]] = []

    for raw_kb_id in kb_ids:
        try:
            kb_id = _validate_kb_id(raw_kb_id, "kb_id")

            # Server-side permission verification
            if not verify_kb_access(user_sub, kb_id):
                logger.warning(
                    "KB access denied for listing",
                    user_sub=user_sub[:8] + "...",
                    kb_id=kb_id,
                )
                errors.append({"kb_id": kb_id, "error": "Access denied"})
                continue

            # Get S3 prefix and list contents. A subpath drills into a
            # subfolder; recursive walks the whole tree.
            prefix = _get_s3_prefix(kb_id, user_sub)
            if subpath:
                prefix = f"{prefix}{subpath}/"
            if recursive:
                listing = _list_recursive(DATA_BUCKET_NAME, prefix, max_items)
            else:
                listing = _list_top_level(DATA_BUCKET_NAME, prefix, max_items)

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

    return _spill_listings_response(
        {
            "listings": listings,
            "kb_count": len(listings),
            "errors": errors,
        }
    )
