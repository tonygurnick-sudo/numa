"""FastAPI app exposing knowledge-base management endpoints.

Migrated verbatim from numa-chat-agent so that KB operations don't pay the
chat lambda's heavy startup cost. Behaviour and response shapes are identical;
the contract is held by the existing frontend at numa-frontend/src/Services/
knowledgeBaseService.ts.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import structlog
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from kb_core import KnowledgeBaseManager
from prm import client as prm_client
from prm import resource as prm_resource

from .auth import (
    resolve_subs_to_emails,
    resolve_user_identifiers,
    verify_jwt_token,
)
from .config import (
    BEDROCK_KNOWLEDGE_BASE_ID,
    CF_SHARED_SECRET,
    CLIENT_NAME,
    CRAWL_URLS_TABLE_NAME,
    DATA_BUCKET,
    PREFERRED_KNOWLEDGE_BASE,
    Q_APPLICATION_ID,
    Q_INDEX_ID,
    REGION,
)

logger = structlog.get_logger()

app = FastAPI()


# File types Bedrock Knowledge Base can index. Retained as reference so a
# future UX can surface "indexable" vs "stored only" state — we no longer
# gate listing on this, everything in the bucket is shown.
BEDROCK_SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".txt",
    ".md",
    ".html",
    ".htm",
    ".csv",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
}


# ── Request guards ────────────────────────────────────────────────────────


def _guard_request(request: Request) -> Tuple[Optional[Response], Dict[str, Any]]:
    """Validate CloudFront secret + JWT. Returns (error_response, claims)."""
    headers = {k.lower(): v for k, v in request.headers.items()}

    if (
        CF_SHARED_SECRET
        and headers.get("x-arcanum-cloudfront-secret") != CF_SHARED_SECRET
    ):
        return JSONResponse({"error": "Forbidden"}, status_code=403), {}

    auth = headers.get("authorization")
    if not auth:
        return (
            JSONResponse({"error": "Missing Authorization header"}, status_code=401),
            {},
        )

    try:
        claims = verify_jwt_token(auth)
    except Exception as e:  # pylint: disable=broad-except
        logger.warning("JWT verification failed", error=str(e))
        return JSONResponse({"error": "Unauthorized"}, status_code=401), {}

    user_id = claims.get("sub")
    if not isinstance(user_id, str) or not user_id:
        return JSONResponse({"error": "Invalid user ID"}, status_code=401), {}

    return None, claims


# ── KB CRUD ───────────────────────────────────────────────────────────────


@app.post("/api/kb")
async def create_kb(request: Request) -> Response:
    """Create a new knowledge base.

    Body:
        {
            "name": "KB display name",
            "viewers": ["user_id1", "user_id2"] or ["*"] for all users,
            "editors": ["user_id1"]
        }
    """
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        body = await request.json()

        name = body.get("name", "").strip()
        if not name:
            return JSONResponse({"error": "Missing name"}, status_code=400)

        viewers = body.get("viewers", [])
        editors = body.get("editors", [])

        resolved_viewers, unresolved_viewers = resolve_user_identifiers(viewers)
        resolved_editors, unresolved_editors = resolve_user_identifiers(editors)

        unresolved_inputs = list(set(unresolved_viewers + unresolved_editors))
        if unresolved_inputs:
            return JSONResponse(
                {
                    "error": "Some users could not be resolved by email or ID",
                    "unresolved": unresolved_inputs,
                },
                status_code=400,
            )

        user_sub = user["sub"]
        kb_manager = KnowledgeBaseManager()
        kb = kb_manager.create_kb(
            name=name,
            created_by=user_sub,
            viewers=resolved_viewers,
            editors=resolved_editors,
        )

        logger.info("KB created", kb_id=kb["kb_id"], created_by=user_sub)
        return JSONResponse({"status": "success", "kb": kb}, status_code=201)

    except ValueError as e:
        logger.warning("KB creation validation error", error=str(e))
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB creation failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.get("/api/kb")
async def list_user_kbs(request: Request) -> Response:
    """List all KBs accessible to the current user."""
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        kb_manager = KnowledgeBaseManager()
        kbs = kb_manager.list_user_kbs(user["sub"])
        return JSONResponse({"status": "success", "kbs": kbs}, status_code=200)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB list failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.get("/api/kb/{kb_id}")
async def get_kb(request: Request, kb_id: str) -> Response:
    """Get details of a specific KB (if user has permission)."""
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        if not kb_manager.check_permission(kb_id, user_id, "VIEWER"):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        # Note: document_count comes from DynamoDB cache; refreshed when the
        # user lists files via GET /api/kb/{id}/files. Keeps this endpoint cheap.

        editors = kb.get("editors", [])
        kb["editor_emails"] = resolve_subs_to_emails(editors) if editors else []

        viewers = kb.get("viewers", [])
        viewer_subs = [v for v in viewers if v != "*"]
        kb["viewer_emails"] = resolve_subs_to_emails(viewer_subs) if viewer_subs else []

        return JSONResponse({"status": "success", "kb": kb}, status_code=200)

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB get failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.patch("/api/kb/{kb_id}")
async def update_kb(request: Request, kb_id: str) -> Response:
    """Update KB properties.

    Body (all fields optional):
        {
            "name": "New name",
            "viewers": ["user_id1", "user_id2"],
            "editors": ["user_id1"]
        }
    """
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        if not kb_manager.check_owner(kb_id, user_id):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        body = await request.json()
        name = body.get("name")
        viewers = body.get("viewers")
        editors = body.get("editors")

        resolved_viewers = None
        resolved_editors = None

        if viewers is not None:
            resolved_viewers, unresolved_viewers = resolve_user_identifiers(viewers)
            if unresolved_viewers:
                return JSONResponse(
                    {
                        "error": "Some viewers could not be resolved by email or ID",
                        "unresolved": unresolved_viewers,
                    },
                    status_code=400,
                )

        if editors is not None:
            resolved_editors, unresolved_editors = resolve_user_identifiers(editors)
            if unresolved_editors:
                return JSONResponse(
                    {
                        "error": "Some editors could not be resolved by email or ID",
                        "unresolved": unresolved_editors,
                    },
                    status_code=400,
                )

        success = kb_manager.update_kb(
            kb_id=kb_id, name=name, viewers=resolved_viewers, editors=resolved_editors
        )

        if not success:
            return JSONResponse({"error": "Update failed"}, status_code=400)

        logger.info("KB updated", kb_id=kb_id, updated_by=user_id)
        return JSONResponse({"status": "success"}, status_code=200)

    except ValueError as e:
        logger.warning("KB update validation error", error=str(e))
        return JSONResponse({"error": str(e)}, status_code=400)
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB update failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.delete("/api/kb/{kb_id}")
async def delete_kb(request: Request, kb_id: str) -> Response:
    """Soft-delete (archive) a KB."""
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        if not kb_manager.check_owner(kb_id, user_id):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        success = kb_manager.delete_kb(kb_id)
        if not success:
            return JSONResponse({"error": "Delete failed"}, status_code=400)

        logger.info("KB deleted", kb_id=kb_id, deleted_by=user_id)
        return JSONResponse({"status": "success"}, status_code=200)

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB delete failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


# ── KB files (S3 listing + deletion) ──────────────────────────────────────


def _get_s3_url_tag(s3_client: Any, bucket_name: str, key: str) -> Optional[str]:
    """Read the ``url`` user-metadata tag set by the web crawler."""
    try:
        head_resp = s3_client.head_object(Bucket=bucket_name, Key=key)
        return head_resp.get("Metadata", {}).get("url", "") or None
    except Exception as head_err:  # pylint: disable=broad-except
        logger.debug(
            "Could not fetch URL tag for scraped file",
            key=key,
            error=str(head_err),
        )
        return None


def _get_file_metadata(
    s3_client: Any, bucket: str, key: str
) -> Optional[Dict[str, Any]]:
    """Read the `<key>.metadata.json` sidecar if it exists."""
    metadata_key = f"{key}.metadata.json"
    try:
        response = s3_client.get_object(Bucket=bucket, Key=metadata_key)
        content = response["Body"].read().decode("utf-8")
        data = json.loads(content)
        return data.get("metadataAttributes", data)
    except s3_client.exceptions.NoSuchKey:
        return None
    except Exception as e:  # pylint: disable=broad-except
        logger.debug(
            "Failed to read metadata sidecar",
            bucket=bucket,
            key=metadata_key,
            error=str(e),
        )
        return None


def _enrich_file_info_with_metadata(
    s3_client: Any, bucket_name: str, key: str, file_info: Dict[str, Any]
) -> None:
    metadata = _get_file_metadata(s3_client, bucket_name, key)
    if not metadata:
        return
    uploader = metadata.get("uploader_email")
    if uploader:
        file_info["uploadedBy"] = uploader
    uploaded_at = metadata.get("uploaded_at")
    if uploaded_at:
        file_info["uploadedAt"] = uploaded_at


RECURSIVE_LIST_MAX_FILES = 50_000


def _list_kb_files_recursive(
    bucket_name: str, prefix: str
) -> Tuple[List[Dict[str, Any]], int, bool]:
    """List every file under a KB prefix as a flat list, up to a hard cap.

    Skips sidecar enrichment (`.metadata.json`, head_object for urlTag) — this
    endpoint exists to feed client-side search, not the per-row display. Rich
    metadata arrives via the per-level `_list_kb_files` call when the user
    drills into a folder. Capped at ``RECURSIVE_LIST_MAX_FILES`` so a runaway
    KB (millions of files) can't time out the lambda or bloat the payload.
    Returns (files, count, truncated).
    """
    try:
        s3_client = prm_client("s3", region=REGION)
        paginator = s3_client.get_paginator("list_objects_v2")

        files: List[Dict[str, Any]] = []
        truncated = False

        for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
            for obj in page.get("Contents", []):
                key_val = obj.get("Key") if isinstance(obj, dict) else None
                if not isinstance(key_val, str):
                    continue
                if key_val.endswith(".metadata.json"):
                    continue
                if key_val.endswith("/"):
                    # Folder marker — skip. Folders are implied by keys.
                    continue

                last_modified = obj.get("LastModified")
                files.append(
                    {
                        "key": key_val,
                        "lastModified": (
                            last_modified.isoformat() if last_modified else None
                        ),
                        "size": obj.get("Size", 0),
                    }
                )

                if len(files) >= RECURSIVE_LIST_MAX_FILES:
                    truncated = True
                    break

            if truncated:
                break

        if truncated:
            logger.warning(
                "Recursive KB listing truncated",
                bucket=bucket_name,
                prefix=prefix,
                cap=RECURSIVE_LIST_MAX_FILES,
            )

        return files, len(files), truncated
    except Exception as e:  # pylint: disable=broad-except
        logger.error(
            "Error listing S3 files recursively",
            bucket=bucket_name,
            prefix=prefix,
            error=str(e),
        )
        return [], 0, False


def _list_kb_files(
    bucket_name: str, prefix: str, subpath: str = ""
) -> Tuple[List[Dict[str, Any]], List[str], int]:
    """List files and immediate sub-folders at one level of an S3 prefix.

    Uses ``Delimiter='/'`` so only the current directory level is returned,
    keeping the response fast even for KBs with tens of thousands of objects.
    The frontend calls again with a deeper *subpath* when the user drills
    into a folder.
    """
    full_prefix = prefix + subpath
    try:
        s3_client = prm_client("s3", region=REGION)
        paginator = s3_client.get_paginator("list_objects_v2")

        files: List[Dict[str, Any]] = []
        folders: List[str] = []
        doc_count = 0

        for page in paginator.paginate(
            Bucket=bucket_name, Prefix=full_prefix, Delimiter="/"
        ):
            for cp in page.get("CommonPrefixes", []):
                folder_full = cp.get("Prefix", "")
                folder_name = folder_full[len(full_prefix) :].rstrip("/")
                if folder_name:
                    folders.append(folder_name)

            for obj in page.get("Contents", []):
                key_val = obj.get("Key") if isinstance(obj, dict) else None
                if not isinstance(key_val, str):
                    continue
                if key_val == full_prefix:
                    continue
                if key_val.endswith(".metadata.json"):
                    continue

                is_folder = key_val.endswith("/")
                is_web_crawler = (
                    "web-crawler/" in key_val or "scraped-content/" in key_val
                )

                last_modified = obj.get("LastModified")
                file_info: Dict[str, Any] = {
                    "key": key_val,
                    "lastModified": (
                        last_modified.isoformat() if last_modified else None
                    ),
                    "size": obj.get("Size", 0),
                }

                if not is_folder and is_web_crawler:
                    url_tag = _get_s3_url_tag(s3_client, bucket_name, key_val)
                    if url_tag:
                        file_info["urlTag"] = url_tag

                if not is_folder:
                    _enrich_file_info_with_metadata(
                        s3_client, bucket_name, key_val, file_info
                    )

                files.append(file_info)
                if not is_folder:
                    doc_count += 1

        logger.debug(
            "Listed S3 files (level)",
            bucket=bucket_name,
            prefix=full_prefix,
            file_count=len(files),
            folder_count=len(folders),
        )
        return files, folders, doc_count
    except Exception as e:  # pylint: disable=broad-except
        logger.error(
            "Error listing S3 files",
            bucket=bucket_name,
            prefix=full_prefix,
            error=str(e),
        )
        return [], [], 0


@app.get("/api/kb/{kb_id}/files")
async def list_kb_files(request: Request, kb_id: str) -> Response:
    """List files in a KB's S3 prefix and update the cached document count."""
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        if not kb_manager.check_permission(kb_id, user_id, "VIEWER"):
            logger.warning(
                "Access denied - user lacks VIEWER permission",
                kb_id=kb_id,
                user_id=user_id,
            )
            return JSONResponse({"error": "Access denied"}, status_code=403)

        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        if not CLIENT_NAME or not kb.get("s3_prefix"):
            return JSONResponse(
                {"error": "KB configuration incomplete"}, status_code=500
            )

        s3_prefix = kb["s3_prefix"]

        recursive_flag = request.query_params.get("recursive", "").lower() == "true"
        if recursive_flag:
            files, count, truncated = _list_kb_files_recursive(DATA_BUCKET, s3_prefix)
            # Skip the cached-count refresh for recursive responses — a cold
            # call or a truncated call would both overwrite the real document
            # count with an unreliable number.
            logger.info(
                "Listed KB files (recursive)",
                kb_id=kb_id,
                user_id=user_id,
                file_count=count,
                truncated=truncated,
            )
            return JSONResponse(
                {
                    "files": files,
                    "folders": [],
                    "document_count": count,
                    "count": count,
                    "truncated": truncated,
                },
                status_code=200,
            )

        subpath = request.query_params.get("path", "")
        if subpath:
            subpath = subpath.strip("/") + "/"
            if ".." in subpath:
                return JSONResponse({"error": "Invalid path"}, status_code=400)

        files, folders, doc_count = _list_kb_files(DATA_BUCKET, s3_prefix, subpath)

        # Only refresh the cached document_count for root-level listings —
        # subfolder counts would clobber the total.
        if not subpath:
            kb_manager.update_document_count(kb_id, doc_count)

        logger.info(
            "Listed KB files",
            kb_id=kb_id,
            user_id=user_id,
            file_count=doc_count,
            folder_count=len(folders),
            subpath=subpath or "(root)",
        )

        return JSONResponse(
            {"files": files, "folders": folders, "document_count": doc_count},
            status_code=200,
        )

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB files list failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.post("/api/kb/{kb_id}/files/delete")
async def delete_kb_files(request: Request, kb_id: str) -> Response:
    """Delete files from a KB's S3 prefix server-side."""
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        # Company KB is system-owned: admin group members can prune it without
        # being listed as editors. Other KBs require explicit EDITOR role.
        user_groups = user.get("cognito:groups", []) or []
        is_company_admin = kb_id == "company" and "admin" in user_groups
        if not is_company_admin and not kb_manager.check_permission(
            kb_id, user_id, "EDITOR"
        ):
            logger.warning(
                "Access denied - user lacks EDITOR permission for file deletion",
                kb_id=kb_id,
                user_id=user_id,
            )
            return JSONResponse({"error": "Access denied"}, status_code=403)

        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        s3_prefix = kb.get("s3_prefix", "")
        if not s3_prefix:
            return JSONResponse(
                {"error": "KB configuration incomplete"}, status_code=500
            )

        body = await request.json()
        keys = body.get("keys", [])
        if not keys or not isinstance(keys, list):
            return JSONResponse(
                {"error": "Request body must contain a 'keys' array"}, status_code=400
            )

        # Cross-KB safeguard: every key must live under this KB's prefix.
        for key in keys:
            if not isinstance(key, str) or not key.startswith(s3_prefix):
                logger.warning(
                    "Rejected cross-KB deletion attempt",
                    kb_id=kb_id,
                    user_id=user_id,
                    invalid_key=key,
                    expected_prefix=s3_prefix,
                )
                return JSONResponse(
                    {"error": f"Key '{key}' is outside this KB's prefix"},
                    status_code=400,
                )

        s3 = prm_client("s3", region=REGION)

        successful: List[str] = []
        failed: List[Dict[str, str]] = []

        # S3 caps batch deletes at 1000 objects per call.
        for i in range(0, len(keys), 1000):
            batch = keys[i : i + 1000]
            objects = [{"Key": k} for k in batch]
            try:
                response = s3.delete_objects(
                    Bucket=DATA_BUCKET,
                    Delete={"Objects": objects, "Quiet": False},
                )
                successful.extend([d["Key"] for d in response.get("Deleted", [])])
                for err in response.get("Errors", []):
                    failed.append(
                        {"key": err.get("Key", ""), "error": err.get("Message", "")}
                    )
            except Exception as batch_err:  # pylint: disable=broad-except
                logger.error(
                    "S3 batch delete failed",
                    bucket=DATA_BUCKET,
                    batch_size=len(batch),
                    error=str(batch_err),
                )
                for k in batch:
                    failed.append({"key": k, "error": str(batch_err)})

        # Refresh the cached document_count after deletion.
        _, _, doc_count = _list_kb_files(DATA_BUCKET, s3_prefix, "")
        kb_manager.update_document_count(kb_id, doc_count)

        logger.info(
            "KB files deleted",
            kb_id=kb_id,
            user_id=user_id,
            successful_count=len(successful),
            failed_count=len(failed),
        )

        return JSONResponse(
            {"successful": successful, "failed": failed},
            status_code=200,
        )

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB file deletion failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


# ── KB files (move) ───────────────────────────────────────────────────────


@app.post("/api/kb/{kb_id}/files/move")
async def move_kb_files(request: Request, kb_id: str) -> Response:
    """Move files from the source KB (path param) to a destination KB + path.

    Body:
        {
            "keys": ["documents/kb-<src>/a.pdf", ...],  // full S3 keys under source prefix
            "destKbId": "<kb id>",                       // may equal kb_id for same-KB moves
            "destPath": "reports/q3"                     // optional subpath within dest KB
        }

    Performs a collision check up front and rejects with 409 if any destination
    key already exists. On success copies each file + its `.metadata.json`
    sidecar to the new key then deletes the originals.
    """
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        body = await request.json()
        keys = body.get("keys", [])
        dest_kb_id = body.get("destKbId") or kb_id
        dest_path = (body.get("destPath") or "").strip("/")

        if not keys or not isinstance(keys, list):
            return JSONResponse(
                {"error": "Request body must contain a non-empty 'keys' array"},
                status_code=400,
            )
        if ".." in dest_path:
            return JSONResponse({"error": "Invalid destPath"}, status_code=400)

        # Permissions: EDITOR on source (required to delete) and EDITOR on dest
        # (required to write). Company KB allows admin group members to bypass
        # the explicit editor list, matching the delete endpoint.
        user_groups = user.get("cognito:groups", []) or []

        def _can_edit(target_kb_id: str) -> bool:
            if target_kb_id == "company" and "admin" in user_groups:
                return True
            return kb_manager.check_permission(target_kb_id, user_id, "EDITOR")

        if not _can_edit(kb_id):
            logger.warning(
                "Access denied - user lacks EDITOR permission on source KB",
                kb_id=kb_id,
                user_id=user_id,
            )
            return JSONResponse(
                {"error": "Access denied on source KB"}, status_code=403
            )
        if dest_kb_id != kb_id and not _can_edit(dest_kb_id):
            logger.warning(
                "Access denied - user lacks EDITOR permission on destination KB",
                dest_kb_id=dest_kb_id,
                user_id=user_id,
            )
            return JSONResponse(
                {"error": "Access denied on destination KB"}, status_code=403
            )

        source_kb = kb_manager.get_kb(kb_id)
        dest_kb = source_kb if dest_kb_id == kb_id else kb_manager.get_kb(dest_kb_id)
        if not source_kb or not dest_kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        source_prefix = source_kb.get("s3_prefix", "")
        dest_prefix = dest_kb.get("s3_prefix", "")
        if not source_prefix or not dest_prefix:
            return JSONResponse(
                {"error": "KB configuration incomplete"}, status_code=500
            )

        for k in keys:
            if not isinstance(k, str) or not k.startswith(source_prefix):
                logger.warning(
                    "Rejected cross-KB move attempt",
                    kb_id=kb_id,
                    user_id=user_id,
                    invalid_key=k,
                    expected_prefix=source_prefix,
                )
                return JSONResponse(
                    {"error": f"Key '{k}' is outside source KB prefix"},
                    status_code=400,
                )
            if k.endswith("/"):
                return JSONResponse(
                    {"error": "Folder moves are not supported yet"}, status_code=400
                )

        dest_folder_prefix = (
            f"{dest_prefix}{dest_path}/".replace("//", "/")
            if dest_path
            else dest_prefix
        )

        s3 = prm_client("s3", region=REGION)

        # Build (source -> destination) pairs, filtering out no-op self-moves.
        pairs: List[Tuple[str, str]] = []
        for key in keys:
            filename = key.split("/")[-1]
            new_key = f"{dest_folder_prefix}{filename}"
            if new_key == key:
                continue
            pairs.append((key, new_key))

        if not pairs:
            return JSONResponse(
                {"successful": [], "failed": [], "message": "No-op move"},
                status_code=200,
            )

        # Collision check — fail fast, don't partially clobber.
        collisions: List[str] = []
        precheck_failed: List[Dict[str, str]] = []
        for _source, dest in pairs:
            try:
                s3.head_object(Bucket=DATA_BUCKET, Key=dest)
                collisions.append(dest)
            except ClientError as e:
                code = e.response.get("Error", {}).get("Code", "")
                if code in ("404", "NoSuchKey", "NotFound"):
                    continue
                precheck_failed.append({"key": dest, "error": str(e)})

        if collisions:
            return JSONResponse(
                {"error": "Destination collision", "collisions": collisions},
                status_code=409,
            )
        if precheck_failed:
            return JSONResponse(
                {"error": "Pre-check failed", "failed": precheck_failed},
                status_code=500,
            )

        successful: List[Dict[str, str]] = []
        failed: List[Dict[str, str]] = []
        for source_key, dest_key in pairs:
            metadata_source = f"{source_key}.metadata.json"
            metadata_dest = f"{dest_key}.metadata.json"
            try:
                s3.copy_object(
                    Bucket=DATA_BUCKET,
                    CopySource={"Bucket": DATA_BUCKET, "Key": source_key},
                    Key=dest_key,
                    MetadataDirective="COPY",
                )
                had_metadata = False
                try:
                    s3.copy_object(
                        Bucket=DATA_BUCKET,
                        CopySource={"Bucket": DATA_BUCKET, "Key": metadata_source},
                        Key=metadata_dest,
                        MetadataDirective="COPY",
                    )
                    had_metadata = True
                except ClientError as meta_err:
                    code = meta_err.response.get("Error", {}).get("Code", "")
                    if code not in ("404", "NoSuchKey", "NotFound"):
                        logger.warning(
                            "Metadata sidecar copy failed",
                            key=metadata_source,
                            error=str(meta_err),
                        )

                delete_objects = [{"Key": source_key}]
                if had_metadata:
                    delete_objects.append({"Key": metadata_source})
                s3.delete_objects(
                    Bucket=DATA_BUCKET,
                    Delete={"Objects": delete_objects, "Quiet": True},
                )
                successful.append({"sourceKey": source_key, "destKey": dest_key})
            except Exception as move_err:  # pylint: disable=broad-except
                logger.error(
                    "File move failed",
                    source_key=source_key,
                    dest_key=dest_key,
                    error=str(move_err),
                )
                failed.append({"key": source_key, "error": str(move_err)})

        # Refresh cached document counts for affected KBs.
        _, _, src_count = _list_kb_files(DATA_BUCKET, source_prefix, "")
        kb_manager.update_document_count(kb_id, src_count)
        if dest_kb_id != kb_id:
            _, _, dest_count = _list_kb_files(DATA_BUCKET, dest_prefix, "")
            kb_manager.update_document_count(dest_kb_id, dest_count)

        logger.info(
            "KB files moved",
            kb_id=kb_id,
            dest_kb_id=dest_kb_id,
            user_id=user_id,
            successful_count=len(successful),
            failed_count=len(failed),
        )

        return JSONResponse(
            {"successful": successful, "failed": failed},
            status_code=200,
        )

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB file move failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


# ── KB files (rename) ────────────────────────────────────────────────────────


@app.post("/api/kb/{kb_id}/files/rename")
async def rename_kb_file(request: Request, kb_id: str) -> Response:
    """Rename a single file within a KB (same folder, new filename).

    Body:
        {
            "key": "documents/kb-<id>/reports/old-name.pdf",
            "newFilename": "new-name.pdf"
        }

    Performs a collision check, then copies the file + metadata sidecar to
    the new key and deletes the originals. The file stays in the same folder.
    """
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        user_groups = user.get("cognito:groups", []) or []
        is_company_admin = kb_id == "company" and "admin" in user_groups
        if not is_company_admin and not kb_manager.check_permission(
            kb_id, user_id, "EDITOR"
        ):
            logger.warning(
                "Access denied - user lacks EDITOR permission for file rename",
                kb_id=kb_id,
                user_id=user_id,
            )
            return JSONResponse({"error": "Access denied"}, status_code=403)

        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        s3_prefix = kb.get("s3_prefix", "")
        if not s3_prefix:
            return JSONResponse(
                {"error": "KB configuration incomplete"}, status_code=500
            )

        body = await request.json()
        key = body.get("key", "")
        new_filename = body.get("newFilename", "").strip()

        if not key or not isinstance(key, str):
            return JSONResponse({"error": "'key' is required"}, status_code=400)
        if not new_filename or not isinstance(new_filename, str):
            return JSONResponse({"error": "'newFilename' is required"}, status_code=400)
        if "/" in new_filename or "\\" in new_filename or ".." in new_filename:
            return JSONResponse(
                {"error": "Filename must not contain path separators"},
                status_code=400,
            )

        if not key.startswith(s3_prefix):
            return JSONResponse(
                {"error": f"Key '{key}' is outside this KB's prefix"},
                status_code=400,
            )
        if key.endswith("/"):
            return JSONResponse({"error": "Cannot rename folders"}, status_code=400)

        # Build new key: same parent folder, new filename.
        parent = key.rsplit("/", 1)[0] + "/"
        new_key = f"{parent}{new_filename}"

        if new_key == key:
            return JSONResponse(
                {"sourceKey": key, "destKey": new_key, "message": "No-op rename"},
                status_code=200,
            )

        s3 = prm_client("s3", region=REGION)

        # Collision check.
        try:
            s3.head_object(Bucket=DATA_BUCKET, Key=new_key)
            return JSONResponse(
                {"error": "Destination collision", "collision": new_key},
                status_code=409,
            )
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code not in ("404", "NoSuchKey", "NotFound"):
                return JSONResponse(
                    {"error": f"Pre-check failed: {e}"}, status_code=500
                )

        # Copy file to new key.
        s3.copy_object(
            Bucket=DATA_BUCKET,
            CopySource={"Bucket": DATA_BUCKET, "Key": key},
            Key=new_key,
            MetadataDirective="COPY",
        )

        # Copy metadata sidecar if it exists.
        metadata_source = f"{key}.metadata.json"
        metadata_dest = f"{new_key}.metadata.json"
        had_metadata = False
        try:
            s3.copy_object(
                Bucket=DATA_BUCKET,
                CopySource={"Bucket": DATA_BUCKET, "Key": metadata_source},
                Key=metadata_dest,
                MetadataDirective="COPY",
            )
            had_metadata = True
        except ClientError as meta_err:
            code = meta_err.response.get("Error", {}).get("Code", "")
            if code not in ("404", "NoSuchKey", "NotFound"):
                logger.warning(
                    "Metadata sidecar copy failed during rename",
                    key=metadata_source,
                    error=str(meta_err),
                )

        # Delete originals.
        delete_objects = [{"Key": key}]
        if had_metadata:
            delete_objects.append({"Key": metadata_source})
        s3.delete_objects(
            Bucket=DATA_BUCKET,
            Delete={"Objects": delete_objects, "Quiet": True},
        )

        logger.info(
            "KB file renamed",
            kb_id=kb_id,
            user_id=user_id,
            source_key=key,
            dest_key=new_key,
        )

        return JSONResponse(
            {"sourceKey": key, "destKey": new_key},
            status_code=200,
        )

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB file rename failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)


# ── KB sync state (Bedrock or Q Business) ─────────────────────────────────


def _sanitize_failed_s3_uri(uri: str) -> Optional[str]:
    """Strip diagnostic suffixes from an S3 URI mentioned in a failure reason."""
    if not uri:
        return None
    trimmed = uri.strip()
    if not trimmed:
        return None
    without_suffix = re.sub(r"\s+\([^)]*\)$", "", trimmed)
    cleaned = re.sub(r"[;.,]+$", "", without_suffix)
    return cleaned if cleaned.startswith("s3://") else None


def _extract_failed_doc_from_uri(
    uri: str, job_updated_at: Any
) -> Optional[Dict[str, Any]]:
    sanitized = _sanitize_failed_s3_uri(uri)
    if not sanitized:
        return None

    key_match = re.search(r"[^/]+$", sanitized)
    filename = key_match.group(0) if key_match else sanitized

    return {
        "documentId": sanitized,
        "status": "FAILED",
        "updatedAt": (
            job_updated_at.isoformat()
            if hasattr(job_updated_at, "isoformat")
            else str(job_updated_at)
        ),
        "error": {
            "errorMessage": "File format not supported or processing failed during ingestion"
        },
        "fileName": filename,
    }


def _collect_failed_docs_from_job(
    bedrock_agent: Any,
    kb_id: str,
    data_source_id: str,
    job: Dict[str, Any],
    s3_uri_pattern: re.Pattern,
) -> List[Dict[str, Any]]:
    try:
        job_details = bedrock_agent.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=data_source_id,
            ingestionJobId=job.get("ingestionJobId"),
        )
        failure_reasons = (
            job_details.get("ingestionJob", {}).get("failureReasons") or []
        )
        job_updated = job.get("updatedAt", "")
        failed_docs: List[Dict[str, Any]] = []

        for reason in failure_reasons:
            for uri in s3_uri_pattern.findall(reason):
                failed_doc = _extract_failed_doc_from_uri(uri, job_updated)
                if failed_doc:
                    failed_docs.append(failed_doc)
        return failed_docs
    except Exception as job_err:  # pylint: disable=broad-except
        logger.debug(
            "Error fetching ingestion job details",
            job_id=job.get("ingestionJobId"),
            error=str(job_err),
        )
        return []


def _filter_documents_by_prefix(
    documents: List[Dict[str, Any]], s3_prefix_filter: str, kb_type: str
) -> List[Dict[str, Any]]:
    """Restrict a global Bedrock/Q document list to a single KB's documents."""
    if not documents:
        return []
    if not s3_prefix_filter or not kb_type:
        return documents

    filtered: List[Dict[str, Any]] = []
    for doc in documents:
        s3_uri = doc.get("documentId", "")
        if kb_type == "user":
            if s3_prefix_filter in s3_uri:
                filtered.append(doc)
        elif kb_type == "company":
            # Company KB lives at documents/company/ — exclude per-user kb-* prefixes.
            if s3_prefix_filter in s3_uri or (
                "documents/company/" in s3_uri and "documents/kb-" not in s3_uri
            ):
                filtered.append(doc)
        else:
            filtered.append(doc)
    return filtered


def _compute_kb_metrics(
    filtered_docs: List[Dict[str, Any]], failed_docs: List[Dict[str, Any]]
) -> Dict[str, int]:
    """Compute per-KB metrics from the already-filtered document list.

    Job-level statistics from Bedrock are global across all data sources, so
    we recount from the filtered slice to get accurate per-KB numbers.
    """
    indexed = sum(1 for d in filtered_docs if d.get("status") == "INDEXED")
    failed = len(failed_docs)
    pending = len(filtered_docs) - indexed

    return {
        "documentsIndexed": indexed,
        "documentsFailed": failed,
        "documentsPending": pending,
        "totalDocuments": len(filtered_docs),
    }


def _serialize_datetime(obj: Any) -> Any:
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialize_datetime(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize_datetime(item) for item in obj]
    return obj


def _serialize_data_sources(sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [_serialize_datetime(source) for source in sources]


def _check_web_crawler_content_exists(domain: str, kb_id: str) -> bool:
    """Filter out orphan crawl-DB rows by confirming S3 has matching content."""
    if not CLIENT_NAME or not domain:
        return False

    try:
        s3_client = prm_client("s3", region=REGION)
        if kb_id == "company":
            prefix = f"documents/company/web-crawler/{domain}/"
        else:
            prefix = f"documents/kb-{kb_id}/web-crawler/{domain}/"

        response = s3_client.list_objects_v2(
            Bucket=DATA_BUCKET, Prefix=prefix, MaxKeys=1
        )
        return response.get("KeyCount", 0) > 0
    except Exception as e:  # pylint: disable=broad-except
        logger.warning(
            "Error checking web crawler content",
            domain=domain,
            kb_id=kb_id,
            error=str(e),
        )
        return False


def _get_web_crawler_stats(kb_id: str) -> List[Dict[str, Any]]:
    """Fetch web-crawler 'data sources' from the crawl URLs table.

    Returns one entry per seed URL (the URL the user actually submitted),
    with the page count from the same crawl session. Falls back to grouping
    by domain for older crawls written before isSeedUrl existed.
    """
    if not CRAWL_URLS_TABLE_NAME:
        return []

    try:
        dynamodb = prm_resource("dynamodb")
        table = dynamodb.Table(CRAWL_URLS_TABLE_NAME)

        response = table.query(
            IndexName="kbId-status-index",
            KeyConditionExpression=Key("kbId").eq(kb_id)
            & Key("status").eq("completed"),
            Limit=2000,
        )

        items = response.get("Items", [])
        if not items:
            return []

        seed_urls: List[Dict[str, Any]] = []
        urls_by_session: Dict[str, List[Dict[str, Any]]] = {}

        for item in items:
            session_id = item.get("crawlSessionId", "unknown")
            urls_by_session.setdefault(session_id, []).append(item)
            if item.get("isSeedUrl"):
                seed_urls.append(item)

        if seed_urls:
            data_sources: List[Dict[str, Any]] = []
            for seed in seed_urls:
                url = seed.get("url", "")
                session_id = seed.get("crawlSessionId", "unknown")
                domain = urlparse(url).netloc

                session_pages = urls_by_session.get(session_id, [])
                page_count = len(session_pages)

                last_crawled = None
                for page in session_pages:
                    updated = page.get("updatedAt") or page.get("createdAt")
                    if updated and (last_crawled is None or updated > last_crawled):
                        last_crawled = updated

                if last_crawled and hasattr(last_crawled, "isoformat"):
                    last_crawled = last_crawled.isoformat()

                data_sources.append(
                    {
                        "dataSourceId": f"web-crawler-{session_id}",
                        "name": url,
                        "displayName": url,
                        "type": "Numa Web Crawler",
                        "status": "ACTIVE",
                        "pageCount": page_count,
                        "lastCrawled": last_crawled,
                        "isWebCrawler": True,
                        "domain": domain,
                        "sourceUrl": url,
                        "isSeedUrl": True,
                        "crawlDepth": int(seed.get("crawlDepth", 1)),
                        "limitToPath": bool(seed.get("limitToPath", True)),
                    }
                )

            data_sources = [
                ds
                for ds in data_sources
                if _check_web_crawler_content_exists(ds.get("domain", ""), kb_id)
            ]

            data_sources.sort(
                key=lambda d: (d.get("lastCrawled") or "", d.get("name") or ""),
                reverse=True,
            )
            return data_sources

        # Legacy fallback: aggregate by domain when no seed URL marker exists.
        domains: Dict[str, Dict[str, Any]] = {}
        for item in items:
            url = item.get("url")
            if not url:
                continue
            domain = urlparse(url).netloc
            if not domain:
                continue

            entry = domains.setdefault(
                domain, {"domain": domain, "pageCount": 0, "lastCrawled": None}
            )
            entry["pageCount"] += 1

            updated = item.get("updatedAt") or item.get("createdAt")
            if updated and (
                entry["lastCrawled"] is None or updated > entry["lastCrawled"]
            ):
                entry["lastCrawled"] = updated

        legacy_sources: List[Dict[str, Any]] = []
        for entry in domains.values():
            domain_url = f"https://{entry['domain']}"
            last_crawled = entry["lastCrawled"]
            if last_crawled and hasattr(last_crawled, "isoformat"):
                last_crawled = last_crawled.isoformat()
            legacy_sources.append(
                {
                    "dataSourceId": f"web-crawler-{entry['domain']}",
                    "name": domain_url,
                    "displayName": domain_url,
                    "type": "Numa Web Crawler",
                    "status": "ACTIVE",
                    "pageCount": entry["pageCount"],
                    "lastCrawled": last_crawled,
                    "isWebCrawler": True,
                    "domain": entry["domain"],
                    "sourceUrl": domain_url,
                }
            )

        legacy_sources = [
            ds
            for ds in legacy_sources
            if _check_web_crawler_content_exists(ds.get("domain", ""), kb_id)
        ]

        legacy_sources.sort(
            key=lambda d: (d.get("lastCrawled") or "", d.get("domain") or ""),
            reverse=True,
        )
        return legacy_sources

    except Exception as e:  # pylint: disable=broad-except
        logger.warning("Failed to fetch web crawler stats", kb_id=kb_id, error=str(e))
        return []


def _get_bedrock_kb_state(
    kb_id: str, s3_prefix_filter: str, kb_type: str
) -> Dict[str, Any]:
    """Get KB state from a Bedrock Knowledge Base (data sources, jobs, docs)."""
    if not BEDROCK_KNOWLEDGE_BASE_ID:
        return {"error": "Bedrock Knowledge Base ID not configured"}

    try:
        bedrock_agent = prm_client("bedrock-agent", region=REGION)
        client_display_name = f"numa-{CLIENT_NAME}".lower()

        ds_resp = bedrock_agent.list_data_sources(
            knowledgeBaseId=BEDROCK_KNOWLEDGE_BASE_ID
        )
        summaries = ds_resp.get("dataSourceSummaries", [])

        if not summaries:
            return {
                "error": "no-data-source",
                "message": "No Bedrock data source found",
                "dataSources": [],
                "source": "bedrock",
            }

        ds = None
        for s in summaries:
            name = (s.get("name") or "").lower()
            display = (s.get("displayName") or "").lower()
            if (
                name == client_display_name
                or display == client_display_name
                or name.startswith(client_display_name)
            ):
                ds = s
                break
        if not ds:
            ds = summaries[0]

        data_source_id = ds.get("dataSourceId")

        job_resp = bedrock_agent.list_ingestion_jobs(
            knowledgeBaseId=BEDROCK_KNOWLEDGE_BASE_ID,
            dataSourceId=data_source_id,
            maxResults=10,
            sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
        )
        ingestion_jobs = job_resp.get("ingestionJobSummaries", [])
        latest_job = ingestion_jobs[0] if ingestion_jobs else None
        last_success = next(
            (j for j in ingestion_jobs if j.get("status") == "COMPLETE"), None
        )

        # Pull failed-doc URIs from the failureReasons of the 3 most recent jobs.
        failed_documents_map: Dict[str, Dict[str, Any]] = {}
        recent_jobs = ingestion_jobs[:3]
        s3_uri_pattern = re.compile(r"s3://[^,;\]]+")

        for job in recent_jobs:
            job_failed_docs = _collect_failed_docs_from_job(
                bedrock_agent,
                BEDROCK_KNOWLEDGE_BASE_ID,
                data_source_id,
                job,
                s3_uri_pattern,
            )
            for doc in job_failed_docs:
                if doc["documentId"] not in failed_documents_map:
                    failed_documents_map[doc["documentId"]] = doc

        failed_documents = list(failed_documents_map.values())

        docs: List[Dict[str, Any]] = []
        next_token = None
        while True:
            list_params: Dict[str, Any] = {
                "knowledgeBaseId": BEDROCK_KNOWLEDGE_BASE_ID,
                "dataSourceId": data_source_id,
            }
            if next_token:
                list_params["nextToken"] = next_token

            doc_resp = bedrock_agent.list_knowledge_base_documents(**list_params)
            raw_docs = doc_resp.get("documentDetails", [])

            for doc in raw_docs:
                identifier = doc.get("identifier", {})
                s3_info = identifier.get("s3", {})
                if s3_info.get("uri"):
                    doc["documentId"] = s3_info["uri"]
                docs.append(doc)

            next_token = doc_resp.get("nextToken")
            if not next_token:
                break

        def map_status(status: Optional[str]) -> Optional[str]:
            if status == "IN_PROGRESS":
                return "SYNCING"
            if status == "COMPLETE":
                return "SUCCEEDED"
            return status

        filtered_docs = _filter_documents_by_prefix(docs, s3_prefix_filter, kb_type)
        filtered_failed = _filter_documents_by_prefix(
            failed_documents, s3_prefix_filter, kb_type
        )

        return {
            "dataSourceId": data_source_id,
            "syncStatus": ds.get("status"),
            "syncJobStatus": map_status(
                latest_job.get("status") if latest_job else None
            ),
            "lastSuccessfulSync": (
                last_success.get("updatedAt").isoformat()
                if last_success and hasattr(last_success.get("updatedAt"), "isoformat")
                else str(last_success.get("updatedAt", "")) if last_success else None
            ),
            "lastUpdated": (
                (latest_job.get("updatedAt") or latest_job.get("startedAt")).isoformat()
                if latest_job
                and hasattr(
                    latest_job.get("updatedAt") or latest_job.get("startedAt"),
                    "isoformat",
                )
                else str(latest_job.get("updatedAt", "")) if latest_job else None
            ),
            "syncMetrics": _compute_kb_metrics(filtered_docs, filtered_failed),
            "documents": _serialize_datetime(filtered_docs),
            "dataSources": _serialize_data_sources(summaries)
            + _get_web_crawler_stats(kb_id),
            "failedDocuments": _serialize_datetime(filtered_failed),
            "source": "bedrock",
        }

    except Exception as e:  # pylint: disable=broad-except
        logger.error("Error getting Bedrock KB state", error=str(e), exc_info=True)
        return {"error": str(e), "source": "bedrock"}


def _get_qbusiness_kb_state(
    kb_id: str, s3_prefix_filter: str, kb_type: str
) -> Dict[str, Any]:
    """Get KB state from Amazon Q Business (data sources, sync jobs, docs)."""
    if not Q_APPLICATION_ID or not Q_INDEX_ID:
        return {"error": "Q Business Application or Index ID not configured"}

    try:
        qbusiness = prm_client("qbusiness", region=REGION)
        client_display_name = f"numa-{CLIENT_NAME}"

        ds_resp = qbusiness.list_data_sources(
            applicationId=Q_APPLICATION_ID, indexId=Q_INDEX_ID
        )
        all_data_sources = ds_resp.get("dataSources", [])

        if not all_data_sources:
            return {
                "error": "no-data-source",
                "message": "No Q Business data source found",
                "dataSources": [],
                "source": "q-business",
            }

        ds = next(
            (
                d
                for d in all_data_sources
                if d.get("displayName") == client_display_name
            ),
            all_data_sources[0],
        )

        data_source_id = ds.get("dataSourceId")

        job_resp = qbusiness.list_data_source_sync_jobs(
            applicationId=Q_APPLICATION_ID,
            indexId=Q_INDEX_ID,
            dataSourceId=data_source_id,
            maxResults=10,
        )
        job_history = job_resp.get("history", [])
        latest_job = job_history[0] if job_history else None
        last_success = next(
            (j for j in job_history if j.get("status") in ("SUCCEEDED", "INCOMPLETE")),
            None,
        )

        docs: List[Dict[str, Any]] = []
        next_token = None
        while True:
            list_params: Dict[str, Any] = {
                "applicationId": Q_APPLICATION_ID,
                "indexId": Q_INDEX_ID,
                "dataSourceIds": [data_source_id],
            }
            if next_token:
                list_params["nextToken"] = next_token

            doc_resp = qbusiness.list_documents(**list_params)
            docs.extend(doc_resp.get("documentDetailList", []))

            next_token = doc_resp.get("nextToken")
            if not next_token:
                break

        filtered_docs = _filter_documents_by_prefix(docs, s3_prefix_filter, kb_type)

        return {
            "dataSourceId": data_source_id,
            "syncStatus": ds.get("status"),
            "syncJobStatus": latest_job.get("status") if latest_job else None,
            "lastSuccessfulSync": (
                last_success.get("endTime").isoformat()
                if last_success and hasattr(last_success.get("endTime"), "isoformat")
                else str(last_success.get("endTime", "")) if last_success else None
            ),
            "lastUpdated": (
                (latest_job.get("endTime") or latest_job.get("startTime")).isoformat()
                if latest_job
                and hasattr(
                    latest_job.get("endTime") or latest_job.get("startTime"),
                    "isoformat",
                )
                else str(latest_job.get("endTime", "")) if latest_job else None
            ),
            "syncMetrics": _compute_kb_metrics(filtered_docs, []),
            "documents": _serialize_datetime(filtered_docs),
            "dataSources": _serialize_data_sources(all_data_sources)
            + _get_web_crawler_stats(kb_id),
            "failedDocuments": [],  # Q Business doesn't expose this yet
            "source": "q-business",
        }

    except Exception as e:  # pylint: disable=broad-except
        logger.error("Error getting Q Business KB state", error=str(e), exc_info=True)
        return {"error": str(e), "source": "q-business"}


@app.get("/api/kb/{kb_id}/state")
async def get_kb_state(request: Request, kb_id: str) -> Response:
    """Get KB sync state, indexed documents, ingestion jobs."""
    guard, user = _guard_request(request)
    if guard is not None:
        return guard

    try:
        user_id = user["sub"]
        kb_manager = KnowledgeBaseManager()

        if not kb_manager.check_permission(kb_id, user_id, "VIEWER"):
            return JSONResponse({"error": "Access denied"}, status_code=403)

        kb = kb_manager.get_kb(kb_id)
        if not kb:
            return JSONResponse({"error": "KB not found"}, status_code=404)

        s3_prefix = kb.get("s3_prefix", "")
        kb_type = "company" if kb_id == "company" else "user"
        s3_prefix_filter = s3_prefix

        # Per-KB user data is only indexed in Bedrock (Q Business has no per-KB
        # isolation), so user KBs always read state from Bedrock even on Q-preferred
        # stacks. Only the company KB respects PREFERRED_KNOWLEDGE_BASE.
        if kb_type == "user" and PREFERRED_KNOWLEDGE_BASE == "q":
            state = _get_bedrock_kb_state(kb_id, s3_prefix_filter, kb_type)
        elif PREFERRED_KNOWLEDGE_BASE == "q":
            state = _get_qbusiness_kb_state(kb_id, s3_prefix_filter, kb_type)
        else:
            state = _get_bedrock_kb_state(kb_id, s3_prefix_filter, kb_type)

        logger.info(
            "Got KB state",
            kb_id=kb_id,
            user_id=user_id,
            source=state.get("source"),
            doc_count=len(state.get("documents", [])),
        )

        return JSONResponse(state, status_code=200)

    except Exception as exc:  # pylint: disable=broad-except
        logger.error("KB state fetch failed", error=str(exc), exc_info=True)
        return JSONResponse({"error": "Internal server error"}, status_code=500)
