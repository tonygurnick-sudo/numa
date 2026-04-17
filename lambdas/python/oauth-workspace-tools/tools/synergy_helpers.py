"""Synergy API helpers for browsing jobs, folders, and files.

Extracted from data-connectors Lambda for use in the unified connect tool.
Each Lambda is self-contained — no cross-Lambda imports.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx
import structlog

from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
DATA_CONNECTORS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_TABLE_NAME", "")
DATA_CONNECTORS_SECRETS_PREFIX = os.environ.get(
    "DATA_CONNECTORS_SECRETS_PREFIX", f"{CLIENT_NAME}/data-connectors"
)

# PAT rotation config — must match data-connectors Lambda values
PAT_TTL_DAYS = 90
PAT_ROTATION_THRESHOLD_DAYS = 30


class SynergyAuthError(ValueError):
    """Raised when Synergy returns 401/403 — token expired, revoked, or insufficient permissions."""

    def __init__(self, status_code: int, detail: str = ""):
        self.status_code = status_code
        super().__init__(
            f"Synergy authentication failed (HTTP {status_code}). {detail}".strip()
        )


def _check_response(response: httpx.Response) -> None:
    """Raise SynergyAuthError on 401/403, otherwise raise_for_status."""
    if response.status_code in (401, 403):
        detail = response.text[:200] if response.text else ""
        raise SynergyAuthError(response.status_code, detail)
    response.raise_for_status()


# ---------------------------------------------------------------------------
# URL and token helpers
# ---------------------------------------------------------------------------


def _build_base_url(server: str) -> str:
    """Build a valid base URL from a server string."""
    server = (server or "").strip().rstrip("/")
    if not server:
        raise ValueError("Server is required.")

    if not server.startswith(("http://", "https://")):
        server = f"https://{server}"

    parsed = urlparse(server)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or parsed.path
    path = parsed.path if parsed.netloc else ""

    return f"{scheme}://{netloc}{path}".rstrip("/")


def _normalize_token(token: str) -> str:
    """Normalize a PAT token to 'Bearer {token}' format."""
    cleaned = token.strip()
    if cleaned.lower().startswith("authorization:"):
        cleaned = cleaned.split(":", 1)[1].strip()
    if cleaned.lower().startswith("bearer "):
        cleaned = cleaned[7:].strip()
    if (
        cleaned.startswith(("'", '"'))
        and cleaned.endswith(("'", '"'))
        and len(cleaned) > 1
    ):
        cleaned = cleaned[1:-1].strip()
    return f"Bearer {cleaned}"


# ---------------------------------------------------------------------------
# Credential resolution
# ---------------------------------------------------------------------------


def get_synergy_credentials(user_sub: str) -> Optional[tuple[str, str]]:
    """Return Synergy (server, access_token) for the user, or None if not configured.

    Reads the data-connectors DynamoDB table and Secrets Manager.
    If the PAT is within PAT_ROTATION_THRESHOLD_DAYS of expiry (or has no
    expiry tracking), attempts automatic rotation before returning credentials.
    """
    if not DATA_CONNECTORS_TABLE_NAME:
        return None

    try:
        dynamodb = prm_resource("dynamodb")
        table = dynamodb.Table(DATA_CONNECTORS_TABLE_NAME)
        response = table.get_item(Key={"user_id": user_sub, "connector_id": "synergy"})
        record = response.get("Item")
        if not record or record.get("status") != "connected":
            return None

        secret_arn = record.get("secret_arn")
        if not secret_arn:
            return None

        secrets_client = prm_client("secretsmanager")
        secret_response = secrets_client.get_secret_value(SecretId=secret_arn)
        secret_data = json.loads(secret_response.get("SecretString", "{}"))

        server = secret_data.get("server") or (record.get("config") or {}).get("server")
        token = secret_data.get("access_token")

        if not server or not token:
            return None

        # Check if PAT needs rotation
        pat_expires_at = secret_data.get("pat_expires_at")
        now = datetime.now(timezone.utc)

        # Backfill: if no expiry tracked, set to now to force immediate rotation
        if not pat_expires_at:
            pat_expires_at = now.isoformat()
            logger.info(
                "Backfilling missing pat_expires_at to force rotation",
                _name="PAT_ROTATION",
                user_id=user_sub,
            )

        try:
            expiry = datetime.fromisoformat(pat_expires_at)
            days_remaining = (expiry - now).days
            if days_remaining <= PAT_ROTATION_THRESHOLD_DAYS:
                logger.info(
                    "Synergy PAT approaching expiry, attempting rotation",
                    _name="PAT_ROTATION",
                    days_remaining=days_remaining,
                    user_id=user_sub,
                )
                new_token = _rotate_pat(server, token, secret_data, user_sub)
                if new_token:
                    token = new_token
        except (ValueError, TypeError) as exc:
            logger.warning(
                "Failed to parse PAT expiry", _name="PAT_ROTATION", error=str(exc)
            )

        return server, token

    except Exception as e:
        logger.warning("Failed to get Synergy credentials", error=str(e))
        return None


def _rotate_pat(
    server: str,
    current_token: str,
    secret_data: Dict[str, Any],
    user_sub: str,
) -> Optional[str]:
    """Generate a new Synergy PAT and update Secrets Manager + DynamoDB.

    Returns the new token on success, None on failure.
    """
    try:
        base_url = _build_base_url(server)
        auth_header = _normalize_token(current_token)
        response = httpx.post(
            f"{base_url}/api/v1/auth/generate-pat",
            headers={
                "Authorization": auth_header,
                "Content-Type": "application/json",
            },
            json={
                "ClientId": "numa",
                "Name": "numa-auto-rotation",
                "ExpireInDays": PAT_TTL_DAYS,
            },
            timeout=30,
        )
        if response.status_code >= 400:
            logger.warning(
                "PAT rotation API call failed",
                _name="PAT_ROTATION",
                status=response.status_code,
            )
            return None

        data = response.json()
        new_token = data.get("Token") or data.get("token")
        if not new_token:
            return None

        now = datetime.now(timezone.utc)
        pat_history = secret_data.get("pat_history") or []
        pat_history.append(
            {
                "token_prefix": current_token[:12] + "...",
                "created_at": secret_data.get("pat_created_at"),
                "expires_at": secret_data.get("pat_expires_at"),
                "replaced_at": now.isoformat(),
                "reason": "auto_rotation",
            }
        )

        new_expires_at = now + timedelta(days=PAT_TTL_DAYS)
        updated_secret = {
            **secret_data,
            "access_token": new_token,
            "pat_created_at": now.isoformat(),
            "pat_expires_at": new_expires_at.isoformat(),
            "pat_ttl_days": PAT_TTL_DAYS,
            "pat_history": pat_history[-50:],
        }

        # Update Secrets Manager
        secret_name = f"{DATA_CONNECTORS_SECRETS_PREFIX}/synergy/{user_sub}"
        secrets_client = prm_client("secretsmanager")
        try:
            secrets_client.create_secret(
                Name=secret_name,
                SecretString=json.dumps(updated_secret),
            )
        except secrets_client.exceptions.ResourceExistsException:
            secrets_client.put_secret_value(
                SecretId=secret_name,
                SecretString=json.dumps(updated_secret),
            )

        # Update DynamoDB expiry
        try:
            dynamodb = prm_resource("dynamodb")
            table = dynamodb.Table(DATA_CONNECTORS_TABLE_NAME)
            table.update_item(
                Key={"user_id": user_sub, "connector_id": "synergy"},
                UpdateExpression="SET pat_expires_at = :exp, updated_at = :now",
                ExpressionAttributeValues={
                    ":exp": new_expires_at.isoformat(),
                    ":now": now.isoformat(),
                },
            )
        except Exception as exc:
            logger.warning("Failed to update DynamoDB expiry", error=str(exc))

        logger.info(
            "Synergy PAT rotated successfully",
            _name="PAT_ROTATION",
            user_id=user_sub,
            new_expires_at=new_expires_at.isoformat(),
        )
        return new_token

    except Exception as exc:
        logger.warning("PAT rotation failed", _name="PAT_ROTATION", error=str(exc))
        return None


def is_synergy_configured(user_sub: str) -> bool:
    """Check if Synergy is configured for the user (without retrieving full creds)."""
    if not DATA_CONNECTORS_TABLE_NAME:
        return False

    try:
        dynamodb = prm_resource("dynamodb")
        table = dynamodb.Table(DATA_CONNECTORS_TABLE_NAME)
        response = table.get_item(Key={"user_id": user_sub, "connector_id": "synergy"})
        record = response.get("Item")
        return bool(record and record.get("status") == "connected")
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Synergy API calls
# ---------------------------------------------------------------------------


def search_jobs(
    server: str,
    token: str,
    name: str = "",
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """Search top-level jobs in Synergy."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/search"
    payload = {
        "QuickSearchTerm": "",
        "Name": name or "",
        "Page": page,
        "PageSize": page_size,
        "Attributes": [
            {
                "Attribute": {
                    "Name": "TopLevel",
                    "DisplayName": "Restrict to top level?",
                },
                "Type": "SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                "Value": True,
                "SearchQueryType": 4,
                "Operation": 0,
                "Name": "Restrict to top level?",
                "OperationName": "=",
            }
        ],
    }
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.post(url, json=payload, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    items = data.get("Result") or data.get("Items") or data.get("items") or []
    jobs = [_normalize_job(job) for job in items if isinstance(job, dict)]
    return {
        "page": data.get("PageNumber") or data.get("pageNumber"),
        "page_size": data.get("PageSize") or data.get("pageSize"),
        "total_rows": data.get("TotalRows") or data.get("Total") or data.get("total"),
        "total_pages": data.get("TotalPages") or data.get("totalPages"),
        "items": jobs,
    }


def list_job_folders(server: str, token: str, job_id: str) -> List[Dict[str, Any]]:
    """Return top-level folders for a job."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/{job_id}/items"
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(url, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    items = (
        data.get("SubFolders")
        or data.get("Result")
        or data.get("Items")
        or data.get("items")
        or []
    )
    return [_normalize_folder(folder) for folder in items if isinstance(folder, dict)]


def get_folder_items(server: str, token: str, folder_id: str) -> Dict[str, Any]:
    """Return subfolders and files for a folder."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/folders/{folder_id}/items"
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(url, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    subfolders = [
        _normalize_folder(folder)
        for folder in data.get("SubFolders", [])
        if isinstance(folder, dict)
    ]
    files_data = data.get("Files") or {}
    file_items = (
        files_data.get("Result")
        or files_data.get("Items")
        or files_data.get("items")
        or []
    )
    files = [_normalize_file(f) for f in file_items if isinstance(f, dict)]
    return {
        "folder_id": folder_id,
        "subfolders": subfolders,
        "files": files,
        "files_total": files_data.get("TotalRows"),
    }


def download_file(server: str, token: str, file_id: str) -> tuple[bytes, str]:
    """Download a file from Synergy. Returns (content_bytes, filename).

    Per the 12d Synergy REST API docs, file download is a POST to
    /api/v1/files/{id}/download?version={n}&with_references=false
    with Content-Type: application/octet-stream and an empty body.
    """
    base_url = _build_base_url(server)
    auth_header = _normalize_token(token)

    # Try to get the latest version number for the file
    version = 1
    try:
        meta_response = httpx.get(
            f"{base_url}/api/v1/files/{file_id}",
            headers={"Authorization": auth_header, "Content-Type": "application/json"},
            timeout=60,
        )
        meta_response.raise_for_status()
        meta = meta_response.json()
        version = meta.get("LatestVersion") or meta.get("latestVersion") or 1
    except Exception:
        logger.warning(
            "Could not fetch file metadata for version, using version=1",
            file_id=file_id,
        )

    # Synergy download is POST with empty body (per API docs)
    response = httpx.post(
        f"{base_url}/api/v1/files/{file_id}/download?version={version}&with_references=false",
        headers={
            "Authorization": auth_header,
            "Content-Type": "application/octet-stream",
        },
        content=b"",
        timeout=120,
    )
    _check_response(response)

    # Try to extract filename from Content-Disposition header
    filename = f"synergy_file_{file_id[:8]}"
    cd = response.headers.get("content-disposition", "")
    if "filename=" in cd:
        parts = cd.split("filename=")
        if len(parts) > 1:
            filename = parts[1].strip().strip('"').strip("'")

    return response.content, filename


# ---------------------------------------------------------------------------
# Normalizers — consistent output format
# ---------------------------------------------------------------------------


def _normalize_job(job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = (job.get("ID") or {}).get("IDString")
    return {
        "job_id": job_id or job.get("IDString"),
        "name": job.get("Name"),
        "description": job.get("Description"),
        "path": job.get("Path"),
        "no_of_folders": job.get("NoOfFolders"),
        "no_of_children": job.get("NoOfChildren"),
    }


def _normalize_file(file: Dict[str, Any]) -> Dict[str, Any]:
    file_id = (file.get("ID") or {}).get("IDString")
    return {
        "file_id": file_id or file.get("IDString"),
        "name": file.get("FileName") or file.get("Name"),
        "size": file.get("FileSize") or file.get("Size"),
        "content_type": file.get("ContentType") or file.get("MimeType"),
        "modified_at": file.get("ModifiedDate") or file.get("LastModified"),
    }


def _normalize_folder(folder: Dict[str, Any]) -> Dict[str, Any]:
    folder_id = (folder.get("ID") or {}).get("IDString")
    return {
        "folder_id": folder_id or folder.get("IDString"),
        "name": folder.get("Name"),
        "has_subfolders": folder.get("HasSubFolders")
        or (folder.get("NoOfSubFolders") or 0) > 0,
        "no_of_subfolders": folder.get("NoOfSubFolders"),
        "folder_type": folder.get("FolderType"),
    }
