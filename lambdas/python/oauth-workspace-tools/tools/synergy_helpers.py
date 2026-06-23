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
from synergy_tokenize import tokenize_for_index

logger = structlog.get_logger()

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
DATA_CONNECTORS_TABLE_NAME = os.environ.get("DATA_CONNECTORS_TABLE_NAME", "")
VAULT_AUDIT_LOG_TABLE_NAME = os.environ.get("VAULT_AUDIT_LOG_TABLE_NAME", "")

# Audit dedup: a chat turn that calls Synergy 20 times shouldn't write 20
# audit rows. Module-level so it survives across warm-container invocations.
_LAST_SYNERGY_AUDIT_TS: Dict[Tuple[str, str], float] = {}
_SYNERGY_AUDIT_DEDUP_SECONDS = 60
# Hard cap on the module-level dedup map so a long-lived warm container serving
# many users can't grow it without bound (entries past the dedup window are
# already pruned opportunistically; this is the belt-and-braces ceiling).
_SYNERGY_AUDIT_DEDUP_MAX_ENTRIES = 4096


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
    # Opportunistically prune entries that can no longer suppress a write (older
    # than the dedup window) so this module-level map can't grow unbounded across
    # warm-container invocations. Belt-and-braces: if it's still oversized, evict
    # the oldest entries. Dedup behaviour is unchanged — only stale keys go.
    cutoff = now - _SYNERGY_AUDIT_DEDUP_SECONDS
    for k in [k for k, ts in _LAST_SYNERGY_AUDIT_TS.items() if ts < cutoff]:
        _LAST_SYNERGY_AUDIT_TS.pop(k, None)
    if len(_LAST_SYNERGY_AUDIT_TS) >= _SYNERGY_AUDIT_DEDUP_MAX_ENTRIES:
        overflow = len(_LAST_SYNERGY_AUDIT_TS) - _SYNERGY_AUDIT_DEDUP_MAX_ENTRIES + 1
        for k, _ts in sorted(_LAST_SYNERGY_AUDIT_TS.items(), key=lambda kv: kv[1])[
            :overflow
        ]:
            _LAST_SYNERGY_AUDIT_TS.pop(k, None)
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


def _seg(v: Any) -> str:
    """Percent-encode a user-controlled value for use as a single URL path segment.

    12d entity ids (``8_1``) are normally safe, but they are user/agent-supplied
    and interpolated straight into the path, so encode them defensively — a value
    containing ``/`` or ``?`` could otherwise reshape the request. ``safe=""``
    encodes everything (including ``/``); never wrap an already-``quote()``-d
    value or you'll double-encode it.
    """
    from urllib.parse import quote

    return quote(str(v if v is not None else ""), safe="")


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


# Wall-clock budget for walking the jobs pages. The backing Lambda times out at
# 120s; on a large 12d instance an UNFILTERED jobs/search is slow per page and
# there can be many pages, so walking them all (the old behaviour) blew the
# Lambda budget and the whole list call failed — even when the user only wanted
# the first few. We instead return whatever we gathered within this budget and
# flag it truncated, so the caller gets a fast partial answer + can narrow by name.
SYNERGY_LIST_DEADLINE_S = float(os.getenv("SYNERGY_LIST_DEADLINE_S", "20"))


def search_all_jobs(
    server: str,
    token: str,
    name: str = "",
    page_size: int = 100,
    max_pages: int = 50,
    deadline_seconds: Optional[float] = None,
) -> Dict[str, Any]:
    """Fetch matching jobs across pages, bounded by a wall-clock deadline.

    ``search_jobs`` returns a single page; the chat agent has no "load more"
    affordance, so page-1-only silently truncated big accounts. We walk pages and
    return the complete set when feasible — but a full unfiltered walk on a large
    instance exceeds the Lambda timeout, so we STOP at ``deadline_seconds`` (or
    ``max_pages``) and return the partial set with ``truncated=True``. Also stops
    on a short/empty page (the universal last-page signal).
    """
    page_size = max(int(page_size or 100), 1)
    budget = SYNERGY_LIST_DEADLINE_S if deadline_seconds is None else deadline_seconds
    started = time.monotonic()
    jobs: List[Dict[str, Any]] = []
    total_rows = 0
    truncated = False
    page = 1
    while True:
        data = search_jobs(server, token, name=name, page=page, page_size=page_size)
        page_items = data.get("items") or []
        jobs.extend(page_items)
        total_rows = data.get("total_rows") or total_rows
        total_pages = data.get("total_pages")
        # Stop on a short/empty page, an explicit last page, or once we've
        # gathered the reported total.
        if not page_items or len(page_items) < page_size:
            break
        if total_pages and page >= total_pages:
            break
        if total_rows and len(jobs) >= total_rows:
            break
        # Bound the walk: never risk the Lambda timeout. Return what we have and
        # let the caller surface "narrow your search" guidance.
        if page >= max_pages or (time.monotonic() - started) >= budget:
            truncated = (not total_rows) or len(jobs) < total_rows
            break
        page += 1
    return {
        "items": jobs,
        "total_rows": total_rows or len(jobs),
        "pages_fetched": page,
        "truncated": truncated,
    }


def get_job_meta(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Structural metadata + child counts for a job (cheap, two single calls).

    `/jobs/{id}/items` → JobItemsModel (SubJobs / SubFolders / Sub12dProjects /
    Forums) gives the composition; `/jobs/{id}/true` gives the job's own
    attributes (type, status, dates, custom fields). Both are single-shot.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    items_resp = httpx.get(
        f"{base_url}/api/v1/jobs/{_seg(job_id)}/items", headers=headers, timeout=60
    )
    _check_response(items_resp)
    items = items_resp.json() or {}

    attributes: Dict[str, Any] = {}
    try:
        detail = httpx.get(
            f"{base_url}/api/v1/jobs/{_seg(job_id)}/true", headers=headers, timeout=60
        )
        _check_response(detail)
        attributes = detail.json() or {}
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        pass  # attributes are best-effort; counts are the core value

    def _count(key: str) -> int:
        val = items.get(key)
        return len(val) if isinstance(val, list) else 0

    return {
        "job_id": job_id,
        "name": attributes.get("Name") or items.get("Name") or job_id,
        "counts": {
            "sub_jobs": _count("SubJobs"),
            "sub_folders": _count("SubFolders"),
            "projects_12d": _count("Sub12dProjects"),
            "forums": _count("Forums"),
        },
        "attributes": attributes,
    }


def get_file_metadata(server: str, token: str, file_id: str) -> Dict[str, Any]:
    """File detail for one Synergy file (`/files/{id}/true` → FileModel),
    normalised to the connector file-metadata shape so `file-info` renders it."""
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    resp = httpx.get(
        f"{base_url}/api/v1/files/{_seg(file_id)}/true", headers=headers, timeout=60
    )
    _check_response(resp)
    d = resp.json() or {}

    def _f(*keys: str) -> Any:
        for k in keys:
            v = d.get(k)
            if v not in (None, ""):
                return v
        return None

    size = _f("FileSize", "Size")
    try:
        size = int(size) if size is not None else None
    except (TypeError, ValueError):
        size = None
    return {
        "name": str(_f("FileName", "Name") or file_id),
        "path": _f("Path"),
        "size": size,
        "version": str(_f("LatestVersion", "Version") or "") or None,
        "created_at": _f("DateCreated", "Created", "CreatedOn"),
        "modified_at": _f("LastModified", "DateModified", "UpdatedOn"),
        "file_id": file_id,
        "provider": "synergy",
        "attributes": d.get("Attributes"),
    }


def get_folder_summary(server: str, token: str, folder_id: str) -> Dict[str, Any]:
    """Counts + first-page size for a folder (single `/folders/{id}/items` call).

    FolderItemsModel carries SubFolders, TDJobs, and Files (a PagedResultModel —
    its TotalRows is the real file count without walking pages)."""
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    resp = httpx.get(
        f"{base_url}/api/v1/folders/{_seg(folder_id)}/items",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    sub_folders = data.get("SubFolders")
    files_paged = data.get("Files") or {}
    page_items = files_paged.get("Result") or files_paged.get("Items") or []
    page_bytes = 0
    for f in page_items:
        if isinstance(f, dict):
            try:
                page_bytes += int(f.get("FileSize") or f.get("Size") or 0)
            except (TypeError, ValueError):
                pass
    return {
        "folder_id": folder_id,
        "subfolder_count": len(sub_folders) if isinstance(sub_folders, list) else 0,
        "file_count": files_paged.get("TotalRows")
        or files_paged.get("Total")
        or len(page_items),
        "first_page_bytes": page_bytes,
    }


def get_job_schema(server: str, token: str) -> Dict[str, Any]:
    """The job attribute vocabulary — what fields exist to filter/report on.

    `jobs/getStandardAttributes` (the standard set) + the standard SEARCH
    attributes (the ones usable as query filters). Both single calls. This is
    what lets the agent know, e.g., that 'Job Type' / 'Status' / a custom field
    exist and what values are valid."""
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }

    def _get(path: str) -> Any:
        try:
            r = httpx.get(f"{base_url}{path}", headers=headers, timeout=60)
            _check_response(r)
            return r.json()
        except (httpx.HTTPError, ValueError):
            return None

    return {
        "standard_attributes": _get("/api/v1/jobs/getStandardAttributes"),
        "search_attributes": _get("/api/v1/Attributes/getStandardJobSearchAttributes"),
    }


# Bounds for the recursive job walk (job-stats / job-tree). Never risk the
# Lambda timeout on a deep/wide job — return partial + truncated instead.
SYNERGY_WALK_DEADLINE_S = float(os.getenv("SYNERGY_WALK_DEADLINE_S", "30"))
SYNERGY_WALK_MAX_DEPTH = int(os.getenv("SYNERGY_WALK_MAX_DEPTH", "10"))
SYNERGY_WALK_MAX_FOLDERS = int(os.getenv("SYNERGY_WALK_MAX_FOLDERS", "400"))


def _ext(name: str) -> str:
    name = (name or "").lower()
    return name.rsplit(".", 1)[-1] if "." in name else "(none)"


def _walk_job_tree(
    server: str,
    token: str,
    job_id: str,
    *,
    max_depth: int,
    deadline_s: float,
) -> Dict[str, Any]:
    """Bounded breadth-first walk of a job's folder tree.

    Per folder, `/folders/{id}/items` gives subfolders (free) + the accurate file
    count (`Files.TotalRows`, no paging) + a page-1 file SAMPLE used for
    type/size stats. Stops at max_depth / a folder cap / a wall-clock deadline
    and flags `truncated`, so it never approaches the Lambda timeout."""
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    started = time.monotonic()

    def _items(fid: str) -> Dict[str, Any]:
        r = httpx.get(
            f"{base_url}/api/v1/folders/{fid}/items", headers=headers, timeout=60
        )
        _check_response(r)
        return r.json() or {}

    # Seed with the job's top-level folders.
    job_items = httpx.get(
        f"{base_url}/api/v1/jobs/{_seg(job_id)}/items", headers=headers, timeout=60
    )
    _check_response(job_items)
    seed = job_items.json() or {}

    nodes: List[Dict[str, Any]] = []
    file_sample: List[Dict[str, Any]] = []
    total_files = 0
    total_folders = 0
    max_depth_seen = 0
    truncated = False

    visited: set[str] = set()  # guard against folder cycles / repeated ids
    queue: List[Tuple[Dict[str, Any], int, str]] = []
    for sf in seed.get("SubFolders") or []:
        if isinstance(sf, dict):
            queue.append((sf, 1, ""))

    while queue:
        if (
            total_folders >= SYNERGY_WALK_MAX_FOLDERS
            or (time.monotonic() - started) >= deadline_s
        ):
            truncated = True
            break
        folder, depth, parent_path = queue.pop(0)
        # ID may be a nested {"IDString": ...} object or a flat id — never assume
        # it's a dict (a malformed truthy non-dict would crash `.get`).
        id_obj = folder.get("ID")
        fid = str(
            (id_obj.get("IDString") if isinstance(id_obj, dict) else None)
            or folder.get("IDString")
            or folder.get("id")
            or ""
        )
        fname = str(folder.get("Name") or folder.get("name") or fid)
        if not fid or fid in visited:
            continue
        visited.add(fid)
        total_folders += 1
        max_depth_seen = max(max_depth_seen, depth)
        path = f"{parent_path}/{fname}" if parent_path else fname
        try:
            data = _items(fid)
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            continue
        files_paged = data.get("Files") or {}
        page_items = files_paged.get("Result") or files_paged.get("Items") or []
        fcount = (
            files_paged.get("TotalRows") or files_paged.get("Total") or len(page_items)
        )
        total_files += int(fcount or 0)
        for f in page_items:
            if isinstance(f, dict):
                file_sample.append(f)
        nodes.append(
            {
                "folder_id": fid,
                "name": fname,
                "path": path,
                "depth": depth,
                "file_count": fcount,
            }
        )
        subs = data.get("SubFolders") or []
        if depth < max_depth:
            for sf in subs:
                if isinstance(sf, dict):
                    queue.append((sf, depth + 1, path))
        elif subs:
            truncated = True

    return {
        "job_id": job_id,
        "nodes": nodes,
        "total_folders": total_folders,
        "total_files": total_files,
        "file_sample": file_sample,
        "max_depth_reached": max_depth_seen,
        "truncated": truncated,
    }


def get_job_stats(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Aggregate stats for a job: folder/file counts, file-type mix, size buckets,
    largest sampled file, depth. Counts are exact (TotalRows); the type/size mix
    is from a per-folder page-1 SAMPLE (flagged), so it's cheap and bounded."""
    walk = _walk_job_tree(
        server,
        token,
        job_id,
        max_depth=SYNERGY_WALK_MAX_DEPTH,
        deadline_s=SYNERGY_WALK_DEADLINE_S,
    )
    sample = walk["file_sample"]
    type_mix: Dict[str, int] = {}
    size_buckets = {
        "<100KB": 0,
        "100KB-1MB": 0,
        "1-10MB": 0,
        "10-100MB": 0,
        ">100MB": 0,
    }
    sampled_bytes = 0
    largest = {"name": None, "size": 0}
    for f in sample:
        name = str(f.get("FileName") or f.get("Name") or "")
        type_mix[_ext(name)] = type_mix.get(_ext(name), 0) + 1
        try:
            size = int(f.get("FileSize") or f.get("Size") or 0)
        except (TypeError, ValueError):
            size = 0
        sampled_bytes += size
        if size > int(largest["size"] or 0):
            largest = {"name": name, "size": size}
        mb = size / (1024 * 1024)
        bucket = (
            "<100KB"
            if size < 100 * 1024
            else (
                "100KB-1MB"
                if mb < 1
                else "1-10MB" if mb < 10 else "10-100MB" if mb < 100 else ">100MB"
            )
        )
        size_buckets[bucket] += 1
    return {
        "job_id": job_id,
        "total_folders": walk["total_folders"],
        "total_files": walk["total_files"],
        "max_depth": walk["max_depth_reached"],
        "file_type_mix": dict(sorted(type_mix.items(), key=lambda kv: -kv[1])),
        "size_buckets": size_buckets,
        "largest_sampled_file": largest if largest["name"] else None,
        "sampled_files": len(sample),
        "sampled_bytes": sampled_bytes,
        "sample_coverage_pct": (
            round(100 * len(sample) / walk["total_files"], 1)
            if walk["total_files"]
            else 100.0
        ),
        "truncated": walk["truncated"],
        "note": (
            "Folder/file counts are exact (TotalRows). The file-type mix, size "
            f"buckets and largest file are from a {len(sample)}-file sample "
            f"({(round(100 * len(sample) / walk['total_files'], 1) if walk['total_files'] else 100.0)}% "
            "of files — page 1 of each folder); treat the distribution as indicative, "
            "not exact, when coverage is low."
            + (
                " Walk was truncated (depth/deadline/budget cap)."
                if walk["truncated"]
                else ""
            )
        ),
    }


def get_job_tree(
    server: str, token: str, job_id: str, max_depth: int = SYNERGY_WALK_MAX_DEPTH
) -> Dict[str, Any]:
    """The job's folder outline (path + file count per folder), depth-bounded."""
    walk = _walk_job_tree(
        server, token, job_id, max_depth=max_depth, deadline_s=SYNERGY_WALK_DEADLINE_S
    )
    return {
        "job_id": job_id,
        "folders": [
            {"path": n["path"], "depth": n["depth"], "file_count": n["file_count"]}
            for n in walk["nodes"]
        ],
        "total_folders": walk["total_folders"],
        "total_files": walk["total_files"],
        "truncated": walk["truncated"],
    }


# Bound the structured portfolio scan so a huge tenant can't blow the Lambda
# budget — return a partial + truncated and tell the agent to narrow.
SYNERGY_PORTFOLIO_MAX_SCAN = int(os.getenv("SYNERGY_PORTFOLIO_MAX_SCAN", "30000"))


def portfolio_query(
    table_name: str,
    user_sub: str,
    *,
    attr_filters: Optional[Dict[str, str]] = None,
    created_after: str = "",
    created_before: str = "",
    exclude_templates: bool = False,
    group_by: str = "",
    limit: int = 100,
) -> Dict[str, Any]:
    """Exhaustive structured query over the crawl JOB# rows (NOT the semantic KB).

    Answers "list/count ALL jobs where <attr>=… / created in range / not a
    template" with ACL enforced — only jobs whose allowed_users contains the
    caller. Scans the state table with a server-side FilterExpression (bounded by
    SYNERGY_PORTFOLIO_MAX_SCAN). `group_by` returns a faceted count by a stamped
    key (e.g. attr_status). This is the deterministic counterpart to the KB's
    top-K similarity search — counts here are exact within ACL scope.
    """
    from boto3.dynamodb.conditions import Attr

    table = prm_resource("dynamodb").Table(table_name)
    cond = (
        Attr("sk").eq("META")
        & Attr("pk").begins_with("JOB#")
        & Attr("allowed_users").contains(user_sub)  # ACL — fail-closed per row
        # On-visit-granted JOB# rows are created with only an ACL + pk/sk and
        # lack structured attributes until the next scheduled crawl stamps them.
        # `is_template` is one such attribute the coordinator always writes for a
        # fully-stamped row, so its presence is a proxy for "structured". Require
        # it so half-written rows (null name/path/created_date) never enter the
        # structured results — they stay reachable via the ACL-filtered KB search.
        & Attr("is_template").exists()
    )
    for k, v in (attr_filters or {}).items():
        cond = cond & Attr(k).eq(str(v))
    if created_after:
        cond = cond & Attr("created_date").gte(str(created_after))
    if created_before:
        cond = cond & Attr("created_date").lte(str(created_before))
    if exclude_templates:
        # JOB# rows store is_template as a native DynamoDB BOOL (the coordinator
        # writes bool(Type == 1)), so compare against the boolean — `.ne("true")`
        # against a string never matches and would exclude nothing.
        cond = cond & Attr("is_template").ne(True)

    matched: List[Dict[str, Any]] = []
    facet: Dict[str, int] = {}
    scanned = 0
    truncated = False
    scan_kwargs: Dict[str, Any] = {"FilterExpression": cond}
    while True:
        resp = table.scan(**scan_kwargs)
        for it in resp.get("Items", []):
            matched.append(it)
            if group_by:
                facet[str(it.get(group_by) or "(none)")] = (
                    facet.get(str(it.get(group_by) or "(none)"), 0) + 1
                )
        scanned += int(resp.get("ScannedCount", 0) or 0)
        lek = resp.get("LastEvaluatedKey")
        if not lek or scanned >= SYNERGY_PORTFOLIO_MAX_SCAN:
            truncated = bool(lek)
            break
        scan_kwargs["ExclusiveStartKey"] = lek

    jobs = [
        {
            "job_id": str(it.get("job_id") or str(it.get("pk", ""))[len("JOB#") :]),
            "name": it.get("job_name"),
            "path": it.get("job_path"),
            "created_date": it.get("created_date"),
            **{
                k: it.get(k) for k in it if isinstance(k, str) and k.startswith("attr_")
            },
        }
        for it in matched[: max(int(limit or 100), 1)]
    ]
    return {
        "total_count": len(matched),
        "returned": len(jobs),
        "jobs": jobs,
        # ``scanned`` is the DynamoDB ScannedCount summed across pages (rows the
        # FilterExpression touched, NOT the rows returned) — the read-capacity
        # proxy the caller meters at the cost-recovery floor. Returned, not
        # discarded, so the handler can price the query's consumption.
        "scanned": scanned,
        "facet": (
            dict(sorted(facet.items(), key=lambda kv: -kv[1])) if group_by else None
        ),
        "group_by": group_by or None,
        "truncated": truncated,
        "note": (
            "Exact counts within your access scope (ACL-filtered)."
            + (
                " Scan hit its cap — counts are a lower bound; narrow with filters."
                if truncated
                else ""
            )
        ),
    }


SYNERGY_EXACT_TERM_MAX_JOBS_PER_TERM = int(
    os.getenv("SYNERGY_EXACT_TERM_MAX_JOBS_PER_TERM", "5000")
)

# Wall-clock budget for the whole exact-term search (GSI paging + ACL probe).
# The backing Lambda times out at 120s. A common stemmed token ('wall'/'report')
# can live in 100k+ jobs → 100+ sequential 1MB Query pages, and the round-1 AND
# fix removed the per-term cap with no replacement bound — so a single hot token
# could walk forever. Every other walk in this file is deadline-bounded; this
# brings exact_term_search in line. Stopping an AND term early yields a SUBSET of
# its true job set, so the intersection can only DROP true matches (false
# negatives), never add false ones — truncated=True + the "narrow to a rarer
# term" note is the honest signal. Same deadline also bounds the ACL phase.
SYNERGY_EXACT_TERM_DEADLINE_S = float(os.getenv("SYNERGY_EXACT_TERM_DEADLINE_S", "25"))

# Secondary bound on a single token's GSI walk — page-count cap so one hot token
# can't monopolise the whole deadline before any sibling term gets a turn.
SYNERGY_EXACT_TERM_MAX_PAGES_PER_TERM = int(
    os.getenv("SYNERGY_EXACT_TERM_MAX_PAGES_PER_TERM", "100")
)

# Bound on how many AND candidates we ACL-probe before giving up regardless of
# how many matched — protects against a caller who can access few/none of the
# candidates from running thousands of serial reads to the timeout.
SYNERGY_EXACT_TERM_MAX_ACL_PROBE = int(
    os.getenv("SYNERGY_EXACT_TERM_MAX_ACL_PROBE", "1000")
)

# BatchGetItem hard limit per request is 100 keys.
_SYNERGY_BATCH_GET_SIZE = 100

# Bounded retry for BatchGetItem UnprocessedKeys (throttling/partial responses).
_SYNERGY_BATCH_GET_MAX_RETRIES = 3


def _batch_get_job_meta(table: Any, job_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """BatchGetItem the JOB#/META rows for ``job_ids`` (≤100), keyed by job_id.

    Uses the table resource's underlying ``batch_get_item`` (DynamoDB resource
    API — deserializes to native types, so ``allowed_users`` arrives as a set,
    matching the old ``get_item`` path). Handles ``UnprocessedKeys`` with a
    bounded retry. Missing rows (purged jobs) are simply absent from the result.
    """
    if not job_ids:
        return {}

    # `table.meta.client` is the low-level client; we want the resource-level
    # batch_get_item that returns deserialized items. The resource is reachable
    # via the table's `meta` — but boto3 exposes batch_get_item on the service
    # resource, which the Table doesn't carry a handle to. prm_resource() gives
    # us a fresh service resource with the same PRM wiring.
    service = prm_resource("dynamodb")
    table_name = table.name
    request_keys = [{"pk": f"JOB#{jid}", "sk": "META"} for jid in job_ids]

    out: Dict[str, Dict[str, Any]] = {}
    attempt = 0
    while request_keys and attempt <= _SYNERGY_BATCH_GET_MAX_RETRIES:
        resp = service.batch_get_item(RequestItems={table_name: {"Keys": request_keys}})
        for row in resp.get("Responses", {}).get(table_name, []):
            pk = str(row.get("pk", ""))
            if pk.startswith("JOB#"):
                out[pk[len("JOB#") :]] = row
        unprocessed = resp.get("UnprocessedKeys", {}).get(table_name, {})
        request_keys = unprocessed.get("Keys", []) if unprocessed else []
        attempt += 1
    return out


def exact_term_search(
    table_name: str,
    user_sub: str,
    *,
    terms: List[str],
    mode: str = "AND",
    limit: int = 100,
) -> Dict[str, Any]:
    """Exact-term search over the crawl TERM rows — "which jobs contain these
    literal words/codes" — ACL-enforced, exhaustive (the 4th search mode).

    User terms are normalized with the SAME shared tokenizer the crawler indexed
    with (so ``walls`` matches stored ``wall``, ``DWG-2401`` stays verbatim). Each
    token → one Query on the ``term-job-index`` GSI; AND intersects the job sets,
    OR unions them. ACL is applied at query time by reading each candidate's
    ``JOB#`` row — so stale TERM rows can never leak (a purged job has no JOB# row;
    a revoked user never matches its allowed_users)."""
    from boto3.dynamodb.conditions import Key

    table = prm_resource("dynamodb").Table(table_name)

    tokens: List[str] = []
    for t in terms or []:
        tokens.extend(tokenize_for_index(t))
    tokens = list(dict.fromkeys(tokens))  # dedupe, preserve order
    if not tokens:
        return {
            "terms": list(terms or []),
            "tokens": [],
            "jobs": [],
            "count": 0,
            "truncated": False,
            "note": "No searchable terms (all stopwords/empty).",
        }

    truncated = False
    is_or = mode.upper() == "OR"
    started = time.monotonic()
    per_token: List[set] = []
    # Read-capacity proxy for metering: every GSI item read (across all token
    # pages) plus every JOB# row ACL-probed. These are the reads that cost
    # capacity; the handler prices them at the cost-recovery floor.
    gsi_items_read = 0
    for tok in tokens:
        found: set = set()
        start_key = None
        pages = 0
        while True:
            kw: Dict[str, Any] = {
                "IndexName": "term-job-index",
                "KeyConditionExpression": Key("term").eq(tok),
            }
            if start_key:
                kw["ExclusiveStartKey"] = start_key
            resp = table.query(**kw)
            pages += 1
            page_items = resp.get("Items", [])
            gsi_items_read += len(page_items)
            for it in page_items:
                jid = str(it.get("job_id") or "")
                if jid:
                    found.add(jid)
            start_key = resp.get("LastEvaluatedKey")
            # OR caps each term independently (union only samples), but AND must
            # NOT cap per-term by job COUNT: a common term hitting the count cap
            # could drop a job that survives the intersection. For AND we page
            # the full set and cap the FINAL candidate set instead.
            per_term_full = is_or and len(found) >= SYNERGY_EXACT_TERM_MAX_JOBS_PER_TERM
            # Wall-clock / page-count bound applies to BOTH modes: a single hot
            # token can have 100+ 1MB pages and blow the 120s Lambda budget.
            # Stopping a token early yields a SUBSET of its true set — for AND
            # the intersection only loses true matches (false negatives), never
            # gains false ones; for OR the union just samples fewer. Either way
            # truncated=True is the honest signal.
            time_up = (time.monotonic() - started) >= SYNERGY_EXACT_TERM_DEADLINE_S
            pages_up = pages >= SYNERGY_EXACT_TERM_MAX_PAGES_PER_TERM
            if not start_key or per_term_full or time_up or pages_up:
                truncated = truncated or bool(start_key)
                break
        per_token.append(found)
        # Past the deadline, stop paging remaining tokens entirely — their sets
        # would be empty/partial anyway, and an empty AND set must be honestly
        # flagged truncated rather than reported as "no matches".
        if (time.monotonic() - started) >= SYNERGY_EXACT_TERM_DEADLINE_S:
            truncated = True
            break

    # If we broke out of the token loop early (deadline), some requested tokens
    # were never queried at all. For AND, intersecting only the tokens we DID
    # evaluate yields a SUPERSET of the true answer (jobs that lack the
    # un-queried terms slip through) — an unsound result we must not return.
    tokens_evaluated = len(per_token) == len(tokens)
    if not is_or and not tokens_evaluated:
        return {
            "terms": list(terms or []),
            "tokens": tokens,
            "mode": "AND",
            "jobs": [],
            "count": 0,
            "read_count": gsi_items_read,
            "truncated": True,
            "note": (
                "Could not evaluate all AND terms within the time budget — "
                "narrow to fewer/rarer terms and retry."
            ),
        }

    if is_or:
        candidates_set = set().union(*per_token) if per_token else set()
    else:
        # Intersect smallest-first (cheapest, and the result can only shrink),
        # then cap the final candidate set deterministically.
        ordered = sorted(per_token, key=len)
        candidates_set = set(ordered[0]) if ordered else set()
        for s in ordered[1:]:
            candidates_set &= s

    candidates = sorted(candidates_set)  # deterministic near the cap cutoff
    if not is_or and len(candidates) > SYNERGY_EXACT_TERM_MAX_JOBS_PER_TERM:
        candidates = candidates[:SYNERGY_EXACT_TERM_MAX_JOBS_PER_TERM]
        truncated = True

    # ACL probe — read each candidate's JOB#/META row and keep only the jobs the
    # caller can see. Batched (BatchGetItem, 100 keys/call) rather than one
    # serial get_item per candidate: with the old loop, a caller who can access
    # few/none of up to 5000 candidates ran 5000 serial reads (25-50s, 5000 RCU)
    # because the only break was on len(jobs)>=limit. We bound the TOTAL probed
    # (regardless of matches) and share the R2 wall-clock deadline.
    want = max(int(limit or 100), 1)
    jobs: List[Dict[str, Any]] = []
    probed = 0
    probe_cap = min(len(candidates), SYNERGY_EXACT_TERM_MAX_ACL_PROBE)
    for batch_start in range(0, probe_cap, _SYNERGY_BATCH_GET_SIZE):
        if (time.monotonic() - started) >= SYNERGY_EXACT_TERM_DEADLINE_S:
            truncated = True
            break
        # Clamp the final batch to the probe cap so we never read past it.
        batch = candidates[
            batch_start : min(batch_start + _SYNERGY_BATCH_GET_SIZE, probe_cap)
        ]
        probed += len(batch)
        rows = _batch_get_job_meta(table, batch)
        # Preserve deterministic order — iterate the batch, not the (unordered)
        # BatchGetItem response.
        hit_limit = False
        for idx, jid in enumerate(batch):
            row = rows.get(jid)
            if not row:
                continue  # purged job (no row) → drop
            au = row.get("allowed_users")
            if not (isinstance(au, (set, list)) and user_sub in au):
                continue  # no access → drop
            jobs.append(
                {
                    "job_id": jid,
                    "name": row.get("job_name"),
                    "path": row.get("job_path"),
                }
            )
            if len(jobs) >= want:
                # More candidates may remain — in this batch beyond `idx`, or in
                # later batches. If so, we returned only a page → truncated.
                remaining = (len(batch) - idx - 1) + (len(candidates) - probed)
                if remaining > 0:
                    truncated = True
                hit_limit = True
                break
        if hit_limit:
            break
    else:
        # Probed every batch without filling `want`: incomplete only if the
        # probe cap stopped us short of the full candidate set.
        if probe_cap < len(candidates):
            truncated = True

    note = "Exact-term matches within your access (ACL-filtered)."
    if truncated and not is_or:
        note += (
            " Result hit the cap and may be incomplete — AND-matches beyond the"
            " cap are not shown; narrow your search to a rarer term."
        )
    elif truncated and is_or:
        note += (
            " Some matches were omitted — a common term hit the sampling cap or"
            " the result limit; use fewer/rarer terms or raise the limit."
        )
    return {
        "terms": list(terms or []),
        "tokens": tokens,
        "mode": "OR" if mode.upper() == "OR" else "AND",
        "jobs": jobs,
        "count": len(jobs),
        # ``read_count`` is the read-capacity proxy the caller meters: GSI items
        # read across every token's pages + JOB# rows ACL-probed. Returned, not
        # discarded, so the handler can price the query at the cost-recovery floor.
        "read_count": gsi_items_read + probed,
        "truncated": truncated,
        "note": note,
    }


def list_job_folders(server: str, token: str, job_id: str) -> List[Dict[str, Any]]:
    """Return top-level folders for a job."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/{_seg(job_id)}/items"
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


# Wall-clock budget for the folder file page-walk (mirrors
# SYNERGY_RECENT_DEADLINE_S) so a folder with thousands of files can't walk
# 100 pages into the 120s Lambda timeout.
SYNERGY_FOLDER_ITEMS_DEADLINE_S = float(
    os.getenv("SYNERGY_FOLDER_ITEMS_DEADLINE_S", "20")
)


def get_folder_items(server: str, token: str, folder_id: str) -> Dict[str, Any]:
    """Return a folder's subfolders and ALL of its files.

    Synergy's `/api/v1/folders/{id}/items` only returns the first
    (default-size) page of `Files`, with no way to request more from that
    endpoint. The chat agent has no "load more" affordance, so we page through
    every file via the dedicated paginated endpoint
    (`/folders/{id}/files/{retrieve_attrs}/{page}/{page_size}/{filter}/{show_deleted}`)
    and return the complete set, so the agent sees the whole folder. The walk is
    bounded by max_pages + SYNERGY_FOLDER_ITEMS_DEADLINE_S; ``truncated`` is set
    when either stops us before reaching total_pages.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }

    # Subfolders: single shot from /items (they don't paginate).
    items_response = httpx.get(
        f"{base_url}/api/v1/folders/{_seg(folder_id)}/items",
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
    truncated = False
    started = time.monotonic()
    page = 1
    page_size = 100
    max_pages = 100  # safety cap (10k files) so a pathological folder can't hang
    while page <= max_pages:
        # {filter} is a SQL LIKE pattern — `%25` is the URL-encoded `%`
        # wildcard (match all); a literal `*` matches nothing on 12d.
        files_url = (
            f"{base_url}/api/v1/folders/{_seg(folder_id)}/files"
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
        # More pages remain — stop early (flagging truncated) if we hit the page
        # cap or the wall-clock budget before walking them all.
        if page >= max_pages:
            truncated = True
            break
        if (time.monotonic() - started) >= SYNERGY_FOLDER_ITEMS_DEADLINE_S:
            truncated = True
            break
        page += 1

    return {
        "folder_id": folder_id,
        "subfolders": subfolders,
        "files": files,
        "files_total": files_total,
        "truncated": truncated,
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


SYNERGY_MAX_DOWNLOAD_BYTES = int(
    os.getenv("SYNERGY_MAX_DOWNLOAD_BYTES", str(50 * 1024 * 1024))
)


def download_file(server: str, token: str, file_id: str) -> tuple[bytes, str]:
    """Download a file from Synergy. Returns (content_bytes, filename).

    Per the 12d Synergy REST API docs, file download is a POST to
    /api/v1/files/{id}/download?version={n}&with_references=false
    with Content-Type: application/octet-stream and an empty body.
    """
    base_url = _build_base_url(server)
    auth_header = _normalize_token(token)

    # Try to get the latest version number + listed size for the file
    version = 1
    size = 0
    try:
        meta_response = httpx.get(
            f"{base_url}/api/v1/files/{_seg(file_id)}",
            headers={"Authorization": auth_header, "Content-Type": "application/json"},
            timeout=60,
        )
        meta_response.raise_for_status()
        meta = meta_response.json()
        version = meta.get("LatestVersion") or meta.get("latestVersion") or 1
        size = int(meta.get("FileSize") or meta.get("Size") or 0)
    except Exception:
        logger.warning(
            "Could not fetch file metadata for version, using version=1",
            file_id=file_id,
        )

    # Early-reject a known-oversized file BEFORE buffering its body. The handler
    # also caps post-buffer (MAX_DOWNLOAD_SIZE), but rejecting on the listed size
    # first avoids pulling a multi-GB file into Lambda memory (OOM).
    if size and size > SYNERGY_MAX_DOWNLOAD_BYTES:
        raise ValueError(
            f"File too large ({size // (1024 * 1024)}MB). "
            f"Max is {SYNERGY_MAX_DOWNLOAD_BYTES // (1024 * 1024)}MB."
        )

    # Synergy download is POST with empty body (per API docs)
    response = httpx.post(
        f"{base_url}/api/v1/files/{_seg(file_id)}/download?version={version}&with_references=false",
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
    job_id = _id_string(job)
    return {
        "job_id": job_id,
        "name": job.get("Name"),
        "description": job.get("Description"),
        "path": job.get("Path"),
        "no_of_folders": job.get("NoOfFolders"),
        "no_of_children": job.get("NoOfChildren"),
    }


def _normalize_file(file: Dict[str, Any]) -> Dict[str, Any]:
    file_id = _id_string(file)
    return {
        "file_id": file_id,
        "name": file.get("FileName") or file.get("Name"),
        "size": file.get("FileSize") or file.get("Size"),
        "content_type": file.get("ContentType") or file.get("MimeType"),
        "modified_at": file.get("ModifiedDate") or file.get("LastModified"),
        "path": file.get("Path") or file.get("FolderPath") or "",
    }


def _normalize_folder(folder: Dict[str, Any]) -> Dict[str, Any]:
    folder_id = _id_string(folder)
    return {
        "folder_id": folder_id,
        "name": folder.get("Name"),
        "has_subfolders": folder.get("HasSubFolders")
        or (folder.get("NoOfSubFolders") or 0) > 0,
        "no_of_subfolders": folder.get("NoOfSubFolders"),
        "folder_type": folder.get("FolderType"),
    }


# ---------------------------------------------------------------------------
# Wave-1 read-only helpers — defensive shared utilities
# ---------------------------------------------------------------------------


def _id_string(value: Any) -> Optional[str]:
    """Coerce a 12d id (nested ``{IDString}`` / ``{ID:{IDString}}`` / flat) to a string.

    12d ids arrive in several shapes depending on the model: a bare ``"8_1"``
    string, a nested ``{"IDString": "8_1", "_id": 8, "_server_id": 1}`` object,
    or wrapped one level deeper as ``{"ID": {"IDString": ...}}``. Never assume a
    dict — a malformed truthy non-dict would crash ``.get``. Returns None when no
    id can be extracted.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value or None
    if isinstance(value, dict):
        inner = value.get("ID")
        if isinstance(inner, dict):
            ids = inner.get("IDString")
            if ids:
                return str(ids)
        ids = value.get("IDString") or value.get("id") or value.get("Id")
        if ids:
            return str(ids)
    return None


def _pick(d: Dict[str, Any], *keys: str) -> Any:
    """First non-empty value across a list of candidate keys (PascalCase→snake).

    The many ``[UNKNOWN]``/Swagger-200-only 12d schemas mean we never know the
    exact casing a given instance returns, so every field read tries both. ``""``
    and ``None`` are treated as absent; ``0``/``False`` are kept (valid values).
    """
    if not isinstance(d, dict):
        return None
    for k in keys:
        v = d.get(k)
        if v not in (None, ""):
            return v
    return None


def _coerce_rows(data: Any, *keys: str) -> List[Dict[str, Any]]:
    """Coerce a 12d list-or-wrapper response into a list of dict rows.

    Many list endpoints are documented Swagger-200-only and may return either a
    bare JSON array OR a wrapper object (``{Result|Items|items|value|History|...}``).
    Tries the supplied wrapper keys (plus the universal ``Result/Items/items/value``)
    and falls back to a bare list. Non-dict rows are dropped by the caller's
    normalizer guard.
    """
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        candidates = list(keys) + ["Result", "Items", "items", "value"]
        for k in candidates:
            v = data.get(k)
            if isinstance(v, list):
                return [r for r in v if isinstance(r, dict)]
    return []


# ---------------------------------------------------------------------------
# 1. Tasks — list a job's tasks (who owns what, state, due dates)
# ---------------------------------------------------------------------------


def _normalize_task(task: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d ``TaskItemModel`` row.

    CRITICAL: ``TaskItemModel`` is **snake_case** (``id.IDString``, ``name``,
    ``description``, ``due_date_utc``, ``is_closed``, ``item_owner``,
    ``task_state_name``, ``priority``, ``parent_item_id``, ``children``) — do NOT
    reuse ``_normalize_job`` PascalCase field names. ``item_owner`` is either an
    EntityID (``{IDString}``) or a ``ContactInfoModel`` (carries a display name);
    pull both best-effort. PascalCase fallbacks are kept since the getTaskList
    envelope is ``[UNKNOWN]`` and a given instance may differ. state/priority may
    be null on simple to-dos.
    """
    owner = task.get("item_owner") or task.get("ItemOwner") or {}
    owner_id = _id_string(owner) if isinstance(owner, dict) else None
    owner_name = None
    if isinstance(owner, dict):
        owner_name = _pick(
            owner,
            "name",
            "Name",
            "display_name",
            "DisplayName",
            "full_name",
            "FullName",
        )
        ci = owner.get("contact_info") or owner.get("ContactInfo")
        if not owner_name and isinstance(ci, dict):
            owner_name = _pick(ci, "name", "Name")

    children = task.get("children")
    if not isinstance(children, list):
        children = task.get("Children")
    child_count = len(children) if isinstance(children, list) else 0

    assignee = task.get("assignee") or task.get("Assignee") or {}
    assignee_id = _id_string(assignee) if isinstance(assignee, dict) else None

    return {
        "task_id": _id_string(task.get("id") or task.get("ID") or task),
        "name": _pick(task, "name", "Name"),
        "description": _pick(task, "description", "Description"),
        "owner_id": owner_id,
        "owner_name": owner_name,
        "assignee_id": assignee_id,
        "due_date": _pick(task, "due_date_utc", "DueDateUtc", "due_date", "DueDate"),
        "is_closed": _pick(task, "is_closed", "IsClosed"),
        "state": _pick(task, "task_state", "TaskState", "state", "State"),
        "state_name": _pick(
            task, "task_state_name", "TaskStateName", "state_name", "StateName"
        ),
        "priority": _pick(task, "priority", "Priority"),
        "parent_id": _id_string(task.get("parent_item_id") or task.get("ParentItemId")),
        "has_children": child_count > 0,
        "child_count": child_count,
    }


def list_job_tasks(
    server: str,
    token: str,
    job_id: str,
    assignee_id: str = "",
    include_closed: Optional[bool] = None,
    limit: int = 200,
) -> Dict[str, Any]:
    """List a job's tasks (owner, state, due date) — read-only.

    Two paths:
      * **getTaskList** (primary): ``GET /api/v1/tasks/getTaskList/{job_id}`` —
        lists ALL of the job's tasks in one shot (no paging). Used when no
        assignee filter and ``include_closed`` is unset.
      * **search**: ``POST /api/v1/tasks/search`` body
        ``TaskSearchModel {JobId, AssigneeId, IncludeClosedTasks}`` — used when
        ``assignee_id`` is supplied OR ``include_closed`` is explicitly set.

    Read paths DO carry ``/api/v1/`` (the "POST /api/Tasks has no /v1/" rule is
    CREATE/UPDATE only). The getTaskList envelope is ``[UNKNOWN]`` → defensive
    list-or-wrapper. An empty job returns ``[]`` (not an error). Results are
    truncated client-side to ``limit``.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    limit = max(int(limit or 200), 1)
    note: Optional[str] = None

    use_search = bool(assignee_id) or include_closed is not None
    if use_search:
        body: Dict[str, Any] = {
            "JobId": _build_limit_id(job_id),
            "IncludeClosedTasks": bool(include_closed),
        }
        if assignee_id:
            body["AssigneeId"] = _build_limit_id(assignee_id)
        response = httpx.post(
            f"{base_url}/api/v1/tasks/search",
            json=body,
            headers=headers,
            timeout=60,
        )
        _check_response(response)
        data = response.json()
    else:
        response = httpx.get(
            f"{base_url}/api/v1/tasks/getTaskList/{_seg(job_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(response)
        data = response.json()

    rows = _coerce_rows(data, "Tasks", "tasks", "TaskList", "task_list")
    tasks = [_normalize_task(r) for r in rows]
    # Open-only filter when the caller didn't ask for closed tasks via the
    # search path (getTaskList may return both; default is open-only).
    if not use_search:
        tasks = [t for t in tasks if not t.get("is_closed")]
    total_count = len(tasks)
    truncated = total_count > limit
    if truncated:
        tasks = tasks[:limit]
        note = (
            f"Returned the first {limit} of {total_count} tasks; raise the limit "
            "or narrow by assignee to see more."
        )

    return {
        "job_id": job_id,
        "tasks": tasks,
        "total_count": total_count,
        "returned": len(tasks),
        "truncated": truncated,
        "connector": "synergy",
        **({"note": note} if note else {}),
    }


# ---------------------------------------------------------------------------
# 2. Contacts — people on a job / directory lookup
# ---------------------------------------------------------------------------


def _normalize_contact(contact: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d ``ContactModel`` row (snake_case, PascalCase fallbacks).

    Companies arrive as a list of company refs; each is reduced to
    ``{company_id, name}``. ``is_user`` / ``active`` are best-effort booleans.
    """
    companies_raw = contact.get("companies") or contact.get("Companies") or []
    companies: List[Dict[str, Any]] = []
    if isinstance(companies_raw, list):
        for c in companies_raw:
            if isinstance(c, dict):
                companies.append(
                    {
                        "company_id": _id_string(c.get("id") or c.get("ID") or c),
                        "name": _pick(c, "name", "Name", "company_name", "CompanyName"),
                    }
                )

    first = _pick(contact, "first_name", "FirstName")
    last = _pick(contact, "last_name", "LastName")
    name = _pick(contact, "name", "Name", "full_name", "FullName", "display_name")
    if not name:
        name = " ".join(p for p in (first, last) if p) or None

    return {
        "contact_id": _id_string(contact.get("id") or contact.get("ID") or contact),
        "first_name": first,
        "last_name": last,
        "name": name,
        "email": _pick(contact, "email", "Email", "email_address", "EmailAddress"),
        "is_user": _pick(contact, "is_user", "IsUser", "users_only", "UsersOnly"),
        "active": _pick(contact, "active", "Active", "is_active", "IsActive"),
        "companies": companies,
        "attributes": contact.get("attributes") or contact.get("Attributes"),
        "create_date": _pick(
            contact, "create_date", "CreateDate", "created", "Created"
        ),
    }


# Bound the per-list contact fan-out (one getContactListContacts GET per list)
# so a job wired to hundreds of contact lists can't run hundreds of serial
# reads into the 120s Lambda timeout.
SYNERGY_JOB_CONTACTS_MAX_LISTS = int(os.getenv("SYNERGY_JOB_CONTACTS_MAX_LISTS", "50"))
SYNERGY_JOB_CONTACTS_DEADLINE_S = float(
    os.getenv("SYNERGY_JOB_CONTACTS_DEADLINE_S", "20")
)


def get_job_contacts(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Return the contacts attached to a job via its contact lists — read-only.

    ``GET /api/v1/Contacts/getJobContactLists/{job_id}`` returns the job's
    contact lists; for each list,
    ``GET /api/v1/Contacts/getContactListContacts/{list_id}`` returns its
    contacts. CRITICAL: Capital-C ``Contacts`` (lowercase 404s). Both list
    endpoints are ``[UNKNOWN]`` → defensive list-or-wrapper. An empty
    ``contact_lists`` is valid (count 0 + note). Note: the job's PM/foreman is
    often answerable via the job's PM *attribute* (connect_synergy_job_meta),
    not only contact lists.

    The per-list contact fan-out is bounded by SYNERGY_JOB_CONTACTS_MAX_LISTS
    and SYNERGY_JOB_CONTACTS_DEADLINE_S; ``truncated`` is set when either stops
    the walk before every list was iterated.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    lists_resp = httpx.get(
        f"{base_url}/api/v1/Contacts/getJobContactLists/{_seg(job_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(lists_resp)
    list_rows = _coerce_rows(
        lists_resp.json(), "ContactLists", "contact_lists", "Lists"
    )

    contact_lists: List[Dict[str, Any]] = []
    contacts: List[Dict[str, Any]] = []
    seen: set[str] = set()
    truncated = False
    started = time.monotonic()
    lists_iterated = 0
    for lr in list_rows:
        list_id = _id_string(lr.get("id") or lr.get("ID") or lr)
        contact_lists.append({"list_id": list_id, "name": _pick(lr, "name", "Name")})
        if not list_id:
            continue
        # Stop fanning out once we hit the list cap or the wall-clock budget —
        # there are still lists we haven't fetched contacts for, so flag it.
        if (
            lists_iterated >= SYNERGY_JOB_CONTACTS_MAX_LISTS
            or (time.monotonic() - started) >= SYNERGY_JOB_CONTACTS_DEADLINE_S
        ):
            truncated = True
            break
        lists_iterated += 1
        try:
            c_resp = httpx.get(
                f"{base_url}/api/v1/Contacts/getContactListContacts/{_seg(list_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(c_resp)
            c_rows = _coerce_rows(c_resp.json(), "Contacts")
        except (httpx.HTTPError, ValueError):
            continue  # one bad list must not sink the whole call
        for cr in c_rows:
            norm = _normalize_contact(cr)
            cid = norm.get("contact_id")
            dedup_key = cid or json.dumps(norm, sort_keys=True, default=str)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            contacts.append(norm)

    note: Optional[str] = None
    if not contact_lists:
        note = (
            "This job has no contact lists. The PM/foreman may still be set as a "
            "job attribute — check connect_synergy_job_meta."
        )
    elif truncated:
        note = (
            "Too many contact lists to read within the time/list budget — "
            "contacts shown are partial."
        )

    return {
        "job_id": job_id,
        "contact_lists": contact_lists,
        "contacts": contacts,
        "total_count": len(contacts),
        "truncated": truncated,
        "connector": "synergy",
        **({"note": note} if note else {}),
    }


def search_contacts(
    server: str,
    token: str,
    query: str = "",
    first_name: str = "",
    last_name: str = "",
    email: str = "",
    users_only: bool = False,
    page_size: int = 50,
) -> Dict[str, Any]:
    """Search the contact directory — read-only.

    Two sources:
      * **simpleSearch** (free-text): ``GET /api/v1/Contacts/simpleSearch/{term}/
        {users_only}`` — hard-capped at 20, no paging. Used when ``query`` is
        supplied. Its count is NOT authoritative → flag ``truncated`` at 20.
      * **structured search**: ``POST /api/v1/Contacts/search`` body
        ``{FirstName,LastName,Email,UsersOnly,Page,PageSize}`` →
        ``PagedResultModel``. Used when structured fields are supplied.

    CRITICAL: Capital-C ``Contacts``. The ``PagedResultModel`` wrapper is
    PascalCase (``PageNumber/PageSize/TotalPages/TotalRows/Result``) even though
    ``ContactModel`` rows are snake_case — normalize each layer separately.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    page_size = max(int(page_size or 50), 1)

    if query:
        # Free-text simpleSearch — path-encoded term, users_only segment.
        from urllib.parse import quote

        term = quote(query, safe="")
        uo = "true" if users_only else "false"
        response = httpx.get(
            f"{base_url}/api/v1/Contacts/simpleSearch/{term}/{uo}",
            headers=headers,
            timeout=60,
        )
        _check_response(response)
        rows = _coerce_rows(response.json(), "Contacts")
        contacts = [_normalize_contact(r) for r in rows]
        # simpleSearch hard-caps at 20 with no paging and its count is not
        # authoritative — flag truncated whenever we hit the cap.
        truncated = len(contacts) >= 20
        return {
            "contacts": contacts,
            "total_count": len(contacts),
            "source": "simpleSearch",
            "truncated": truncated,
            **(
                {
                    "note": "simpleSearch returns at most 20 contacts and its "
                    "count is not authoritative — narrow your query or use the "
                    "structured fields to page further."
                }
                if truncated
                else {}
            ),
        }

    body = {
        "FirstName": first_name or "",
        "LastName": last_name or "",
        "Email": email or "",
        "UsersOnly": bool(users_only),
        "Page": 1,
        "PageSize": page_size,
    }
    response = httpx.post(
        f"{base_url}/api/v1/Contacts/search",
        json=body,
        headers=headers,
        timeout=60,
    )
    _check_response(response)
    data = response.json() or {}
    rows = _coerce_rows(data, "Contacts")
    contacts = [_normalize_contact(r) for r in rows]
    # PagedResultModel wrapper is PascalCase — read it separately from the
    # snake_case ContactModel rows above.
    page = _pick(data, "PageNumber", "pageNumber", "Page", "page")
    total_rows = _pick(data, "TotalRows", "Total", "total")
    total_pages = _pick(data, "TotalPages", "totalPages")
    truncated = bool(total_pages and isinstance(total_pages, int) and total_pages > 1)
    return {
        "contacts": contacts,
        "total_count": len(contacts),
        "source": "search",
        "page": page,
        "page_size": page_size,
        "total_rows": total_rows,
        "truncated": truncated,
    }


def get_contact(server: str, token: str, contact_id: str) -> Dict[str, Any]:
    """Return one contact's full detail — read-only.

    ``GET /api/v1/Contacts/{id}/{retrieve_attributes}/{retrieve_companies}`` —
    both trailing segments are REQUIRED (we pass ``/true/true`` to pull the
    contact's attributes and companies). CRITICAL: Capital-C ``Contacts``.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(
        f"{base_url}/api/v1/Contacts/{_seg(contact_id)}/true/true",
        headers=headers,
        timeout=60,
    )
    _check_response(response)
    data = response.json() or {}
    if not isinstance(data, dict):
        data = {}
    return {"contact": _normalize_contact(data), "connector": "synergy"}


# ---------------------------------------------------------------------------
# 3. Issues — issues/RFIs on a job (+ detail)
# ---------------------------------------------------------------------------


def _normalize_issue(
    issue: Dict[str, Any],
    status_labels: Optional[Dict[str, str]] = None,
    type_labels: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Normalize a 12d issue row — ALL shapes INFERRED, fully defensive.

    The issue-tracking schemas are ``[UNKNOWN]`` (Swagger-200-only); the
    normalizer reads BOTH casings for every field (``Title|title``,
    ``Status|status``, ``ID.IDString|id``...) and keeps a ``raw`` passthrough so
    a caller can recover anything the mapping missed. ``status_label`` /
    ``type_label`` are resolved from the optional best-effort label maps when the
    code-only value matches.
    """
    status = _pick(issue, "Status", "status", "StatusId", "status_id")
    itype = _pick(issue, "Type", "type", "TypeId", "type_id", "IssueType")
    assigned = (
        issue.get("AssignedTo")
        or issue.get("assigned_to")
        or issue.get("Assignee")
        or issue.get("assignee")
        or {}
    )
    assigned_to = (
        _id_string(assigned)
        if isinstance(assigned, dict)
        else (assigned if isinstance(assigned, str) else None)
    )
    assigned_name = None
    if isinstance(assigned, dict):
        assigned_name = _pick(assigned, "name", "Name", "display_name", "DisplayName")

    status_label = None
    if status_labels and status is not None:
        status_label = status_labels.get(str(status))
    type_label = None
    if type_labels and itype is not None:
        type_label = type_labels.get(str(itype))

    return {
        "issue_id": _id_string(
            issue.get("ID") or issue.get("id") or issue.get("IssueId") or issue
        ),
        "title": _pick(issue, "Title", "title", "Name", "name", "Subject", "subject"),
        "status": status,
        "status_label": status_label,
        "type": itype,
        "type_label": type_label,
        "priority": _pick(issue, "Priority", "priority"),
        "assigned_to": assigned_name or assigned_to,
        "created_at": _pick(
            issue, "CreatedAt", "created_at", "DateCreated", "Created", "CreatedOn"
        ),
        "modified_at": _pick(
            issue,
            "ModifiedAt",
            "modified_at",
            "LastModified",
            "DateModified",
            "UpdatedOn",
        ),
        "raw": issue,
    }


def _fetch_issue_label_maps(
    base_url: str, headers: Dict[str, str]
) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Best-effort fetch of issue status + type label maps (code → display name).

    ``GET /api/v1/issue-tracking/issue-statuses/get`` and
    ``GET /api/v1/issue-tracking/issue-types/get/{retrieve_info}``. Both are
    ``[UNKNOWN]`` and INLINE best-effort — any failure degrades to empty maps
    (the normalizer then passes the raw code through). Fetched once per call.
    """
    status_labels: Dict[str, str] = {}
    type_labels: Dict[str, str] = {}

    def _label_map(rows: List[Dict[str, Any]]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        for r in rows:
            code = _pick(r, "ID", "id", "Code", "code", "Value", "value")
            label = _pick(r, "Name", "name", "DisplayName", "display_name", "Label")
            if code is not None and label:
                out[str(_id_string(code) or code)] = str(label)
        return out

    try:
        r = httpx.get(
            f"{base_url}/api/v1/issue-tracking/issue-statuses/get",
            headers=headers,
            timeout=60,
        )
        _check_response(r)
        status_labels = _label_map(_coerce_rows(r.json(), "Statuses", "statuses"))
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        pass
    try:
        r = httpx.get(
            f"{base_url}/api/v1/issue-tracking/issue-types/get/true",
            headers=headers,
            timeout=60,
        )
        _check_response(r)
        type_labels = _label_map(_coerce_rows(r.json(), "Types", "types"))
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        pass
    return status_labels, type_labels


# Wall-clock budget for walking the issue pages (mirrors SYNERGY_LIST_DEADLINE_S).
SYNERGY_ISSUE_DEADLINE_S = float(os.getenv("SYNERGY_ISSUE_DEADLINE_S", "20"))
SYNERGY_ISSUE_MAX_PAGES = int(os.getenv("SYNERGY_ISSUE_MAX_PAGES", "50"))


def list_job_issues(
    server: str,
    token: str,
    job_id: str,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """List a job's issues/RFIs — read-only, page-walked + bounded.

    ``POST /api/v1/issue-tracking/issues/get`` body
    ``{job_id:{IDString,_id,_server_id}, page, page_size}``. CRITICAL: the
    ``[UNKNOWN]`` casing means we send the lowercase body the mutation doc
    documents and read BOTH casings in the normalizer. Walk is bounded by a
    wall-clock deadline + page cap; ``truncated`` is set on cap. Status/type
    label maps are fetched once (best-effort) and applied to every row.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    page = max(int(page or 1), 1)
    page_size = max(int(page_size or 50), 1)

    status_labels, type_labels = _fetch_issue_label_maps(base_url, headers)

    issues: List[Dict[str, Any]] = []
    total_rows = 0
    truncated = False
    pages_fetched = 0
    started = time.monotonic()
    cur = page
    while True:
        body = {
            "job_id": _build_limit_id(job_id),
            "page": cur,
            "page_size": page_size,
        }
        response = httpx.post(
            f"{base_url}/api/v1/issue-tracking/issues/get",
            json=body,
            headers=headers,
            timeout=60,
        )
        _check_response(response)
        data = response.json()
        rows = _coerce_rows(data, "Issues", "issues")
        pages_fetched += 1
        for r in rows:
            issues.append(_normalize_issue(r, status_labels, type_labels))
        if isinstance(data, dict):
            total_rows = (
                _pick(data, "TotalRows", "total_rows", "Total", "total") or total_rows
            )
            total_pages = _pick(data, "TotalPages", "total_pages", "totalPages")
        else:
            total_pages = None
        # Stop on a short/empty page (universal last-page signal), an explicit
        # last page, or once we've gathered the reported total.
        if not rows or len(rows) < page_size:
            break
        if total_pages and isinstance(total_pages, int) and cur >= total_pages:
            break
        if total_rows and len(issues) >= int(total_rows):
            break
        # Bound the walk — never risk the Lambda timeout.
        if (
            pages_fetched >= SYNERGY_ISSUE_MAX_PAGES
            or (time.monotonic() - started) >= SYNERGY_ISSUE_DEADLINE_S
        ):
            truncated = (not total_rows) or len(issues) < int(total_rows)
            break
        cur += 1

    note = (
        "Issue field mappings are inferred from undocumented 12d schemas — verify "
        "against a live instance before trusting in customer-facing answers."
    )
    if truncated:
        note += " Result was truncated (page/deadline cap); narrow or page further."
    if not status_labels and not type_labels:
        note += " Status/type label maps unavailable — codes passed through raw."

    return {
        "job_id": job_id,
        "issues": issues,
        "total_rows": total_rows or len(issues),
        "pages_fetched": pages_fetched,
        "truncated": truncated,
        "note": note,
    }


def get_issue_detail(
    server: str,
    token: str,
    issue_id: str,
    retrieve_details: bool = True,
    include_changes: bool = False,
) -> Dict[str, Any]:
    """Return one issue's detail (+ comments, optional change log) — read-only.

    ``GET /api/v1/issue-tracking/get-issue/{issue_ticket_id}/{retrieve_details}``
    is the core call. Best-effort secondaries:
      * comments: ``GET /api/v1/issue-tracking/issue/get-comments/{issue_id}``
      * changes (only if ``include_changes``):
        ``GET /api/v1/issue-tracking/issue/get-changes/{issue_id}``
      * parent job (fallback): ``GET /api/v1/issue-tracking/get-job-id/
        {issue_ticket_id}``

    ALL shapes INFERRED → defensive + ``raw`` passthrough on the issue; comments/
    changes degrade to empty + note on failure.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    rd = "true" if retrieve_details else "false"

    status_labels, type_labels = _fetch_issue_label_maps(base_url, headers)

    response = httpx.get(
        f"{base_url}/api/v1/issue-tracking/get-issue/{_seg(issue_id)}/{rd}",
        headers=headers,
        timeout=60,
    )
    _check_response(response)
    raw = response.json()
    if isinstance(raw, list):
        raw = raw[0] if raw and isinstance(raw[0], dict) else {}
    if not isinstance(raw, dict):
        raw = {}
    issue = _normalize_issue(raw, status_labels, type_labels)

    # Resolve parent job — prefer an embedded value, fall back to get-job-id.
    job_id = _id_string(raw.get("JobId") or raw.get("job_id") or raw.get("Job"))
    if not job_id:
        try:
            j = httpx.get(
                f"{base_url}/api/v1/issue-tracking/get-job-id/{_seg(issue_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(j)
            jd = j.json()
            job_id = _id_string(jd) or (
                _id_string(jd.get("JobId") or jd.get("job_id"))
                if isinstance(jd, dict)
                else None
            )
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            job_id = None

    degraded: List[str] = []

    comments: List[Dict[str, Any]] = []
    try:
        c = httpx.get(
            f"{base_url}/api/v1/issue-tracking/issue/get-comments/{_seg(issue_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(c)
        comments = _coerce_rows(c.json(), "Comments", "comments")
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        degraded.append("comments")

    changes: Optional[List[Dict[str, Any]]] = None
    if include_changes:
        try:
            ch = httpx.get(
                f"{base_url}/api/v1/issue-tracking/issue/get-changes/{_seg(issue_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(ch)
            changes = _coerce_rows(ch.json(), "Changes", "changes")
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            changes = None
            degraded.append("changes")

    note = (
        "Issue field mappings are inferred from undocumented 12d schemas — verify "
        "against a live instance before trusting in customer-facing answers."
    )
    if degraded:
        note += f" Best-effort sections unavailable: {', '.join(degraded)}."

    return {
        "issue_id": issue_id,
        "job_id": job_id,
        "issue": issue,
        "comments": comments,
        "changes": changes,
        "note": note,
    }


# ---------------------------------------------------------------------------
# 4. Workflows — workflow status (READ ONLY)
# ---------------------------------------------------------------------------

# entity_type encoding is UNVERIFIED against a live 12d instance. We keep an
# explicit best-guess map; on a 404 the handler surfaces a clear "verify
# entity_type encoding" error rather than silently retrying. The string forms
# are passed through unchanged if not in the map.
ENTITY_TYPE_MAP: Dict[str, str] = {"job": "job", "issue": "issue", "task": "task"}


def get_workflow_definitions(server: str, token: str) -> Dict[str, Any]:
    """List all workflow definitions — read-only. ``GET /api/v1/workflows/all``.

    Response shape is ``[UNKNOWN]`` → fully defensive list-or-wrapper. An empty
    list is valid.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(
        f"{base_url}/api/v1/workflows/all", headers=headers, timeout=60
    )
    _check_response(response)
    rows = _coerce_rows(response.json(), "Workflows", "workflows", "Definitions")
    definitions = [
        {
            "workflow_id": _id_string(d.get("ID") or d.get("id") or d),
            "name": _pick(d, "Name", "name"),
            "description": _pick(d, "Description", "description"),
            "raw": d,
        }
        for d in rows
    ]
    return {
        "definitions": definitions,
        "total_count": len(definitions),
        "connector": "synergy",
        "note": (
            "Workflow response shapes are undocumented (12d Swagger 200-only) — "
            "verify field mappings against a live instance."
        ),
    }


def get_workflow_definition(
    server: str, token: str, workflow_id: str, return_all: bool = True
) -> Dict[str, Any]:
    """Return one workflow definition — read-only.

    ``GET /api/v1/workflows/{workflow_id}/{return_all}`` (``return_all`` default
    'true'). Shape ``[UNKNOWN]`` → raw passthrough plus best-effort top fields.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    ra = "true" if return_all else "false"
    response = httpx.get(
        f"{base_url}/api/v1/workflows/{_seg(workflow_id)}/{ra}",
        headers=headers,
        timeout=60,
    )
    _check_response(response)
    data = response.json() or {}
    if not isinstance(data, dict):
        data = {}
    return {
        "workflow_id": _id_string(data.get("ID") or data.get("id")) or workflow_id,
        "name": _pick(data, "Name", "name"),
        "description": _pick(data, "Description", "description"),
        "definition": data,
        "connector": "synergy",
        "note": (
            "Workflow definition shape is undocumented — verify against a live "
            "12d instance."
        ),
    }


def get_workflow_instance(
    server: str,
    token: str,
    workflow_id: str,
    entity_id: str,
    entity_type: str,
) -> Dict[str, Any]:
    """Return the LIVE workflow instance for an entity — read-only.

    ``GET /api/v1/workflows/getWorkflowInstance/{workflow_id}/{entity_id}/
    {entity_type}``. Best-effort secondaries (instance mode):
      * ``GET /api/v1/workflows/getProperties/{instance_id}``
      * ``GET /api/v1/workflows/getTransitionLog/{instance_id}``

    ALL shapes ``[UNKNOWN]`` → fully defensive. ``entity_type`` encoding is
    UNVERIFIED: a 404 raises a clear ValueError telling the caller to verify the
    encoding (NO retry). ``instance_id`` extraction is best-effort (probe
    InstanceID/instance_id/ID → IDString); if absent we return the raw instance,
    null secondaries, and a note.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    et = ENTITY_TYPE_MAP.get((entity_type or "").lower(), entity_type)
    try:
        response = httpx.get(
            f"{base_url}/api/v1/workflows/getWorkflowInstance/{_seg(workflow_id)}/{_seg(entity_id)}/{et}",
            headers=headers,
            timeout=60,
        )
        _check_response(response)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            raise ValueError(
                "Workflow instance not found (HTTP 404). The entity_type encoding "
                f"({entity_type!r} → {et!r}) is UNVERIFIED against a live 12d "
                "instance — confirm the correct entity_type encoding before "
                "retrying. Also verify workflow_id and entity_id are correct."
            ) from exc
        raise

    instance = response.json() or {}
    if not isinstance(instance, dict):
        instance = {"raw": instance}

    current_state = (
        _pick(instance, "CurrentState", "current_state", "State", "state") or {}
    )
    instance_id = _id_string(
        instance.get("InstanceID")
        or instance.get("instance_id")
        or instance.get("InstanceId")
        or instance.get("ID")
        or instance.get("id")
    )

    properties = None
    transition_log = None
    note_parts: List[str] = [
        "Workflow instance shapes are undocumented (12d Swagger 200-only) — verify "
        "field mappings against a live instance.",
    ]
    if instance_id:
        try:
            p = httpx.get(
                f"{base_url}/api/v1/workflows/getProperties/{_seg(instance_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(p)
            properties = p.json()
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            note_parts.append("Properties unavailable (best-effort).")
        try:
            t = httpx.get(
                f"{base_url}/api/v1/workflows/getTransitionLog/{_seg(instance_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(t)
            transition_log = _coerce_rows(t.json(), "Transitions", "transitions", "Log")
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            note_parts.append("Transition log unavailable (best-effort).")
    else:
        note_parts.append(
            "Could not extract instance_id — properties/transition log skipped; "
            "raw instance returned."
        )

    return {
        "instance": instance,
        "instance_id": instance_id,
        "current_state": current_state,
        "properties": properties,
        "transition_log": transition_log,
        "connector": "synergy",
        "note": " ".join(note_parts),
    }


def get_workflow_transition_log(
    server: str, token: str, instance_id: str
) -> Dict[str, Any]:
    """Return a workflow instance's transition log — read-only.

    ``GET /api/v1/workflows/getTransitionLog/{instance_id}``. Shape
    ``[UNKNOWN]`` → list-or-wrapper defensive parse.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(
        f"{base_url}/api/v1/workflows/getTransitionLog/{_seg(instance_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(response)
    transitions = _coerce_rows(
        response.json(), "Transitions", "transitions", "Log", "log"
    )
    return {
        "instance_id": instance_id,
        "transitions": transitions,
        "total_count": len(transitions),
        "connector": "synergy",
        "note": (
            "Transition log shape is undocumented — verify against a live 12d "
            "instance."
        ),
    }


def get_workflow_diagram(
    server: str, token: str, workflow_id: str, current_state_id: str
) -> Tuple[bytes, str]:
    """Return a workflow diagram as raw (bytes, filename) — read-only.

    ``GET /api/v1/workflows/{workflow_id}/diagram/{current_state_id}`` returns a
    BINARY image (never ``.json()``). Mirrors ``download_file``'s
    ``(content, filename)`` signature so the handler can stage it via
    ``build_download_payload`` (inline hex small / presigned S3 large), exactly
    like ``synergy_download_file``. Filename is best-effort from
    Content-Disposition, else synthesised.
    """
    base_url = _build_base_url(server)
    headers = {"Authorization": _normalize_token(token)}
    response = httpx.get(
        f"{base_url}/api/v1/workflows/{_seg(workflow_id)}/diagram/{_seg(current_state_id)}",
        headers=headers,
        timeout=120,
    )
    _check_response(response)

    filename = f"workflow_{workflow_id}_{current_state_id}.png"
    cd = response.headers.get("content-disposition", "")
    if "filename=" in cd:
        parts = cd.split("filename=")
        if len(parts) > 1:
            extracted = parts[1].strip().strip('"').strip("'")
            if extracted:
                filename = extracted
    return response.content, filename


# ---------------------------------------------------------------------------
# 5. File history — file version history (1:1 PORT from data-connectors)
# ---------------------------------------------------------------------------


def _normalize_history_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d file-history row (snake_case `History[]` items).

    PORTED verbatim from data-connectors/synergy_api.py.
    """
    return {
        "version": entry.get("version"),
        "changed_by": entry.get("change_by")
        or (entry.get("contact_info") or {}).get("name"),
        "changed_at": entry.get("utc_change_time"),
        "change_type": entry.get("change_type"),
    }


def get_file_history(
    server: str, token: str, file_id: str, page: int = 1, page_size: int = 50
) -> Dict[str, Any]:
    """Return a page of a file's version history (GET /files/{id}/history/...).

    PORTED verbatim from data-connectors/synergy_api.py. 12d returns the rows
    under a `History` key (not `Result`), snake_case. An empty page is
    `{TotalRows:0, []}` — not an error.
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(
        f"{base_url}/api/v1/files/{_seg(file_id)}/history/true/{max(1, page)}/{max(1, page_size)}",
        headers=headers,
        timeout=60,
    )
    _check_response(response)
    data = response.json() or {}
    rows = data.get("History") or data.get("Result") or data.get("Items") or []
    return {
        "items": [_normalize_history_entry(r) for r in rows if isinstance(r, dict)],
        "page": data.get("PageNumber") or page,
        "page_size": data.get("PageSize") or page_size,
        "total_rows": data.get("TotalRows") or len(rows),
        "total_pages": data.get("TotalPages") or 1,
    }


# ---------------------------------------------------------------------------
# 6. Recent changes — what changed recently (job or folder)
# ---------------------------------------------------------------------------

# Bound the recent-changes walk so a busy job/folder can't blow the Lambda
# budget (mirrors SYNERGY_LIST_DEADLINE_S / get_folder_items).
SYNERGY_RECENT_DEADLINE_S = float(os.getenv("SYNERGY_RECENT_DEADLINE_S", "20"))
SYNERGY_RECENT_MAX_PAGES = int(os.getenv("SYNERGY_RECENT_MAX_PAGES", "100"))

_RECENT_POLL_CAVEAT = (
    "Synergy has no change webhooks — this is a point-in-time poll. Re-run "
    "periodically to catch new changes; do not tight-loop."
)


def _row_modified_at(row: Dict[str, Any]) -> Optional[str]:
    """Best-effort 'last modified' timestamp string from a normalized/raw row."""
    return (
        row.get("modified_at")
        or row.get("LastModified")
        or row.get("ModifiedDate")
        or row.get("DateModified")
    )


def get_recent_changes(
    server: str,
    token: str,
    job_id: str = "",
    folder_id: str = "",
    days: int = 7,
    since: str = "",
    limit: int = 100,
) -> Dict[str, Any]:
    """Return files changed recently in a job or folder — read-only.

    Scope: ``folder_id`` wins if both supplied; otherwise ``job_id``.
    ``since`` (ISO-UTC) overrides ``days``.

    Job scope:
      * ``POST /api/v1/files/search`` job-scoped (LimitSearchTo=2, LimitID via
        ``_build_limit_id``) with a ModifiedDate attribute filter, page-walked
        (Page=1.., PageSize=100) bounded by SYNERGY_RECENT_DEADLINE_S +
        SYNERGY_RECENT_MAX_PAGES. If the instance ignores server-side date
        filtering we client-side filter each row's LastModified/ModifiedDate.

    Folder scope:
      * ``GET /api/v1/folders/{id}/changelog/{page}/{page_size}`` (Style-2,
        defensive parse, client-side date filter).

    Rows are normalized via ``_normalize_file`` + change-field augmentation (null
    when the source lacks them). Walk is bounded (deadline + max pages).
    """
    base_url = _build_base_url(server)
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    limit = max(int(limit or 100), 1)
    days = max(int(days or 7), 1)

    # Resolve the cutoff ISO-UTC timestamp.
    if since:
        since_iso = since
        try:
            cutoff = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            since_iso = cutoff.isoformat()
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        since_iso = cutoff.isoformat()
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    def _after_cutoff(ts: Any) -> bool:
        """Keep rows with no timestamp (can't prove they're old) and rows >= cutoff."""
        if not ts:
            return True
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt >= cutoff
        except (ValueError, TypeError):
            return True

    def _augment(norm: Dict[str, Any], raw: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "file_id": norm.get("file_id"),
            "name": norm.get("name"),
            "path": norm.get("path"),
            "size": norm.get("size"),
            "version": _pick(raw, "LatestVersion", "Version", "version"),
            "modified_at": norm.get("modified_at"),
            "change_type": _pick(raw, "ChangeType", "change_type"),
            "changed_by": _pick(raw, "ChangedBy", "change_by", "ModifiedBy")
            or (
                (raw.get("contact_info") or {}).get("name")
                if isinstance(raw.get("contact_info"), dict)
                else None
            ),
        }

    # ---- Folder scope -----------------------------------------------------
    if folder_id:
        changes: List[Dict[str, Any]] = []
        truncated = False
        started = time.monotonic()
        page = 1
        page_size = 100
        client_filtered = False
        while page <= SYNERGY_RECENT_MAX_PAGES:
            try:
                resp = httpx.get(
                    f"{base_url}/api/v1/folders/{_seg(folder_id)}/changelog/{page}/{page_size}",
                    headers=headers,
                    timeout=60,
                )
                _check_response(resp)
                rows = _coerce_rows(resp.json(), "Changes", "changes", "History")
            except SynergyAuthError:
                raise
            except (httpx.HTTPError, ValueError):
                break
            if not rows:
                break
            for raw in rows:
                norm = _augment(_normalize_file(raw), raw)
                if _after_cutoff(_row_modified_at(raw) or norm.get("modified_at")):
                    changes.append(norm)
                else:
                    client_filtered = True
            if len(rows) < page_size:
                break
            if (
                len(changes) >= limit
                or (time.monotonic() - started) >= SYNERGY_RECENT_DEADLINE_S
            ):
                truncated = len(changes) >= limit
                break
            page += 1
        if len(changes) > limit:
            changes = changes[:limit]
            truncated = True
        note = _RECENT_POLL_CAVEAT
        if client_filtered:
            note += " Server-side date filter unconfirmed — client-side filtered."
        return {
            "scope": "folder",
            "folder_id": folder_id,
            "since": since_iso,
            "days": days,
            "source": "folder_changelog",
            "changes": changes,
            "count": len(changes),
            "truncated": truncated,
            "note": note,
        }

    # ---- Job scope --------------------------------------------------------
    # files/search job-scoped with a ModifiedDate attribute filter, page-walked
    # (Page=1.., PageSize=100). A single Page:1 read silently dropped every
    # change past the first page; we now accumulate up to `limit` bounded by the
    # same deadline + max-pages the folder branch uses.
    changes = []
    truncated = False
    client_filtered = False
    source = "files_search"
    started = time.monotonic()
    page = 1
    page_size = 100
    limit_id = _build_limit_id(job_id)
    while page <= SYNERGY_RECENT_MAX_PAGES:
        body = {
            "Page": page,
            "PageSize": page_size,
            "ShowDeletedFiles": False,
            "LimitSearchTo": 2,  # job + sub-jobs
            "LimitID": limit_id,
            "Attributes": [
                {
                    "Attribute": {"Name": "ModifiedDate"},
                    "Value": since_iso,
                    "SearchQueryType": 4,
                    "Operation": 2,
                    "OperationName": ">",
                }
            ],
        }
        response = httpx.post(
            f"{base_url}/api/v1/files/search",
            json=body,
            headers=headers,
            timeout=90,
        )
        _check_response(response)
        data = response.json()
        rows = _coerce_rows(data, "Result")
        for raw in rows:
            norm = _augment(_normalize_file(raw), raw)
            # If the server-side ModifiedDate filter was honoured every row is in
            # range; if not, client-side filtering catches stale rows. Either way
            # the client-side check is cheap insurance.
            ts = _row_modified_at(raw) or norm.get("modified_at")
            if _after_cutoff(ts):
                changes.append(norm)
            else:
                client_filtered = True

        # No rows / short page: the server has nothing more for us.
        if not rows or len(rows) < page_size:
            break
        # A full page came back — there may be more (the server reports more, or
        # at minimum a full PageSize is itself a strong signal). Stop early if
        # we've satisfied the caller, hit the page cap, or run out of budget,
        # flagging truncated so the caller knows the poll was incomplete.
        total_pages = data.get("TotalPages") or data.get("totalPages") or 0
        if total_pages and page >= total_pages:
            break
        if len(changes) >= limit:
            truncated = True
            break
        if page >= SYNERGY_RECENT_MAX_PAGES:
            truncated = True
            break
        if (time.monotonic() - started) >= SYNERGY_RECENT_DEADLINE_S:
            truncated = True
            break
        page += 1

    if len(changes) > limit:
        changes = changes[:limit]
        truncated = True

    note = _RECENT_POLL_CAVEAT
    if client_filtered:
        note += " Server-side date filter unconfirmed — client-side filtered."

    return {
        "scope": "job",
        "job_id": job_id,
        "since": since_iso,
        "days": days,
        "source": source,
        "changes": changes,
        "count": len(changes),
        "truncated": truncated,
        "note": note,
    }


# ===========================================================================
# WAVE 2 — comprehensive read-only 12d coverage
# ===========================================================================
#
# All Wave-2 helpers are READ-ONLY, PAT-scoped (12d enforces permissions
# server-side), so there is NO Numa ACL and NO metering (never call
# `_meter_synergy_query`). Every response schema in these domains is
# `[UNKNOWN]` (12d Swagger documents 200-responses only, with no body and no
# error schema — errors are plain text, not JSON). So every field read goes
# through the Wave-1 defensive utilities (`_id_string`, `_pick`,
# `_coerce_rows`) with BOTH PascalCase and snake_case candidate keys and a
# `raw` passthrough, and every result carries a `note` flagging that the
# mappings are inferred and must be verified against a live instance.

_INFERRED_SCHEMA_NOTE = (
    "Field mappings are inferred from undocumented 12d schemas — verify against "
    "a live instance before trusting in customer-facing answers."
)


# ---------------------------------------------------------------------------
# Wave-2 — Forums (list / forum / categories / topics / posts drill)
# ---------------------------------------------------------------------------

# Bound the paged forum walks (topics, posts) so a busy thread never
# approaches the 120s Lambda timeout (mirrors SYNERGY_ISSUE_DEADLINE_S).
SYNERGY_FORUM_DEADLINE_S = float(os.getenv("SYNERGY_FORUM_DEADLINE_S", "20"))
SYNERGY_FORUM_MAX_PAGES = int(os.getenv("SYNERGY_FORUM_MAX_PAGES", "50"))


def _synergy_headers(token: str) -> Dict[str, str]:
    """Standard auth + JSON headers for a 12d API call."""
    return {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }


def _normalize_forum(forum: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d ``ForumModel`` row — shape ``[UNKNOWN]``, defensive."""
    return {
        "forum_id": _id_string(forum.get("ID") or forum.get("id") or forum),
        "name": _pick(forum, "Name", "name", "Title", "title"),
        "description": _pick(forum, "Description", "description"),
        "raw": forum,
    }


def _normalize_forum_category(cat: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d forum category row — shape ``[UNKNOWN]``, defensive."""
    return {
        "category_id": _id_string(cat.get("ID") or cat.get("id") or cat),
        "name": _pick(cat, "Name", "name", "Title", "title"),
        "raw": cat,
    }


def _normalize_forum_topic(topic: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d forum topic (thread) row — shape ``[UNKNOWN]``."""
    return {
        "topic_id": _id_string(topic.get("ID") or topic.get("id") or topic),
        "title": _pick(topic, "Title", "title", "Name", "name", "Subject", "subject"),
        "created_at": _pick(
            topic, "CreatedAt", "created_at", "DateCreated", "Created", "CreatedOn"
        ),
        "modified_at": _pick(
            topic, "ModifiedAt", "modified_at", "LastModified", "DateModified"
        ),
        "created_by": _pick(
            topic, "CreatedBy", "created_by", "Author", "author", "author_name"
        ),
        "post_count": _pick(
            topic, "PostCount", "post_count", "NoOfPosts", "no_of_posts"
        ),
        "raw": topic,
    }


def _normalize_forum_post(post: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d forum post/message row — shape ``[UNKNOWN]``."""
    author = post.get("Author") or post.get("author") or {}
    author_name = None
    author_id = None
    if isinstance(author, dict):
        author_name = _pick(author, "Name", "name", "DisplayName", "display_name")
        author_id = _id_string(author)
    elif isinstance(author, str):
        author_name = author
    return {
        "post_id": _id_string(post.get("ID") or post.get("id") or post),
        "author": author_name
        or _pick(post, "AuthorName", "author_name", "CreatedBy", "created_by"),
        "author_id": author_id
        or _id_string(post.get("AuthorId") or post.get("author_id")),
        "body": _pick(post, "Body", "body", "Message", "message", "Text", "text"),
        "created_at": _pick(
            post, "CreatedAt", "created_at", "DateCreated", "Created", "CreatedOn"
        ),
        "modified_at": _pick(
            post, "ModifiedAt", "modified_at", "LastModified", "DateModified"
        ),
        "raw": post,
    }


def get_job_forums(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """List a job's forums — read-only (forums drill: list mode).

    ``GET /api/v1/jobs/{job_id}/getForums`` (primary); falls back to
    ``GET /api/v1/Forums/getAll/{job_id}`` on a 4xx (the two are documented
    duplicates). ``ForumModel`` shape is ``[UNKNOWN]`` → defensive
    list-or-wrapper. CASING: ``Forums`` is Capital-F in the dedicated
    controller (lowercase 404s); the job endpoint is lowercase ``jobs``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    rows: List[Dict[str, Any]] = []
    try:
        resp = httpx.get(
            f"{base_url}/api/v1/jobs/{_seg(job_id)}/getForums",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        rows = _coerce_rows(resp.json(), "Forums", "forums")
    except SynergyAuthError:
        raise
    except (httpx.HTTPError, ValueError):
        # Fallback to the sibling controller endpoint.
        try:
            resp = httpx.get(
                f"{base_url}/api/v1/Forums/getAll/{_seg(job_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(resp)
            rows = _coerce_rows(resp.json(), "Forums", "forums")
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            rows = []

    forums = [_normalize_forum(r) for r in rows]
    return {
        "job_id": job_id,
        "forums": forums,
        "total_count": len(forums),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_forum(
    server: str, token: str, forum_id: str, include_permission: bool = False
) -> Dict[str, Any]:
    """Return one forum's header detail — read-only (forums drill: forum mode).

    ``GET /api/v1/Forums/{forum_id}``. When ``include_permission`` is set, also
    fetch ``GET /api/v1/Forums/getPermission/{forum_id}`` best-effort (failure
    degrades to a note, never sinks the call). Shape ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/Forums/{_seg(forum_id)}", headers=headers, timeout=60
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}

    permission: Optional[Any] = None
    note = _INFERRED_SCHEMA_NOTE
    if include_permission:
        try:
            p = httpx.get(
                f"{base_url}/api/v1/Forums/getPermission/{_seg(forum_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(p)
            permission = p.json()
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            note += " Permission lookup unavailable (best-effort)."

    return {
        "forum_id": forum_id,
        "forum": _normalize_forum(data),
        "permission": permission,
        "connector": "synergy",
        "note": note,
    }


def get_forum_categories(server: str, token: str, forum_id: str) -> Dict[str, Any]:
    """List a forum's categories — read-only (forums drill: categories mode).

    ``GET /api/v1/Forums/{forum_id}/categories``. Shape ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/Forums/{_seg(forum_id)}/categories",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Categories", "categories")
    categories = [_normalize_forum_category(r) for r in rows]
    return {
        "forum_id": forum_id,
        "categories": categories,
        "total_count": len(categories),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_forum_category(
    server: str, token: str, forum_id: str, category_id: str
) -> Dict[str, Any]:
    """Return one forum category's detail — read-only (forums: category mode).

    ``GET /api/v1/Forums/{forum_id}/categories/{category_id}``. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/Forums/{_seg(forum_id)}/categories/{_seg(category_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "forum_id": forum_id,
        "category_id": category_id,
        "category": _normalize_forum_category(data),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def _walk_forum_pages(
    base_url: str,
    headers: Dict[str, str],
    path_fmt: str,
    page: int,
    page_size: int,
    normalizer: Any,
    *wrapper_keys: str,
) -> Tuple[List[Dict[str, Any]], int, int, bool]:
    """Bounded page-walk for the path-style paged forum endpoints.

    ``path_fmt`` carries ``{page}`` and ``{page_size}`` placeholders. Returns
    ``(rows, total_rows, pages_fetched, truncated)``. Walk is bounded by a
    wall-clock deadline + page cap (mirrors ``list_job_issues``), stopping on a
    short/empty page (universal last-page signal).
    """
    page = max(int(page or 1), 1)
    page_size = max(int(page_size or 50), 1)
    out: List[Dict[str, Any]] = []
    total_rows = 0
    truncated = False
    pages_fetched = 0
    started = time.monotonic()
    cur = page
    while True:
        resp = httpx.get(
            f"{base_url}{path_fmt.format(page=cur, page_size=page_size)}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        data = resp.json()
        rows = _coerce_rows(data, *wrapper_keys)
        pages_fetched += 1
        out.extend(normalizer(r) for r in rows)
        if isinstance(data, dict):
            total_rows = (
                _pick(data, "TotalRows", "total_rows", "Total", "total") or total_rows
            )
            total_pages = _pick(data, "TotalPages", "total_pages", "totalPages")
        else:
            total_pages = None
        if not rows or len(rows) < page_size:
            break
        if total_pages and isinstance(total_pages, int) and cur >= total_pages:
            break
        if total_rows and len(out) >= int(total_rows):
            break
        if (
            pages_fetched >= SYNERGY_FORUM_MAX_PAGES
            or (time.monotonic() - started) >= SYNERGY_FORUM_DEADLINE_S
        ):
            truncated = (not total_rows) or len(out) < int(total_rows)
            break
        cur += 1
    return out, (total_rows or len(out)), pages_fetched, truncated


def list_forum_category_topics(
    server: str,
    token: str,
    category_id: str,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """List a category's topics (threads) — read-only, paged + bounded.

    ``GET /api/v1/Forums/getForumCategoryTopics/{category_id}/{page}/{page_size}``.
    Path-style paging, walked + bounded (deadline + page cap). ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    rows, total_rows, pages_fetched, truncated = _walk_forum_pages(
        base_url,
        headers,
        "/api/v1/Forums/getForumCategoryTopics/" + category_id + "/{page}/{page_size}",
        page,
        page_size,
        _normalize_forum_topic,
        "Topics",
        "topics",
    )
    note = _INFERRED_SCHEMA_NOTE
    if truncated:
        note += " Result was truncated (page/deadline cap); page further."
    return {
        "category_id": category_id,
        "topics": rows,
        "total_rows": total_rows,
        "pages_fetched": pages_fetched,
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


def get_forum_topic(server: str, token: str, topic_id: str) -> Dict[str, Any]:
    """Return one topic/thread header — read-only (forums drill: topic mode).

    ``GET /api/v1/Forums/getForumCategoryTopic/{topic_id}``. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/Forums/getForumCategoryTopic/{_seg(topic_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "topic_id": topic_id,
        "topic": _normalize_forum_topic(data),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def list_forum_topic_posts(
    server: str,
    token: str,
    topic_id: str,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """READ A THREAD — list a topic's posts/messages — paged + bounded.

    ``GET /api/v1/Forums/getForumTopicPosts/{topic_id}/{page}/{page_size}``. The
    leaf of the forum drill. Path-style paging, walked + bounded. ``[UNKNOWN]``.
    Also fetches the topic header best-effort so the posts have context.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)

    topic: Optional[Dict[str, Any]] = None
    try:
        t = httpx.get(
            f"{base_url}/api/v1/Forums/getForumCategoryTopic/{_seg(topic_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(t)
        td = t.json() or {}
        if isinstance(td, dict):
            topic = _normalize_forum_topic(td)
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        topic = None

    rows, total_rows, pages_fetched, truncated = _walk_forum_pages(
        base_url,
        headers,
        "/api/v1/Forums/getForumTopicPosts/" + topic_id + "/{page}/{page_size}",
        page,
        page_size,
        _normalize_forum_post,
        "Posts",
        "posts",
        "Messages",
        "messages",
    )
    note = _INFERRED_SCHEMA_NOTE
    if truncated:
        note += " Result was truncated (page/deadline cap); page further."
    return {
        "topic_id": topic_id,
        "topic": topic,
        "posts": rows,
        "total_rows": total_rows,
        "pages_fetched": pages_fetched,
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


# ---------------------------------------------------------------------------
# Wave-2 — 12d Projects (TDProjectModel — the 12d Model software project
# embedded INSIDE a Synergy job/folder; NOT a Synergy job)
# ---------------------------------------------------------------------------

# Bound the project change-history page-walk (mirrors SYNERGY_ISSUE_DEADLINE_S).
SYNERGY_PROJECT_DEADLINE_S = float(os.getenv("SYNERGY_PROJECT_DEADLINE_S", "20"))
SYNERGY_PROJECT_MAX_PAGES = int(os.getenv("SYNERGY_PROJECT_MAX_PAGES", "50"))


def _normalize_project(proj: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d ``TDProjectModel`` row — shape ``[UNKNOWN]``, defensive."""
    return {
        "project_id": _id_string(proj.get("ID") or proj.get("id") or proj),
        "name": _pick(proj, "Name", "name", "ProjectName", "project_name"),
        "path": _pick(proj, "Path", "path"),
        "raw": proj,
    }


def get_synergy_projects(
    server: str,
    token: str,
    *,
    mode: str = "",
    project_id: Optional[str] = None,
    job_id: Optional[str] = None,
    folder_id: Optional[str] = None,
    name: Optional[str] = None,
    file_name: Optional[str] = None,
    is_folder: bool = False,
    version: Optional[Any] = None,
    page: int = 1,
    page_size: int = 50,
    retrieve_attributes: bool = True,
) -> Dict[str, Any]:
    """Mode dispatcher for the 12d-projects read tool — routes to the per-mode
    helpers so handle_connect_synergy_projects can call a single function. Modes:
    find/list/get/folders/file-info/associations/notes/permission/history/
    changed-elements/latest-change (the binary `preview` mode is staged in the
    handler, not here). Read-only."""
    m = (mode or "").strip().lower()
    if m == "find":
        return find_projects_by_name(server, token, name or "", job_id=job_id or "")
    if m == "list" or not m:
        return list_projects(
            server, token, job_id=job_id or "", folder_id=folder_id or ""
        )
    if m == "get":
        return get_project(
            server, token, project_id or "", retrieve_attributes=retrieve_attributes
        )
    if m == "folders":
        return get_project_folders(
            server, token, project_id or "", retrieve_attributes=retrieve_attributes
        )
    if m in ("file-info", "file_info"):
        return get_project_file_info(
            server,
            token,
            project_id or "",
            file_name or "",
            is_folder=is_folder,
            retrieve_attributes=retrieve_attributes,
        )
    if m in ("associations", "notes"):
        return get_project_simple_list(server, token, project_id or "", m)
    if m == "permission":
        return get_project_permission(server, token, project_id or "")
    if m == "history":
        return get_project_history(
            server,
            token,
            project_id or "",
            folder_id=folder_id or "",
            page=page,
            page_size=page_size,
        )
    if m in ("changed-elements", "changed_elements"):
        return get_project_changed_elements(
            server, token, project_id or "", version=version
        )
    if m in ("latest-change", "latest_change"):
        return get_project_latest_change(server, token, project_id or "")
    raise ValueError(f"Unknown projects mode: {mode!r}")


def find_projects_by_name(
    server: str, token: str, name: str, job_id: str = ""
) -> Dict[str, Any]:
    """Locate a 12d project by name — read-only (projects: find mode).

    ``POST /api/v1/12dProjects/findByName``. Body shape is ``[UNKNOWN]`` → send
    a defensive dual-casing body ({Name/name}, optional {JobId} scope via
    ``_build_limit_id``). Read-only despite being POST. ``[UNKNOWN]`` rows.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    body: Dict[str, Any] = {"Name": name, "name": name}
    if job_id:
        body["JobId"] = _build_limit_id(job_id)
    resp = httpx.post(
        f"{base_url}/api/v1/12dProjects/findByName",
        json=body,
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Projects", "projects", "TDProjects")
    projects = [_normalize_project(r) for r in rows]
    return {
        "mode": "find",
        "name": name,
        "projects": projects,
        "total_count": len(projects),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def list_projects(
    server: str, token: str, job_id: str = "", folder_id: str = ""
) -> Dict[str, Any]:
    """List the 12d projects under a job or folder — read-only (list mode).

    Job scope: ``GET /api/v1/jobs/{job_id}/items`` → ``JobItemsModel
    .Sub12dProjects``; expected_count cross-checkable against
    ``JobModel.NoOfTDJobs``. Folder scope: ``GET /api/v1/folders/{folder_id}
    /items`` → ``FolderItemsModel.TDJobs``; expected_count against
    ``FolderModel.NumberOf12dProjects``. Single-shot composite. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    if folder_id:
        scope = "folder"
        resp = httpx.get(
            f"{base_url}/api/v1/folders/{_seg(folder_id)}/items",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        data = resp.json() or {}
        rows = data.get("TDJobs") if isinstance(data, dict) else None
        expected = (
            _pick(data, "NumberOf12dProjects", "number_of_12d_projects")
            if isinstance(data, dict)
            else None
        )
    else:
        scope = "job"
        resp = httpx.get(
            f"{base_url}/api/v1/jobs/{_seg(job_id)}/items", headers=headers, timeout=60
        )
        _check_response(resp)
        data = resp.json() or {}
        rows = data.get("Sub12dProjects") if isinstance(data, dict) else None
        expected = (
            _pick(data, "NoOfTDJobs", "no_of_td_jobs")
            if isinstance(data, dict)
            else None
        )

    rows_list = rows if isinstance(rows, list) else _coerce_rows(rows or [])
    projects = [_normalize_project(r) for r in rows_list if isinstance(r, dict)]
    return {
        "mode": "list",
        "scope": scope,
        **({"folder_id": folder_id} if folder_id else {"job_id": job_id}),
        "projects": projects,
        "total_count": len(projects),
        "expected_count": expected,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_project(
    server: str, token: str, project_id: str, retrieve_attributes: bool = True
) -> Dict[str, Any]:
    """Return one 12d project's metadata + details + description — read-only.

    ``GET /api/v1/12dProjects/{id}/{retrieve_attributes}`` (core), plus
    best-effort ``/details`` and ``/description`` (folded in; failure → null +
    note, never sinks the call). ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    ra = "true" if retrieve_attributes else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/{ra}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    core = resp.json() or {}
    if not isinstance(core, dict):
        core = {"raw": core}

    details = None
    description = None
    degraded: List[str] = []
    try:
        d = httpx.get(
            f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/details",
            headers=headers,
            timeout=60,
        )
        _check_response(d)
        details = d.json()
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        degraded.append("details")
    try:
        desc = httpx.get(
            f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/description",
            headers=headers,
            timeout=60,
        )
        _check_response(desc)
        # description may be a bare string or a wrapped object
        dj = desc.json()
        description = (
            dj
            if isinstance(dj, str)
            else (
                _pick(dj, "Description", "description") if isinstance(dj, dict) else dj
            )
        )
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        degraded.append("description")

    note = _INFERRED_SCHEMA_NOTE
    if degraded:
        note += f" Best-effort sections unavailable: {', '.join(degraded)}."
    return {
        "mode": "get",
        "project_id": project_id,
        "name": _pick(core, "Name", "name", "ProjectName", "project_name"),
        "description": description,
        "details": details,
        "attributes": _pick(core, "Attributes", "attributes"),
        "raw": core,
        "connector": "synergy",
        "note": note,
    }


def get_project_folders(
    server: str, token: str, project_id: str, retrieve_attributes: bool = True
) -> Dict[str, Any]:
    """List a 12d project's internal sub-folders — read-only (folders mode).

    ``GET /api/v1/12dProjects/{id}/folders/{retrieve_attributes}``. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    ra = "true" if retrieve_attributes else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/folders/{ra}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Folders", "folders")
    folders = [
        {
            "folder_id": _id_string(r.get("ID") or r.get("id") or r),
            "name": _pick(r, "Name", "name"),
            "path": _pick(r, "Path", "path"),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "mode": "folders",
        "project_id": project_id,
        "folders": folders,
        "total_count": len(folders),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_project_file_info(
    server: str,
    token: str,
    project_id: str,
    file_name: str,
    is_folder: bool = False,
    retrieve_attributes: bool = True,
) -> Dict[str, Any]:
    """Metadata for one named file (or sub-folder) inside a 12d project.

    ``GET /api/v1/12dProjects/{id}/fileInfo/{file_name}/{is_folder}/
    {retrieve_attributes}``. ``file_name`` is URL-encoded into the path.
    Distinct from ``get_file_metadata`` (ordinary Synergy files). ``[UNKNOWN]``.
    """
    from urllib.parse import quote

    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    encoded = quote(file_name, safe="")
    isf = "true" if is_folder else "false"
    ra = "true" if retrieve_attributes else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/fileInfo/{encoded}/{isf}/{ra}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "mode": "file-info",
        "project_id": project_id,
        "file_name": file_name,
        "is_folder": is_folder,
        "file": {
            "file_id": _id_string(data.get("ID") or data.get("id")),
            "name": _pick(data, "FileName", "Name", "name") or file_name,
            "size": _pick(data, "FileSize", "Size", "size"),
            "raw": data,
        },
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_project_simple_list(
    server: str, token: str, project_id: str, section: str
) -> Dict[str, Any]:
    """List a 12d project's associations or notes — read-only.

    ``section`` ∈ {associations, notes}:
      * associations → ``GET /api/v1/12dProjects/{id}/associations``
      * notes        → ``GET /api/v1/12dProjects/{id}/notes``
    Both ``[UNKNOWN]`` → defensive list-or-wrapper + raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    sub = "associations" if section == "associations" else "notes"
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/{sub}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json())
    return {
        "mode": section,
        "project_id": project_id,
        "items": rows,
        "total_count": len(rows),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_project_permission(server: str, token: str, project_id: str) -> Dict[str, Any]:
    """Return the CALLER's permission on a 12d project — read-only.

    ``GET /api/v1/12dProjects/{id}/permission``. ``[UNKNOWN]`` → raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/permission",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json()
    return {
        "mode": "permission",
        "project_id": project_id,
        "permission": data if isinstance(data, dict) else {"raw": data},
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_project_history(
    server: str,
    token: str,
    project_id: str,
    folder_id: str = "",
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """Return a 12d project's change history — read-only, paged + bounded.

    ``GET /api/v1/12dProjects/{id}/changelog/{page}/{page_size}`` (project-wide),
    or ``GET /api/v1/12dProjects/{id}/{folder_id}/history/{page}/{page_size}``
    when ``folder_id`` scopes it to a sub-folder. Style-2 path paging, walked +
    bounded (deadline + page cap). ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    if folder_id:
        path_fmt = (
            "/api/v1/12dProjects/"
            + project_id
            + "/"
            + folder_id
            + "/history/{page}/{page_size}"
        )
    else:
        path_fmt = "/api/v1/12dProjects/" + project_id + "/changelog/{page}/{page_size}"

    page_i = max(int(page or 1), 1)
    page_size_i = max(int(page_size or 50), 1)
    items: List[Dict[str, Any]] = []
    total_rows = 0
    truncated = False
    pages_fetched = 0
    started = time.monotonic()
    cur = page_i
    while True:
        resp = httpx.get(
            f"{base_url}{path_fmt.format(page=cur, page_size=page_size_i)}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        data = resp.json()
        rows = _coerce_rows(data, "Changes", "changes", "History", "history")
        pages_fetched += 1
        items.extend(rows)
        if isinstance(data, dict):
            total_rows = (
                _pick(data, "TotalRows", "total_rows", "Total", "total") or total_rows
            )
            total_pages = _pick(data, "TotalPages", "total_pages", "totalPages")
        else:
            total_pages = None
        if not rows or len(rows) < page_size_i:
            break
        if total_pages and isinstance(total_pages, int) and cur >= total_pages:
            break
        if total_rows and len(items) >= int(total_rows):
            break
        if (
            pages_fetched >= SYNERGY_PROJECT_MAX_PAGES
            or (time.monotonic() - started) >= SYNERGY_PROJECT_DEADLINE_S
        ):
            truncated = (not total_rows) or len(items) < int(total_rows)
            break
        cur += 1

    note = _INFERRED_SCHEMA_NOTE
    if truncated:
        note += " Result was truncated (page/deadline cap); page further."
    return {
        "mode": "history",
        "project_id": project_id,
        **({"folder_id": folder_id} if folder_id else {}),
        "items": items,
        "page": page_i,
        "page_size": page_size_i,
        "total_rows": total_rows or len(items),
        "pages_fetched": pages_fetched,
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


def get_project_latest_change(
    server: str, token: str, project_id: str
) -> Dict[str, Any]:
    """Return the latest change id for a 12d project — read-only.

    ``GET /api/v1/12dProjects/{id}/latest-change``. Also used internally to
    resolve a default version for changed-elements / preview. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/latest-change",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json()
    latest = {
        "id": (_id_string(data) if isinstance(data, (dict, str)) else None)
        or (
            _pick(data, "Version", "version", "ChangeId", "change_id", "ID", "id")
            if isinstance(data, dict)
            else data
        ),
        "raw": data,
    }
    return {
        "mode": "latest-change",
        "project_id": project_id,
        "latest_change": latest,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def _resolve_project_version(
    base_url: str, headers: Dict[str, str], project_id: str
) -> Optional[Any]:
    """Best-effort resolve a 12d project's latest version/change for defaults."""
    try:
        r = httpx.get(
            f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/latest-change",
            headers=headers,
            timeout=60,
        )
        _check_response(r)
        data = r.json()
        if isinstance(data, dict):
            return _pick(
                data, "Version", "version", "ChangeId", "change_id", "ID", "id"
            )
        return data
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        return None


def get_project_changed_elements(
    server: str,
    token: str,
    project_id: str,
    version: Optional[Any] = None,
) -> Dict[str, Any]:
    """Return the 12d-Model elements that changed at a version — read-only.

    ``GET /api/v1/12dProjects/{id}/changed-elements/{version}``. ``version`` is a
    REQUIRED path segment — defaults to the latest via ``latest-change`` when
    omitted. ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    if version is None or version == "":
        version = _resolve_project_version(base_url, headers, project_id)
    if version is None or version == "":
        raise ValueError(
            "Could not resolve a project version for changed-elements — supply an "
            "explicit version, or verify the project_id and latest-change endpoint."
        )
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/changed-elements/{version}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    elements = _coerce_rows(resp.json(), "Elements", "elements", "ChangedElements")
    return {
        "mode": "changed-elements",
        "project_id": project_id,
        "version": version,
        "elements": elements,
        "total_count": len(elements),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_project_preview(
    server: str,
    token: str,
    project_id: str,
    version: Optional[Any] = None,
) -> Tuple[bytes, str, Any]:
    """Return a 12d project's BINARY preview image — read-only.

    ``GET /api/v1/12dProjects/{id}/preview/{version}``. ``version`` defaults to
    the latest via ``latest-change`` when omitted. Returns ``(content, filename,
    version)`` so the handler can stage it via ``build_download_payload`` (inline
    hex small / presigned S3 large), exactly like ``get_workflow_diagram`` —
    NEVER inline JSON image bytes.
    """
    base_url = _build_base_url(server)
    headers = {"Authorization": _normalize_token(token)}
    if version is None or version == "":
        version = _resolve_project_version(base_url, headers, project_id)
    if version is None or version == "":
        raise ValueError(
            "Could not resolve a project version for preview — supply an explicit "
            "version, or verify the project_id and latest-change endpoint."
        )
    resp = httpx.get(
        f"{base_url}/api/v1/12dProjects/{_seg(project_id)}/preview/{version}",
        headers=headers,
        timeout=120,
    )
    _check_response(resp)
    filename = f"project_{project_id}_{version}.png"
    cd = resp.headers.get("content-disposition", "")
    if "filename=" in cd:
        parts = cd.split("filename=")
        if len(parts) > 1:
            extracted = parts[1].strip().strip('"').strip("'")
            if extracted:
                filename = extracted
    return resp.content, filename, version


# ---------------------------------------------------------------------------
# Wave-2 — Transmittals (Issued Files): types → sets → set → issue, discover
# ---------------------------------------------------------------------------

# Bound the discover fan-out (job → all types → all sets).
SYNERGY_TRANSMITTAL_DEADLINE_S = float(
    os.getenv("SYNERGY_TRANSMITTAL_DEADLINE_S", "25")
)
SYNERGY_TRANSMITTAL_MAX_TYPES = int(os.getenv("SYNERGY_TRANSMITTAL_MAX_TYPES", "50"))
# Conservative inter-call spacing on the discover fan-out (01d: no documented
# rate limit, be conservative).
_SYNERGY_TRANSMITTAL_CALL_SPACING_S = 0.1


def _coerce_bool(value: Any) -> Optional[bool]:
    """Best-effort coerce a 12d ``[UNKNOWN]`` truthy/falsey value to a bool.

    Handles a bare JSON bool, the strings 'true'/'false'/'1'/'0', ints, or a
    one-key wrapper ({HasAccess|has_access|value:...}). Returns None when the
    shape can't be resolved (caller degrades to raw + note).
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        s = value.strip().lower()
        if s in ("true", "1", "yes"):
            return True
        if s in ("false", "0", "no"):
            return False
        return None
    if isinstance(value, dict):
        for k in (
            "HasAccess",
            "has_access",
            "Value",
            "value",
            "Result",
            "result",
            "Enabled",
            "enabled",
        ):
            if k in value:
                return _coerce_bool(value.get(k))
    return None


def _normalize_filesettype(t: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize an issued-file-set TYPE row — shape ``[UNKNOWN]``."""
    return {
        "type_id": _id_string(t.get("ID") or t.get("id") or t),
        "name": _pick(t, "Name", "name", "Title", "title"),
        "raw": t,
    }


def _normalize_fileset(s: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize an issued file-SET row — shape ``[UNKNOWN]``."""
    return {
        "set_id": _id_string(s.get("ID") or s.get("id") or s),
        "name": _pick(s, "Name", "name", "Title", "title"),
        "version": _pick(s, "Version", "version", "LatestVersion", "latest_version"),
        "issued": _pick(s, "Issued", "issued", "DateIssued", "date_issued"),
        "raw": s,
    }


def get_job_filesettypes(
    server: str, token: str, job_id: str, type_id: str = ""
) -> Dict[str, Any]:
    """List a job's issued-file-set TYPES — read-only (transmittals: types).

    ``GET /api/v1/issued-files/getJobFileSetTypes/{job_id}`` (primary), falling
    back to ``GET /api/v1/jobs/{id}/getIssuedFileSetTypes`` on 4xx/empty. When a
    ``type_id`` is given, also fetch one type's definition best-effort via
    ``getIssuedFileSetType/{type_id}``. ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    rows: List[Dict[str, Any]] = []
    try:
        resp = httpx.get(
            f"{base_url}/api/v1/issued-files/getJobFileSetTypes/{_seg(job_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        rows = _coerce_rows(resp.json(), "Types", "types", "FileSetTypes")
    except SynergyAuthError:
        raise
    except (httpx.HTTPError, ValueError):
        rows = []
    if not rows:
        try:
            resp = httpx.get(
                f"{base_url}/api/v1/jobs/{_seg(job_id)}/getIssuedFileSetTypes",
                headers=headers,
                timeout=60,
            )
            _check_response(resp)
            rows = _coerce_rows(resp.json(), "Types", "types", "FileSetTypes")
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            rows = []

    types = [_normalize_filesettype(r) for r in rows]

    note = _INFERRED_SCHEMA_NOTE
    if type_id:
        try:
            t = httpx.get(
                f"{base_url}/api/v1/issued-files/getIssuedFileSetType/{_seg(type_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(t)
            td = t.json()
            if isinstance(td, dict):
                # Merge the single-type detail in (best-effort enrichment).
                detail = _normalize_filesettype(td)
                merged = False
                for entry in types:
                    if entry.get("type_id") == detail.get("type_id"):
                        entry.update(detail)
                        merged = True
                if not merged and detail.get("type_id"):
                    types.append(detail)
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            note += " Single-type definition lookup unavailable (best-effort)."

    return {
        "job_id": job_id,
        "types": types,
        "total_count": len(types),
        "connector": "synergy",
        "note": note,
    }


def get_issued_file_sets(
    server: str, token: str, job_id: str, type_id: str
) -> Dict[str, Any]:
    """List a job's issued file-SETS for a type — read-only (transmittals: sets).

    ``GET /api/v1/issued-files/getIssuedFileSets/{job_id}/{type_id}`` — requires
    BOTH path segments. ``[UNKNOWN]`` → defensive list-or-wrapper.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/issued-files/getIssuedFileSets/{_seg(job_id)}/{_seg(type_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Sets", "sets", "FileSets")
    sets = [_normalize_fileset(r) for r in rows]
    return {
        "job_id": job_id,
        "type_id": type_id,
        "sets": sets,
        "total_count": len(sets),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_issued_file_set(
    server: str,
    token: str,
    set_id: str,
    get_issues: bool = True,
    version: Optional[Any] = None,
) -> Dict[str, Any]:
    """Return one issued file-set's detail + its issues — read-only (set mode).

    PREFERRED ``GET /api/v1/issued-files/getIssuedFileSetForDisplay/{set_id}/
    {get_issues}``; falls back to the slower ``getIssuedFileSet/{set_id}/
    {get_issues}`` only on 404. When ``version`` supplied, also fetch that set
    version's files via ``getIssuedFileSetVersionFiles/{set_id}/{version}``
    (best-effort). ``[UNKNOWN]`` → raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    gi = "true" if get_issues else "false"

    data: Dict[str, Any] = {}
    try:
        resp = httpx.get(
            f"{base_url}/api/v1/issued-files/getIssuedFileSetForDisplay/{_seg(set_id)}/{gi}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        d = resp.json()
        data = d if isinstance(d, dict) else {"raw": d}
    except SynergyAuthError:
        raise
    except (httpx.HTTPError, ValueError):
        try:
            resp = httpx.get(
                f"{base_url}/api/v1/issued-files/getIssuedFileSet/{_seg(set_id)}/{gi}",
                headers=headers,
                timeout=60,
            )
            _check_response(resp)
            d = resp.json()
            data = d if isinstance(d, dict) else {"raw": d}
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            data = {}

    issue_rows = _coerce_rows(
        data.get("Issues") or data.get("issues") or [], "Issues", "issues"
    )
    issues = [
        {
            "issue_id": _id_string(r.get("ID") or r.get("id") or r),
            "raw": r,
        }
        for r in issue_rows
    ]

    version_files: Optional[List[Dict[str, Any]]] = None
    note = _INFERRED_SCHEMA_NOTE
    if version is not None and version != "":
        try:
            vf = httpx.get(
                f"{base_url}/api/v1/issued-files/getIssuedFileSetVersionFiles/{_seg(set_id)}/{version}",
                headers=headers,
                timeout=60,
            )
            _check_response(vf)
            vrows = _coerce_rows(vf.json(), "Files", "files")
            version_files = [
                {
                    "file_id": _id_string(r.get("ID") or r.get("id") or r),
                    "name": _pick(r, "FileName", "Name", "name"),
                    "size": _pick(r, "FileSize", "Size", "size"),
                    "version": _pick(r, "Version", "version"),
                    "raw": r,
                }
                for r in vrows
            ]
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            note += " Version-files lookup unavailable (best-effort)."

    return {
        "set_id": set_id,
        "set": data,
        "issues": issues,
        **({"version_files": version_files} if version_files is not None else {}),
        "connector": "synergy",
        "note": note,
    }


def get_issued_file_issue(server: str, token: str, issue_id: str) -> Dict[str, Any]:
    """Return one transmittal ISSUE (publish event) — read-only (issue mode).

    NOTE: this 'issue' is a transmittal issuance, NOT an issue-tracking RFI
    (that is ``list_job_issues``/``get_issue_detail``). Combines:
      * ``getIssueDetails/{issue_id}`` (event details — core)
      * ``getIssuedFileIssueSetPublishedFileDetails/{issue_id}`` (published files)
      * ``getPublishingInfo/{issue_id}`` + ``getIssuedFilePublishingInfo/{issue_id}``
        (recipients/distribution — merged best-effort)
      * ``hasStoredTransmittalFile/{issue_id}`` (download-available flag)
    Every secondary is best-effort (degrades to empty + degraded[] note — one
    bad sub-call must not sink the read). ALL ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    degraded: List[str] = []

    issue: Dict[str, Any] = {}
    try:
        r = httpx.get(
            f"{base_url}/api/v1/issued-files/getIssueDetails/{_seg(issue_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(r)
        d = r.json()
        issue = d if isinstance(d, dict) else {"raw": d}
    except SynergyAuthError:
        raise
    except (httpx.HTTPError, ValueError):
        degraded.append("issue_details")

    published_files: List[Dict[str, Any]] = []
    try:
        r = httpx.get(
            f"{base_url}/api/v1/issued-files/getIssuedFileIssueSetPublishedFileDetails/{_seg(issue_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(r)
        prows = _coerce_rows(r.json(), "Files", "files", "PublishedFiles")
        published_files = [
            {
                "file_id": _id_string(pf.get("ID") or pf.get("id") or pf),
                "name": _pick(pf, "FileName", "Name", "name"),
                "version": _pick(pf, "Version", "version"),
                "raw": pf,
            }
            for pf in prows
        ]
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        degraded.append("published_files")

    publishing_info: Dict[str, Any] = {}
    for path in (
        "getPublishingInfo",
        "getIssuedFilePublishingInfo",
    ):
        try:
            r = httpx.get(
                f"{base_url}/api/v1/issued-files/{path}/{_seg(issue_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(r)
            d = r.json()
            if isinstance(d, dict):
                # Merge — one endpoint may carry recipients the other omits.
                for k, v in d.items():
                    if k not in publishing_info or publishing_info.get(k) in (
                        None,
                        "",
                        [],
                        {},
                    ):
                        publishing_info[k] = v
            elif d is not None:
                publishing_info.setdefault("raw", d)
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            degraded.append(path)

    with_transmittal_available: Optional[bool] = None
    try:
        r = httpx.get(
            f"{base_url}/api/v1/issued-files/hasStoredTransmittalFile/{_seg(issue_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(r)
        with_transmittal_available = _coerce_bool(r.json())
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        degraded.append("has_stored_transmittal_file")

    note = (
        _INFERRED_SCHEMA_NOTE
        + " NOTE: this 'issue' is a transmittal publish EVENT, not an "
        "issue-tracking RFI (use connect_synergy_issues for those)."
    )
    if degraded:
        note += f" Best-effort sections unavailable: {', '.join(degraded)}."

    return {
        "issue_id": issue_id,
        "issue": issue,
        "published_files": published_files,
        "publishing_info": publishing_info,
        "with_transmittal_available": with_transmittal_available,
        "degraded": degraded,
        "connector": "synergy",
        "note": note,
    }


def get_required_issue_attributes(server: str, token: str) -> Dict[str, Any]:
    """Return the required transmittal-issue attributes — read-only (vocab).

    ``GET /api/v1/issued-files/getRequiredIssueAttributes``. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/issued-files/getRequiredIssueAttributes",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    attrs = _coerce_rows(resp.json(), "Attributes", "attributes")
    return {
        "required_issue_attributes": attrs,
        "total_count": len(attrs),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def discover_transmittals(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Chain job → all types → all sets — read-only (transmittals: discover).

    Bounded fan-out: cap the number of types iterated + a wall-clock deadline,
    set ``truncated`` on cap. Conservative inter-call spacing. ``[UNKNOWN]``.
    """
    types_result = get_job_filesettypes(server, token, job_id)
    types = types_result.get("types") or []

    all_sets: List[Dict[str, Any]] = []
    truncated = False
    started = time.monotonic()
    types_iterated = 0
    for t in types:
        type_id = t.get("type_id")
        if not type_id:
            continue
        if (
            types_iterated >= SYNERGY_TRANSMITTAL_MAX_TYPES
            or (time.monotonic() - started) >= SYNERGY_TRANSMITTAL_DEADLINE_S
        ):
            truncated = True
            break
        types_iterated += 1
        try:
            sr = get_issued_file_sets(server, token, job_id, str(type_id))
            for s in sr.get("sets") or []:
                tagged = {**s, "type_id": type_id}
                all_sets.append(tagged)
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            continue
        time.sleep(_SYNERGY_TRANSMITTAL_CALL_SPACING_S)

    note = _INFERRED_SCHEMA_NOTE
    if truncated:
        note += " Discover fan-out was truncated (type/deadline cap); query a type directly."
    return {
        "job_id": job_id,
        "types": types,
        "sets": all_sets,
        "total_sets": len(all_sets),
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


# ---------------------------------------------------------------------------
# Wave-2 — Companies (list / get / jobs / staff / schema)
# ---------------------------------------------------------------------------


def _normalize_company(company: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d ``CompanyModel`` row — shape ``[UNKNOWN]``, defensive.

    Reads BOTH casings for every field and always keeps a ``raw`` passthrough.
    """
    return {
        "company_id": _id_string(company.get("ID") or company.get("id") or company),
        "name": _pick(company, "Name", "name", "CompanyName", "company_name"),
        "attributes": _pick(company, "Attributes", "attributes"),
        "raw": company,
    }


def list_companies(server: str, token: str, limit: int = 200) -> Dict[str, Any]:
    """List ALL companies — read-only, best-effort (companies: list mode).

    ``GET /api/v1/Companies`` (Capital-C). The docs DISAGREE on whether a
    list-all endpoint exists (inventory says yes; query-patterns says no), so we
    call it and on 404/405/501 return an empty list + a helpful note rather than
    surfacing a raw HTTP error. Client-side capped to ``limit``. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    limit = max(int(limit or 200), 1)
    try:
        resp = httpx.get(f"{base_url}/api/v1/Companies", headers=headers, timeout=60)
        _check_response(resp)
        rows = _coerce_rows(resp.json(), "Companies", "companies")
    except SynergyAuthError:
        raise
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code if exc.response is not None else None
        if code in (404, 405, 501):
            return {
                "companies": [],
                "total_count": 0,
                "returned": 0,
                "truncated": False,
                "connector": "synergy",
                "note": (
                    "This instance does not expose a list-all companies endpoint; "
                    "fetch a company by id, via its jobs, or via a contact record "
                    "(connect_synergy_contacts returns each contact's companies[])."
                ),
            }
        raise
    except (httpx.HTTPError, ValueError):
        return {
            "companies": [],
            "total_count": 0,
            "returned": 0,
            "truncated": False,
            "connector": "synergy",
            "note": (
                "Could not list companies on this instance; fetch a company by id "
                "or via a contact's companies[]."
            ),
        }

    companies = [_normalize_company(r) for r in rows]
    total_count = len(companies)
    truncated = total_count > limit
    if truncated:
        companies = companies[:limit]
    note = _INFERRED_SCHEMA_NOTE
    if truncated:
        note += f" Returned the first {limit} of {total_count} companies."
    return {
        "companies": companies,
        "total_count": total_count,
        "returned": len(companies),
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


def get_company(server: str, token: str, company_id: str) -> Dict[str, Any]:
    """Return one company by id (+ attributes) — read-only (companies: get).

    ``GET /api/v1/Companies/{id}/true`` (retrieve_attributes hardcoded 'true').
    ``CompanyModel`` shape ``[UNKNOWN]`` → ``_normalize_company`` + raw.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/Companies/{_seg(company_id)}/true",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "company": _normalize_company(data),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_company_jobs(
    server: str, token: str, company_id: str, limit: int = 200
) -> Dict[str, Any]:
    """List a company's jobs — read-only (companies: jobs mode).

    ``GET /api/v1/Companies/{id}/jobs``. Rows are ``JobModel`` (PascalCase,
    confirmed) → reuse ``_normalize_job``. Envelope ``[UNKNOWN]`` → defensive.
    Client-side capped to ``limit``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    limit = max(int(limit or 200), 1)
    resp = httpx.get(
        f"{base_url}/api/v1/Companies/{_seg(company_id)}/jobs",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Jobs", "jobs")
    jobs = [_normalize_job(r) for r in rows]
    total_count = len(jobs)
    truncated = total_count > limit
    if truncated:
        jobs = jobs[:limit]
    return {
        "company_id": company_id,
        "jobs": jobs,
        "total_count": total_count,
        "returned": len(jobs),
        "truncated": truncated,
        "connector": "synergy",
    }


def get_company_staff(
    server: str, token: str, company_id: str, limit: int = 200
) -> Dict[str, Any]:
    """List a company's staff (contacts) — read-only (companies: staff mode).

    ``GET /api/v1/Companies/{id}/staff/true`` (retrieve_attributes 'true'). Rows
    are ``ContactModel`` (snake_case, confirmed) → reuse ``_normalize_contact``.
    Envelope ``[UNKNOWN]`` → defensive. Client-side capped to ``limit``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    limit = max(int(limit or 200), 1)
    resp = httpx.get(
        f"{base_url}/api/v1/Companies/{_seg(company_id)}/staff/true",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Contacts", "contacts", "Staff")
    contacts = [_normalize_contact(r) for r in rows]
    total_count = len(contacts)
    truncated = total_count > limit
    if truncated:
        contacts = contacts[:limit]
    return {
        "company_id": company_id,
        "contacts": contacts,
        "total_count": total_count,
        "returned": len(contacts),
        "truncated": truncated,
        "connector": "synergy",
    }


def get_company_attributes(server: str, token: str) -> Dict[str, Any]:
    """Return the system Company attribute vocabulary — read-only (schema mode).

    ``GET /api/v1/Companies/getSystemCompanyAttributes/true`` (get_initial
    'true'). Best-effort: ``[UNKNOWN]`` shape, degrade to null + note on failure
    (same pattern as ``get_job_schema``).
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    system_attributes: Any = None
    note = _INFERRED_SCHEMA_NOTE
    try:
        resp = httpx.get(
            f"{base_url}/api/v1/Companies/getSystemCompanyAttributes/true",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        system_attributes = resp.json()
    except SynergyAuthError:
        raise
    except (httpx.HTTPError, ValueError):
        note += " System company attributes unavailable on this instance."
    return {
        "system_attributes": system_attributes,
        "connector": "synergy",
        "note": note,
    }


# ---------------------------------------------------------------------------
# Wave-2 — Webforms (enabled / definitions / fills)
# ---------------------------------------------------------------------------

# Bound the fills page-walk (Style-2 path paging).
SYNERGY_WEBFORM_DEADLINE_S = float(os.getenv("SYNERGY_WEBFORM_DEADLINE_S", "20"))
SYNERGY_WEBFORM_MAX_PAGES = int(os.getenv("SYNERGY_WEBFORM_MAX_PAGES", "50"))
# Wildcard user-id segment for the by-job/by-task fills paths when not filtering
# to one user. Exact wildcard token is UNVERIFIED — flagged in the note.
_WEBFORM_USER_WILDCARD = "all"


def _normalize_form_definition(d: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d form DEFINITION row — shape ``[UNKNOWN]``, defensive."""
    return {
        "definition_id": _id_string(
            d.get("ID") or d.get("id") or d.get("ChangeId") or d.get("change_id") or d
        ),
        "name": _pick(d, "Name", "name", "Title", "title"),
        "description": _pick(d, "Description", "description"),
        "task_type": _pick(d, "TaskType", "task_type", "TaskTypeId", "task_type_id"),
        "raw": d,
    }


def _normalize_form_fill(f: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d form FILL (submission) row — shape ``[UNKNOWN]``."""
    return {
        "fill_id": _id_string(f.get("ID") or f.get("id") or f),
        "form_definition_id": _id_string(
            f.get("FormDefinitionId")
            or f.get("form_definition_id")
            or f.get("DefinitionId")
            or f.get("definition_id")
        ),
        "status": _pick(f, "Status", "status", "State", "state"),
        "submitted_by": _pick(
            f, "SubmittedBy", "submitted_by", "CreatedBy", "created_by", "User", "user"
        ),
        "submitted_at": _pick(
            f, "SubmittedAt", "submitted_at", "CreatedAt", "created_at", "DateCreated"
        ),
        "modified_at": _pick(
            f, "ModifiedAt", "modified_at", "LastModified", "DateModified"
        ),
        "answers": _pick(f, "Answers", "answers", "Values", "values", "Fields"),
        "raw": f,
    }


def forms_enabled(server: str, token: str) -> Dict[str, Any]:
    """Probe whether webforms are enabled on the instance — read-only.

    ``GET /api/v1/web-forms/forms-enabled``. Returns ``enabled: bool|null``.
    ``[UNKNOWN]`` shape → ``_coerce_bool``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/web-forms/forms-enabled", headers=headers, timeout=60
    )
    _check_response(resp)
    enabled = _coerce_bool(resp.json())
    return {
        "enabled": enabled,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def list_form_definitions(
    server: str,
    token: str,
    job_id: str = "",
    task_id: str = "",
    task_type_id: str = "",
) -> Dict[str, Any]:
    """List form DEFINITIONS scoped to a job/task/task-type — read-only.

    Exactly one scope is honoured (task_type → task → job order):
      * by-task-type → ``form-definitions/by-task-type/{task_type_id}``
      * by-task      → ``form-definitions/by-task/{task_id}``
      * by-job       → ``form-definitions/by-job/{job_id}`` (default)
    ``[UNKNOWN]`` → defensive list-or-wrapper.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    if task_type_id:
        scope = "task_type"
        path = f"/api/v1/web-forms/form-definitions/by-task-type/{_seg(task_type_id)}"
        scope_echo: Dict[str, Any] = {"task_type_id": task_type_id}
    elif task_id:
        scope = "task"
        path = f"/api/v1/web-forms/form-definitions/by-task/{_seg(task_id)}"
        scope_echo = {"task_id": task_id}
    else:
        scope = "job"
        path = f"/api/v1/web-forms/form-definitions/by-job/{_seg(job_id)}"
        scope_echo = {"job_id": job_id}
    resp = httpx.get(f"{base_url}{path}", headers=headers, timeout=60)
    _check_response(resp)
    rows = _coerce_rows(
        resp.json(), "FormDefinitions", "form_definitions", "Definitions"
    )
    definitions = [_normalize_form_definition(r) for r in rows]
    return {
        "scope": scope,
        **scope_echo,
        "definitions": definitions,
        "total_count": len(definitions),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_form_definition(
    server: str, token: str, definition_id: str, for_view: bool = True
) -> Dict[str, Any]:
    """Return one form definition's field/question structure — read-only.

    ``GET /api/v1/web-forms/form-definitions/{definition_change_id}/{for_view}``
    (for_view default 'true'). ``[UNKNOWN]`` → raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    fv = "true" if for_view else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/web-forms/form-definitions/{_seg(definition_id)}/{fv}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "scope": "definition",
        "definition_id": definition_id,
        "definition": {**_normalize_form_definition(data), "raw": data},
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def list_form_fills(
    server: str,
    token: str,
    job_id: str = "",
    file_id: str = "",
    task_id: str = "",
    user_id: str = "",
    page: int = 1,
    page_size: int = 50,
    limit: int = 100,
) -> Dict[str, Any]:
    """List form FILLS (submissions) scoped to a job/file/task — read-only.

    Style-2 path paging, walked + bounded (deadline + page cap):
      * by-file → ``form-fills/by-file/{file_id}/{page}/{page_size}``
      * by-task → ``form-fills/by-task/{task_id}/{page}/{page_size}/{user_id}``
      * by-job  → ``form-fills/by-job/{job_id}/{page}/{page_size}/{user_id}`` (default)
    The ``{user_id}`` segment is REQUIRED on by-job/by-task — a wildcard token is
    used when not filtering (exact token UNVERIFIED → flagged). ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    uid = user_id or _WEBFORM_USER_WILDCARD
    if file_id:
        scope = "file"
        path_fmt = (
            "/api/v1/web-forms/form-fills/by-file/" + file_id + "/{page}/{page_size}"
        )
        scope_echo: Dict[str, Any] = {"file_id": file_id}
    elif task_id:
        scope = "task"
        path_fmt = (
            "/api/v1/web-forms/form-fills/by-task/"
            + task_id
            + "/{page}/{page_size}/"
            + uid
        )
        scope_echo = {"task_id": task_id}
    else:
        scope = "job"
        path_fmt = (
            "/api/v1/web-forms/form-fills/by-job/"
            + job_id
            + "/{page}/{page_size}/"
            + uid
        )
        scope_echo = {"job_id": job_id}

    page_i = max(int(page or 1), 1)
    page_size_i = max(int(page_size or 50), 1)
    limit = max(int(limit or 100), 1)
    fills: List[Dict[str, Any]] = []
    total_rows = 0
    truncated = False
    pages_fetched = 0
    started = time.monotonic()
    cur = page_i
    while True:
        resp = httpx.get(
            f"{base_url}{path_fmt.format(page=cur, page_size=page_size_i)}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        data = resp.json()
        rows = _coerce_rows(data, "FormFills", "form_fills", "Fills")
        pages_fetched += 1
        fills.extend(_normalize_form_fill(r) for r in rows)
        if isinstance(data, dict):
            total_rows = (
                _pick(data, "TotalRows", "total_rows", "Total", "total") or total_rows
            )
            total_pages = _pick(data, "TotalPages", "total_pages", "totalPages")
        else:
            total_pages = None
        if not rows or len(rows) < page_size_i:
            break
        if total_pages and isinstance(total_pages, int) and cur >= total_pages:
            break
        if total_rows and len(fills) >= int(total_rows):
            break
        if (
            len(fills) >= limit
            or pages_fetched >= SYNERGY_WEBFORM_MAX_PAGES
            or (time.monotonic() - started) >= SYNERGY_WEBFORM_DEADLINE_S
        ):
            truncated = (
                (len(fills) >= limit)
                or (not total_rows)
                or len(fills) < int(total_rows or 0)
            )
            break
        cur += 1
    if len(fills) > limit:
        fills = fills[:limit]
        truncated = True

    note = _INFERRED_SCHEMA_NOTE
    if scope in ("job", "task") and not user_id:
        note += (
            " The user_id path segment wildcard token is UNVERIFIED — if results "
            "are empty, filter to a specific user_id or use the search mode."
        )
    if truncated:
        note += " Result was truncated (limit/page/deadline cap); page further."
    return {
        "scope": scope,
        **scope_echo,
        "fills": fills,
        "total_rows": total_rows or len(fills),
        "page": page_i,
        "page_size": page_size_i,
        "pages_fetched": pages_fetched,
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


def search_form_fills(
    server: str,
    token: str,
    page: int = 1,
    page_size: int = 50,
    filters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Server-side search for form FILLS — read-only (fills: search).

    ``POST /api/v1/web-forms/form-fills/search`` (Style-1 body, PagedResultModel).
    Body shape is ``[UNKNOWN]`` → send only ``{Page, PageSize}`` plus any
    caller-supplied pass-through ``filters``, never a hard-coded required field.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    page = max(int(page or 1), 1)
    page_size = max(int(page_size or 50), 1)
    body: Dict[str, Any] = {"Page": page, "PageSize": page_size}
    if isinstance(filters, dict):
        body.update(filters)
    resp = httpx.post(
        f"{base_url}/api/v1/web-forms/form-fills/search",
        json=body,
        headers=headers,
        timeout=90,
    )
    _check_response(resp)
    data = resp.json() or {}
    rows = _coerce_rows(data, "FormFills", "form_fills", "Fills")
    fills = [_normalize_form_fill(r) for r in rows]
    total_rows = (
        _pick(data, "TotalRows", "total_rows", "Total", "total")
        if isinstance(data, dict)
        else None
    )
    total_pages = (
        _pick(data, "TotalPages", "total_pages", "totalPages")
        if isinstance(data, dict)
        else None
    )
    return {
        "scope": "search",
        "fills": fills,
        "total_rows": total_rows or len(fills),
        "page": page,
        "page_size": page_size,
        "truncated": bool(
            total_pages and isinstance(total_pages, int) and total_pages > 1
        ),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_form_fill(server: str, token: str, fill_id: str) -> Dict[str, Any]:
    """Return one form FILL (submission) with its answers — read-only.

    ``GET /api/v1/web-forms/form-fills/{id}``. ``[UNKNOWN]`` → raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/web-forms/form-fills/{_seg(fill_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "scope": "fill",
        "fill": {**_normalize_form_fill(data), "raw": data},
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_form_fill_output_files(server: str, token: str, fill_id: str) -> Dict[str, Any]:
    """Return a form FILL's generated output files — read-only (refs only).

    ``GET /api/v1/web-forms/form-fills/{form_fill_id}/output-file-list``. Returns
    file refs the agent can then pull via the existing connect_synergy_download
    (READ-only, no bytes here). ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/web-forms/form-fills/{_seg(fill_id)}/output-file-list",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Files", "files", "OutputFiles")
    output_files = [
        {
            "file_id": _id_string(r.get("ID") or r.get("id") or r),
            "name": _pick(r, "FileName", "Name", "name"),
            "size": _pick(r, "FileSize", "Size", "size"),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "scope": "output_files",
        "fill_id": fill_id,
        "output_files": output_files,
        "total_count": len(output_files),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


# ---------------------------------------------------------------------------
# Wave-2 — Job extras (Teams, Reports, ClashDetection)
# ---------------------------------------------------------------------------

# Bound the clash-items client-side cap (mirrors list_job_tasks limit).
SYNERGY_CLASH_ITEMS_LIMIT = int(os.getenv("SYNERGY_CLASH_ITEMS_LIMIT", "200"))


def get_job_team(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Return a job's team (members + roles) — read-only (job_extras: team).

    PARAMETER PASSING IS ``[UNKNOWN]``: ``GET /api/v1/teams/getJobTeam`` shows no
    documented path/query param. Try ``?job_id=`` (then ``?jobId=`` / ``?JobId=``)
    first; on 400/404 fall back to ``/getJobTeam/{job_id}`` path form; surface a
    clear note if both fail. Response shape ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    rows: Optional[List[Dict[str, Any]]] = None
    note = _INFERRED_SCHEMA_NOTE
    attempts = [
        f"/api/v1/teams/getJobTeam?job_id={job_id}",
        f"/api/v1/teams/getJobTeam?jobId={job_id}",
        f"/api/v1/teams/getJobTeam?JobId={job_id}",
        f"/api/v1/teams/getJobTeam/{_seg(job_id)}",
    ]
    for path in attempts:
        try:
            resp = httpx.get(f"{base_url}{path}", headers=headers, timeout=60)
            _check_response(resp)
            rows = _coerce_rows(resp.json(), "Team", "team", "Members", "members")
            break
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            continue
    if rows is None:
        rows = []
        note += " getJobTeam param encoding unverified — could not retrieve the team."

    team = [
        {
            "member_id": _id_string(
                r.get("ID") or r.get("id") or r.get("UserId") or r.get("user_id") or r
            ),
            "name": _pick(r, "Name", "name", "DisplayName", "display_name"),
            "role_id": _id_string(r.get("RoleId") or r.get("role_id"))
            or _pick(r, "Role", "role"),
            "role_name": _pick(r, "RoleName", "role_name"),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "job_id": job_id,
        "team": team,
        "total_count": len(team),
        "connector": "synergy",
        "note": note,
    }


def get_role_definitions(server: str, token: str) -> Dict[str, Any]:
    """Return the global role-definition reference — read-only (job_extras: roles).

    ``GET /api/v1/teams/getAllRoleDefinitions``. Reference data (cache-friendly).
    ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/teams/getAllRoleDefinitions",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Roles", "roles", "RoleDefinitions")
    roles = [
        {
            "role_id": _id_string(r.get("ID") or r.get("id") or r),
            "name": _pick(r, "Name", "name", "DisplayName", "display_name"),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "roles": roles,
        "total_count": len(roles),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def list_entity_reports(
    server: str,
    token: str,
    entity_id: str = "",
    entity_type: str = "",
    report_type: str = "",
) -> Dict[str, Any]:
    """List reports — read-only (job_extras: reports).

    Routing (the ``{type}`` / ``{report_id}`` paths collide at the route level —
    disambiguate by params, not guessing):
      * no report_type → ``GET /api/v1/reports/entityTypeReports`` (catalog)
      * report_type only → ``GET /api/v1/reports/{type}`` (all of that type)
      * entity_id + report_type → ``GET /api/v1/reports/{entity_id}/{type}``
    ``report_type``/``entity_type`` encoding ``[UNKNOWN]`` → pass verbatim; a 404
    surfaces 'verify report_type/entity_type encoding' (NO retry). ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    if entity_id and report_type:
        scope = "entity"
        path = f"/api/v1/reports/{_seg(entity_id)}/{report_type}"
    elif report_type:
        scope = "type"
        path = f"/api/v1/reports/{report_type}"
    else:
        scope = "catalog"
        path = "/api/v1/reports/entityTypeReports"

    try:
        resp = httpx.get(f"{base_url}{path}", headers=headers, timeout=60)
        _check_response(resp)
    except httpx.HTTPStatusError as exc:
        if (
            exc.response is not None
            and exc.response.status_code == 404
            and (report_type or entity_type)
        ):
            raise ValueError(
                "Reports lookup not found (HTTP 404). The report_type "
                f"({report_type!r}) / entity_type ({entity_type!r}) encoding is "
                "UNVERIFIED — confirm the correct enum encoding (fetch "
                "/types/entityTypes) before retrying."
            ) from exc
        raise
    rows = _coerce_rows(resp.json(), "Reports", "reports", "EntityTypeReports")
    reports = [
        {
            "report_id": _id_string(r.get("ID") or r.get("id") or r)
            or _pick(r, "ReportId", "report_id", "Guid", "guid"),
            "name": _pick(r, "Name", "name", "Title", "title"),
            "type": _pick(r, "Type", "type", "ReportType", "report_type"),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "reports": reports,
        "total_count": len(reports),
        "scope": scope,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_report(server: str, token: str, report_id: str) -> Dict[str, Any]:
    """Return one report's definition/metadata — read-only (job_extras: report).

    ``GET /api/v1/reports/{report_id}/get``. ``report_id`` is a GUID (NOT an N_N
    IDString) — passed verbatim, never through ``_build_limit_id``. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/reports/{_seg(report_id)}/get",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "report_id": report_id,
        "report": data,
        "name": _pick(data, "Name", "name", "Title", "title"),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_report_inputs(server: str, token: str, report_id: str) -> Dict[str, Any]:
    """Return a report's input parameter definitions — read-only.

    ``GET /api/v1/reports/{report_id}/inputs``. READ of the input schema only
    (generateReport itself is a WRITE and excluded). ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/reports/{_seg(report_id)}/inputs",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    inputs = _coerce_rows(resp.json(), "Inputs", "inputs", "Parameters", "parameters")
    return {
        "report_id": report_id,
        "inputs": inputs,
        "total_count": len(inputs),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def _clash_can_access(base_url: str, headers: Dict[str, str]) -> Optional[bool]:
    """Best-effort clash-detection access probe — returns True/False/None.

    ``GET /api/v1/clash-detection/canUserAccess``. Param passing ``[UNKNOWN]`` →
    best-effort; any non-200/parse-failure → None ('unknown, proceed').
    """
    try:
        r = httpx.get(
            f"{base_url}/api/v1/clash-detection/canUserAccess",
            headers=headers,
            timeout=60,
        )
        if r.status_code in (401, 403):
            return False
        r.raise_for_status()
        return _coerce_bool(r.json())
    except (httpx.HTTPError, ValueError):
        return None


def get_clash_details(server: str, token: str, folder_id: str) -> Dict[str, Any]:
    """Return clash detections for a folder's federated model — read-only.

    Calls ``canUserAccess`` FIRST (best-effort): if it returns false/403,
    short-circuit with a clear 'clash detection not licensed / no access' note
    instead of 404-spamming. Then ``GET /api/v1/clash-detection/getDetails/
    {folder_id}``. ``[UNKNOWN]`` → defensive.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    access = _clash_can_access(base_url, headers)
    if access is False:
        return {
            "folder_id": folder_id,
            "clashes": [],
            "total_count": 0,
            "access_checked": True,
            "connector": "synergy",
            "note": (
                "Clash detection is not licensed or you do not have access on this "
                "12d instance (canUserAccess returned false)."
            ),
        }
    resp = httpx.get(
        f"{base_url}/api/v1/clash-detection/getDetails/{_seg(folder_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Clashes", "clashes", "Detections")
    clashes = [
        {
            "clash_id": _id_string(r.get("ID") or r.get("id") or r),
            "name": _pick(r, "Name", "name", "Title", "title"),
            "status": _pick(r, "Status", "status", "State", "state"),
            "created_at": _pick(r, "CreatedAt", "created_at", "DateCreated", "Created"),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "folder_id": folder_id,
        "clashes": clashes,
        "total_count": len(clashes),
        "access_checked": access is not None,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_clash_items(
    server: str, token: str, clash_id: str, limit: int = SYNERGY_CLASH_ITEMS_LIMIT
) -> Dict[str, Any]:
    """Return the individual clash items within one clash run — read-only.

    ``GET /api/v1/clash-detection/clashes/{clash_id}/items``. Client-side capped
    to ``limit`` with a truncated flag (paging ``[UNKNOWN]``). ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    limit = max(int(limit or SYNERGY_CLASH_ITEMS_LIMIT), 1)
    resp = httpx.get(
        f"{base_url}/api/v1/clash-detection/clashes/{_seg(clash_id)}/items",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Items", "items", "Clashes", "clashes")
    total_count = len(rows)
    truncated = total_count > limit
    items = rows[:limit] if truncated else rows
    note = _INFERRED_SCHEMA_NOTE
    if truncated:
        note += f" Returned the first {limit} of {total_count} clash items."
    return {
        "clash_id": clash_id,
        "items": items,
        "total_count": total_count,
        "returned": len(items),
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


def get_clash_report(
    server: str,
    token: str,
    clash_id: str,
    report_format: str = "csv",
    delimiter: str = ",",
) -> Tuple[bytes, str]:
    """Return a clash run's BINARY report — read-only.

    ``GET /api/v1/clash-detection/getReport/{clash_id}/{format}/{delimiter}``.
    ``delimiter`` is only meaningful for delimited formats; passed verbatim
    (URL-encoded). Returns ``(content, filename)`` so the handler can stage it
    via ``build_download_payload`` like ``get_workflow_diagram`` — NEVER inline
    JSON. ``format`` valid set ``[UNKNOWN]`` → passed verbatim.
    """
    from urllib.parse import quote

    base_url = _build_base_url(server)
    headers = {"Authorization": _normalize_token(token)}
    fmt = quote(report_format or "csv", safe="")
    delim = quote(delimiter or ",", safe="")
    resp = httpx.get(
        f"{base_url}/api/v1/clash-detection/getReport/{_seg(clash_id)}/{fmt}/{delim}",
        headers=headers,
        timeout=120,
    )
    _check_response(resp)
    filename = f"clash_report_{clash_id}.{report_format or 'csv'}"
    cd = resp.headers.get("content-disposition", "")
    if "filename=" in cd:
        parts = cd.split("filename=")
        if len(parts) > 1:
            extracted = parts[1].strip().strip('"').strip("'")
            if extracted:
                filename = extracted
    return resp.content, filename


# ---------------------------------------------------------------------------
# Wave-2 — Notes & Associations (cross-cutting entity annotations)
# ---------------------------------------------------------------------------

# Bound the per-note message hydration fan-out.
SYNERGY_NOTES_MAX_HYDRATE = int(os.getenv("SYNERGY_NOTES_MAX_HYDRATE", "50"))
SYNERGY_NOTES_DEADLINE_S = float(os.getenv("SYNERGY_NOTES_DEADLINE_S", "15"))
# Default 'all-types' value for the Associations expected_type filter segment
# (encoding [UNKNOWN] — passed verbatim).
_ASSOCIATION_ALL_TYPES = "all"


def _normalize_note_header(n: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d note header row — shape ``[UNKNOWN]``, defensive."""
    return {
        "note_id": _id_string(n.get("ID") or n.get("id") or n),
        "title": _pick(n, "Title", "title", "Subject", "subject", "Name", "name"),
        "author": _pick(
            n, "Author", "author", "CreatedBy", "created_by", "author_name"
        ),
        "created_at": _pick(
            n, "CreatedAt", "created_at", "DateCreated", "Created", "CreatedOn"
        ),
        "raw": n,
    }


def _normalize_association(a: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d association row — shape ``[UNKNOWN]``, defensive."""
    return {
        "entity_id": _id_string(a.get("ID") or a.get("id") or a),
        "entity_type": _pick(
            a, "EntityType", "entity_type", "Type", "type", "TargetType"
        ),
        "name": _pick(a, "Name", "name", "Title", "title"),
        "raw": a,
    }


def get_note_message(
    server: str, token: str, target_type: str, note_id: str
) -> Optional[Any]:
    """Best-effort fetch of one note's full message body — read-only.

    ``GET /api/v1/notes/getMessage/{target_type}/{note_id}``. Returns the body
    string (or raw) or None on failure. ``[UNKNOWN]`` → ``_pick`` across body
    field candidates.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    try:
        resp = httpx.get(
            f"{base_url}/api/v1/notes/getMessage/{target_type}/{_seg(note_id)}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        data = resp.json()
        if isinstance(data, str):
            return data
        if isinstance(data, dict):
            return (
                _pick(data, "Message", "message", "Body", "body", "Text", "text")
                or data
            )
        return data
    except (httpx.HTTPError, ValueError, SynergyAuthError):
        return None


def get_note_count(
    server: str, token: str, target_type: str, target_id: str
) -> Dict[str, Any]:
    """Return just the note count for an entity — read-only (cheap).

    ``GET /api/v1/notes/getCount/{target_type}/{note_id}``. NOTE: the inventory
    names the second segment ``{note_id}`` but semantically it is the entity id
    for a count — we pass the entity id and flag the ambiguity. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/notes/getCount/{target_type}/{_seg(target_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json()
    count: Optional[int] = None
    if isinstance(data, (int, float)):
        count = int(data)
    elif isinstance(data, str) and data.strip().isdigit():
        count = int(data.strip())
    elif isinstance(data, dict):
        c = _pick(data, "Count", "count", "Total", "total", "Value", "value")
        try:
            count = int(c) if c is not None else None
        except (TypeError, ValueError):
            count = None
    return {
        "target_id": target_id,
        "target_type": target_type,
        "count": count,
        "count_only": True,
        "connector": "synergy",
        "note": (
            _INFERRED_SCHEMA_NOTE
            + " getCount's second path segment is named {note_id} in the spec but "
            "is used here as the entity id for a count (ambiguous in 12d docs)."
        ),
    }


def get_entity_notes(
    server: str,
    token: str,
    target_id: str,
    target_type: str = "",
    scope: str = "",
    include_message: bool = True,
) -> Dict[str, Any]:
    """Return the notes on an entity — read-only (notes section).

    When ``scope`` ∈ {job, file, folder, project} is supplied, use the scoped
    convenience path (``jobs/{id}/notes`` etc.) so the caller need NOT know the
    ``target_type`` enum; fall back to the generic ``notes/getHeaders/
    {target_type}/{target_id}`` on 404 (needs target_type). When
    ``include_message`` is set, hydrate each header's body via ``getMessage``
    (bounded best-effort; per-note failures degrade to header-only). ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    scope_map = {
        "job": f"/api/v1/jobs/{_seg(target_id)}/notes",
        "file": f"/api/v1/files/{_seg(target_id)}/notes",
        "folder": f"/api/v1/folders/{_seg(target_id)}/notes",
        "project": f"/api/v1/12dProjects/{_seg(target_id)}/notes",
    }
    degraded: List[str] = []
    rows: Optional[List[Dict[str, Any]]] = None
    used_scope = ""

    if scope and scope in scope_map:
        try:
            resp = httpx.get(
                f"{base_url}{scope_map[scope]}", headers=headers, timeout=60
            )
            _check_response(resp)
            rows = _coerce_rows(resp.json(), "Notes", "notes", "Headers")
            used_scope = scope
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            rows = None

    if rows is None:
        if not target_type:
            raise ValueError(
                "notes: a target_type enum is required when no recognised scope "
                "(job|file|folder|project) is supplied — fetch /types/noteTargetTypes "
                "for the encoding, or pass scope."
            )
        try:
            resp = httpx.get(
                f"{base_url}/api/v1/notes/getHeaders/{target_type}/{_seg(target_id)}",
                headers=headers,
                timeout=60,
            )
            _check_response(resp)
            rows = _coerce_rows(resp.json(), "Notes", "notes", "Headers")
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                raise ValueError(
                    "Notes not found (HTTP 404). The target_type encoding "
                    f"({target_type!r}) is UNVERIFIED — verify it (fetch "
                    "/types/noteTargetTypes) before retrying."
                ) from exc
            raise

    notes = [_normalize_note_header(r) for r in rows]

    # Bounded best-effort message hydration.
    if include_message and target_type and notes:
        started = time.monotonic()
        hydrated = 0
        for n in notes:
            if (
                hydrated >= SYNERGY_NOTES_MAX_HYDRATE
                or (time.monotonic() - started) >= SYNERGY_NOTES_DEADLINE_S
            ):
                degraded.append("message_hydration_truncated")
                break
            nid = n.get("note_id")
            if not nid:
                continue
            body = get_note_message(server, token, target_type, str(nid))
            if body is not None:
                n["message"] = body
            else:
                degraded.append(f"message:{nid}")
            hydrated += 1
    elif include_message and not target_type:
        degraded.append("message_hydration_needs_target_type")

    note = _INFERRED_SCHEMA_NOTE
    if degraded:
        note += f" Best-effort message hydration partial: {len(degraded)} item(s)."
    return {
        "target_id": target_id,
        **({"scope": used_scope} if used_scope else {"target_type": target_type}),
        "notes": notes,
        "total_count": len(notes),
        "degraded": degraded,
        "connector": "synergy",
        "note": note,
    }


def get_association_count(
    server: str, token: str, target_id: str, target_type: str
) -> Dict[str, Any]:
    """Return just the count of associations for an entity — read-only (cheap).

    ``GET /api/v1/Associations/GetNumberOfAssociatedEntities/{id}/{type}``.
    ``type`` enum encoding ``[UNKNOWN]`` → verbatim. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/Associations/GetNumberOfAssociatedEntities/{_seg(target_id)}/{target_type}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json()
    count: Optional[int] = None
    if isinstance(data, (int, float)):
        count = int(data)
    elif isinstance(data, str) and data.strip().isdigit():
        count = int(data.strip())
    elif isinstance(data, dict):
        c = _pick(data, "Count", "count", "Total", "total", "Value", "value")
        try:
            count = int(c) if c is not None else None
        except (TypeError, ValueError):
            count = None
    return {
        "target_id": target_id,
        "type": target_type,
        "count": count,
        "count_only": True,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_entity_associations(
    server: str,
    token: str,
    target_id: str,
    target_type: str = "",
    scope: str = "",
    expected_type: str = "",
) -> Dict[str, Any]:
    """Return the entities associated with an entity — read-only (associations).

    When ``scope`` ∈ {file, project} is supplied, use the scoped convenience path
    (``files/{id}/associations`` / ``12dProjects/{id}/associations``) so the
    caller need NOT know the type enum; fall back to the generic
    ``Associations/GetAssociatedEntities/{id}/{type}/{expected_type}`` on 404
    (needs target_type). ``type``/``expected_type`` encoding ``[UNKNOWN]`` →
    verbatim; a 404 surfaces 'verify type encoding'. ``[UNKNOWN]``.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    scope_map = {
        "file": f"/api/v1/files/{_seg(target_id)}/associations",
        "project": f"/api/v1/12dProjects/{_seg(target_id)}/associations",
    }
    rows: Optional[List[Dict[str, Any]]] = None
    used_scope = ""

    if scope and scope in scope_map:
        try:
            resp = httpx.get(
                f"{base_url}{scope_map[scope]}", headers=headers, timeout=60
            )
            _check_response(resp)
            rows = _coerce_rows(resp.json(), "Associations", "associations", "Entities")
            used_scope = scope
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            rows = None

    if rows is None:
        if not target_type:
            raise ValueError(
                "associations: a target_type enum is required when no recognised "
                "scope (file|project) is supplied — fetch /types/entityTypes for the "
                "encoding, or pass scope."
            )
        et = expected_type or _ASSOCIATION_ALL_TYPES
        try:
            resp = httpx.get(
                f"{base_url}/api/v1/Associations/GetAssociatedEntities/{_seg(target_id)}/{target_type}/{et}",
                headers=headers,
                timeout=60,
            )
            _check_response(resp)
            rows = _coerce_rows(resp.json(), "Associations", "associations", "Entities")
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                raise ValueError(
                    "Associations not found (HTTP 404). The type "
                    f"({target_type!r}) / expected_type ({expected_type!r}) encoding "
                    "is UNVERIFIED — verify it (fetch /types/entityTypes) before "
                    "retrying."
                ) from exc
            raise

    associations = [_normalize_association(r) for r in rows]
    return {
        "target_id": target_id,
        **({"scope": used_scope} if used_scope else {"type": target_type}),
        "associations": associations,
        "total_count": len(associations),
        **({"expected_type": expected_type} if expected_type else {}),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


# ---------------------------------------------------------------------------
# Wave-2 — Server identity / connection health (status)
# ---------------------------------------------------------------------------


def get_server_status(server: str, token: str) -> Dict[str, Any]:
    """Run the four connector health/identity probes — read-only.

    (1) ``GET /health`` (NO auth, NO /api/v1/ prefix, bare host) — reachability.
        A 200 proves the host is up but says NOTHING about token validity. On
        connection error / non-200 → reachable=false and the authed probes are
        skipped (no point probing a dead host).
    (2) ``GET /api/server/getVersion`` (NO /v1/) — API/server version. Best-effort.
    (3) ``GET /api/server/getServerId`` (NO /v1/) — server identity. Best-effort.
    (4) ``GET /api/v1/auth/getPersonalAccessTokens`` — PAT liveness. A 200 = PAT
        valid; 401/403 = pat_valid=false (this is a LIVENESS probe, so a 401 is a
        RESULT, not a raised SynergyAuthError).

    ``healthy`` = reachable AND pat_valid. Only those two drive the verdict; a
    best-effort version/server-id failure never flips healthy to false. All
    bodies are ``[UNKNOWN]`` → defensively coerced.
    """
    base_url = _build_base_url(server)
    auth_headers = _synergy_headers(token)

    checks: Dict[str, Dict[str, Any]] = {
        "health": {"ok": False, "detail": ""},
        "version": {"ok": False, "detail": ""},
        "server_id": {"ok": False, "detail": ""},
        "pat": {"ok": False, "detail": ""},
    }
    note_parts: List[str] = []

    # (1) Reachability — no auth, bare host.
    reachable = False
    try:
        r = httpx.get(f"{base_url}/health", timeout=30)
        if r.status_code == 200:
            reachable = True
            checks["health"] = {"ok": True, "detail": "Healthy"}
        else:
            checks["health"] = {"ok": False, "detail": f"HTTP {r.status_code}"}
    except httpx.HTTPError as exc:
        checks["health"] = {"ok": False, "detail": f"unreachable: {exc}"}

    server_version: Optional[str] = None
    server_id: Optional[str] = None
    pat_valid = False
    pat_days_remaining: Optional[int] = None

    if not reachable:
        note_parts.append(
            "Instance is not reachable (/health did not return 200) — authed "
            "probes skipped."
        )
        return {
            "connector": "synergy",
            "reachable": False,
            "server_version": None,
            "server_id": None,
            "pat_valid": False,
            "pat_days_remaining": None,
            "healthy": False,
            "checks": checks,
            "note": " ".join(note_parts) or "Instance unreachable.",
        }

    # (2) Version — /api/server/getVersion (NO /v1/). Best-effort.
    try:
        r = httpx.get(
            f"{base_url}/api/server/getVersion", headers=auth_headers, timeout=30
        )
        _check_response(r)
        data = r.json()
        if isinstance(data, str):
            server_version = data
        elif isinstance(data, dict):
            v = _pick(
                data, "Version", "version", "ServerVersion", "server_version", "value"
            )
            server_version = str(v) if v is not None else None
        checks["version"] = {
            "ok": server_version is not None,
            "detail": server_version or "unparseable",
        }
        if server_version is None:
            note_parts.append(
                "version endpoint shape undocumented — verify against live 12d."
            )
    except (httpx.HTTPError, ValueError, SynergyAuthError) as exc:
        checks["version"] = {"ok": False, "detail": f"{exc}"}
        note_parts.append("version probe unavailable (best-effort).")

    # (3) Server id — /api/server/getServerId (NO /v1/). Best-effort.
    try:
        r = httpx.get(
            f"{base_url}/api/server/getServerId", headers=auth_headers, timeout=30
        )
        _check_response(r)
        data = r.json()
        if isinstance(data, (str, int)):
            server_id = str(data)
        elif isinstance(data, dict):
            sid = _pick(data, "ServerId", "server_id", "Id", "id", "IDString", "value")
            server_id = str(sid) if sid is not None else None
        checks["server_id"] = {
            "ok": server_id is not None,
            "detail": server_id or "unparseable",
        }
        if server_id is None:
            note_parts.append(
                "server-id endpoint shape undocumented — verify against live 12d."
            )
    except (httpx.HTTPError, ValueError, SynergyAuthError) as exc:
        checks["server_id"] = {"ok": False, "detail": f"{exc}"}
        note_parts.append("server-id probe unavailable (best-effort).")

    # (4) PAT liveness — getPersonalAccessTokens (carries /v1/). A 401/403 is a
    # RESULT (pat_valid=false), not a raised error.
    try:
        r = httpx.get(
            f"{base_url}/api/v1/auth/getPersonalAccessTokens",
            headers=auth_headers,
            timeout=30,
        )
        if r.status_code in (401, 403):
            pat_valid = False
            checks["pat"] = {
                "ok": False,
                "detail": f"HTTP {r.status_code} — PAT expired/revoked",
            }
        else:
            r.raise_for_status()
            pat_valid = True
            rows = _coerce_rows(r.json(), "Tokens", "tokens", "PersonalAccessTokens")
            # Derive days_remaining best-effort from any token row's expiry.
            now = datetime.now(timezone.utc)
            for tok in rows:
                exp = _pick(
                    tok,
                    "ExpiresAt",
                    "expires_at",
                    "Expiry",
                    "expiry",
                    "ExpireDate",
                    "expire_date",
                    "ExpiresOn",
                    "expires_on",
                    "pat_expires_at",
                )
                if not exp:
                    continue
                try:
                    expiry = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
                    if expiry.tzinfo is None:
                        expiry = expiry.replace(tzinfo=timezone.utc)
                    days = (expiry - now).days
                    if pat_days_remaining is None or days < pat_days_remaining:
                        pat_days_remaining = days
                except (ValueError, TypeError):
                    continue
            detail = "valid"
            if pat_days_remaining is not None:
                detail = f"valid, ~{pat_days_remaining}d remaining"
            else:
                note_parts.append(
                    "PAT expiry field not present — days_remaining unknown."
                )
            checks["pat"] = {"ok": True, "detail": detail}
    except (httpx.HTTPError, ValueError) as exc:
        # A non-auth transport error is genuinely indeterminate; treat as not
        # valid for the verdict but record the detail.
        pat_valid = False
        checks["pat"] = {"ok": False, "detail": f"{exc}"}
        note_parts.append("PAT liveness probe failed (transport error).")

    healthy = reachable and pat_valid
    return {
        "connector": "synergy",
        "reachable": reachable,
        "server_version": server_version,
        "server_id": server_id,
        "pat_valid": pat_valid,
        "pat_days_remaining": pat_days_remaining,
        "healthy": healthy,
        "checks": checks,
        "note": " ".join(note_parts)
        or "Connection healthy. Some identity field shapes are inferred — verify against a live instance.",
    }


# ---------------------------------------------------------------------------
# Wave-2 — Users (lookup / checkouts / module)
# ---------------------------------------------------------------------------


def _normalize_user(u: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d ``UserModel`` row — shape ``[UNKNOWN]``, defensive."""
    first = _pick(u, "FirstName", "first_name")
    last = _pick(u, "LastName", "last_name")
    name = _pick(u, "Name", "name", "DisplayName", "display_name", "FullName")
    if not name:
        name = " ".join(p for p in (first, last) if p) or None
    return {
        "user_id": _id_string(u.get("ID") or u.get("id") or u),
        "name": name,
        "email": _pick(u, "Email", "email", "EmailAddress", "email_address"),
        "first_name": first,
        "last_name": last,
        "is_active": _pick(u, "IsActive", "is_active", "Active", "active"),
        "attributes": _pick(u, "Attributes", "attributes"),
        "raw": u,
    }


def get_user(
    server: str, token: str, user_id: str, retrieve_attributes: bool = True
) -> Dict[str, Any]:
    """Return one user by id — read-only (users: lookup mode).

    ``GET /api/v1/users/{id}/{retrieve_attributes}`` — retrieve_attributes is a
    REQUIRED path segment (there is NO plain /users/{id}). ``UserModel`` shape is
    ``[UNKNOWN]`` → ``_normalize_user`` + raw.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    ra = "true" if retrieve_attributes else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/users/{_seg(user_id)}/{ra}", headers=headers, timeout=60
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}
    return {
        "mode": "lookup",
        "user": _normalize_user(data),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_active_checkouts(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """List the CURRENT user's active checkouts within a job — read-only.

    ``GET /api/v1/users/activeCheckouts/{job_id}``. 12d scopes this to the PAT
    identity, so it returns ONLY the caller's own checkouts (NOT an org-wide
    view). Rows carry ``CheckOutInfo`` (also seen as FileModel.ActiveCheckout).
    ``[UNKNOWN]`` → defensive list-or-wrapper.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/users/activeCheckouts/{_seg(job_id)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Checkouts", "checkouts", "CheckOuts")
    checkouts = []
    for r in rows:
        co = (
            r.get("ActiveCheckout")
            or r.get("active_checkout")
            or r.get("CheckOutInfo")
            or r
        )
        co = co if isinstance(co, dict) else r
        checkouts.append(
            {
                "file_id": _id_string(r.get("ID") or r.get("id"))
                or _id_string(r.get("FileId") or r.get("file_id")),
                "folder_id": _id_string(r.get("FolderId") or r.get("folder_id")),
                "name": _pick(r, "FileName", "Name", "name"),
                "path": _pick(r, "Path", "path"),
                "checked_out_by": _pick(
                    co, "CheckedOutBy", "checked_out_by", "User", "user", "Name", "name"
                ),
                "checked_out_by_id": (
                    _id_string(
                        co.get("CheckedOutById")
                        or co.get("checked_out_by_id")
                        or co.get("UserId")
                        or co.get("user_id")
                    )
                    if isinstance(co, dict)
                    else None
                ),
                "checked_out_at": _pick(
                    co,
                    "CheckedOutAt",
                    "checked_out_at",
                    "CheckOutDate",
                    "check_out_date",
                    "DateCheckedOut",
                ),
                "version": _pick(r, "Version", "version", "LatestVersion"),
                "raw": r,
            }
        )
    return {
        "mode": "checkouts",
        "job_id": job_id,
        "checkouts": checkouts,
        "count": len(checkouts),
        "connector": "synergy",
        "note": (
            _INFERRED_SCHEMA_NOTE
            + " activeCheckouts is scoped to the PAT identity — it returns only "
            "the CALLER's own checkouts, not an org-wide 'who has this locked' view."
        ),
    }


def get_user_module_access(server: str, token: str, module: str) -> Dict[str, Any]:
    """Check whether the CURRENT user has access to a license module — read-only.

    ``GET /api/v1/users/HasAccessToModule/{license_module}`` (path segment
    URL-encoded). Return type ``[UNKNOWN]`` (bare bool / 'true' / {HasAccess}) →
    ``_coerce_bool`` best-effort; falls back to has_access=None + raw + note.
    """
    from urllib.parse import quote

    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    encoded = quote(module, safe="")
    resp = httpx.get(
        f"{base_url}/api/v1/users/HasAccessToModule/{encoded}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json()
    has_access = _coerce_bool(data)
    note = _INFERRED_SCHEMA_NOTE
    if has_access is None:
        note += " HasAccessToModule return shape unrecognised — see raw."
    return {
        "mode": "module",
        "module": module,
        "has_access": has_access,
        "raw": data,
        "connector": "synergy",
        "note": note,
    }


# ---------------------------------------------------------------------------
# Wave-2 — Schema EXTENSION: attribute/type/enum vocabulary
# ---------------------------------------------------------------------------
#
# Extends the EXISTING schema helper surface (get_job_schema, above) with a
# mode-dispatched attribute/type/enum vocab fetcher. The zero-arg/default 'job'
# behaviour stays backward-compatible (standard + standard-search job
# attributes); 'job' (full) adds default-search + defined-search + system; and
# the new 'file'/'contact'/'types'/'categories'/'find'/'choices' modes round
# out the self-describing-filter vocabulary. Every sub-call is best-effort
# (failed sibling → null + note), mirroring get_job_schema's inner _get().


def _normalize_attribute(a: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a 12d ``AttributeInfo`` row — both casings + raw passthrough.

    Spec model is PascalCase (Name/DisplayName/Type/Optional/EnumItems) but 12d
    mixes casing per model, so read both. Shape ``[UNKNOWN]`` → defensive.
    """
    return {
        "attribute_id": _id_string(a.get("ID") or a.get("id")),
        "name": _pick(a, "Name", "name"),
        "display_name": _pick(a, "DisplayName", "display_name"),
        "type": _pick(a, "Type", "type", "AttributeType", "attribute_type"),
        "type_label": _pick(a, "TypeName", "type_name", "TypeLabel", "type_label"),
        "required": (
            _pick(a, "Required", "required")
            if _pick(a, "Required", "required") is not None
            else (
                (not _pick(a, "Optional", "optional"))
                if _pick(a, "Optional", "optional") is not None
                else None
            )
        ),
        "enum_items": _pick(
            a, "EnumItems", "enum_items", "Choices", "choices", "Values", "values"
        ),
        "raw": a,
    }


def _normalize_attribute_list(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize a list of AttributeInfo rows."""
    return [_normalize_attribute(r) for r in rows]


def get_attribute_vocab(
    server: str,
    token: str,
    *,
    mode: str = "job",
    entity: str = "job",
    name: str = "",
    type_name: str = "",
    extension: str = "",
) -> Dict[str, Any]:
    """Comprehensive attribute/type/enum vocabulary — read-only (schema extend).

    Modes:
      * ``job`` (default): standard + standard-search job attributes (the
        original ``get_job_schema`` behaviour), plus default-search +
        defined-search + system job attributes.
      * ``file`` / ``contact``: per-entity searchable + system attribute sets.
      * ``types``: the decode enums (attributeTypes, matchOperations, entityTypes,
        fileTypes, folderTypes, folderStates, noteTargetTypes), plus a named enum
        via ``type_name`` (the lone query-string exception, encoding UNVERIFIED).
      * ``categories``: the category taxonomy (/categories + jobs/getAllCategories).
      * ``find``: one attribute by name + context (findAttributeByNameAndContext;
        search_context encoding UNVERIFIED → 404 surfaces a clear note).
      * ``choices``: valid enum choices for an attribute (POST validAttributeChoices
        — non-mutating; body shape ``[UNKNOWN]`` → defensive, degrade to []).

    EVERY sub-call is best-effort: a failed sibling becomes null + a note. ALL
    shapes are ``[UNKNOWN]`` (Attributes/* and Types/* are Swagger-200-only).
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    mode = (mode or "job").lower()

    def _get(path: str) -> Any:
        try:
            r = httpx.get(f"{base_url}{path}", headers=headers, timeout=60)
            _check_response(r)
            return r.json()
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            return None

    def _attr_list(path: str) -> Optional[List[Dict[str, Any]]]:
        data = _get(path)
        if data is None:
            return None
        return _normalize_attribute_list(_coerce_rows(data))

    def _enum_map(path: str) -> Any:
        """Fetch a decode enum, returning a {value->label} map when possible."""
        data = _get(path)
        if data is None:
            return None
        rows = _coerce_rows(data)
        if not rows:
            return data  # raw passthrough when not list-shaped
        out: Dict[str, str] = {}
        for r in rows:
            code = _pick(r, "ID", "id", "Value", "value", "Code", "code")
            label = _pick(
                r, "Name", "name", "DisplayName", "display_name", "Label", "label"
            )
            if code is not None and label:
                out[str(_id_string(code) or code)] = str(label)
        return out or rows

    note = (
        "Several Attributes/Types schemas are undocumented (12d Swagger 200-only) "
        "— verify field mappings against a live instance."
    )

    if mode == "types":
        result: Dict[str, Any] = {
            "attribute_types": _enum_map("/api/v1/types/attributeTypes"),
            "match_operations": _enum_map("/api/v1/types/attributeMatchOperations"),
            "entity_types": _enum_map("/api/v1/types/entityTypes"),
            "file_types": _enum_map("/api/v1/types/fileTypes"),
            "folder_types": _enum_map("/api/v1/types/folderTypes"),
            "folder_states": _enum_map("/api/v1/types/folderStates"),
            "note_target_types": _enum_map("/api/v1/types/noteTargetTypes"),
        }
        if type_name:
            # type_name is a QUERY param (the lone query-string exception);
            # encoding UNVERIFIED → attempt, degrade to null + note.
            from urllib.parse import quote

            named = _get(f"/api/v1/types?type_name={quote(type_name, safe='')}")
            result["named_enum"] = named
            if named is None:
                note += (
                    f" Named enum '{type_name}' could not be resolved — the "
                    "type_name query encoding is UNVERIFIED."
                )
        result["connector"] = "synergy"
        result["note"] = note
        return result

    if mode == "categories":
        categories = _coerce_rows(_get("/api/v1/categories") or [])
        job_categories = _coerce_rows(_get("/api/v1/jobs/getAllCategories") or [])
        return {
            "categories": [
                {
                    "category_id": _id_string(c.get("ID") or c.get("id") or c),
                    "name": _pick(c, "Name", "name"),
                    "parent_id": _id_string(c.get("ParentId") or c.get("parent_id")),
                    "raw": c,
                }
                for c in categories
            ],
            "job_categories": [
                {
                    "category_id": _id_string(c.get("ID") or c.get("id") or c),
                    "name": _pick(c, "Name", "name"),
                    "raw": c,
                }
                for c in job_categories
            ],
            "connector": "synergy",
            "note": note,
        }

    if mode == "find":
        if not name:
            raise ValueError("schema mode=find requires a name.")
        from urllib.parse import quote

        search_context = entity or "job"
        encoded_name = quote(name, safe="")
        encoded_ctx = quote(search_context, safe="")
        try:
            r = httpx.get(
                f"{base_url}/api/v1/Attributes/findAttributeByNameAndContext/{encoded_name}/{encoded_ctx}",
                headers=headers,
                timeout=60,
            )
            _check_response(r)
            data = r.json()
        except SynergyAuthError:
            raise
        except httpx.HTTPStatusError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                raise ValueError(
                    "Attribute not found (HTTP 404). The search_context encoding "
                    f"({search_context!r}) is UNVERIFIED — verify it before retrying."
                ) from exc
            raise
        except (httpx.HTTPError, ValueError):
            data = None
        return {
            "attribute": _normalize_attribute(data) if isinstance(data, dict) else None,
            "search_context": search_context,
            "raw": data,
            "connector": "synergy",
            "note": note,
        }

    if mode == "choices":
        if not name:
            raise ValueError("schema mode=choices requires a name.")
        # POST validAttributeChoices — non-mutating. Body shape [UNKNOWN] → send
        # the attribute ref defensively; degrade to choices=[] on 4xx.
        body = {"Name": name, "name": name, "Attribute": {"Name": name}}
        choices: List[Dict[str, Any]] = []
        choices_note = note
        try:
            r = httpx.post(
                f"{base_url}/api/v1/Attributes/validAttributeChoices",
                json=body,
                headers=headers,
                timeout=60,
            )
            _check_response(r)
            rows = _coerce_rows(r.json(), "Choices", "choices", "Values")
            for c in rows:
                choices.append(
                    {
                        "value": _pick(c, "Value", "value", "ID", "id", "Code", "code"),
                        "label": _pick(
                            c, "Label", "label", "Name", "name", "DisplayName"
                        ),
                    }
                )
            raw_choices: Any = rows
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            raw_choices = None
            choices_note += " Valid choices unavailable on this instance (best-effort)."
        return {
            "attribute": name,
            "choices": choices,
            "raw": raw_choices,
            "connector": "synergy",
            "note": choices_note,
        }

    if mode == "file":
        return {
            "search_attributes": _attr_list(
                "/api/v1/Attributes/getStandardFileSearchAttributes"
            ),
            "system_attributes": (
                _attr_list(f"/api/v1/Attributes/getSystemFileAttributes/{extension}")
                if extension
                else None
            ),
            "connector": "synergy",
            "note": note
            + (
                ""
                if extension
                else " (system_attributes skipped — no extension supplied; "
                "empty-segment behaviour is [UNKNOWN])."
            ),
        }

    if mode == "contact":
        return {
            "search_attributes": _attr_list(
                "/api/v1/Attributes/getStandardContactSearchAttributes"
            ),
            "system_attributes": _attr_list(
                "/api/v1/Attributes/getSystemContactAttributes/true"
            ),
            "connector": "synergy",
            "note": note,
        }

    # Default / mode == "job": backward-compatible standard + standard-search,
    # plus the fuller job vocab (default-search, defined-search, system).
    return {
        "standard_attributes": _attr_list("/api/v1/jobs/getStandardAttributes"),
        "search_attributes": _attr_list(
            "/api/v1/Attributes/getStandardJobSearchAttributes"
        ),
        "default_search_attributes": _attr_list(
            "/api/v1/Attributes/getDefaultJobSearchAttributes"
        ),
        "defined_search_attributes": _attr_list(
            "/api/v1/jobs/getDefinedSearchAttributes"
        ),
        "system_attributes": _attr_list(
            "/api/v1/Attributes/getSystemJobAttributes/true"
        ),
        "connector": "synergy",
        "note": note,
    }


# ---------------------------------------------------------------------------
# Wave-3 — Resolve (parse a pasted 12d link/path → entity + clickable URL)
# ---------------------------------------------------------------------------
#
# These hit the admin controller, but ALL three are NON-MUTATING link/path
# lookups (parse a link, find an entity by path, build a web link). Admin
# response shapes are wholly ``[UNKNOWN]`` (Swagger 200-only) so every helper is
# fully defensive: it always keeps a ``raw`` passthrough and never hard-indexes.


def _extract_entity_ref(data: Any) -> Dict[str, Any]:
    """Best-effort pull of an entity reference from an admin-resolve response.

    The parse/find responses are ``[UNKNOWN]`` — the entity id + type may live at
    the top level (``EntityID``/``EntityType``) or nested under an ``Entity`` /
    ``Result`` wrapper, in either casing. Returns ``{entity_id, entity_type,
    name, path}`` (any of which may be None). Never assumes a dict.
    """
    if not isinstance(data, dict):
        return {"entity_id": None, "entity_type": None, "name": None, "path": None}
    # Unwrap a level if the payload nests the entity under a common wrapper key.
    inner = data
    for wrap in ("Entity", "entity", "Result", "result", "Item", "item"):
        w = data.get(wrap)
        if isinstance(w, dict):
            inner = w
            break
    entity_id = _id_string(
        inner.get("EntityID")
        or inner.get("entity_id")
        or inner.get("EntityId")
        or inner.get("ID")
        or inner.get("id")
        or inner
    )
    entity_type = _pick(
        inner,
        "EntityType",
        "entity_type",
        "EntityTypeName",
        "entity_type_name",
        "Type",
        "type",
    )
    name = _pick(inner, "Name", "name", "DisplayName", "display_name", "Title", "title")
    path = _pick(inner, "Path", "path", "FullPath", "full_path")
    return {
        "entity_id": entity_id,
        "entity_type": str(entity_type) if entity_type is not None else None,
        "name": name,
        "path": path,
    }


def resolve_synergy_link(server: str, token: str, link: str) -> Dict[str, Any]:
    """Parse a pasted 12d link (``synergy://…`` or web URL) → entity ref + URL.

    ``POST /api/v1/admin/parseSynergyLink`` — non-mutating. Body shape is
    ``[UNKNOWN]`` so we send the link under several candidate keys
    (``Link``/``link``/``Url``/``url``/``Path``/``path``) at once; 12d ignores the
    ones it doesn't recognise. The response is also ``[UNKNOWN]`` → defensive
    extract + raw passthrough. After resolving the entity, best-effort builds a
    clickable web link via ``get_entity_weblink`` (failure degrades to no URL).
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    body = {
        "Link": link,
        "link": link,
        "Url": link,
        "url": link,
        "Path": link,
        "path": link,
    }
    resp = httpx.post(
        f"{base_url}/api/v1/admin/parseSynergyLink",
        json=body,
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    try:
        data = resp.json()
    except ValueError:
        data = None
    ref = _extract_entity_ref(data)

    note = _INFERRED_SCHEMA_NOTE
    web_link: Optional[str] = None
    if ref.get("entity_id") and ref.get("entity_type"):
        try:
            wl = get_entity_weblink(
                server, token, str(ref["entity_id"]), str(ref["entity_type"])
            )
            web_link = wl.get("web_link")
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            note += (
                " Web link could not be built for the resolved entity (best-effort)."
            )
    else:
        note += " The parsed response did not yield an entity id + type — see raw."

    return {
        "link": link,
        "entity_id": ref.get("entity_id"),
        "entity_type": ref.get("entity_type"),
        "name": ref.get("name"),
        "path": ref.get("path"),
        "web_link": web_link,
        "raw": data,
        "connector": "synergy",
        "note": note,
    }


def resolve_synergy_path(server: str, token: str, path: str) -> Dict[str, Any]:
    """Find the entity at a 12d path string → entity ref + clickable URL.

    ``GET /api/v1/admin/findEntityByItsPath/{path}`` — non-mutating. The path
    segment is URL-encoded (a 12d path contains ``/`` and spaces, so we encode
    with ``safe=''`` to keep the whole path in one segment). Response shape
    ``[UNKNOWN]`` → defensive extract + raw passthrough; best-effort web link.
    """
    from urllib.parse import quote

    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    encoded = quote(path or "", safe="")
    resp = httpx.get(
        f"{base_url}/api/v1/admin/findEntityByItsPath/{encoded}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    try:
        data = resp.json()
    except ValueError:
        data = None
    ref = _extract_entity_ref(data)

    note = _INFERRED_SCHEMA_NOTE
    web_link: Optional[str] = None
    if ref.get("entity_id") and ref.get("entity_type"):
        try:
            wl = get_entity_weblink(
                server, token, str(ref["entity_id"]), str(ref["entity_type"])
            )
            web_link = wl.get("web_link")
        except (httpx.HTTPError, ValueError, SynergyAuthError):
            note += (
                " Web link could not be built for the resolved entity (best-effort)."
            )
    else:
        note += " No entity was found at that path (or the response lacked id + type) — see raw."

    return {
        "path": path,
        "entity_id": ref.get("entity_id"),
        "entity_type": ref.get("entity_type"),
        "name": ref.get("name"),
        "web_link": web_link,
        "raw": data,
        "connector": "synergy",
        "note": note,
    }


def get_entity_weblink(
    server: str, token: str, entity_id: str, entity_type: str
) -> Dict[str, Any]:
    """Build a full clickable web link for an entity — read-only.

    ``GET /api/v1/admin/getWebLink/{entity_id}/{entity_type}`` — non-mutating.
    The ``entity_type`` encoding is the same UNVERIFIED concern as workflows, so
    we pass it through ``ENTITY_TYPE_MAP`` (best-guess) and surface a clear note
    on 404 rather than silently retrying. The response may be a bare string URL
    OR a JSON wrapper (``{WebLink|web_link|Url|Link}``) → defensive extract.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    et = ENTITY_TYPE_MAP.get((entity_type or "").lower(), entity_type)
    try:
        resp = httpx.get(
            f"{base_url}/api/v1/admin/getWebLink/{_seg(entity_id)}/{et}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            raise ValueError(
                "Web link not found (HTTP 404). The entity_type encoding "
                f"({entity_type!r} → {et!r}) is UNVERIFIED against a live 12d "
                "instance — confirm the correct entity_type encoding before retrying."
            ) from exc
        raise

    web_link: Optional[str] = None
    raw: Any
    text = (resp.text or "").strip()
    try:
        data = resp.json()
        raw = data
    except ValueError:
        data = None
        raw = text or None
    if isinstance(data, str):
        web_link = data.strip() or None
    elif isinstance(data, dict):
        wl = _pick(
            data, "WebLink", "web_link", "Url", "url", "Link", "link", "Href", "href"
        )
        web_link = str(wl) if wl else None
    elif text:
        # Bare-string body that wasn't valid JSON (e.g. a quoted/plain URL).
        web_link = text.strip('"').strip("'") or None

    return {
        "entity_id": entity_id,
        "entity_type": str(entity_type) if entity_type is not None else None,
        "web_link": web_link,
        "raw": raw,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


# ---------------------------------------------------------------------------
# Wave-3 — Tasks fold-in: single-task detail + task vocabulary
# ---------------------------------------------------------------------------


def get_task_detail(
    server: str,
    token: str,
    task_id: str,
    children: bool = True,
    history: bool = True,
    reminders: bool = False,
    cc: bool = False,
) -> Dict[str, Any]:
    """Return one task with optional children/history/reminders/cc — read-only.

    ``GET /api/v1/tasks/getTask/{task_id}/{children}/{history}/{reminders}/{cc}``
    — all four trailing segments are REQUIRED bools, sent as lowercase
    ``'true'``/``'false'`` path segments. Defaults: children + history on,
    reminders + cc off (the common "show me this task and its sub-tasks" read).

    The top-level task is normalised via ``_normalize_task``; the raw payload is
    kept so children/history/reminders/cc (whose nested shapes are ``[UNKNOWN]``)
    are available verbatim. An ``[UNKNOWN]`` envelope is handled defensively.
    """

    def _b(v: bool) -> str:
        return "true" if v else "false"

    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/tasks/getTask/{_seg(task_id)}/"
        f"{_b(children)}/{_b(history)}/{_b(reminders)}/{_b(cc)}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json() or {}
    if not isinstance(data, dict):
        data = {"raw": data}

    # The task may be the payload itself or nested under a wrapper key.
    task_obj: Dict[str, Any] = data
    for wrap in ("Task", "task", "Result", "result", "Item", "item"):
        w = data.get(wrap)
        if isinstance(w, dict):
            task_obj = w
            break

    child_rows = _coerce_rows(
        task_obj.get("children") or task_obj.get("Children") or [],
        "children",
        "Children",
    )
    history_rows = _coerce_rows(
        task_obj.get("history") or task_obj.get("History") or [], "history", "History"
    )

    return {
        "task_id": task_id,
        "task": _normalize_task(task_obj),
        "children": [_normalize_task(c) for c in child_rows],
        "child_count": len(child_rows),
        "history": history_rows,
        "raw": data,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_task_vocab(
    server: str,
    token: str,
    task_type_id: str = "",
    get_attributes: bool = True,
) -> Dict[str, Any]:
    """Return the task-type / task-state vocabulary — read-only (tasks: vocab).

    With NO ``task_type_id``: lists ALL task types
    (``GET /api/v1/tasks/getTaskTypes/{get_attributes}``).
    With a ``task_type_id``: returns that single type
    (``GET /api/v1/tasks/getTaskType/{id}/{get_attributes}``) plus its states
    (``GET /api/v1/tasks/getTaskStates/{type_id}``) and initial states
    (``GET /api/v1/tasks/getInitialTaskStates/{type_id}``).

    Every sub-call is best-effort (a failed sibling → null + note). The
    ``get_attributes`` bool is sent as a lowercase ``'true'``/``'false'`` path
    segment. ALL shapes ``[UNKNOWN]`` → defensive list-or-wrapper.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    ga = "true" if get_attributes else "false"
    note = _INFERRED_SCHEMA_NOTE

    def _get(path: str) -> Any:
        try:
            r = httpx.get(f"{base_url}{path}", headers=headers, timeout=60)
            _check_response(r)
            return r.json()
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            return None

    if not task_type_id:
        types = _coerce_rows(
            _get(f"/api/v1/tasks/getTaskTypes/{ga}") or [], "TaskTypes", "task_types"
        )
        return {
            "task_types": types,
            "total_count": len(types),
            "connector": "synergy",
            "note": note,
        }

    task_type = _get(f"/api/v1/tasks/getTaskType/{_seg(task_type_id)}/{ga}")
    states = _coerce_rows(
        _get(f"/api/v1/tasks/getTaskStates/{_seg(task_type_id)}") or [],
        "TaskStates",
        "task_states",
        "States",
        "states",
    )
    initial_states = _coerce_rows(
        _get(f"/api/v1/tasks/getInitialTaskStates/{_seg(task_type_id)}") or [],
        "TaskStates",
        "task_states",
        "States",
        "states",
    )
    if task_type is None:
        note += " The task type could not be fetched on this instance (best-effort)."
    return {
        "task_type_id": task_type_id,
        "task_type": task_type,
        "states": states,
        "initial_states": initial_states,
        "connector": "synergy",
        "note": note,
    }


# ---------------------------------------------------------------------------
# Wave-3 — File-info fold-in: access + lookup-by-name + version-N
# ---------------------------------------------------------------------------


def get_file_permission(server: str, token: str, file_id: str) -> Dict[str, Any]:
    """Return the CALLER's permission on a file — read-only (file_info: permission).

    ``GET /api/v1/files/{id}/permission``. Shape ``[UNKNOWN]`` → keep raw and
    best-effort surface a level/flags summary.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/files/{_seg(file_id)}/permission",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json()
    perm: Dict[str, Any] = data if isinstance(data, dict) else {}
    return {
        "file_id": file_id,
        "permission": _pick(
            perm, "Permission", "permission", "Level", "level", "Access", "access"
        ),
        "can_read": _pick(perm, "CanRead", "can_read", "Read", "read"),
        "can_write": _pick(perm, "CanWrite", "can_write", "Write", "write"),
        "raw": data,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_file_access(server: str, token: str, file_id: str) -> Dict[str, Any]:
    """Return the users + groups that can access a file — read-only (file_info: access).

    Merges ``GET /api/v1/files/{id}/users`` and ``GET /api/v1/files/{id}/groups``.
    Each is best-effort (one failing does not sink the other). Both shapes
    ``[UNKNOWN]`` → defensive list-or-wrapper + raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    note = _INFERRED_SCHEMA_NOTE

    def _rows(path: str, *keys: str) -> Optional[List[Dict[str, Any]]]:
        try:
            r = httpx.get(f"{base_url}{path}", headers=headers, timeout=60)
            _check_response(r)
            return _coerce_rows(r.json(), *keys)
        except SynergyAuthError:
            raise
        except (httpx.HTTPError, ValueError):
            return None

    user_rows = _rows(f"/api/v1/files/{_seg(file_id)}/users", "Users", "users")
    group_rows = _rows(f"/api/v1/files/{_seg(file_id)}/groups", "Groups", "groups")

    if user_rows is None:
        note += " User access list unavailable (best-effort)."
        user_rows = []
    if group_rows is None:
        note += " Group access list unavailable (best-effort)."
        group_rows = []

    users = [
        {
            "user_id": _id_string(r.get("ID") or r.get("id") or r),
            "name": _pick(r, "Name", "name", "DisplayName", "display_name"),
            "raw": r,
        }
        for r in user_rows
    ]
    groups = [
        {
            "group_id": _id_string(r.get("ID") or r.get("id") or r),
            "name": _pick(r, "Name", "name", "DisplayName", "display_name"),
            "raw": r,
        }
        for r in group_rows
    ]
    return {
        "file_id": file_id,
        "users": users,
        "groups": groups,
        "user_count": len(users),
        "group_count": len(groups),
        "connector": "synergy",
        "note": note,
    }


def get_file_info_by_name(
    server: str,
    token: str,
    name: str,
    folder_id: str,
    retrieve_attributes: bool = True,
    retrieve_flatten_parent_attributes: bool = False,
) -> Dict[str, Any]:
    """Look a file up by NAME within a folder — read-only (file_info: by-name).

    ``GET /api/v1/files/getFileInfoByName/{file_name}/{folder_id}/
    {retrieve_attributes}/{retrieve_flatten_parent_attributes}`` — the ``name``
    segment is URL-encoded (``safe=''``); the two trailing bools are sent as
    lowercase ``'true'``/``'false'`` path segments. Returns the same normalised
    file-metadata shape as ``get_file_metadata`` plus a raw passthrough.
    """
    from urllib.parse import quote

    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    encoded_name = quote(name or "", safe="")
    ra = "true" if retrieve_attributes else "false"
    rfpa = "true" if retrieve_flatten_parent_attributes else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/files/getFileInfoByName/{encoded_name}/{_seg(folder_id)}/{ra}/{rfpa}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    d = resp.json() or {}
    if not isinstance(d, dict):
        d = {}

    def _f(*keys: str) -> Any:
        return _pick(d, *keys)

    size = _f("FileSize", "Size", "file_size")
    try:
        size = int(size) if size is not None else None
    except (TypeError, ValueError):
        size = None
    return {
        "name": str(_f("FileName", "Name", "file_name") or name),
        "file_id": _id_string(d.get("ID") or d.get("id")) or None,
        "folder_id": folder_id,
        "path": _f("Path", "path"),
        "size": size,
        "version": str(_f("LatestVersion", "Version", "latest_version") or "") or None,
        "created_at": _f("DateCreated", "Created", "CreatedOn", "date_created"),
        "modified_at": _f("LastModified", "DateModified", "UpdatedOn", "last_modified"),
        "attributes": d.get("Attributes") or d.get("attributes"),
        "raw": d,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_file_version(
    server: str,
    token: str,
    file_id: str,
    version: str,
    retrieve_attributes: bool = True,
) -> Dict[str, Any]:
    """Return a specific VERSION of a file — read-only (file_info: version).

    ``GET /api/v1/files/{id}/versions/{version}/{retrieve_attributes}`` (the
    trailing bool is a lowercase ``'true'``/``'false'`` path segment). Returns
    the same normalised file-metadata shape as ``get_file_metadata`` plus the raw
    payload. Same response shape as a single FileModel → defensive read.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    ra = "true" if retrieve_attributes else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/files/{_seg(file_id)}/versions/{version}/{ra}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    d = resp.json() or {}
    if not isinstance(d, dict):
        d = {}

    def _f(*keys: str) -> Any:
        return _pick(d, *keys)

    size = _f("FileSize", "Size", "file_size")
    try:
        size = int(size) if size is not None else None
    except (TypeError, ValueError):
        size = None
    return {
        "file_id": file_id,
        "version": str(version),
        "name": str(_f("FileName", "Name", "file_name") or file_id),
        "path": _f("Path", "path"),
        "size": size,
        "created_at": _f("DateCreated", "Created", "CreatedOn", "date_created"),
        "modified_at": _f("LastModified", "DateModified", "UpdatedOn", "last_modified"),
        "attributes": d.get("Attributes") or d.get("attributes"),
        "raw": d,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


# ---------------------------------------------------------------------------
# Wave-3 — Contacts fold-in: full directory + global contact lists
# ---------------------------------------------------------------------------

# Bound the contacts directory page-walk (Style-2 path paging) so a large
# address book never approaches the 120s Lambda timeout (mirrors
# SYNERGY_WEBFORM_* / list_form_fills).
SYNERGY_CONTACTS_DIR_DEADLINE_S = float(
    os.getenv("SYNERGY_CONTACTS_DIR_DEADLINE_S", "20")
)
SYNERGY_CONTACTS_DIR_MAX_PAGES = int(os.getenv("SYNERGY_CONTACTS_DIR_MAX_PAGES", "50"))


def list_contacts_directory(
    server: str,
    token: str,
    page: int = 1,
    page_size: int = 50,
    get_attributes: bool = False,
    sort_column: str = "",
    sort_direction: str = "",
    filter_text: str = "",
    limit: int = 200,
) -> Dict[str, Any]:
    """List the full contact directory (address book) — read-only (contacts: directory).

    ``GET /api/v1/Contacts/list/{page}/{size}/{get_attrs}/{sort_col}/{sort_dir}/
    {filter}`` (Capital-C ``Contacts``; lowercase 404s). Style-2 path paging,
    bounded walk (deadline + page cap + client-side ``limit``). All segments are
    REQUIRED so we pass safe defaults: ``get_attrs`` → lowercase bool;
    ``sort_col``/``sort_dir`` default to a wildcard ``'-'`` placeholder (exact
    "no sort" token is UNVERIFIED → flagged); ``filter`` default ``'%25'`` (the
    URL-encoded ``%`` SQL-LIKE match-all, same convention as ``get_folder_items``).
    ``ContactModel`` rows are snake_case → ``_normalize_contact``; the
    ``PagedResultModel`` wrapper (if present) is PascalCase → read separately.
    """
    from urllib.parse import quote

    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    page_i = max(int(page or 1), 1)
    page_size_i = max(int(page_size or 50), 1)
    limit = max(int(limit or 200), 1)
    ga = "true" if get_attributes else "false"
    # Required path segments — use UNVERIFIED safe placeholders when the caller
    # didn't supply a sort. '%25' is the URL-encoded '%' wildcard (match all).
    sort_col_seg = quote(sort_column, safe="") if sort_column else "-"
    sort_dir_seg = quote(sort_direction, safe="") if sort_direction else "-"
    filter_seg = quote(filter_text, safe="") if filter_text else "%25"

    contacts: List[Dict[str, Any]] = []
    total_rows = 0
    truncated = False
    pages_fetched = 0
    started = time.monotonic()
    cur = page_i
    seen: set[str] = set()
    while True:
        resp = httpx.get(
            f"{base_url}/api/v1/Contacts/list/{cur}/{page_size_i}/{ga}/"
            f"{sort_col_seg}/{sort_dir_seg}/{filter_seg}",
            headers=headers,
            timeout=60,
        )
        _check_response(resp)
        data = resp.json()
        rows = _coerce_rows(data, "Contacts", "contacts")
        pages_fetched += 1
        for r in rows:
            norm = _normalize_contact(r)
            cid = norm.get("contact_id")
            dedup_key = cid or json.dumps(norm, sort_keys=True, default=str)
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            contacts.append(norm)
        if isinstance(data, dict):
            total_rows = (
                _pick(data, "TotalRows", "total_rows", "Total", "total") or total_rows
            )
            total_pages = _pick(data, "TotalPages", "total_pages", "totalPages")
        else:
            total_pages = None
        if not rows or len(rows) < page_size_i:
            break
        if total_pages and isinstance(total_pages, int) and cur >= total_pages:
            break
        if total_rows and len(contacts) >= int(total_rows):
            break
        if (
            len(contacts) >= limit
            or pages_fetched >= SYNERGY_CONTACTS_DIR_MAX_PAGES
            or (time.monotonic() - started) >= SYNERGY_CONTACTS_DIR_DEADLINE_S
        ):
            truncated = (
                (len(contacts) >= limit)
                or (not total_rows)
                or len(contacts) < int(total_rows or 0)
            )
            break
        cur += 1
    if len(contacts) > limit:
        contacts = contacts[:limit]
        truncated = True

    note = _INFERRED_SCHEMA_NOTE
    if not sort_column and not sort_direction:
        note += (
            " sort_column/sort_direction path segments use an UNVERIFIED 'no-sort' "
            "placeholder — if results look wrong, pass an explicit sort."
        )
    if truncated:
        note += (
            " Result was truncated (limit/page/deadline cap); page further or filter."
        )
    return {
        "contacts": contacts,
        "total_count": len(contacts),
        "total_rows": total_rows or len(contacts),
        "page": page_i,
        "page_size": page_size_i,
        "pages_fetched": pages_fetched,
        "source": "directory",
        "truncated": truncated,
        "connector": "synergy",
        "note": note,
    }


def get_global_contact_lists(server: str, token: str) -> Dict[str, Any]:
    """Return the workspace-wide (global) contact lists — read-only (contacts: global-lists).

    ``GET /api/v1/Contacts/getGlobalContactLists`` (Capital-C ``Contacts``).
    Shape ``[UNKNOWN]`` → defensive list-or-wrapper + raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/Contacts/getGlobalContactLists",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "ContactLists", "contact_lists", "Lists", "lists")
    lists = [
        {
            "list_id": _id_string(r.get("ID") or r.get("id") or r),
            "name": _pick(r, "Name", "name", "Title", "title"),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "contact_lists": lists,
        "total_count": len(lists),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


# ---------------------------------------------------------------------------
# Wave-3 — Job-extras fold-in: job header reads
# ---------------------------------------------------------------------------


def get_job_dashboard(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Return a job's dashboard header — read-only (job_extras: dashboard).

    ``GET /api/v1/jobs/{id}/dashboard``. Shape ``[UNKNOWN]`` → keep the raw
    payload and best-effort surface a name + summary block.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/jobs/{_seg(job_id)}/dashboard",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    data = resp.json()
    dash: Dict[str, Any] = data if isinstance(data, dict) else {}
    return {
        "job_id": job_id,
        "name": _pick(dash, "Name", "name", "JobName", "job_name"),
        "dashboard": data,
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_job_roles(
    server: str, token: str, job_id: str, users_only: bool = False
) -> Dict[str, Any]:
    """Return a job's roles (role → assigned user) — read-only (job_extras: roles).

    ``GET /api/v1/jobs/{id}/roles/{users_only}`` (the trailing bool is a
    lowercase ``'true'``/``'false'`` path segment). Shape ``[UNKNOWN]`` →
    defensive list-or-wrapper + raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    uo = "true" if users_only else "false"
    resp = httpx.get(
        f"{base_url}/api/v1/jobs/{_seg(job_id)}/roles/{uo}",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Roles", "roles")
    roles = [
        {
            "role_id": _id_string(
                r.get("RoleId") or r.get("role_id") or r.get("ID") or r.get("id")
            )
            or _pick(r, "Role", "role"),
            "role_name": _pick(r, "RoleName", "role_name", "Name", "name"),
            "user_id": _id_string(
                r.get("UserId") or r.get("user_id") or r.get("User") or r.get("user")
            ),
            "user_name": _pick(
                r, "UserName", "user_name", "DisplayName", "display_name"
            ),
            "raw": r,
        }
        for r in rows
    ]
    return {
        "job_id": job_id,
        "roles": roles,
        "total_count": len(roles),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_job_categories(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Return a job's categories — read-only (job_extras: categories).

    ``GET /api/v1/jobs/{id}/categories``. Shape ``[UNKNOWN]`` → defensive
    list-or-wrapper + raw passthrough.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/jobs/{_seg(job_id)}/categories",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(resp.json(), "Categories", "categories")
    categories = [
        {
            "category_id": _id_string(c.get("ID") or c.get("id") or c),
            "name": _pick(c, "Name", "name"),
            "parent_id": _id_string(c.get("ParentId") or c.get("parent_id")),
            "raw": c,
        }
        for c in rows
    ]
    return {
        "job_id": job_id,
        "categories": categories,
        "total_count": len(categories),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }


def get_job_file_attributes(server: str, token: str, job_id: str) -> Dict[str, Any]:
    """Return all file-attribute definitions for a job — read-only (job_extras: job-file-attributes).

    ``GET /api/v1/jobs/{id}/jobFileAttributes``. Rows are ``AttributeInfo``-like
    → reuse ``_normalize_attribute``. Shape ``[UNKNOWN]`` → defensive
    list-or-wrapper.
    """
    base_url = _build_base_url(server)
    headers = _synergy_headers(token)
    resp = httpx.get(
        f"{base_url}/api/v1/jobs/{_seg(job_id)}/jobFileAttributes",
        headers=headers,
        timeout=60,
    )
    _check_response(resp)
    rows = _coerce_rows(
        resp.json(), "Attributes", "attributes", "FileAttributes", "file_attributes"
    )
    attributes = [_normalize_attribute(r) for r in rows]
    return {
        "job_id": job_id,
        "file_attributes": attributes,
        "total_count": len(attributes),
        "connector": "synergy",
        "note": _INFERRED_SCHEMA_NOTE,
    }
