"""
S3-based workspace persistence for AgentCore.

Syncs workspace files to/from S3 for persistence across per-conversation sessions.
- chat-workflows/ is globally persistent (syncs to user's root S3 path) [currently disabled]
- uploads/, session/, root files, and trace sync to conversation-specific S3 path

S3 Structure:
    {bucket}/numa-chat/workspace/{user_sub}/
    ├── chat-workflows/                # GLOBAL - persists across all conversations
    └── conversations/{conv_id}/       # Per-conversation
        ├── uploads/
        ├── session/
        ├── (root files)
        └── _system/
            └── trace.jsonl
"""

import hashlib
import os
from pathlib import Path
from typing import TypedDict

import boto3
import structlog
from botocore.exceptions import ClientError

from .sdk_config import LOCAL_ROOT
from .workspace import get_workspace_paths

logger = structlog.get_logger()

# S3 configuration
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")
S3_PREFIX = "numa-chat/workspace"


class FileChecksum(TypedDict):
    """File with its checksum for change detection."""

    path: str
    checksum: str
    size: int
    mtime: float


class SyncResult(TypedDict):
    """Result of a sync operation."""

    files_downloaded: int
    files_uploaded: int
    errors: list[str]


def _get_s3_client():
    """Get S3 client."""
    return boto3.client("s3")


def _compute_file_checksum(file_path: Path) -> str:
    """Compute MD5 checksum of a file for change detection."""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def _get_s3_path_for_file(rel_path: str, conversation_id: str, user_sub: str) -> str:
    """
    Determine the S3 path for a local file.

    Args:
        rel_path: Path relative to workspace root (e.g., "chat-workflows/file.py")
        conversation_id: Current conversation ID
        user_sub: User's Cognito sub

    Returns:
        Full S3 key for the file
    """
    # chat-workflows/ is globally persistent
    if rel_path.startswith("chat-workflows/"):
        return f"{S3_PREFIX}/{user_sub}/{rel_path}"

    # Trace file goes to _system/ in conversation path
    if rel_path == "_system/trace.jsonl":
        return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/_system/trace.jsonl"

    # Everything else (uploads, session, root files) goes to conversation path
    return f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/{rel_path}"


def _get_local_path_for_rel(rel_path: str, paths: dict) -> Path:
    """
    Get the local filesystem path for a relative path.

    Args:
        rel_path: Path relative to workspace root
        paths: WorkspacePaths dict

    Returns:
        Absolute local path
    """
    if rel_path == "_system/trace.jsonl":
        return paths["trace_file"]
    return paths["root"] / rel_path


def get_local_checksums(conversation_id: str) -> dict[str, FileChecksum]:
    """
    Get checksums of all files that need syncing.

    Scans:
    - /chat-workflows/* (globally persistent)
    - /uploads/* (conversation)
    - /session/* (conversation)
    - /* root-level files (conversation)
    - /.system/trace.jsonl (conversation)

    Args:
        conversation_id: Current conversation ID (for S3 path mapping)

    Returns:
        Dict mapping relative path to FileChecksum
    """
    paths = get_workspace_paths()
    checksums: dict[str, FileChecksum] = {}
    root = paths["root"]

    # Protected directories that should not be synced as root files
    # tools/ is baked into container image - never sync to S3
    protected_dirs = {".system", "chat-workflows", "uploads", "session", "tools"}

    # DISABLED: chat-workflows feature temporarily disabled
    # Scan chat-workflows (globally persistent)
    # workflows_dir = paths["workflows"]
    # if workflows_dir.exists():
    #     for file_path in workflows_dir.rglob("*"):
    #         if not file_path.is_file():
    #             continue
    #         try:
    #             rel_path = str(file_path.relative_to(root))
    #             checksums[rel_path] = FileChecksum(
    #                 path=rel_path,
    #                 checksum=_compute_file_checksum(file_path),
    #                 size=file_path.stat().st_size,
    #                 mtime=file_path.stat().st_mtime,
    #             )
    #         except (OSError, IOError) as e:
    #             logger.warning(
    #                 "Failed to checksum file", path=str(file_path), error=str(e)
    #             )

    # Scan uploads and session (per-conversation)
    for dir_key in ["uploads", "session"]:
        scan_dir = paths[dir_key]
        if not scan_dir.exists():
            continue
        for file_path in scan_dir.rglob("*"):
            if not file_path.is_file():
                continue
            try:
                rel_path = str(file_path.relative_to(root))
                checksums[rel_path] = FileChecksum(
                    path=rel_path,
                    checksum=_compute_file_checksum(file_path),
                    size=file_path.stat().st_size,
                    mtime=file_path.stat().st_mtime,
                )
            except (OSError, IOError) as e:
                logger.warning(
                    "Failed to checksum file", path=str(file_path), error=str(e)
                )

    # Scan root-level files (per-conversation)
    try:
        for item in root.iterdir():
            if item.name in protected_dirs:
                continue
            # Skip hidden files
            if item.name.startswith("."):
                continue
            if item.is_file():
                try:
                    rel_path = item.name  # Just the filename at root
                    checksums[rel_path] = FileChecksum(
                        path=rel_path,
                        checksum=_compute_file_checksum(item),
                        size=item.stat().st_size,
                        mtime=item.stat().st_mtime,
                    )
                except (OSError, IOError) as e:
                    logger.warning(
                        "Failed to checksum file", path=str(item), error=str(e)
                    )
            elif item.is_dir():
                # Non-protected directories created by AI
                for file_path in item.rglob("*"):
                    if not file_path.is_file():
                        continue
                    try:
                        rel_path = str(file_path.relative_to(root))
                        checksums[rel_path] = FileChecksum(
                            path=rel_path,
                            checksum=_compute_file_checksum(file_path),
                            size=file_path.stat().st_size,
                            mtime=file_path.stat().st_mtime,
                        )
                    except (OSError, IOError) as e:
                        logger.warning(
                            "Failed to checksum file", path=str(file_path), error=str(e)
                        )
    except PermissionError as e:
        logger.warning("Cannot iterate root directory", error=str(e))

    # Add trace file (stored as _system/trace.jsonl in S3)
    trace_file = paths["trace_file"]
    if trace_file.exists():
        try:
            trace_size = trace_file.stat().st_size
            checksums["_system/trace.jsonl"] = FileChecksum(
                path="_system/trace.jsonl",
                checksum=_compute_file_checksum(trace_file),
                size=trace_size,
                mtime=trace_file.stat().st_mtime,
            )
        except (OSError, IOError) as e:
            logger.warning("Failed to checksum trace", phase="sync", error=str(e))

    return checksums


def is_cold_start() -> bool:
    """
    Check if this is a cold start (no active conversation set).

    The .system directory is baked into the container image (Dockerfile),
    so we can't rely on its existence. Instead, check if current_conv.json
    exists — it's only written after the first request is handled.

    Returns:
        True if no active conversation (needs S3 sync)
    """
    from .workspace import get_active_conversation

    return get_active_conversation() is None


def sync_from_s3(user_sub: str, conversation_id: str) -> SyncResult:
    """
    Download workspace from S3 to local storage.

    Downloads:
    - chat-workflows/ from user's global path
    - Conversation files from conversations/{conv_id}/

    Args:
        user_sub: Cognito user sub (UUID)
        conversation_id: Conversation to load

    Returns:
        SyncResult with sync details
    """
    result = SyncResult(files_downloaded=0, files_uploaded=0, errors=[])

    if not OUTPUTS_BUCKET:
        result["errors"].append("OUTPUTS_BUCKET_NAME not configured")
        logger.error("S3 bucket not configured")
        return result

    paths = get_workspace_paths()
    s3 = _get_s3_client()
    root = paths["root"]

    # Prefixes to download
    # DISABLED: chat-workflows feature temporarily disabled
    prefixes = [
        # Globally persistent chat-workflows (DISABLED)
        # (f"{S3_PREFIX}/{user_sub}/chat-workflows/", paths["workflows"]),
        # Conversation-specific files (uploads, session, root files, _system)
        (f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/", root),
    ]

    for s3_prefix, local_base in prefixes:
        try:
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=OUTPUTS_BUCKET, Prefix=s3_prefix):
                for obj in page.get("Contents", []):
                    s3_key = obj["Key"]
                    rel_path = s3_key[len(s3_prefix) :]

                    if not rel_path:
                        continue

                    # Handle _system/trace.jsonl specially
                    if rel_path == "_system/trace.jsonl":
                        local_file = paths["trace_file"]
                    else:
                        local_file = local_base / rel_path

                    local_file.parent.mkdir(parents=True, exist_ok=True)

                    try:
                        s3.download_file(OUTPUTS_BUCKET, s3_key, str(local_file))
                        result["files_downloaded"] += 1
                    except ClientError as e:
                        error_msg = f"Failed to download {s3_key}: {e}"
                        result["errors"].append(error_msg)
                        logger.error(
                            "S3 download failed",
                            _name="S3_DOWNLOAD_ERROR",
                            phase="sync",
                            s3_key=s3_key,
                            error=str(e),
                        )

        except ClientError as e:
            error_msg = f"Failed to list {s3_prefix}: {e}"
            result["errors"].append(error_msg)
            logger.error(
                "S3 list failed",
                _name="S3_LIST_ERROR",
                phase="sync",
                prefix=s3_prefix,
                error=str(e),
            )

    # Single consolidated log for S3 sync from S3
    logger.info(
        "S3 sync from S3 complete",
        _name="S3_SYNC_DOWNLOAD",
        phase="sync",
        conversation_id=conversation_id,
        user_sub=user_sub,
        files_downloaded=result["files_downloaded"],
        errors=len(result["errors"]),
    )

    return result


def sync_to_s3(
    user_sub: str,
    conversation_id: str,
    previous_checksums: dict[str, FileChecksum] | None = None,
) -> SyncResult:
    """
    Upload changed files to S3.

    Routes files to correct S3 paths:
    - chat-workflows/* -> {user_sub}/chat-workflows/*
    - Everything else -> {user_sub}/conversations/{conv_id}/*

    Args:
        user_sub: Cognito user sub (UUID)
        conversation_id: Current conversation ID
        previous_checksums: Previous checksums for change detection

    Returns:
        SyncResult with sync details
    """
    result = SyncResult(files_downloaded=0, files_uploaded=0, errors=[])

    if not OUTPUTS_BUCKET:
        result["errors"].append("OUTPUTS_BUCKET_NAME not configured")
        logger.error("S3 bucket not configured")
        return result

    s3 = _get_s3_client()
    paths = get_workspace_paths()

    # Get current checksums
    current_checksums = get_local_checksums(conversation_id)

    # Determine changed files
    files_to_upload: list[str] = []

    if previous_checksums is None:
        # No previous - upload everything
        files_to_upload = list(current_checksums.keys())
    else:
        # Compare checksums
        for rel_path, current in current_checksums.items():
            previous = previous_checksums.get(rel_path)
            if previous is None or previous["checksum"] != current["checksum"]:
                files_to_upload.append(rel_path)

    if not files_to_upload:
        return result

    for rel_path in files_to_upload:
        # Determine local file path
        local_file = _get_local_path_for_rel(rel_path, paths)

        # Determine S3 key based on file type
        s3_key = _get_s3_path_for_file(rel_path, conversation_id, user_sub)

        try:
            s3.upload_file(str(local_file), OUTPUTS_BUCKET, s3_key)
            result["files_uploaded"] += 1
        except ClientError as e:
            error_msg = f"Failed to upload {rel_path}: {e}"
            result["errors"].append(error_msg)
            logger.error(
                "S3 upload failed",
                _name="S3_UPLOAD_ERROR",
                phase="sync",
                path=rel_path,
                error=str(e),
            )
        except FileNotFoundError:
            pass  # File removed during operation, not an error

    # Single consolidated log for S3 upload
    logger.info(
        "S3 sync to S3 complete",
        _name="S3_SYNC_UPLOAD",
        phase="sync",
        conversation_id=conversation_id,
        user_sub=user_sub,
        files_uploaded=result["files_uploaded"],
        files_checked=len(current_checksums),
        errors=len(result["errors"]),
    )

    return result


def delete_conversation_from_s3(user_sub: str, conversation_id: str) -> int:
    """
    Delete all files for a conversation from S3.

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation ID to delete

    Returns:
        Number of files deleted
    """
    if not OUTPUTS_BUCKET:
        return 0

    s3 = _get_s3_client()
    prefix = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/"
    deleted = 0

    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=OUTPUTS_BUCKET, Prefix=prefix):
            objects = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
            if objects:
                s3.delete_objects(Bucket=OUTPUTS_BUCKET, Delete={"Objects": objects})
                deleted += len(objects)
    except ClientError as e:
        logger.error("Failed to delete conversation from S3", error=str(e))

    logger.info(
        "Deleted conversation from S3",
        conversation_id=conversation_id,
        deleted=deleted,
    )

    return deleted


def delete_uploads_from_s3(
    user_sub: str,
    conversation_id: str,
    rel_paths: list[str],
) -> int:
    """
    Delete specific upload files from S3.

    Used when user unstages files before sending a message.

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation ID
        rel_paths: List of relative paths within uploads/ (e.g., ["folder/file.pdf"])

    Returns:
        Number of files deleted
    """
    if not OUTPUTS_BUCKET or not rel_paths:
        return 0

    s3 = _get_s3_client()

    # Build S3 keys for each file
    objects_to_delete = [
        {
            "Key": f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/uploads/{rel_path}"
        }
        for rel_path in rel_paths
    ]

    deleted = 0

    # S3 delete_objects accepts max 1000 at a time
    for i in range(0, len(objects_to_delete), 1000):
        batch = objects_to_delete[i : i + 1000]
        try:
            response = s3.delete_objects(
                Bucket=OUTPUTS_BUCKET, Delete={"Objects": batch}
            )
            deleted += len(response.get("Deleted", []))

            # Log any errors
            for error in response.get("Errors", []):
                logger.warning(
                    "Failed to delete S3 object",
                    key=error.get("Key"),
                    code=error.get("Code"),
                    message=error.get("Message"),
                )
        except ClientError as e:
            logger.error("S3 delete_objects failed", error=str(e))

    logger.info(
        "Deleted uploads from S3",
        conversation_id=conversation_id,
        requested=len(rel_paths),
        deleted=deleted,
    )

    return deleted


def sync_uploads_from_s3(user_sub: str, conversation_id: str) -> int:
    """
    Download only the uploads/ prefix for a conversation.

    Used as a warm-session sync guard when files have been uploaded
    but the container doesn't have them locally yet.

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation ID

    Returns:
        Number of files downloaded
    """
    if not OUTPUTS_BUCKET:
        return 0

    s3 = _get_s3_client()
    prefix = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/uploads/"
    paths = get_workspace_paths()
    uploads_dir = paths["uploads"]
    downloaded = 0

    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=OUTPUTS_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                s3_key = obj["Key"]
                rel_path = s3_key[len(prefix) :]

                if not rel_path:
                    continue

                local_path = uploads_dir / rel_path
                local_path.parent.mkdir(parents=True, exist_ok=True)

                try:
                    s3.download_file(OUTPUTS_BUCKET, s3_key, str(local_path))
                    downloaded += 1
                except ClientError as e:
                    logger.warning(
                        "Failed to download upload file from S3",
                        s3_key=s3_key,
                        error=str(e),
                    )

    except ClientError as e:
        logger.error("Failed to list uploads from S3", error=str(e))

    logger.info(
        "Synced uploads from S3",
        conversation_id=conversation_id,
        downloaded=downloaded,
    )

    return downloaded


def list_workspace_files_from_s3(user_sub: str) -> list[dict]:
    """
    List files in user's persistent chat-workflows directory from S3.

    This is used for the read-only /files endpoint without triggering sync.
    Only lists chat-workflows/ as that's the only globally persistent directory.

    DISABLED: chat-workflows feature temporarily disabled - returns empty list.

    Args:
        user_sub: Cognito user sub

    Returns:
        List of file info dicts with path, name, size, modifiedAt
    """
    # DISABLED: chat-workflows feature temporarily disabled
    # Return empty list immediately - no S3 operations needed
    return []

    # if not OUTPUTS_BUCKET:
    #     logger.warning("No OUTPUTS_BUCKET configured")
    #     return []
    #
    # s3 = _get_s3_client()
    # prefix = f"{S3_PREFIX}/{user_sub}/chat-workflows/"
    #
    # files = []
    # try:
    #     paginator = s3.get_paginator("list_objects_v2")
    #     for page in paginator.paginate(Bucket=OUTPUTS_BUCKET, Prefix=prefix):
    #         for obj in page.get("Contents", []):
    #             # Extract relative path from full S3 key
    #             rel_path = obj["Key"].replace(f"{S3_PREFIX}/{user_sub}/", "")
    #             files.append(
    #                 {
    #                     "path": rel_path,
    #                     "name": rel_path.split("/")[-1],
    #                     "size": obj["Size"],
    #                     "modifiedAt": obj["LastModified"].isoformat(),
    #                 }
    #             )
    # except ClientError as e:
    #     logger.error("Failed to list files from S3", prefix=prefix, error=str(e))
    #
    # logger.info(
    #     "Listed workspace files from S3",
    #     user_sub=user_sub[:8] + "...",
    #     count=len(files),
    # )
    # return files


def list_conversation_files_from_s3(user_sub: str, conversation_id: str) -> list[dict]:
    """
    List files in a conversation's uploads/ and session/ directories from S3.

    This is used for the /files/{conversation_id} endpoint to show
    conversation-specific files in the settings panel.

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation UUID

    Returns:
        List of file info dicts with path, name, size, modifiedAt
    """
    if not OUTPUTS_BUCKET:
        logger.warning("No OUTPUTS_BUCKET configured")
        return []

    s3 = _get_s3_client()
    prefix = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/"

    files = []
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=OUTPUTS_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                # Extract relative path within conversation
                rel_path = obj["Key"][len(prefix) :]

                # Only include files from uploads/ and session/ folders
                if not (
                    rel_path.startswith("uploads/") or rel_path.startswith("session/")
                ):
                    continue

                # Skip _system/ directory
                if rel_path.startswith("_system/"):
                    continue

                files.append(
                    {
                        "path": rel_path,
                        "name": rel_path.split("/")[-1],
                        "size": obj["Size"],
                        "modifiedAt": obj["LastModified"].isoformat(),
                    }
                )
    except ClientError as e:
        logger.error(
            "Failed to list conversation files from S3",
            prefix=prefix,
            error=str(e),
        )

    logger.info(
        "Listed conversation files from S3",
        user_sub=user_sub[:8] + "...",
        conversation_id=conversation_id[:8] + "...",
        count=len(files),
    )
    return files


def get_conversation_trace_from_s3(user_sub: str, conversation_id: str) -> str | None:
    """
    Fetch the conversation trace.jsonl content directly from S3.

    This is used for the get_history action to load conversation history
    without needing to download to local disk first.

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation ID

    Returns:
        Trace file content as string, or None if not found
    """
    if not OUTPUTS_BUCKET:
        logger.warning("No OUTPUTS_BUCKET configured")
        return None

    s3 = _get_s3_client()
    trace_key = (
        f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/_system/trace.jsonl"
    )

    try:
        response = s3.get_object(Bucket=OUTPUTS_BUCKET, Key=trace_key)
        content = response["Body"].read().decode("utf-8")
        logger.info(
            "Fetched trace from S3",
            _name="TRACE_FETCHED",
            phase="sync",
            conversation_id=conversation_id,
            size=len(content),
        )
        return content
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            logger.debug(
                "No trace found in S3", phase="sync", conversation_id=conversation_id
            )
            return None
        logger.error(
            "Failed to fetch trace from S3",
            _name="TRACE_ERROR",
            phase="sync",
            error=str(e),
        )
        return None
    except UnicodeDecodeError as e:
        logger.error(
            "Failed to decode trace content from S3",
            conversation_id=conversation_id,
            error=str(e),
        )
        return None
    except Exception as e:
        # Catch any other unexpected errors (network issues, etc.)
        logger.error(
            "Unexpected error fetching trace from S3",
            conversation_id=conversation_id,
            error=str(e),
            exc_info=True,
        )
        return None


def restore_trace_from_s3(user_sub: str, conversation_id: str) -> bool:
    """
    Restore trace.jsonl from S3 if it doesn't exist locally.

    This is a targeted restore for the trace file only, used in the session
    fallback scenario when the container is warm but local session files are
    missing (e.g., after a container kill or GET /trace warming).

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation ID

    Returns:
        True if trace was restored (or didn't need restoring), False on error
    """
    paths = get_workspace_paths()
    trace_file = paths["trace_file"]

    # Only restore if local trace doesn't exist
    if trace_file.exists():
        logger.debug(
            "Local trace file already exists, skipping restore",
            trace_path=str(trace_file),
        )
        return True

    if not OUTPUTS_BUCKET:
        logger.warning("No OUTPUTS_BUCKET configured for trace restore")
        return False

    trace_key = (
        f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/_system/trace.jsonl"
    )
    s3 = _get_s3_client()

    try:
        response = s3.get_object(Bucket=OUTPUTS_BUCKET, Key=trace_key)
        content = response["Body"].read()

        # Ensure parent directory exists
        trace_file.parent.mkdir(parents=True, exist_ok=True)

        # Write trace file
        trace_file.write_bytes(content)

        logger.info(
            "Restored trace file from S3",
            conversation_id=conversation_id[:8] + "..." if conversation_id else None,
            trace_size=len(content),
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            logger.debug(
                "No trace file in S3 (new conversation)",
                conversation_id=conversation_id,
            )
            return True  # Not an error - just no prior trace
        logger.warning(
            "Failed to restore trace from S3",
            conversation_id=conversation_id,
            error=str(e),
        )
        return False
    except Exception as e:
        logger.error(
            "Unexpected error restoring trace from S3",
            conversation_id=conversation_id,
            error=str(e),
        )
        return False


def restore_claude_session(
    user_sub: str, conversation_id: str, home: Path
) -> dict | None:
    """
    Restore .claude directory from S3 archive.

    Downloads and extracts the tar.gz archive containing the Claude Agent SDK
    session database. Only call when conversation has changed (caller checks).

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation ID to restore session for
        home: Home directory to restore .claude into (typically /.system)

    Returns:
        Dict with session_id if restored, None if no archive or error
    """
    import io
    import tarfile

    if not OUTPUTS_BUCKET:
        logger.warning("No OUTPUTS_BUCKET configured for session restore")
        return None

    key = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/_system/claude-home.tar.gz"
    s3 = _get_s3_client()

    try:
        response = s3.get_object(Bucket=OUTPUTS_BUCKET, Key=key)
        blob = response["Body"].read()
        # Retrieve session_id from object metadata
        metadata = response.get("Metadata", {})
        session_id = metadata.get("session-id")
    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchKey":
            logger.debug(
                "No Claude session archive in S3 (new conversation)",
                conversation_id=conversation_id,
            )
            return None
        logger.warning(
            "Failed to download Claude session from S3",
            conversation_id=conversation_id,
            error=str(e),
        )
        return None

    # Extract tar.gz to home directory
    home.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        tf.extractall(path=home)

    logger.info(
        "Restored Claude session from S3",
        _name="SESSION_RESTORED",
        phase="init",
        conversation_id=conversation_id,
        archive_size=len(blob),
        session_id=session_id,
    )
    return {"session_id": session_id}


def archive_claude_session(
    user_sub: str,
    conversation_id: str,
    home: Path,
    session_id: str | None = None,
) -> bool:
    """
    Archive .claude directory to S3 for session persistence.

    Creates a tar.gz of the .claude directory and uploads it. Called at
    end of every SDK invocation to persist session state.

    Args:
        user_sub: Cognito user sub
        conversation_id: Conversation ID to archive session for
        home: Home directory containing .claude (typically /.system)
        session_id: Optional SDK session ID to store as metadata

    Returns:
        True if archived successfully, False otherwise
    """
    import io
    import tarfile

    if not OUTPUTS_BUCKET:
        logger.warning("No OUTPUTS_BUCKET configured for session archive")
        return False

    claude_dir = home / ".claude"
    if not claude_dir.exists():
        logger.debug("No .claude directory to archive", home=str(home))
        return False

    key = f"{S3_PREFIX}/{user_sub}/conversations/{conversation_id}/_system/claude-home.tar.gz"

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        tf.add(claude_dir, arcname=".claude")

    archive_size = buf.tell()
    buf.seek(0)

    try:
        s3 = _get_s3_client()
        # Store session_id as object metadata for quick retrieval on restore
        put_kwargs: dict = {
            "Bucket": OUTPUTS_BUCKET,
            "Key": key,
            "Body": buf.getvalue(),
        }
        if session_id:
            put_kwargs["Metadata"] = {"session-id": session_id}
        s3.put_object(**put_kwargs)
    except ClientError as e:
        logger.error(
            "Failed to upload Claude session to S3",
            conversation_id=conversation_id,
            error=str(e),
        )
        return False

    logger.info(
        "Archived Claude session to S3",
        _name="SESSION_ARCHIVED",
        phase="cleanup",
        conversation_id=conversation_id,
        archive_size=archive_size,
        session_id=session_id,
    )
    return True


def sync_agent_reference_files(
    agent_config: "AgentConfig",
    conversation_id: str,
    user_sub: str,
) -> list[str]:
    """
    Download agent reference files to the workspace.

    Downloads files from the agent's reference_files configuration to
    /workdir/agent-files/. These files are also synced to the conversation's
    S3 prefix like other workspace files, so they persist across reloads.

    Args:
        agent_config: The agent configuration containing reference_files
        conversation_id: Current conversation ID
        user_sub: User's Cognito sub

    Returns:
        List of local file paths where files were downloaded
    """
    from numa_workspace_agent.agent_config import AgentConfig  # noqa: F401

    if not agent_config.reference_files:
        return []

    paths = get_workspace_paths()
    agent_files_dir = paths["agent_files"]
    agent_files_dir.mkdir(parents=True, exist_ok=True)

    s3 = _get_s3_client()
    downloaded_paths: list[str] = []

    for ref_file in agent_config.reference_files:
        # Use the s3_bucket and s3_key from the reference file metadata
        s3_bucket = ref_file.s3_bucket or OUTPUTS_BUCKET
        s3_key = ref_file.s3_key

        if not s3_bucket or not s3_key:
            logger.warning(
                "Skipping reference file with missing S3 info",
                file_name=ref_file.file_name,
            )
            continue

        # Use the original filename for local storage
        local_path = agent_files_dir / ref_file.file_name

        try:
            s3.download_file(s3_bucket, s3_key, str(local_path))
            downloaded_paths.append(str(local_path))
            logger.debug(
                "Downloaded agent reference file",
                file_name=ref_file.file_name,
                local_path=str(local_path),
            )
        except ClientError as e:
            logger.warning(
                "Failed to download agent reference file",
                file_name=ref_file.file_name,
                s3_bucket=s3_bucket,
                s3_key=s3_key,
                error=str(e),
            )

    logger.info(
        "Synced agent reference files",
        _name="AGENT_FILES_SYNCED",
        phase="init",
        agent_id=agent_config.agent_id,
        agent_title=agent_config.title,
        files_requested=len(agent_config.reference_files),
        files_downloaded=len(downloaded_paths),
    )

    return downloaded_paths


# Type hint for AgentConfig (import at runtime would cause circular import)
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from numa_workspace_agent.agent_config import AgentConfig
