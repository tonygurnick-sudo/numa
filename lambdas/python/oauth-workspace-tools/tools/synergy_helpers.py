"""Synergy API helpers for browsing jobs, folders, and files.

Extracted from data-connectors Lambda for use in the unified connect tool.
Each Lambda is self-contained — no cross-Lambda imports.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
import structlog

from prm import client as prm_client
from prm import resource as prm_resource

logger = structlog.get_logger()

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
DATA_CONNECTORS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_TABLE_NAME", "")
VAULT_AUDIT_LOG_TABLE_NAME = os.environ.get("VAULT_AUDIT_LOG_TABLE_NAME", "")

# Audit dedup: a chat turn that calls Synergy 20 times shouldn't write 20
# audit rows. Module-level so it survives across warm-container invocations.
_LAST_SYNERGY_AUDIT_TS: Dict[Tuple[str, str], float] = {}
_SYNERGY_AUDIT_DEDUP_SECONDS = 60


def _audit_synergy_fetch(user_sub: str, secret_name: str) -> None:
    """Write an ai_access audit row when chat resolves Synergy credentials.

    Synergy's credential lookup bypasses get_oauth_token entirely (it reads
    the user's PAT plus an admin-configured server URL), so we audit at the
    public credential-resolver instead.
    """
    if not VAULT_AUDIT_LOG_TABLE_NAME or not user_sub:
        return

    key = (user_sub, secret_name)
    now = time.time()
    last = _LAST_SYNERGY_AUDIT_TS.get(key, 0.0)
    if now - last < _SYNERGY_AUDIT_DEDUP_SECONDS:
        return
    _LAST_SYNERGY_AUDIT_TS[key] = now

    try:
        dynamodb = prm_client("dynamodb")
        audit_id = str(uuid.uuid4())
        ttl = int(now) + (90 * 86400)
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now))
        item: Dict[str, Any] = {
            "user_id": user_sub,
            "timestamp_audit_id": f"{timestamp}#{audit_id}",
            "secret_id": secret_name,
            "secret_name": secret_name,
            "action": "ai_access",
            "accessor": "workspace_agent",
            "actor_email": "",
            "purpose": "Connector credential fetch: synergy",
            "conversation_id": "",
            "approved_by": "oauth_grant",
            "created_at": timestamp,
            "ttl": ttl,
        }
        dynamodb.put_item(
            TableName=VAULT_AUDIT_LOG_TABLE_NAME,
            Item={
                k: {"S": str(v)} if not isinstance(v, int) else {"N": str(v)}
                for k, v in item.items()
            },
        )
    except Exception as e:
        logger.warning(
            "Failed to write Synergy audit log",
            user_sub=user_sub,
            secret_name=secret_name,
            error=str(e),
        )


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


def _get_admin_instance_url(connector_id: str) -> Optional[str]:
    """Return the admin-configured API base URL for a connector, or None.

    Synergy (and any future customer-hosted API) reads its base URL from
    `connector-config-{id}.fields.instance_url` in the COMPANY vault, written
    by the ApiKeyWizard at registration time. This is workspace-wide — every
    user's requests go to the same admin-supplied URL, so it doesn't belong
    in the per-user credential payload.

    Legacy fallback: older Synergy entries may live under `connector-{id}`
    (pre-split) with a `server` or `instance_url` field.
    """
    try:
        from .oauth_tools import _get_consolidated_company_vault

        secrets = _get_consolidated_company_vault() or {}
    except Exception:
        return None

    for key in (f"connector-config-{connector_id}", f"connector-{connector_id}"):
        entry = secrets.get(key)
        if not entry:
            continue
        fields = entry.get("fields") or entry
        if not isinstance(fields, dict):
            continue
        url = fields.get("instance_url") or fields.get("server")
        if url:
            return str(url).strip()
    return None


def _get_synergy_credentials_from_user_vault(
    user_sub: str,
) -> Optional[tuple[str, str]]:
    """Return (server, access_token) — user PAT joined with admin-configured URL.

    User vault supplies `connector-synergy.fields.access_token` (captured in
    chat / sidebar widget). Company vault supplies `connector-config-synergy
    .fields.instance_url` (set in ApiKeyWizard). Both are required.

    Legacy fallback: if the user vault still has `instance_url` / `server`
    from a pre-split connect, we honour it so existing users don't break
    mid-deploy.
    """
    try:
        # Import lazily to avoid circular imports — oauth_tools imports us.
        from .oauth_tools import _get_user_consolidated_vault

        vault = _get_user_consolidated_vault(user_sub) or {}
    except Exception:
        return None

    admin_server = _get_admin_instance_url("synergy")

    secrets = vault.get("secrets", {}) if isinstance(vault, dict) else {}
    for secret_key in ("connector-synergy", "oauth-synergy"):
        entry = secrets.get(secret_key)
        if not entry:
            continue
        fields = entry.get("fields") or entry
        if not isinstance(fields, dict):
            continue
        token = (
            fields.get("access_token")
            or fields.get("api_key")
            or fields.get("bearer_token")
            or fields.get("token")
        )
        # Admin-configured URL wins; legacy per-user URL is only used if admin
        # hasn't set one yet (grace period for existing deployments).
        server = admin_server or fields.get("instance_url") or fields.get("server")
        if token and server:
            return str(server), str(token)
    return None


def get_synergy_credentials(user_sub: str) -> Optional[tuple[str, str]]:
    """Return Synergy (server, access_token) for the user, or None if not configured.

    Checks the user's consolidated vault first (new inline credential-capture
    flow), then falls back to the legacy data-connectors DynamoDB + Secrets
    Manager record. The DynamoDB path still handles PAT rotation for users
    who set up Synergy via the old /data-connectors admin page.

    Audit: any successful credential resolve is logged as an `ai_access` row
    against the user's vault audit table — Synergy bypasses get_oauth_token
    so we have to instrument here directly (TASK-146).
    """
    # Preferred: per-user vault credential.
    vault_creds = _get_synergy_credentials_from_user_vault(user_sub)
    if vault_creds:
        _audit_synergy_fetch(user_sub, "connector-synergy")
        return vault_creds

    # Fallback: legacy DynamoDB record with auto-rotation.
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

        _audit_synergy_fetch(user_sub, "connector-synergy-legacy")
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
    """True if the user has a usable Synergy credential in any supported location.

    Checks user vault first (new `connector-synergy` / legacy `oauth-synergy`),
    then the legacy DynamoDB record.
    """
    if _get_synergy_credentials_from_user_vault(user_sub) is not None:
        return True

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
    """Search jobs in Synergy."""
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
                # False = return all jobs (not restricted to top-level only).
                # The Synergy API docs' sample payload uses false here; true
                # hides every job that lives under a parent, which on most
                # customer instances is effectively all of them.
                "Value": False,
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
    """Return a folder's subfolders and ALL of its files.

    Synergy's `/api/v1/folders/{id}/items` only returns the first
    (default-size) page of `Files`, with no way to request more from that
    endpoint. The chat agent has no "load more" affordance, so we page through
    every file via the dedicated paginated endpoint
    (`/folders/{id}/files/{retrieve_attrs}/{page}/{page_size}/{filter}/{show_deleted}`)
    and return the complete set, so the agent sees the whole folder.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }

    # Subfolders: single shot from /items (they don't paginate).
    items_response = httpx.get(
        f"{base_url}/api/v1/folders/{folder_id}/items",
        headers=headers,
        timeout=60,
    )
    _check_response(items_response)
    items_data = items_response.json() or {}
    subfolders = [
        _normalize_folder(folder)
        for folder in items_data.get("SubFolders", [])
        if isinstance(folder, dict)
    ]

    # Files: walk every page via the dedicated paginated endpoint.
    files: List[Dict[str, Any]] = []
    files_total = 0
    page = 1
    page_size = 100
    max_pages = 100  # safety cap (10k files) so a pathological folder can't hang
    while page <= max_pages:
        # {filter} is a SQL LIKE pattern — `%25` is the URL-encoded `%`
        # wildcard (match all); a literal `*` matches nothing on 12d.
        files_url = (
            f"{base_url}/api/v1/folders/{folder_id}/files"
            f"/true/{page}/{page_size}/%25/false"
        )
        response = httpx.get(files_url, headers=headers, timeout=60)
        _check_response(response)
        data = response.json() or {}
        page_items = data.get("Result") or data.get("Items") or data.get("items") or []
        files.extend(_normalize_file(f) for f in page_items if isinstance(f, dict))
        files_total = (
            data.get("TotalRows") or data.get("Total") or files_total or len(files)
        )
        total_pages = data.get("TotalPages") or data.get("totalPages") or 1
        if page >= total_pages or not page_items:
            break
        page += 1

    return {
        "folder_id": folder_id,
        "subfolders": subfolders,
        "files": files,
        "files_total": files_total,
    }


def _build_limit_id(id_string: str) -> Dict[str, Any]:
    """Build a 12d ``LimitID`` object from an ``N_N`` IDString.

    12d's ``/files/search`` needs the *server* id as well as the entity id:
    ``"8_1"`` -> ``{"_id": 8, "_server_id": 1, "IDString": "8_1"}``. Sending
    only ``IDString`` returns HTTP 500 ("Object reference not set to an
    instance of an object") — that malformed payload was why early file-search
    attempts failed and were mistaken for an indexing problem.
    """
    obj: Dict[str, Any] = {"IDString": id_string}
    parts = (id_string or "").split("_")
    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
        obj["_id"] = int(parts[0])
        obj["_server_id"] = int(parts[1])
    return obj


def search_files(
    server: str,
    token: str,
    query: str,
    job_id: str,
    page_size: int = 25,
    show_deleted: bool = False,
) -> Dict[str, Any]:
    """Search files within a job by name AND contents, merged.

    12d file search is **job-scoped** — it requires ``LimitSearchTo=2`` (the job
    and its sub-jobs) plus the job's full ``LimitID``. There is no working
    global file search; the 12d web client itself always scopes to a job. We run
    the filename and full-text *content* searches separately and merge the
    results (deduped by file_id) so one query matches both file names and
    document contents. Full-text content search works — verified live against
    the cuttriss instance.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    base_body: Dict[str, Any] = {
        "Page": 1,
        "PageSize": page_size,
        "Attributes": [],
        "ShowDeletedFiles": show_deleted,
        "LimitSearchTo": 2,  # job + sub-jobs (verified against the web client)
        "LimitID": _build_limit_id(job_id),
    }

    merged: Dict[str, Dict[str, Any]] = {}
    for field in ("FileName", "Contents"):
        body = {**base_body, field: query}
        try:
            response = httpx.post(
                f"{base_url}/api/v1/files/search",
                json=body,
                headers=headers,
                timeout=90,
            )
            _check_response(response)
        except SynergyAuthError:
            raise
        except httpx.HTTPError as exc:
            # One field failing must not sink the whole search — keep whatever
            # the other field returned.
            logger.warning(
                "Synergy file search field failed",
                field=field,
                job_id=job_id,
                error=str(exc),
            )
            continue
        data = response.json()
        items = data.get("Result") or data.get("Items") or data.get("items") or []
        for raw in items:
            if not isinstance(raw, dict):
                continue
            normalized = _normalize_file(raw)
            fid = normalized.get("file_id")
            if fid and fid not in merged:
                merged[fid] = normalized

    files = list(merged.values())
    return {"job_id": job_id, "files": files, "files_total": len(files)}


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
        "path": file.get("Path") or file.get("FolderPath") or "",
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
