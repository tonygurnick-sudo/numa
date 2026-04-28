"""Unified connect tool handlers for Synergy, S3 data bucket, and generic HTTP.

These handlers extend the oauth-workspace-tools Lambda to support all connector
types in the unified connect system. OAuth handlers remain in oauth_tools.py.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Optional

import httpx
import structlog

from prm import client as prm_client

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
    search_jobs,
)

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
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return _FALLBACK_CREDENTIAL_FIELDS.get(connector_id, [])


def _user_connector_token(connector: str, user_sub: str) -> Optional[str]:
    """Find a usable per-user credential for a non-OAuth connector.

    Looks at connector-{id} in the user vault (written by the PAT credentials
    endpoint, POST /api/pat/{id}/credentials). Returns the first populated of
    api_key / bearer_token / access_token / token.
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
    if not isinstance(fields, dict):
        return None
    for key in ("api_key", "bearer_token", "access_token", "token"):
        val = fields.get(key)
        if val:
            return str(val)
    return None


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
                has_cred = bool(
                    fields.get("access_token")
                    or fields.get("api_key")
                    or fields.get("bearer_token")
                    or fields.get("password")
                )
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
                    has_cred = bool(
                        fields.get("access_token")
                        or fields.get("api_key")
                        or fields.get("bearer_token")
                        or fields.get("password")
                    )
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
      - None/empty → search_jobs() → return jobs as folders
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
            # Root level — list jobs
            data = search_jobs(server, token, name=query, page=1, page_size=page_size)
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


def handle_connect_synergy_search(params: Dict[str, Any]) -> Dict[str, Any]:
    """Search Synergy jobs by name."""
    try:
        user_sub = params.get("user_sub", "")
        query = params.get("query", "").strip()
        page_size = int(params.get("page_size", 20))

        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}

        if not query:
            return {"status": "error", "result": None, "error": "Missing query"}

        creds = get_synergy_credentials(user_sub)
        if not creds:
            return _needs_credential_response("synergy")

        server, token = creds
        data = search_jobs(server, token, name=query, page=1, page_size=page_size)

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
                "connector": "synergy",
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

        return {
            "status": "success",
            "result": {
                "file_content": content.hex(),
                "filename": safe_filename,
                "workspace_path": f"/workdir/uploads/connect-synergy/{safe_filename}",
                "connector": "synergy",
                "original_file_id": file_id,
                "size": len(content),
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

        # Resolve relative URL against the connector's admin-configured base.
        # This removes the need for the LLM to discover the instance URL —
        # it can just ask for "/api/v1/projects" and the backend expands it.
        if not url.startswith(("http://", "https://")):
            base = (
                (_connector_config(connector).get("instance_url") or "")
                .strip()
                .rstrip("/")
            )
            if not base:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        f"Relative URL '{url}' given but no instance_url is configured "
                        f"for connector '{connector}'. Either pass an absolute URL "
                        f"(https://…) or ask an admin to set the Instance URL in "
                        f"Settings -> Data Connectors."
                    ),
                }
            url = base + (url if url.startswith("/") else "/" + url)

        async def do_request():
            # Try OAuth first; fall back to non-OAuth per-user credential.
            access_token = await get_oauth_token(connector, user_sub)
            if not access_token:
                access_token = _user_connector_token(connector, user_sub)
            if not access_token:
                return _needs_credential_response(connector)

            # Most providers accept "Authorization: Bearer {token}". Zoho (and a
            # handful of others) require their own scheme — the admin wizard
            # persists the expected prefix on the oauth-client vault entry so
            # we don't have to hardcode a per-provider map here.
            auth_scheme = _auth_header_scheme(connector) or "Bearer"
            request_headers = {
                "Authorization": f"{auth_scheme} {access_token}",
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
