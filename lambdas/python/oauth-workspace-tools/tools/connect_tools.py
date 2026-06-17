"""Unified connect tool handlers for Synergy, S3 data bucket, and generic HTTP.

These handlers extend the oauth-workspace-tools Lambda to support all connector
types in the unified connect system. OAuth handlers remain in oauth_tools.py.
"""

from __future__ import annotations

import base64
import json
import os
import re
from typing import Any, Dict, Optional

import httpx
import structlog

from prm import client as prm_client

from .file_transfer import build_download_payload
from .oauth_tools import (
    _get_consolidated_company_vault,
    _get_user_consolidated_vault,
    get_available_providers,
    get_oauth_token,
)
from .synergy_helpers import (
    SynergyAuthError,
)
from .synergy_helpers import download_file as synergy_download_file
from .synergy_helpers import (
    get_folder_items,
    get_synergy_credentials,
    is_synergy_configured,
    list_job_folders,
    search_all_jobs,
)
from .synergy_helpers import search_files as synergy_search_files

logger = structlog.get_logger()

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")

# Maximum file download size (50MB)
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024

# Connectors whose disconnected-state hint points the user at Files > Remote.
# OAuth-only: the Files > Remote UI today only supports OAuth redirects and
# legacy single-token modals. Multi-field connectors (Synergy needs
# instance_url + PAT, Fergus needs PAT, etc.) are captured by the inline
# chat credential card instead, even when they list themselves under
# `surfaces: ['files']` in the registry for post-connect browsing.
_FILES_CONNECTOR_IDS = frozenset({"googledrive", "gmail", "onedrive", "dropbox"})

# Fallback credential-field schemas for connectors that pre-date the
# `connector-config-*` vault entry (so the inline card still renders with
# meaningful inputs before an admin re-saves via the wizard).
_FALLBACK_CREDENTIAL_FIELDS: Dict[str, list[Dict[str, Any]]] = {
    "synergy": [
        {
            "key": "instance_url",
            "label": "Synergy URL",
            "type": "url",
            "placeholder": "https://synergy.yourcompany.co.nz",
            "required": True,
        },
        {
            "key": "access_token",
            "label": "Personal Access Token",
            "type": "password",
            "placeholder": "Paste your Synergy PAT",
            "required": True,
        },
    ],
    "fergus": [
        {
            "key": "api_key",
            "label": "API Key",
            "type": "password",
            "placeholder": "Paste your Fergus API key",
            "required": True,
        },
    ],
}


def _surfaces_in_files(connector_id: str) -> bool:
    return connector_id in _FILES_CONNECTOR_IDS


def _auth_type_for(connector_id: str) -> str:
    """Infer auth_type for the status payload from the company vault.

    - oauth-client-{platform} → oauth
    - connector-config-{id} → read `connector_type` field (token/api-key/username-password)
    - connector-{id} (legacy) → same lookup; fall back to 'pat'
    - Unknown → 'oauth' for backwards compat (pre-existing behaviour)
    """
    try:
        secrets = _get_consolidated_company_vault() or {}
    except Exception:
        return "oauth"

    for prefix, default in (("connector-config-", None), ("connector-", "pat")):
        entry = secrets.get(f"{prefix}{connector_id}")
        if entry is None:
            continue
        fields = entry.get("fields") or entry
        ct = fields.get("connector_type") if isinstance(fields, dict) else None
        if ct:
            return ct
        return default or "pat"
    return "oauth"


def _connect_hint_for(connector_id: str) -> Dict[str, str]:
    """Return `{connect_url, pending_hint}` for a disconnected connector.

    File connectors send the user to Files > Remote. Chat-only connectors have no
    URL — they prompt inline on first tool use and the agent tells the user that.
    """
    if _surfaces_in_files(connector_id):
        return {
            "connect_url": "/files?tab=remote",
            "pending_hint": "",
        }
    return {
        "connect_url": "",
        "pending_hint": (
            "Available — you'll be asked for your credentials the first time "
            "you use this connector from chat."
        ),
    }


def _connector_config(connector_id: str) -> Dict[str, Any]:
    """Return the connector-config-{id} company vault fields, or {} if absent.

    Carries admin-supplied metadata (display_name, connector_type) and the
    credential_fields JSON snapshot used to build the needs_credential prompt.
    """
    try:
        secrets = _get_consolidated_company_vault() or {}
    except Exception:
        return {}
    for prefix in ("connector-config-", "connector-"):
        entry = secrets.get(f"{prefix}{connector_id}")
        if entry:
            fields = entry.get("fields") or entry
            return fields if isinstance(fields, dict) else {}
    return {}


def _auth_header_scheme(connector_id: str) -> str | None:
    """Return the admin-persisted Authorization header scheme, or None.

    OAuth connectors that speak something other than `Bearer` (Zoho uses
    `Zoho-oauthtoken`, for example) record the scheme on the oauth-client
    company vault entry at wizard save time. Callers default to `Bearer`
    when this returns None.
    """
    try:
        secrets = _get_consolidated_company_vault() or {}
    except Exception:
        return None
    entry = secrets.get(f"oauth-client-{connector_id}")
    if not entry:
        return None
    fields = entry.get("fields") or entry
    if not isinstance(fields, dict):
        return None
    scheme = fields.get("auth_header_scheme")
    return scheme.strip() if isinstance(scheme, str) and scheme.strip() else None


def _credential_fields_for(connector_id: str) -> list[Dict[str, Any]]:
    """Resolve credential_fields for a connector.

    Prefers the admin-persisted JSON on `connector-config-{id}`; falls back to
    a hardcoded schema for legacy connectors (Synergy, Fergus) so the inline
    credential card works out of the box without requiring the admin to
    re-save via the new wizard.
    """
    cfg = _connector_config(connector_id)
    raw = cfg.get("credential_fields", "")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return [_humanize_credential_field(f) for f in parsed]
        except (json.JSONDecodeError, TypeError):
            pass
    return _FALLBACK_CREDENTIAL_FIELDS.get(connector_id, [])


def _humanize_credential_field(field: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve raw i18n label keys left by older wizard snapshots.

    New wizard saves store display text, but snapshots written before that
    carry keys like 'dataConnectors.fields.apiKey' — turn the tail segment
    into Title Case ('Api Key') so the chat card and the agent's prompt never
    surface a raw key.
    """
    label = field.get("label")
    if isinstance(label, str) and label.startswith("dataConnectors."):
        tail = label.rsplit(".", 1)[-1]
        spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", tail)
        field = {**field, "label": spaced.title()}
    return field


def _token_from_fields(fields: Optional[Dict[str, Any]]) -> Optional[str]:
    """First populated single-token credential field, or None."""
    if not isinstance(fields, dict):
        return None
    for key in ("api_key", "bearer_token", "access_token", "token"):
        val = fields.get(key)
        if val:
            return str(val)
    return None


def _basic_from_fields(fields: Optional[Dict[str, Any]]) -> Optional[str]:
    """Authorization header value for a username/password pair, or None."""
    if not isinstance(fields, dict):
        return None
    username = fields.get("username")
    password = fields.get("password")
    if not (username and password):
        return None
    userpass = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Basic {userpass}"


def _headers_from_fields(
    header_map: Dict[str, str], fields: Optional[Dict[str, Any]]
) -> Dict[str, str]:
    """Custom auth headers built from the user's credential fields.

    All-or-nothing: partial credentials return {} (not connected).
    """
    if not isinstance(fields, dict) or not header_map:
        return {}
    headers: Dict[str, str] = {}
    for header_name, field_key in header_map.items():
        value = fields.get(str(field_key))
        if not value:
            return {}
        headers[str(header_name)] = str(value)
    return headers


def _user_connector_token(connector: str, user_sub: str) -> Optional[str]:
    """Find a usable per-user single-token credential for a non-OAuth connector."""
    return _token_from_fields(_user_connector_fields(connector, user_sub))


def _connector_static_headers(connector: str) -> Dict[str, str]:
    """Account-level headers every request to this connector must carry.

    Some APIs (ProWorkflow) require an account API key on every call in
    addition to the per-user Authorization header. The admin wizard persists
    the key as `api_key` and the carrying header name as `api_key_header` on
    the connector-config-{id} company secret; absent either, no extra headers.
    """
    cfg = _connector_config(connector)
    headers: Dict[str, str] = {}
    # Constant non-secret headers (e.g. GoHighLevel's Version) persisted by
    # the wizard as static_headers JSON.
    raw = cfg.get("static_headers") or ""
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                headers.update({str(k): str(v) for k, v in parsed.items() if v})
        except (json.JSONDecodeError, TypeError):
            pass
    api_key = str(cfg.get("api_key") or "").strip()
    header_name = str(cfg.get("api_key_header") or "").strip()
    if api_key and header_name:
        headers[header_name] = api_key
    return headers


def _user_connector_fields(connector: str, user_sub: str) -> Optional[Dict[str, Any]]:
    """Fetch the user's connector-{id} vault entry fields, or None.

    Single home for the vault → secrets → entry → fields-or-entry unwrapping
    that the per-flavor credential helpers all need.
    """
    try:
        vault = _get_user_consolidated_vault(user_sub) or {}
    except Exception:
        return None
    secrets = vault.get("secrets", {}) if isinstance(vault, dict) else {}
    entry = secrets.get(f"connector-{connector}")
    if not entry:
        return None
    fields = entry.get("fields") or entry
    return fields if isinstance(fields, dict) else None


_TOKEN_FIELD_KEYS = (
    "api_key",
    "bearer_token",
    "access_token",
    "token",
    "refresh_token",
)


def _connector_header_map(connector: str) -> Dict[str, str]:
    """The admin-persisted credential_header_map for a connector, or {}."""
    raw = _connector_config(connector).get("credential_header_map") or ""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _entry_has_usable_credential(connector: str, fields: Dict[str, Any]) -> bool:
    """True when a user vault entry holds a credential the REQUEST PATH can use.

    Mirrors the auth resolution flavors exactly so status and connect_request
    never disagree: a token-style field, a complete username/password pair, or
    ALL fields of the connector's credential_header_map. Partial multi-field
    credentials are NOT connected — the request path would reject them too.
    """
    if not isinstance(fields, dict):
        return False
    if any(fields.get(k) for k in _TOKEN_FIELD_KEYS):
        return True
    if fields.get("username") and fields.get("password"):
        return True
    header_map = _connector_header_map(connector)
    if header_map and all(fields.get(str(v)) for v in header_map.values()):
        return True
    return False


def _needs_credential_response(connector: str) -> Dict[str, Any]:
    """Build the structured needs_credential error payload.

    The agent-side `_check_needs_credential` helper turns this into the
    `[[NUMA_CREDENTIAL_REQUEST:...]]` marker the frontend extracts.
    """
    cfg = _connector_config(connector)
    display_name = cfg.get("display_name") or connector.title()
    auth_type = cfg.get("connector_type") or _auth_type_for(connector)
    return {
        "status": "error",
        "result": None,
        "error": f"No credential stored for {display_name}",
        "error_code": "needs_credential",
        "connector_id": connector,
        "display_name": display_name,
        "auth_type": auth_type,
        "credential_fields": _credential_fields_for(connector),
    }


# ---------------------------------------------------------------------------
# Unified status handler
# ---------------------------------------------------------------------------


def handle_connect_status(params: Dict[str, Any]) -> Dict[str, Any]:
    """Check connection status for all connector types (OAuth + Synergy + S3 data bucket).

    Returns unified status with auth_type field for each connector.
    """
    try:
        user_sub = params.get("user_sub", "")
        connector = params.get("connector", "").strip()

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        result: Dict[str, Any] = {}

        # If a specific connector is requested, only check that one
        if connector == "data-bucket":
            result["data-bucket"] = {
                "status": "connected",
                "auth_type": "iam",
                "display_name": "Data Bucket",
            }
            return {"status": "success", "result": result, "error": None}

        if connector:
            # Check a specific provider (OAuth or token/api-key)
            vault_data = _get_user_consolidated_vault(user_sub)
            user_secrets = vault_data.get("secrets", {}) if vault_data else {}
            auth_type = _auth_type_for(connector)
            hint = _connect_hint_for(connector)
            is_chat_only = not _surfaces_in_files(connector)
            cfg = _connector_config(connector)
            display_name = cfg.get("display_name") or connector.title()
            entry = user_secrets.get(f"oauth-{connector}") or user_secrets.get(
                f"connector-{connector}"
            )
            # Synergy fallback: legacy DynamoDB record also counts as connected.
            if not entry and connector == "synergy" and is_synergy_configured(user_sub):
                entry = {"fields": {"access_token": "_via_legacy_store"}}
            if entry:
                fields = entry.get("fields") or entry
                has_cred = _entry_has_usable_credential(connector, fields)
                if has_cred:
                    result[connector] = {
                        "status": "connected",
                        "auth_type": auth_type,
                        "display_name": display_name,
                        "user_email": fields.get("user_email"),
                        "connected_at": fields.get("connected_at"),
                        "connect_url": hint["connect_url"],
                        "pending_hint": hint["pending_hint"],
                    }
                else:
                    result[connector] = {
                        "status": "disconnected",
                        "auth_type": auth_type,
                        "display_name": display_name,
                        "connect_url": hint["connect_url"],
                        "pending_hint": hint["pending_hint"],
                        "credential_fields": (
                            _credential_fields_for(connector) if is_chat_only else []
                        ),
                    }
            else:
                result[connector] = {
                    "status": "disconnected",
                    "auth_type": auth_type,
                    "display_name": display_name,
                    "connect_url": hint["connect_url"],
                    "pending_hint": hint["pending_hint"],
                    "credential_fields": (
                        _credential_fields_for(connector) if is_chat_only else []
                    ),
                }
            return {"status": "success", "result": result, "error": None}

        # No specific connector — check all
        # 1. S3 data bucket (always connected)
        result["data-bucket"] = {
            "status": "connected",
            "auth_type": "iam",
            "display_name": "Data Bucket",
        }

        # 2. Synergy is handled by the generic provider loop below — same
        # disconnected-chat-only / connected shape as Fergus et al. The
        # provider discovery in get_available_providers() also inspects the
        # legacy DynamoDB / connector-synergy entries via is_synergy_configured
        # fallback inside get_synergy_credentials.
        providers = list(get_available_providers())
        if "synergy" not in providers and is_synergy_configured(user_sub):
            providers.append("synergy")
        if providers:
            vault_data = _get_user_consolidated_vault(user_sub)
            user_secrets = vault_data.get("secrets", {}) if vault_data else {}

            for prov in providers:
                auth_type = _auth_type_for(prov)
                hint = _connect_hint_for(prov)
                is_chat_only = not _surfaces_in_files(prov)
                cfg = _connector_config(prov)
                display_name = cfg.get("display_name") or prov.title()
                entry = user_secrets.get(f"oauth-{prov}") or user_secrets.get(
                    f"connector-{prov}"
                )
                has_cred = False
                fields: Dict[str, Any] = {}
                if entry:
                    fields = entry.get("fields") or entry
                    has_cred = _entry_has_usable_credential(prov, fields)
                # Synergy also accepts the legacy DynamoDB credential record
                # as a connection signal.
                if (
                    not has_cred
                    and prov == "synergy"
                    and is_synergy_configured(user_sub)
                ):
                    has_cred = True

                if has_cred:
                    result[prov] = {
                        "status": "connected",
                        "auth_type": auth_type,
                        "display_name": display_name,
                        "user_email": fields.get("user_email"),
                        "connected_at": fields.get("connected_at"),
                        "connect_url": hint["connect_url"],
                        "pending_hint": hint["pending_hint"],
                    }
                else:
                    result[prov] = {
                        "status": "disconnected",
                        "auth_type": auth_type,
                        "display_name": display_name,
                        "connect_url": hint["connect_url"],
                        "pending_hint": hint["pending_hint"],
                        "credential_fields": (
                            _credential_fields_for(prov) if is_chat_only else []
                        ),
                    }

        return {"status": "success", "result": result, "error": None}

    except Exception as e:
        logger.error("Error in connect_status", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


# ---------------------------------------------------------------------------
# Synergy handlers
# ---------------------------------------------------------------------------


def handle_connect_synergy_list(params: Dict[str, Any]) -> Dict[str, Any]:
    """List Synergy jobs/folders/files using folder_id prefix routing.

    folder_id mapping:
      - None/empty → search_all_jobs() → return ALL jobs as folders
      - "job:{id}" → list_job_folders(id) → return folders
      - "folder:{id}" → get_folder_items(id) → return subfolders + files
    """
    try:
        user_sub = params.get("user_sub", "")
        folder_id = params.get("folder_id", "")
        page_size = int(params.get("page_size", 50))
        query = params.get("query", "")

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        creds = get_synergy_credentials(user_sub)
        if not creds:
            return _needs_credential_response("synergy")

        server, token = creds

        if not folder_id:
            # Root level — list ALL jobs (search_jobs returns one page; page 1
            # only would silently truncate accounts with many jobs).
            data = search_all_jobs(
                server, token, name=query, page_size=max(page_size, 100)
            )
            folders = [
                {
                    "folder_id": f"job:{job['job_id']}",
                    "name": job["name"],
                    "path": job.get("path", ""),
                    "has_subfolders": True,
                    "no_of_subfolders": job.get("no_of_folders"),
                }
                for job in data.get("items", [])
            ]
            return {
                "status": "success",
                "result": {
                    "folders": folders,
                    "files": [],
                    "total_count": data.get("total_rows") or len(folders),
                    "connector": "synergy",
                    "truncated": data.get("truncated", False),
                },
                "error": None,
            }

        if folder_id.startswith("job:"):
            # Job level — list top-level folders
            job_id = folder_id[4:]
            items = list_job_folders(server, token, job_id)
            folders = [
                {
                    "folder_id": f"folder:{f['folder_id']}",
                    "name": f["name"],
                    "has_subfolders": f.get("has_subfolders", False),
                    "no_of_subfolders": f.get("no_of_subfolders"),
                }
                for f in items
            ]
            return {
                "status": "success",
                "result": {
                    "folders": folders,
                    "files": [],
                    "total_count": len(folders),
                    "connector": "synergy",
                },
                "error": None,
            }

        if folder_id.startswith("folder:"):
            # Folder level — list subfolders and files
            real_folder_id = folder_id[7:]
            data = get_folder_items(server, token, real_folder_id)
            folders = [
                {
                    "folder_id": f"folder:{f['folder_id']}",
                    "name": f["name"],
                    "has_subfolders": f.get("has_subfolders", False),
                    "no_of_subfolders": f.get("no_of_subfolders"),
                }
                for f in data.get("subfolders", [])
            ]
            files = [
                {
                    "file_id": f["file_id"],
                    "name": f["name"],
                    "size": f.get("size"),
                    "content_type": f.get("content_type"),
                    "modified_at": f.get("modified_at"),
                }
                for f in data.get("files", [])
            ]
            return {
                "status": "success",
                "result": {
                    "folders": folders,
                    "files": files,
                    "total_count": len(folders) + len(files),
                    "connector": "synergy",
                },
                "error": None,
            }

        return {
            "status": "error",
            "result": None,
            "error": f"Invalid folder_id format: {folder_id}. Use 'job:{{id}}' or 'folder:{{id}}'.",
        }

    except SynergyAuthError:
        return {
            "status": "error",
            "result": None,
            "error": "Your Synergy access token has expired. Please reconnect with new credentials.",
            "error_code": "auth_error",
        }
    except httpx.HTTPError as e:
        logger.error("Synergy API error", error=str(e))
        return {"status": "error", "result": None, "error": f"Synergy API error: {e}"}
    except Exception as e:
        logger.error("Error in connect_synergy_list", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def _synergy_job_scope(folder_id: str) -> Optional[str]:
    """Extract a bare job IDString from a search scope param, else None.

    File search must scope to a *job* (there is no global file search). Accepts
    ``"job:8_1"`` and a bare ``"8_1"``; a ``"folder:..."`` value returns None
    (folder-scoped file search isn't supported by this path — the agent should
    pass the parent job).
    """
    if not folder_id:
        return None
    if folder_id.startswith("job:"):
        return folder_id[4:] or None
    if folder_id.startswith("folder:"):
        return None
    return folder_id  # bare IDString, e.g. "8_1"


def handle_connect_synergy_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Search Synergy.

    12d file search is job-scoped (no global file search), so this op does two
    things depending on whether a job scope is supplied:

      - ``folder_id="job:{id}"`` → search FILES (name + contents, merged) within
        that job and its sub-jobs.
      - no scope → search JOBS by name so the agent can first locate the job,
        then re-search files inside it.
    """
    try:
        user_sub = params.get("user_sub", "")
        query = params.get("query", "").strip()
        folder_id = params.get("folder_id", "") or ""
        page_size = int(params.get("page_size", 25))

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        if not query:
            return {"status": "error", "result": None, "error": "Missing query"}

        creds = get_synergy_credentials(user_sub)
        if not creds:
            return _needs_credential_response("synergy")

        server, token = creds

        job_scope = _synergy_job_scope(folder_id)
        if job_scope:
            # File search within a job — matches file names AND contents.
            data = synergy_search_files(
                server, token, query, job_scope, page_size=page_size
            )
            files = [
                {
                    "file_id": f["file_id"],
                    "name": f["name"],
                    "size": f.get("size"),
                    "content_type": f.get("content_type"),
                    "modified_at": f.get("modified_at"),
                    "path": f.get("path", ""),
                }
                for f in data.get("files", [])
            ]
            return {
                "status": "success",
                "result": {
                    "folders": [],
                    "files": files,
                    "total_count": data.get("files_total") or len(files),
                    "query": query,
                    "scope": f"job:{job_scope}",
                    "connector": "synergy",
                },
                "error": None,
            }

        # No job scope → locate matching jobs by name (file search needs a job).
        # Walk all pages — a single page would silently truncate a name match
        # that spans more than one page.
        data = search_all_jobs(server, token, name=query, page_size=max(page_size, 100))

        folders = [
            {
                "folder_id": f"job:{job['job_id']}",
                "name": job["name"],
                "path": job.get("path", ""),
                "has_subfolders": True,
                "no_of_subfolders": job.get("no_of_folders"),
            }
            for job in data.get("items", [])
        ]

        return {
            "status": "success",
            "result": {
                "folders": folders,
                "files": [],
                "total_count": data.get("total_rows") or len(folders),
                "query": query,
                "hint": (
                    "These are JOBS matching the query. To search file names and "
                    "contents inside a job, call search_files again with "
                    "folder_id='job:<job_id>'."
                ),
                "connector": "synergy",
                "truncated": data.get("truncated", False),
            },
            "error": None,
        }

    except SynergyAuthError:
        return {
            "status": "error",
            "result": None,
            "error": "Your Synergy access token has expired. Please reconnect with new credentials.",
            "error_code": "auth_error",
        }
    except httpx.HTTPError as e:
        logger.error("Synergy search error", error=str(e))
        return {"status": "error", "result": None, "error": f"Synergy API error: {e}"}
    except Exception as e:
        logger.error("Error in connect_synergy_search", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_synergy_download(params: Dict[str, Any]) -> Dict[str, Any]:
    """Download a file from Synergy."""
    try:
        user_sub = params.get("user_sub", "")
        file_id = params.get("file_id", "").strip()

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        if not file_id:
            return {"status": "error", "result": None, "error": "Missing file_id"}

        creds = get_synergy_credentials(user_sub)
        if not creds:
            return _needs_credential_response("synergy")

        server, token = creds
        content, filename = synergy_download_file(server, token, file_id)

        if len(content) > MAX_DOWNLOAD_SIZE:
            return {
                "status": "error",
                "result": None,
                "error": f"File too large ({len(content) // (1024 * 1024)}MB). Max is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB.",
            }

        safe_filename = os.path.basename(filename)
        safe_filename = re.sub(r"[^\w\s.-]", "_", safe_filename)
        safe_filename = safe_filename.strip(". ") or f"synergy_{file_id[:8]}"

        result: Dict[str, Any] = {
            "filename": safe_filename,
            "workspace_path": f"/workdir/uploads/connect-synergy/{safe_filename}",
            "connector": "synergy",
            "original_file_id": file_id,
            "size": len(content),
        }

        # Small files stay inline as hex (fast path, backward compatible with
        # older workspace-agent readers). Larger files are staged to S3 and
        # returned as a presigned URL so they survive the 6 MB Lambda response
        # cap without truncation/corruption — identical to the OAuth download
        # path. The MicroVM reader (mcp_tools/connect.py) accepts either shape
        # and verifies content_sha256 end-to-end.
        result.update(
            build_download_payload(content, safe_filename, user_sub, "synergy")
        )

        return {"status": "success", "result": result, "error": None}

    except SynergyAuthError:
        return {
            "status": "error",
            "result": None,
            "error": "Your Synergy access token has expired. Please reconnect with new credentials.",
            "error_code": "auth_error",
        }
    except httpx.HTTPError as e:
        logger.error("Synergy download error", error=str(e))
        return {
            "status": "error",
            "result": None,
            "error": f"Synergy download error: {e}",
        }
    except Exception as e:
        logger.error("Error in connect_synergy_download", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


# ---------------------------------------------------------------------------
# NetSuite MCP Handler
# ---------------------------------------------------------------------------


def handle_connect_netsuite_mcp(params: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a JSON-RPC 2.0 MCP method against NetSuite AI Connector Service.

    Connector config (client_id, account_id) is read from the COMPANY vault
    entry `oauth-client-netsuite` — admin-managed, framework convention. The
    per-user OAuth tokens live in the user vault as `oauth-netsuite` and are
    fetched via `get_oauth_token`. NetSuite is a public OAuth client (PKCE),
    so there is no client_secret to propagate.
    """
    import asyncio

    try:
        user_sub = params.get("user_sub", "")
        method = params.get("method", "").strip()
        arguments = params.get("arguments", {})

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        if not method:
            return {"status": "error", "result": None, "error": "Missing method"}

        try:
            company_secrets = _get_consolidated_company_vault() or {}
        except Exception:
            company_secrets = {}
        entry = company_secrets.get("oauth-client-netsuite")
        if not entry:
            return {
                "status": "error",
                "result": None,
                "error": (
                    "NetSuite connector is not configured. Ask an admin to set it up "
                    "under Data Connectors in Settings."
                ),
            }

        fields = entry.get("fields") or entry
        if not isinstance(fields, dict):
            return {
                "status": "error",
                "result": None,
                "error": "NetSuite connector config is malformed. Ask an admin to re-save the connector.",
            }

        # Gate MCP on scope. The MCP endpoint (com.netsuite.mcpstandardtools) only
        # accepts tokens minted with the `mcp` scope — which is mutually exclusive
        # with rest_webservices / restlets / suite_analytics on the NetSuite side.
        # A connector configured for any non-mcp scope will 401 on every MCP call,
        # so route the agent to the REST `request` path (which the connected token
        # IS valid for) instead of letting it hammer a doomed MCP call.
        scopes = str(fields.get("scopes", "")).strip().lower()
        scope_set = set(scopes.replace(",", " ").split())
        if scopes and "mcp" not in scope_set:
            return {
                "status": "error",
                "result": None,
                "error": (
                    f"NetSuite is connected with the '{scopes}' scope, not 'mcp', so MCP "
                    "methods (mcp_call / ns_*) are unavailable — they would fail with 401. "
                    "Use the REST 'request' operation instead, which this token is valid for: "
                    "connectors(name='request', connector='netsuite', method='POST', "
                    "path='/services/rest/query/v1/suiteql', headers={'Prefer':'transient'}, "
                    "body={'q':'SELECT id, name FROM subsidiary'}) for SuiteQL, or method='GET' "
                    "path='/services/rest/record/v1/{recordType}' for the Record API. Follow "
                    "/workdir/api-docs/netsuite/01-llm-api-rest-rules.md for endpoints and rules."
                ),
            }

        client_id = fields.get("client_id", "")
        account_id = fields.get("account_id", "")
        if not client_id or not account_id:
            return {
                "status": "error",
                "result": None,
                "error": (
                    "NetSuite connector is missing Client ID or Account ID. Ask an admin "
                    "to re-save the connector under Data Connectors."
                ),
            }

        async def do_call():
            from oauth_providers import create_provider

            access_token = await get_oauth_token("netsuite", user_sub)
            if not access_token:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        "You are not connected to NetSuite. Open Data Connectors in Settings "
                        "and click Connect on the NetSuite entry to complete the OAuth flow."
                    ),
                }

            provider = create_provider(
                "netsuite",
                client_id=client_id,
                client_secret=None,
                account_id=account_id,
            )

            try:
                result = await provider._mcp_call(access_token, method, arguments)  # type: ignore
                return {"status": "success", "result": result, "error": None}
            except Exception as e:
                return {"status": "error", "result": None, "error": str(e)}
            finally:
                await provider.close()

        return asyncio.run(do_call())

    except Exception as e:
        logger.error("Error in connect_netsuite_mcp", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


# ---------------------------------------------------------------------------
# Generic HTTP handler (for ad-hoc OAuth APIs)
# ---------------------------------------------------------------------------


def _resolve_connector_base_url(connector_id: str) -> str:
    """Resolve a native connector's API base URL from the company vault.

    The base URL is whatever was stored at connector setup — an admin-entered
    instance URL, an OAuth ``api_endpoint``, etc. This is intentionally generic:
    there is NO per-connector branching. We check both the
    ``connector-config-{id}`` and ``oauth-client-{id}`` vault entries for the
    common base-URL field names and return the first non-empty value (trailing
    slash trimmed), or "" if none is configured.
    """
    sources: list[Dict[str, Any]] = []

    cfg = _connector_config(connector_id)
    if isinstance(cfg, dict):
        sources.append(cfg)

    try:
        company_secrets = _get_consolidated_company_vault() or {}
    except Exception:
        company_secrets = {}
    oauth_entry = company_secrets.get(f"oauth-client-{connector_id}") or {}
    if isinstance(oauth_entry, dict):
        oauth_fields = oauth_entry.get("fields")
        sources.append(oauth_fields if isinstance(oauth_fields, dict) else oauth_entry)

    for fields in sources:
        if not isinstance(fields, dict):
            continue
        # Tenant/admin-specific endpoints (api_endpoint, instance_url) take
        # precedence over the registry-default base_url the wizards write back.
        for key in ("api_endpoint", "instance_url", "base_url"):
            value = str(fields.get(key) or "").strip()
            if value:
                return value.rstrip("/")
    return ""


def handle_connect_request(params: Dict[str, Any]) -> Dict[str, Any]:
    """Make an authenticated HTTP request to any connected API.

    Auth: injects the user's stored token as a Bearer header automatically —
    OAuth access tokens and PAT/API keys are handled identically.

    URL resolution: a relative path (`/api/v1/projects`) is prepended with
    the connector's admin-configured `instance_url` from the company vault.
    The LLM doesn't have to discover the instance URL — just call
    `connectors(request, connector: "synergy", url: "/api/v1/projects")`
    and the backend expands it.
    """
    import asyncio

    try:
        user_sub = params.get("user_sub", "")
        connector = params.get("connector", "").strip()
        method = params.get("method", "GET").upper()
        url = params.get("url", "").strip()
        headers = params.get("headers") or {}
        body = params.get("body")
        description = params.get("description", "")

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        if not connector:
            return {"status": "error", "result": None, "error": "Missing connector"}
        if not url:
            return {"status": "error", "result": None, "error": "Missing url"}
        if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            return {
                "status": "error",
                "result": None,
                "error": f"Invalid method: {method}",
            }

        # data-bucket is an internal S3 abstraction, not an HTTP API.
        if connector == "data-bucket":
            return {
                "status": "error",
                "result": None,
                "error": "connect_request is not supported for data-bucket. Use the numa_tool files operation instead.",
            }

        # Synergy doesn't support generic HTTP
        if connector == "synergy":
            return {
                "status": "error",
                "result": None,
                "error": "connect_request is not supported for synergy. Use the dedicated list/search/download tools.",
            }

        # Resolve a relative path ("/api/rest/actions") against the connector's
        # base URL. The base URL is sourced entirely from the company vault —
        # whatever was stored when the connector was set up (admin-entered
        # instance URL, OAuth api_endpoint, etc.). There is deliberately NO
        # per-connector branching here: every native connector stores its base
        # URL the same way, so one generic lookup serves all of them.
        if not url.startswith(("http://", "https://")):
            base = _resolve_connector_base_url(connector)
            if not base:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        f"No base URL is configured for connector '{connector}'. "
                        f"To recover: read the Base URL from this connector's API docs "
                        f"and retry this call with an absolute URL "
                        f"(https://<host>{url if url.startswith('/') else '/' + url}). "
                        f"If the docs only give a region/placeholder host rather than a "
                        f"fixed URL, the connector is misconfigured — ask an admin to set "
                        f"its base URL in Settings -> Data Connectors."
                    ),
                }
            url = base + (url if url.startswith("/") else "/" + url)

        async def do_request():
            # OAuth first (token path refreshes automatically); otherwise the
            # connector's DECLARED auth flavor (connector_type persisted by the
            # admin wizard) picks exactly one credential shape from the user's
            # vault entry — a stray token-like field on a username-password or
            # header-auth connector must not hijack the request. Legacy entries
            # with no declared type keep the permissive token-then-basic probe.
            authorization = None
            custom_auth_headers: Dict[str, str] = {}
            access_token = await get_oauth_token(connector, user_sub)
            if access_token:
                # Most providers accept "Authorization: Bearer {token}". Zoho (and a
                # handful of others) require their own scheme — the admin wizard
                # persists the expected prefix on the oauth-client vault entry so
                # we don't have to hardcode a per-provider map here.
                auth_scheme = _auth_header_scheme(connector) or "Bearer"
                authorization = f"{auth_scheme} {access_token}"
            else:
                user_fields = _user_connector_fields(connector, user_sub)
                header_map = _connector_header_map(connector)
                declared = str(
                    _connector_config(connector).get("connector_type") or ""
                ).strip()
                if header_map:
                    custom_auth_headers = _headers_from_fields(header_map, user_fields)
                elif declared == "username-password":
                    authorization = _basic_from_fields(user_fields)
                else:
                    token = _token_from_fields(user_fields)
                    if token:
                        auth_scheme = _auth_header_scheme(connector) or "Bearer"
                        authorization = f"{auth_scheme} {token}"
                    elif not declared:
                        # Legacy connector-config without connector_type: a
                        # username/password pair is still honoured.
                        authorization = _basic_from_fields(user_fields)
            if not authorization and not custom_auth_headers:
                return _needs_credential_response(connector)

            request_headers = {
                **({"Authorization": authorization} if authorization else {}),
                **custom_auth_headers,
                **_connector_static_headers(connector),
                **headers,
            }

            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    headers=request_headers,
                    json=body if body and method in ("POST", "PUT", "PATCH") else None,
                )

            # Try to parse response as JSON
            try:
                response_body = response.json()
            except Exception:
                response_body = response.text

            return {
                "status": "success",
                "result": {
                    "status_code": response.status_code,
                    "body": response_body,
                    "headers": dict(response.headers),
                    "connector": connector,
                    "description": description,
                },
                "error": None,
            }

        return asyncio.run(do_request())

    except httpx.HTTPError as e:
        logger.error("HTTP request error", error=str(e))
        return {"status": "error", "result": None, "error": f"HTTP error: {e}"}
    except Exception as e:
        logger.error("Error in connect_request", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}
