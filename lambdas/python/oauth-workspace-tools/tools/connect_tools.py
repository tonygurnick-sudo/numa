"""Unified connect tool handlers for Synergy, S3 data bucket, and generic HTTP.

These handlers extend the oauth-workspace-tools Lambda to support all connector
types in the unified connect system. OAuth handlers remain in oauth_tools.py.
"""

from __future__ import annotations

import base64
import json
import os
import re
import uuid
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

# ---------------------------------------------------------------------------
# Synergy read-tools — Wave 3 helpers (written in parallel in synergy_helpers.py;
# names are the canonical ones fixed by the Wave-3 build spec). All read-only,
# PAT-scoped, no Numa ACL, no metering. ONE new tool (connect_synergy_resolve)
# plus fold-in modes on tasks / file_info / contacts / job_extras.
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Synergy read-tools — Wave 2 helpers (written in parallel in synergy_helpers.py;
# names are the canonical ones fixed by the Wave-2 build spec). All read-only,
# PAT-scoped, no Numa ACL, no metering.
# ---------------------------------------------------------------------------
from .synergy_helpers import (  # attribute/type/enum vocabulary (schema EXTENSION); companies; notes + associations; forums; job-extras (teams / reports / clash-detection); transmittals (issued files); 12d projects; server identity / status; users; webforms; link / path resolution (connect_synergy_resolve); tasks fold-in (single-task detail + task vocab); file_info fold-in (permission / access / by-name / version); contacts fold-in (directory + global lists); job_extras fold-in (dashboard / roles / categories / job-file-attributes)
    SynergyAuthError,
    discover_transmittals,
)
from .synergy_helpers import download_file as synergy_download_file
from .synergy_helpers import (  # attribute/type/enum vocabulary (schema EXTENSION); companies; notes + associations; forums; job-extras (teams / reports / clash-detection); transmittals (issued files); 12d projects; server identity / status; users; webforms; link / path resolution (connect_synergy_resolve); tasks fold-in (single-task detail + task vocab); file_info fold-in (permission / access / by-name / version); contacts fold-in (directory + global lists); job_extras fold-in (dashboard / roles / categories / job-file-attributes)
    exact_term_search,
    forms_enabled,
    get_active_checkouts,
    get_association_count,
    get_attribute_vocab,
    get_clash_details,
    get_clash_items,
    get_clash_report,
    get_company,
    get_company_attributes,
    get_company_jobs,
    get_company_staff,
    get_contact,
    get_entity_associations,
    get_entity_notes,
    get_entity_weblink,
    get_file_access,
    get_file_history,
    get_file_info_by_name,
    get_file_metadata,
    get_file_permission,
    get_file_version,
    get_folder_items,
    get_folder_summary,
    get_form_definition,
    get_form_fill,
    get_form_fill_output_files,
    get_forum,
    get_forum_categories,
    get_forum_category,
    get_forum_topic,
    get_global_contact_lists,
    get_issue_detail,
    get_issued_file_issue,
    get_issued_file_set,
    get_issued_file_sets,
    get_job_categories,
    get_job_contacts,
    get_job_dashboard,
    get_job_file_attributes,
    get_job_filesettypes,
    get_job_forums,
    get_job_meta,
    get_job_roles,
    get_job_stats,
    get_job_team,
    get_job_tree,
    get_note_count,
    get_note_message,
    get_project_preview,
    get_recent_changes,
    get_report,
    get_report_inputs,
    get_required_issue_attributes,
    get_role_definitions,
    get_server_status,
    get_synergy_credentials,
    get_synergy_projects,
    get_task_detail,
    get_task_vocab,
    get_user,
    get_user_module_access,
    get_workflow_definition,
    get_workflow_definitions,
    get_workflow_diagram,
    get_workflow_instance,
    get_workflow_transition_log,
    is_synergy_configured,
    list_companies,
    list_contacts_directory,
    list_entity_reports,
    list_form_definitions,
    list_form_fills,
    list_forum_category_topics,
    list_forum_topic_posts,
    list_job_folders,
    list_job_issues,
    list_job_tasks,
    portfolio_query,
    resolve_synergy_link,
    resolve_synergy_path,
    search_all_jobs,
    search_contacts,
)
from .synergy_helpers import search_files as synergy_search_files
from .synergy_helpers import (  # attribute/type/enum vocabulary (schema EXTENSION); companies; notes + associations; forums; job-extras (teams / reports / clash-detection); transmittals (issued files); 12d projects; server identity / status; users; webforms; link / path resolution (connect_synergy_resolve); tasks fold-in (single-task detail + task vocab); file_info fold-in (permission / access / by-name / version); contacts fold-in (directory + global lists); job_extras fold-in (dashboard / roles / categories / job-file-attributes)
    search_form_fills,
)

logger = structlog.get_logger()

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
REGION = os.environ.get("AWS_REGION", "")

# Per-query Synergy consumption metering. The structured/exact-term portfolio
# queries read DynamoDB capacity that should draw down the SAME credit ledger as
# the crawl ingestion — booked under the REAL querying user (a query IS a user's
# consumption). Fire-and-forget the synergy-credit-debit lambda; unset env (no
# crawl/metering wired) → skip silently. Best-effort: a metering failure must
# NEVER fail the user's query.
SYNERGY_CREDIT_DEBIT_FUNCTION_NAME = os.environ.get(
    "SYNERGY_CREDIT_DEBIT_FUNCTION_NAME", ""
)


def _meter_synergy_query(user_sub: str, mode: str, count: int) -> None:
    """Fire-and-forget the per-query consumption debit, mirroring the crawler's
    ``_fire_credit_debit``. Best-effort — metering must never block or fail the
    user's query. Skips if the function-name env is unset (metering not wired).

    ``mode`` is ``portfolio`` | ``exact_term``; ``count`` is the read-capacity
    proxy (scanned rows / GSI+probe reads) the debit prices at the cost-recovery
    floor. A fresh per-query ``run_id`` keeps the ledger CONV id unique."""
    if not SYNERGY_CREDIT_DEBIT_FUNCTION_NAME:
        return
    run_id = uuid.uuid4().hex
    try:
        client = prm_client("lambda", region=REGION) if REGION else prm_client("lambda")
        client.invoke(
            FunctionName=SYNERGY_CREDIT_DEBIT_FUNCTION_NAME,
            InvocationType="Event",
            Payload=json.dumps(
                {
                    "kind": "query",
                    "run_id": run_id,
                    "user_sub": user_sub,
                    "scanned_count": int(count or 0),
                    "mode": mode,
                }
            ).encode("utf-8"),
        )
    except Exception as exc:  # noqa: BLE001 — metering is best-effort
        logger.warning(
            "synergy_query_credit_debit_invoke_failed",
            mode=mode,
            error=str(exc),
        )


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
            # Root level — list jobs, bounded by a wall-clock budget so a large
            # 12d instance returns a fast partial set instead of timing out the
            # Lambda. A name query (forwarded to the server) is the way to see
            # jobs beyond the budget.
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
            result: Dict[str, Any] = {
                "folders": folders,
                "files": [],
                "total_count": data.get("total_rows") or len(folders),
                "connector": "synergy",
                "truncated": data.get("truncated", False),
            }
            if data.get("truncated"):
                # Tell the agent NOT to keep re-listing (it'll keep timing out) —
                # the only way to reach more jobs is a server-side name filter.
                result["note"] = (
                    f"This instance has many jobs; showing the first {len(folders)}. "
                    "Listing all of them isn't supported — pass a name query "
                    "(e.g. list with query='...' or use search) to find specific jobs."
                )
            return {"status": "success", "result": result, "error": None}

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
                    "truncated": data.get("truncated", False),
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


def _synergy_meta_call(params: Dict[str, Any], fn, **kwargs) -> Dict[str, Any]:
    """Shared wrapper for read-only Synergy metadata handlers: resolve the user's
    PAT, invoke ``fn(server, token, **kwargs)``, normalise the result/errors."""
    try:
        user_sub = params.get("user_sub", "")
        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        creds = get_synergy_credentials(user_sub)
        if not creds:
            return _needs_credential_response("synergy")
        server, token = creds
        result = fn(server, token, **kwargs)
        return {"status": "success", "result": result, "error": None}
    except SynergyAuthError:
        return _needs_credential_response("synergy")
    except (ValueError, httpx.HTTPError) as e:
        return {"status": "error", "result": None, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        logger.error("Error in synergy metadata call", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def _bare_synergy_id(value: Any, *prefixes: str) -> str:
    """Strip a `job:` / `folder:` prefix off an id.

    `list-files synergy` surfaces ids in folder_id form (e.g. `job:12051_1`,
    `folder:300_1`), and that's the id the agent naturally passes back into these
    metadata commands. The 12d API wants the BARE IDString (`12051_1`), so a
    prefixed id would 404. Accept either form here."""
    v = str(value or "").strip()
    for p in prefixes:
        if v.startswith(p):
            return v[len(p) :].strip()
    return v


def handle_connect_synergy_job_meta(params: Dict[str, Any]) -> Dict[str, Any]:
    """Structural metadata + child counts + attributes for one Synergy job."""
    job_id = _bare_synergy_id(
        params.get("job_id") or params.get("folder_id"), "job:", "folder:"
    )
    if not job_id:
        return {"status": "error", "result": None, "error": "Missing job_id"}
    return _synergy_meta_call(params, get_job_meta, job_id=job_id)


def handle_connect_synergy_folder_summary(params: Dict[str, Any]) -> Dict[str, Any]:
    """Subfolder + file counts (and first-page size) for one Synergy folder."""
    folder_id = _bare_synergy_id(params.get("folder_id"), "folder:", "job:")
    if not folder_id:
        return {"status": "error", "result": None, "error": "Missing folder_id"}
    return _synergy_meta_call(params, get_folder_summary, folder_id=folder_id)


def handle_connect_synergy_schema(params: Dict[str, Any]) -> Dict[str, Any]:
    """The Synergy attribute / type / enum vocabulary — what the agent can
    filter, report on, and decode.

    Backward-compatible: the zero-arg / ``mode='job'`` default returns the job
    attribute vocabulary (standard + searchable fields) exactly as before. The
    new modes EXTEND the same tool (no separate vocab tool):
      - ``job`` (default) — standard + search + default-search + defined-search +
        system job attributes.
      - ``file`` / ``contact`` — that entity's searchable + system attributes
        (``extension`` scopes system file attributes).
      - ``types`` — the decode enums (attributeTypes / matchOperations /
        entityTypes / fileTypes / folderTypes / folderStates / noteTargetTypes),
        or one named enum via ``type_name`` (the lone query-string exception).
      - ``categories`` — the global + job category taxonomy.
      - ``find`` — resolve ONE attribute definition by ``name`` (+ ``entity`` →
        search_context). A 404 surfaces a 'verify search_context encoding' note.
      - ``choices`` — the valid enum choices for an attribute (``name``).

    Every sub-call is best-effort: a failed sibling degrades to null + a note.
    All shapes are [UNKNOWN]/Swagger-200-only → defensive dual-casing parsing."""
    mode = str(params.get("mode") or "").strip().lower()
    entity = str(params.get("entity") or "").strip().lower() or "job"
    name = str(params.get("name") or "").strip()
    type_name = str(params.get("type_name") or "").strip()
    extension = str(params.get("extension") or "").strip()

    # Default (and explicit 'job') preserves the original zero-arg behaviour.
    if not mode:
        mode = "job"

    if mode in ("find", "choices") and not name:
        return {
            "status": "error",
            "result": None,
            "error": f"mode={mode} needs an attribute name (--name).",
        }

    return _synergy_meta_call(
        params,
        get_attribute_vocab,
        mode=mode,
        entity=entity,
        name=name or None,
        type_name=type_name or None,
        extension=extension or None,
    )


def handle_connect_synergy_file_info(params: Dict[str, Any]) -> Dict[str, Any]:
    """Metadata for one Synergy file (size, version, dates, path, attributes).

    Default (``info``) returns the file's metadata exactly as before. Fold-in
    modes EXTEND the same tool (no separate tool ids):
      - ``permission`` — the caller's permission on the file.
      - ``access`` — the users + groups with access (merged).
      - ``by-name`` — look a file up by ``name`` within ``folder_id`` (no id
        needed). URL-encoding is handled by the helper.
      - ``version`` — the file's metadata at a specific ``version`` (int).

    All but ``by-name`` need a file ``file_id`` (e.g. '10_1'); ``by-name`` needs
    ``name`` + ``folder_id`` instead. [UNKNOWN] shapes → defensive parse."""
    mode = str(params.get("mode") or "").strip().lower()
    file_id = str(params.get("file_id") or "").strip()
    name = str(params.get("name") or "").strip()
    folder_id = _bare_synergy_id(params.get("folder_id"), "folder:", "job:")
    retrieve_attributes = (
        bool(params.get("retrieve_attributes"))
        if params.get("retrieve_attributes") is not None
        else True
    )
    version_raw = params.get("version")
    try:
        version = (
            int(version_raw) if version_raw is not None and version_raw != "" else None
        )
    except (TypeError, ValueError):
        version = None

    # Infer mode when omitted (the LLM-facing type promises this): name+folder_id
    # -> by-name lookup; a version -> that version's metadata; else plain info.
    if not mode:
        if name and folder_id:
            mode = "by-name"
        elif version is not None:
            mode = "version"
        else:
            mode = "info"

    _file_modes = {"info", "permission", "access", "by-name", "version"}
    if mode not in _file_modes:
        return {
            "status": "error",
            "result": None,
            "error": (
                f"Invalid file-info mode: {mode}. Use one of: "
                + ", ".join(sorted(_file_modes))
                + "."
            ),
        }

    # by-name resolves a file from a folder + name — it needs NO file_id.
    if mode == "by-name":
        if not (name and folder_id):
            return {
                "status": "error",
                "result": None,
                "error": "by-name mode needs name and folder_id.",
            }
        retrieve_flatten = (
            bool(params.get("retrieve_flatten_parent_attributes"))
            if params.get("retrieve_flatten_parent_attributes") is not None
            else False
        )
        return _synergy_meta_call(
            params,
            get_file_info_by_name,
            name=name,
            folder_id=folder_id,
            retrieve_attributes=retrieve_attributes,
            retrieve_flatten_parent_attributes=retrieve_flatten,
        )

    # All other modes are keyed by a FILE id.
    if not file_id:
        return {"status": "error", "result": None, "error": "Missing file_id"}
    if file_id.startswith(("job:", "folder:")):
        return {
            "status": "error",
            "result": None,
            "error": (
                "file-info needs a file id (e.g. '10_1'), not a "
                f"'{file_id.split(':', 1)[0]}:' id. To browse a job/folder use "
                "`list-files synergy --folder-id <id>`."
            ),
        }

    if mode == "permission":
        return _synergy_meta_call(params, get_file_permission, file_id=file_id)

    if mode == "access":
        return _synergy_meta_call(params, get_file_access, file_id=file_id)

    if mode == "version":
        if version is None:
            return {
                "status": "error",
                "result": None,
                "error": "version mode needs a version (int).",
            }
        return _synergy_meta_call(
            params,
            get_file_version,
            file_id=file_id,
            version=version,
            retrieve_attributes=retrieve_attributes,
        )

    # info (default)
    return _synergy_meta_call(params, get_file_metadata, file_id=file_id)


def handle_connect_synergy_portfolio(params: Dict[str, Any]) -> Dict[str, Any]:
    """Exhaustive structured query over crawled jobs (counts/list by attribute,
    ACL-enforced). Reads the crawl JOB# state table — flag-gated: only works when
    synergyKbCrawl is enabled (the state-table env is set)."""
    user_sub = str(params.get("user_sub") or "").strip()
    if not user_sub:
        return {"status": "error", "result": None, "error": "Missing user_sub"}
    table_name = os.getenv("SYNERGY_STATE_TABLE_NAME", "").strip()
    if not table_name:
        return {
            "status": "error",
            "result": None,
            "error": (
                "Synergy portfolio queries require the crawl/index feature "
                "(synergyKbCrawl) to be enabled for this workspace."
            ),
        }
    attrs = params.get("attrs") if isinstance(params.get("attrs"), dict) else {}
    try:
        limit = int(params.get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100
    try:
        result = portfolio_query(
            table_name,
            user_sub,
            attr_filters={str(k): str(v) for k, v in (attrs or {}).items()},
            created_after=str(params.get("created_after") or ""),
            created_before=str(params.get("created_before") or ""),
            exclude_templates=bool(params.get("exclude_templates")),
            group_by=str(params.get("group_by") or ""),
            limit=limit,
        )
        # Meter the query's read-capacity under the real caller (fire-and-forget).
        _meter_synergy_query(user_sub, "portfolio", int(result.get("scanned") or 0))
        return {"status": "success", "result": result, "error": None}
    except Exception as e:  # noqa: BLE001
        logger.error("Error in connect_synergy_portfolio", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_synergy_exact_term(params: Dict[str, Any]) -> Dict[str, Any]:
    """Exact-term search — which jobs contain these literal words/codes (ACL-
    enforced, exhaustive). Reads the crawl TERM index — flag-gated on
    synergyKbCrawl + the per-tenant term-index pilot toggle."""
    user_sub = str(params.get("user_sub") or "").strip()
    if not user_sub:
        return {"status": "error", "result": None, "error": "Missing user_sub"}
    table_name = os.getenv("SYNERGY_STATE_TABLE_NAME", "").strip()
    if not table_name:
        return {
            "status": "error",
            "result": None,
            "error": (
                "Synergy exact-term search requires the crawl/index feature "
                "(synergyKbCrawl + the exact-term index) to be enabled."
            ),
        }
    raw_terms = params.get("terms")
    terms = (
        [str(t) for t in raw_terms]
        if isinstance(raw_terms, list)
        else [str(raw_terms)] if raw_terms else []
    )
    if not terms:
        return {"status": "error", "result": None, "error": "Missing terms"}
    try:
        limit = int(params.get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100
    try:
        result = exact_term_search(
            table_name,
            user_sub,
            terms=terms,
            mode=str(params.get("mode") or "AND"),
            limit=limit,
        )
        # Meter the query's read-capacity under the real caller (fire-and-forget).
        _meter_synergy_query(user_sub, "exact_term", int(result.get("read_count") or 0))
        return {"status": "success", "result": result, "error": None}
    except Exception as e:  # noqa: BLE001
        logger.error("Error in connect_synergy_exact_term", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_synergy_job_stats(params: Dict[str, Any]) -> Dict[str, Any]:
    """Aggregate stats for a job (counts, file-type mix, size buckets, depth) via
    a bounded recursive walk."""
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    if not job_id:
        return {"status": "error", "result": None, "error": "Missing job_id"}
    return _synergy_meta_call(params, get_job_stats, job_id=job_id)


def handle_connect_synergy_job_tree(params: Dict[str, Any]) -> Dict[str, Any]:
    """Folder outline (path + file count per folder) for a job, depth-bounded."""
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    if not job_id:
        return {"status": "error", "result": None, "error": "Missing job_id"}
    try:
        max_depth = int(params.get("max_depth") or 10)
    except (TypeError, ValueError):
        max_depth = 10
    return _synergy_meta_call(params, get_job_tree, job_id=job_id, max_depth=max_depth)


# ---------------------------------------------------------------------------
# Synergy read-tools — Wave 1 (read-only, PAT-scoped, no Numa ACL, no metering)
# ---------------------------------------------------------------------------


def handle_connect_synergy_tasks(params: Dict[str, Any]) -> Dict[str, Any]:
    """Tasks on a Synergy job — who owns what, state, due dates.

    Default (``list``) uses getTaskList for the plain "all tasks on this job"
    read; an ``assignee_id`` or an explicit ``include_closed`` flips the helper
    to the POST /tasks/search path (the only one that filters by assignee /
    closed state). ``limit`` is a client-side cap (getTaskList has no paging).

    Fold-in modes (inferred when ``mode`` omitted):
      - ``detail`` — one task by ``task_id`` (+ its children / history). Bools
        ``children`` / ``history`` default true, ``reminders`` / ``cc`` false.
      - ``vocab`` — the task type / state vocabulary. With ``task_type_id``:
        that type + its states (and initial states); without: all task types.
    """
    mode = str(params.get("mode") or "").strip().lower()
    task_id = str(params.get("task_id") or "").strip()
    if task_id.startswith(("job:", "folder:")):
        return {
            "status": "error",
            "result": None,
            "error": (
                "task_id needs a task id, not a " f"'{task_id.split(':', 1)[0]}:' id."
            ),
        }
    task_type_id = str(params.get("task_type_id") or "").strip()

    # Infer the fold-in mode when not explicit. A task_id means a single-task
    # detail read; a task_type_id (no task_id) means the task vocabulary; the
    # original job-task list stays the default.
    if not mode:
        if task_id:
            mode = "detail"
        elif task_type_id:
            mode = "vocab"
        else:
            mode = "list"

    if mode == "detail":
        if not task_id:
            return {"status": "error", "result": None, "error": "Missing task_id"}
        children = (
            bool(params.get("children")) if params.get("children") is not None else True
        )
        history = (
            bool(params.get("history")) if params.get("history") is not None else True
        )
        reminders = bool(params.get("reminders"))
        cc = bool(params.get("cc"))
        return _synergy_meta_call(
            params,
            get_task_detail,
            task_id=task_id,
            children=children,
            history=history,
            reminders=reminders,
            cc=cc,
        )

    if mode == "vocab":
        get_attributes = (
            bool(params.get("get_attributes"))
            if params.get("get_attributes") is not None
            else True
        )
        return _synergy_meta_call(
            params,
            get_task_vocab,
            task_type_id=task_type_id or None,
            get_attributes=get_attributes,
        )

    if mode != "list":
        return {
            "status": "error",
            "result": None,
            "error": (f"Invalid tasks mode: {mode}. Use one of: list, detail, vocab."),
        }

    # list mode (default) — the original job-scoped task read.
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    if not job_id:
        return {"status": "error", "result": None, "error": "Missing job_id"}
    assignee_id = str(params.get("assignee_id") or "").strip()
    # `include_closed` is meaningful only when explicitly supplied — its presence
    # (like assignee_id) forces the search path. Absent → open-only via getTaskList.
    include_closed_raw = params.get("include_closed")
    include_closed = (
        bool(include_closed_raw) if include_closed_raw is not None else None
    )
    try:
        limit = int(params.get("limit") or 200)
    except (TypeError, ValueError):
        limit = 200
    return _synergy_meta_call(
        params,
        list_job_tasks,
        job_id=job_id,
        assignee_id=assignee_id or None,
        include_closed=include_closed,
        limit=limit,
    )


def handle_connect_synergy_contacts(params: Dict[str, Any]) -> Dict[str, Any]:
    """People on a Synergy job / contact directory lookup.

    Modes (inferred when ``mode`` omitted):
      - ``job`` — list the job's contact lists and their contacts.
      - ``search`` — structured (first/last/email) PagedResult, or free-text
        ``query`` via simpleSearch (hard-capped, truncated flagged).
      - ``get`` — one contact's full record (attributes + companies).
      - ``directory`` — the full address book, page-walked (Style-2 path paging,
        bounded). ``page`` / ``page_size`` control the walk.
      - ``global-lists`` — the instance's global contact lists.

    Note: a job's PM / foreman is often the job's PM *attribute* (see
    ``connect_synergy_job_meta``), not only its contact lists."""
    mode = str(params.get("mode") or "").strip().lower()
    contact_id = str(params.get("contact_id") or "").strip()
    if contact_id.startswith(("job:", "folder:")):
        return {
            "status": "error",
            "result": None,
            "error": (
                "contact_id needs a contact id, not a "
                f"'{contact_id.split(':', 1)[0]}:' id."
            ),
        }
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    query = str(params.get("query") or "").strip()
    first_name = str(params.get("first_name") or "").strip()
    last_name = str(params.get("last_name") or "").strip()
    email = str(params.get("email") or "").strip()
    users_only = bool(params.get("users_only"))
    try:
        page = max(1, int(params.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(params.get("page_size") or 50)
    except (TypeError, ValueError):
        page_size = 50

    # Infer the mode when not supplied: a contact_id means a single-record GET,
    # a job_id means the job's contact lists, anything else is a search.
    # (directory / global-lists are opt-in only — never inferred.)
    if not mode:
        if contact_id:
            mode = "get"
        elif job_id:
            mode = "job"
        else:
            mode = "search"

    if mode == "directory":
        return _synergy_meta_call(
            params,
            list_contacts_directory,
            page=page,
            page_size=max(1, page_size),
        )

    if mode == "global-lists":
        return _synergy_meta_call(params, get_global_contact_lists)

    if mode == "get":
        if not contact_id:
            return {"status": "error", "result": None, "error": "Missing contact_id"}
        return _synergy_meta_call(params, get_contact, contact_id=contact_id)

    if mode == "job":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(params, get_job_contacts, job_id=job_id)

    # search
    if not (query or first_name or last_name or email):
        return {
            "status": "error",
            "result": None,
            "error": "Provide a query or first_name/last_name/email to search contacts.",
        }
    return _synergy_meta_call(
        params,
        search_contacts,
        query=query or None,
        first_name=first_name or None,
        last_name=last_name or None,
        email=email or None,
        users_only=users_only,
        page_size=page_size,
    )


def handle_connect_synergy_issues(params: Dict[str, Any]) -> Dict[str, Any]:
    """Issues / RFIs on a Synergy job, or one issue's detail.

    Exactly one of ``job_id`` (list mode) or ``issue_id`` (detail mode). List
    mode walks the issue-tracking pages (bounded + truncated); detail mode pulls
    the issue, best-effort comments, and (only when ``include_changes``) the
    change log. Status/type label maps are fetched inline best-effort."""
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    issue_id = str(params.get("issue_id") or "").strip()
    if issue_id.startswith(("job:", "folder:")):
        return {
            "status": "error",
            "result": None,
            "error": (
                "issue_id needs an issue id, not a "
                f"'{issue_id.split(':', 1)[0]}:' id."
            ),
        }
    if not job_id and not issue_id:
        return {
            "status": "error",
            "result": None,
            "error": "Provide a job_id (to list issues) or an issue_id (for detail).",
        }

    if issue_id:
        return _synergy_meta_call(
            params,
            get_issue_detail,
            issue_id=issue_id,
            retrieve_details=(
                bool(params.get("retrieve_details"))
                if params.get("retrieve_details") is not None
                else True
            ),
            include_changes=bool(params.get("include_changes")),
        )

    try:
        page = int(params.get("page") or 1)
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(params.get("page_size") or 50)
    except (TypeError, ValueError):
        page_size = 50
    return _synergy_meta_call(
        params,
        list_job_issues,
        job_id=job_id,
        page=max(1, page),
        page_size=max(1, page_size),
    )


def handle_connect_synergy_workflow(params: Dict[str, Any]) -> Dict[str, Any]:
    """Workflow status (READ ONLY) — definitions, a single definition, a live
    instance, a transition log, or a state-diagram image.

    Modes (default ``definitions``, or ``instance`` when an ``entity_id`` is
    present): ``definitions`` | ``definition`` | ``instance`` | ``transition_log``
    | ``diagram``. ``diagram`` returns a staged image payload (binary, never
    inline JSON). ``entity_type`` encoding is UNVERIFIED against live 12d —
    a 404 surfaces a clear "verify entity_type encoding" error."""
    mode = str(params.get("mode") or "").strip().lower()
    workflow_id = str(params.get("workflow_id") or "").strip()
    entity_id = str(params.get("entity_id") or "").strip()
    entity_type = str(params.get("entity_type") or "").strip()
    instance_id = str(params.get("instance_id") or "").strip()
    current_state_id = str(params.get("current_state_id") or "").strip()
    return_all = (
        bool(params.get("return_all")) if params.get("return_all") is not None else True
    )

    if not mode:
        mode = "instance" if entity_id else "definitions"

    if mode == "definitions":
        return _synergy_meta_call(params, get_workflow_definitions)

    if mode == "definition":
        if not workflow_id:
            return {"status": "error", "result": None, "error": "Missing workflow_id"}
        return _synergy_meta_call(
            params,
            get_workflow_definition,
            workflow_id=workflow_id,
            return_all=return_all,
        )

    if mode == "instance":
        if not (workflow_id and entity_id and entity_type):
            return {
                "status": "error",
                "result": None,
                "error": "instance mode needs workflow_id, entity_id and entity_type.",
            }
        return _synergy_meta_call(
            params,
            get_workflow_instance,
            workflow_id=workflow_id,
            entity_id=entity_id,
            entity_type=entity_type,
        )

    if mode == "transition_log":
        if not instance_id:
            return {"status": "error", "result": None, "error": "Missing instance_id"}
        return _synergy_meta_call(
            params, get_workflow_transition_log, instance_id=instance_id
        )

    if mode == "diagram":
        if not (workflow_id and current_state_id):
            return {
                "status": "error",
                "result": None,
                "error": "diagram mode needs workflow_id and current_state_id.",
            }
        # The diagram is a binary image — stage it via build_download_payload
        # (inline hex for small, S3 presigned URL for large) exactly like
        # handle_connect_synergy_download, NOT as inline JSON.
        try:
            user_sub = params.get("user_sub", "")
            if not user_sub:
                return {
                    "status": "error",
                    "result": None,
                    "error": "Missing user_sub",
                }
            creds = get_synergy_credentials(user_sub)
            if not creds:
                return _needs_credential_response("synergy")
            server, token = creds
            content, filename = get_workflow_diagram(
                server, token, workflow_id, current_state_id
            )
            if len(content) > MAX_DOWNLOAD_SIZE:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        f"Diagram too large ({len(content) // (1024 * 1024)}MB). "
                        f"Max is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB."
                    ),
                }
            safe_filename = os.path.basename(filename or "")
            safe_filename = re.sub(r"[^\w\s.-]", "_", safe_filename)
            safe_filename = (
                safe_filename.strip(". ") or f"synergy_workflow_{workflow_id[:8]}.png"
            )
            result: Dict[str, Any] = {
                "mode": "diagram",
                "workflow_id": workflow_id,
                "current_state_id": current_state_id,
                "filename": safe_filename,
                "workspace_path": f"/workdir/uploads/connect-synergy/{safe_filename}",
                "connector": "synergy",
                "size": len(content),
            }
            result.update(
                build_download_payload(content, safe_filename, user_sub, "synergy")
            )
            return {"status": "success", "result": result, "error": None}
        except SynergyAuthError:
            return _needs_credential_response("synergy")
        except (ValueError, httpx.HTTPError) as e:
            return {"status": "error", "result": None, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            logger.error(
                "Error in connect_synergy_workflow diagram",
                error=str(e),
                exc_info=True,
            )
            return {"status": "error", "result": None, "error": str(e)}

    return {
        "status": "error",
        "result": None,
        "error": (
            f"Invalid workflow mode: {mode}. Use one of: definitions, "
            "definition, instance, transition_log, diagram."
        ),
    }


def handle_connect_synergy_file_history(params: Dict[str, Any]) -> Dict[str, Any]:
    """Version history for one Synergy file (version, who changed it, when, type).

    ``file_id`` MUST be a file id (e.g. '10_1') — a job:/folder: prefix is
    rejected with a hint, like handle_connect_synergy_file_info."""
    file_id = str(params.get("file_id") or "").strip()
    if not file_id:
        return {"status": "error", "result": None, "error": "Missing file_id"}
    if file_id.startswith(("job:", "folder:")):
        return {
            "status": "error",
            "result": None,
            "error": (
                "file-history needs a file id (e.g. '10_1'), not a "
                f"'{file_id.split(':', 1)[0]}:' id. To browse a job/folder use "
                "`list-files synergy --folder-id <id>`."
            ),
        }
    try:
        page = int(params.get("page") or 1)
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(params.get("page_size") or 50)
    except (TypeError, ValueError):
        page_size = 50
    return _synergy_meta_call(
        params,
        get_file_history,
        file_id=file_id,
        page=max(1, page),
        page_size=max(1, page_size),
    )


def handle_connect_synergy_recent(params: Dict[str, Any]) -> Dict[str, Any]:
    """What changed recently on a Synergy job or folder.

    Exactly one of ``job_id`` or ``folder_id`` (folder wins if both given).
    ``since`` (ISO-UTC) overrides ``days`` (default 7). Polling-based — there are
    no webhooks; re-run rather than tight-loop (the helper carries that caveat in
    the result note, plus a "client-side date filtered" note on fallback)."""
    folder_id = _bare_synergy_id(params.get("folder_id"), "folder:", "job:")
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    if not folder_id and not job_id:
        return {
            "status": "error",
            "result": None,
            "error": "Provide a job_id or folder_id to see recent changes.",
        }
    try:
        days = int(params.get("days") or 7)
    except (TypeError, ValueError):
        days = 7
    since = str(params.get("since") or "").strip()
    try:
        limit = int(params.get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100
    # Folder wins if both are supplied (pass only the winning scope through).
    return _synergy_meta_call(
        params,
        get_recent_changes,
        job_id=(None if folder_id else (job_id or None)),
        folder_id=(folder_id or None),
        days=days,
        since=since or None,
        limit=limit,
    )


# ---------------------------------------------------------------------------
# Synergy read-tools — Wave 2 (read-only, PAT-scoped, no Numa ACL, no metering)
# ---------------------------------------------------------------------------


def handle_connect_synergy_forums(params: Dict[str, Any]) -> Dict[str, Any]:
    """Forum / discussion drill on a Synergy job (READ ONLY).

    One mode-dispatched read tool: list a job's forums, open a forum, walk its
    categories -> topics -> posts (read a thread). Mode is inferred when omitted
    so the simplest call does the natural thing: ``topic_id`` -> posts,
    ``category_id`` -> topics, ``forum_id`` -> categories, ``job_id`` -> list.
    ForumModel/Category/Topic/Post shapes are [UNKNOWN] — fields are read
    defensively with a ``raw`` passthrough."""
    mode = str(params.get("mode") or "").strip().lower()
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    forum_id = str(params.get("forum_id") or "").strip()
    category_id = str(params.get("category_id") or "").strip()
    topic_id = str(params.get("topic_id") or "").strip()
    include_permission = bool(params.get("include_permission"))

    # forum/category/topic ids are not job/folder ids — reject a prefixed value
    # with a hint (mirrors the file_id guards).
    for label, val in (
        ("forum_id", forum_id),
        ("category_id", category_id),
        ("topic_id", topic_id),
    ):
        if val.startswith(("job:", "folder:")):
            return {
                "status": "error",
                "result": None,
                "error": (
                    f"{label} needs a forum id, not a " f"'{val.split(':', 1)[0]}:' id."
                ),
            }

    try:
        page = max(1, int(params.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, int(params.get("page_size") or 50))
    except (TypeError, ValueError):
        page_size = 50

    # Infer mode from the deepest id supplied (self-navigating drill).
    if not mode:
        if topic_id:
            mode = "posts"
        elif category_id:
            mode = "topics"
        elif forum_id:
            mode = "categories"
        elif job_id:
            mode = "list"
        else:
            mode = "list"

    if mode == "list":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(params, get_job_forums, job_id=job_id)

    if mode == "forum":
        if not forum_id:
            return {"status": "error", "result": None, "error": "Missing forum_id"}
        return _synergy_meta_call(
            params,
            get_forum,
            forum_id=forum_id,
            include_permission=include_permission,
        )

    if mode == "categories":
        if not forum_id:
            return {"status": "error", "result": None, "error": "Missing forum_id"}
        return _synergy_meta_call(params, get_forum_categories, forum_id=forum_id)

    if mode == "category":
        if not (forum_id and category_id):
            return {
                "status": "error",
                "result": None,
                "error": "category mode needs forum_id and category_id.",
            }
        return _synergy_meta_call(
            params, get_forum_category, forum_id=forum_id, category_id=category_id
        )

    if mode == "topics":
        if not category_id:
            return {"status": "error", "result": None, "error": "Missing category_id"}
        return _synergy_meta_call(
            params,
            list_forum_category_topics,
            category_id=category_id,
            page=page,
            page_size=page_size,
        )

    if mode == "topic":
        if not topic_id:
            return {"status": "error", "result": None, "error": "Missing topic_id"}
        return _synergy_meta_call(params, get_forum_topic, topic_id=topic_id)

    if mode == "posts":
        if not topic_id:
            return {"status": "error", "result": None, "error": "Missing topic_id"}
        return _synergy_meta_call(
            params,
            list_forum_topic_posts,
            topic_id=topic_id,
            page=page,
            page_size=page_size,
        )

    return {
        "status": "error",
        "result": None,
        "error": (
            f"Invalid forums mode: {mode}. Use one of: list, forum, categories, "
            "category, topics, topic, posts."
        ),
    }


def handle_connect_synergy_projects(params: Dict[str, Any]) -> Dict[str, Any]:
    """12d PROJECTS (read-only) — the 12d Model software projects embedded INSIDE
    a Synergy job/folder (Sub12dProjects / TDJobs).

    A 12d PROJECT is NOT a Synergy job. Jobs are the org unit users usually mean
    by 'project' — for those use synergy-list / synergy-search / synergy-job-meta.
    Never pass a job id where a project_id is wanted, or vice-versa.

    Mode is inferred when omitted: ``project_id`` -> get; ``job_id``/``folder_id``
    (no project_id) -> list; ``name`` -> find. Other modes: folders, file-info,
    associations, notes, permission, history, changed-elements, latest-change,
    preview. ``preview`` returns a staged BINARY image payload (never inline
    JSON), exactly like the workflow diagram. ALL 14 read endpoints are
    [UNKNOWN]-schema → defensive parse + ``raw`` passthrough + per-result note."""
    mode = str(params.get("mode") or "").strip().lower()
    project_id = _bare_synergy_id(params.get("project_id"), "job:", "folder:")
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    folder_id = _bare_synergy_id(params.get("folder_id"), "folder:", "job:")
    name = str(params.get("name") or "").strip()
    file_name = str(params.get("file_name") or "").strip()
    is_folder = bool(params.get("is_folder"))
    retrieve_attributes = (
        bool(params.get("retrieve_attributes"))
        if params.get("retrieve_attributes") is not None
        else True
    )
    version_raw = params.get("version")
    try:
        version = (
            int(version_raw) if version_raw is not None and version_raw != "" else None
        )
    except (TypeError, ValueError):
        version = None
    try:
        page = max(1, int(params.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, int(params.get("page_size") or 50))
    except (TypeError, ValueError):
        page_size = 50

    if not mode:
        if project_id:
            mode = "get"
        elif job_id or folder_id:
            mode = "list"
        elif name:
            mode = "find"
        else:
            return {
                "status": "error",
                "result": None,
                "error": (
                    "Provide a project_id (get), job_id/folder_id (list), or "
                    "name (find)."
                ),
            }

    _project_modes = {
        "find",
        "list",
        "get",
        "folders",
        "file-info",
        "associations",
        "notes",
        "permission",
        "history",
        "changed-elements",
        "latest-change",
        "preview",
    }
    if mode not in _project_modes:
        return {
            "status": "error",
            "result": None,
            "error": (
                f"Invalid projects mode: {mode}. Use one of: "
                + ", ".join(sorted(_project_modes))
                + "."
            ),
        }

    if mode == "find":
        if not name:
            return {"status": "error", "result": None, "error": "Missing name"}
    elif mode == "list":
        if not (job_id or folder_id):
            return {
                "status": "error",
                "result": None,
                "error": "list mode needs a job_id or folder_id.",
            }
    elif mode == "file-info":
        if not (project_id and file_name):
            return {
                "status": "error",
                "result": None,
                "error": "file-info mode needs project_id and file_name.",
            }
    elif mode in _project_modes - {"find", "list"}:
        if not project_id:
            return {"status": "error", "result": None, "error": "Missing project_id"}

    # Binary preview — stage via build_download_payload like the workflow diagram,
    # NEVER inline JSON image bytes.
    if mode == "preview":
        try:
            user_sub = params.get("user_sub", "")
            if not user_sub:
                return {"status": "error", "result": None, "error": "Missing user_sub"}
            creds = get_synergy_credentials(user_sub)
            if not creds:
                return _needs_credential_response("synergy")
            server, token = creds
            content, filename, _preview_version = get_project_preview(
                server, token, project_id, version=version
            )
            if len(content) > MAX_DOWNLOAD_SIZE:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        f"Preview too large ({len(content) // (1024 * 1024)}MB). "
                        f"Max is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB."
                    ),
                }
            safe_filename = os.path.basename(filename or "")
            safe_filename = re.sub(r"[^\w\s.-]", "_", safe_filename)
            safe_filename = (
                safe_filename.strip(". ") or f"synergy_project_{project_id[:8]}.png"
            )
            result: Dict[str, Any] = {
                "mode": "preview",
                "project_id": project_id,
                "version": version,
                "filename": safe_filename,
                "workspace_path": f"/workdir/uploads/connect-synergy/{safe_filename}",
                "connector": "synergy",
                "size": len(content),
            }
            result.update(
                build_download_payload(content, safe_filename, user_sub, "synergy")
            )
            return {"status": "success", "result": result, "error": None}
        except SynergyAuthError:
            return _needs_credential_response("synergy")
        except (ValueError, httpx.HTTPError) as e:
            return {"status": "error", "result": None, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            logger.error(
                "Error in connect_synergy_projects preview",
                error=str(e),
                exc_info=True,
            )
            return {"status": "error", "result": None, "error": str(e)}

    # All non-binary modes route through the consolidated mode-dispatch helper.
    return _synergy_meta_call(
        params,
        get_synergy_projects,
        mode=mode,
        project_id=project_id or None,
        job_id=job_id or None,
        folder_id=folder_id or None,
        name=name or None,
        file_name=file_name or None,
        is_folder=is_folder,
        version=version,
        page=page,
        page_size=page_size,
        retrieve_attributes=retrieve_attributes,
    )


def handle_connect_synergy_transmittals(params: Dict[str, Any]) -> Dict[str, Any]:
    """Issued Files / transmittals on a Synergy job (READ ONLY).

    Two-level hierarchy: JOB -> file-set TYPES -> SETS (versioned bundles) ->
    ISSUES (each = one publish/transmittal EVENT) -> PUBLISHED FILES + RECIPIENTS.
    Modes: ``types`` | ``sets`` | ``set`` | ``issue`` | ``discover`` |
    ``attributes``. Inferred when omitted: ``issue_id`` -> issue; ``set_id`` ->
    set; ``job_id`` + ``type_id`` -> sets; ``job_id`` alone -> discover; none ->
    attributes.

    WARNING: an 'issue' here is a TRANSMITTAL publish event, NOT an issue-tracking
    RFI (that is connect_synergy_issues) — never cross-wire the two ids. Binary
    transmittal/zip downloads are EXCLUDED (use the download path); this tool only
    flags whether a stored transmittal file exists. ALL Issued Files schemas are
    [UNKNOWN] → defensive parse + ``raw`` passthrough."""
    mode = str(params.get("mode") or "").strip().lower()
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    type_id = str(params.get("type_id") or "").strip()
    set_id = str(params.get("set_id") or "").strip()
    issue_id = str(params.get("issue_id") or "").strip()
    if issue_id.startswith(("job:", "folder:")):
        return {
            "status": "error",
            "result": None,
            "error": (
                "issue_id needs a transmittal issue id, not a "
                f"'{issue_id.split(':', 1)[0]}:' id. (This is a publish event, "
                "not an issue-tracking RFI.)"
            ),
        }
    get_issues = (
        bool(params.get("get_issues")) if params.get("get_issues") is not None else True
    )
    version_raw = params.get("version")
    try:
        version = (
            int(version_raw) if version_raw is not None and version_raw != "" else None
        )
    except (TypeError, ValueError):
        version = None

    if not mode:
        if issue_id:
            mode = "issue"
        elif set_id:
            mode = "set"
        elif job_id and type_id:
            mode = "sets"
        elif job_id:
            mode = "discover"
        else:
            mode = "attributes"

    if mode == "types":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(
            params, get_job_filesettypes, job_id=job_id, type_id=type_id or None
        )

    if mode == "sets":
        if not (job_id and type_id):
            return {
                "status": "error",
                "result": None,
                "error": "sets mode needs job_id and type_id.",
            }
        return _synergy_meta_call(
            params, get_issued_file_sets, job_id=job_id, type_id=type_id
        )

    if mode == "set":
        if not set_id:
            return {"status": "error", "result": None, "error": "Missing set_id"}
        return _synergy_meta_call(
            params,
            get_issued_file_set,
            set_id=set_id,
            get_issues=get_issues,
            version=version,
        )

    if mode == "issue":
        if not issue_id:
            return {"status": "error", "result": None, "error": "Missing issue_id"}
        return _synergy_meta_call(params, get_issued_file_issue, issue_id=issue_id)

    if mode == "discover":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        # BUGFIX: route to the dedicated chain helper. get_job_filesettypes has no
        # `discover=` kwarg, so the old call raised TypeError.
        return _synergy_meta_call(params, discover_transmittals, job_id=job_id)

    if mode == "attributes":
        # BUGFIX: route to the dedicated vocab helper. get_job_filesettypes has no
        # `attributes=` kwarg, so the old call raised TypeError.
        return _synergy_meta_call(params, get_required_issue_attributes)

    return {
        "status": "error",
        "result": None,
        "error": (
            f"Invalid transmittals mode: {mode}. Use one of: types, sets, set, "
            "issue, discover, attributes."
        ),
    }


def handle_connect_synergy_companies(params: Dict[str, Any]) -> Dict[str, Any]:
    """Companies / organisations directory in Synergy (READ ONLY).

    Modes (inferred when omitted): ``list`` (all companies — best-effort, some
    instances have no list-all endpoint), ``get`` (one company + attributes),
    ``jobs`` (a company's jobs), ``staff`` (a company's contacts), ``schema``
    (system company-attribute vocabulary). Pairs with connect_synergy_contacts
    (contacts carry a companies[] back-reference). CompanyModel shape is
    [UNKNOWN] → defensive dual-casing parse + ``raw`` passthrough."""
    mode = str(params.get("mode") or "").strip().lower()
    company_id = _bare_synergy_id(params.get("company_id"), "job:", "folder:")
    try:
        limit = int(params.get("limit") or 200)
    except (TypeError, ValueError):
        limit = 200

    if not mode:
        mode = "get" if company_id else "list"

    if mode == "list":
        return _synergy_meta_call(params, list_companies, limit=limit)

    if mode == "schema":
        return _synergy_meta_call(params, get_company_attributes)

    if mode in ("get", "jobs", "staff"):
        if not company_id:
            return {"status": "error", "result": None, "error": "Missing company_id"}
        if mode == "get":
            return _synergy_meta_call(params, get_company, company_id=company_id)
        if mode == "jobs":
            return _synergy_meta_call(
                params, get_company_jobs, company_id=company_id, limit=limit
            )
        return _synergy_meta_call(
            params, get_company_staff, company_id=company_id, limit=limit
        )

    return {
        "status": "error",
        "result": None,
        "error": (
            f"Invalid companies mode: {mode}. Use one of: list, get, jobs, "
            "staff, schema."
        ),
    }


def handle_connect_synergy_webforms(params: Dict[str, Any]) -> Dict[str, Any]:
    """Web forms on a Synergy instance — definitions + fills/submissions (READ ONLY).

    Modes: ``enabled`` (precondition probe), ``definitions`` (form structures
    scoped to a job/task/task-type, or one by id), ``fills`` (submissions scoped
    to a job/file/task with path-paging, a server-side search, one fill by id, or
    a fill's output-file-list). Inferred when omitted: ``fill_id``/``file_id`` ->
    fills; ``definition_id`` -> definitions; ``task_type_id`` -> definitions;
    ``job_id`` alone -> fills; else ``enabled``. WebForm/Definition/Fill shapes
    are [UNKNOWN] → defensive parse + ``raw`` passthrough."""
    mode = str(params.get("mode") or "").strip().lower()
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    task_id = str(params.get("task_id") or "").strip()
    task_type_id = str(params.get("task_type_id") or "").strip()
    file_id = str(params.get("file_id") or "").strip()
    definition_id = str(params.get("definition_id") or "").strip()
    fill_id = str(params.get("fill_id") or "").strip()
    user_id = str(params.get("user_id") or "").strip()
    for label, val in (("task_id", task_id), ("file_id", file_id)):
        if val.startswith(("job:", "folder:")):
            return {
                "status": "error",
                "result": None,
                "error": (
                    f"{label} needs a {label.split('_')[0]} id, not a "
                    f"'{val.split(':', 1)[0]}:' id."
                ),
            }
    for_view = (
        bool(params.get("for_view")) if params.get("for_view") is not None else True
    )
    output_files = bool(params.get("output_files"))
    search = bool(params.get("search"))
    try:
        page = max(1, int(params.get("page") or 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, int(params.get("page_size") or 50))
    except (TypeError, ValueError):
        page_size = 50
    try:
        limit = int(params.get("limit") or 100)
    except (TypeError, ValueError):
        limit = 100

    if not mode:
        if fill_id or file_id:
            mode = "fills"
        elif definition_id:
            mode = "definitions"
        elif task_type_id:
            mode = "definitions"
        elif job_id:
            mode = "fills"
        else:
            mode = "enabled"

    if mode == "enabled":
        return _synergy_meta_call(params, forms_enabled)

    if mode == "definitions":
        if definition_id:
            return _synergy_meta_call(
                params,
                get_form_definition,
                definition_id=definition_id,
                for_view=for_view,
            )
        if not (job_id or task_id or task_type_id):
            return {
                "status": "error",
                "result": None,
                "error": (
                    "definitions mode needs a job_id, task_id, task_type_id, or "
                    "definition_id."
                ),
            }
        return _synergy_meta_call(
            params,
            list_form_definitions,
            job_id=job_id or None,
            task_id=task_id or None,
            task_type_id=task_type_id or None,
        )

    if mode == "fills":
        if fill_id:
            if output_files:
                return _synergy_meta_call(
                    params, get_form_fill_output_files, fill_id=fill_id
                )
            return _synergy_meta_call(params, get_form_fill, fill_id=fill_id)
        if output_files:
            return {
                "status": "error",
                "result": None,
                "error": "output_files needs a fill_id.",
            }
        if search:
            # search_form_fills is a server-side PagedResultModel search bounded by
            # page/page_size — it has no `limit` param (passing one raised TypeError).
            return _synergy_meta_call(
                params,
                search_form_fills,
                page=page,
                page_size=page_size,
            )
        if not (job_id or file_id or task_id):
            return {
                "status": "error",
                "result": None,
                "error": (
                    "fills mode needs a job_id, file_id, task_id, fill_id, or "
                    "search=true."
                ),
            }
        return _synergy_meta_call(
            params,
            list_form_fills,
            job_id=job_id or None,
            file_id=file_id or None,
            task_id=task_id or None,
            user_id=user_id or None,
            page=page,
            page_size=page_size,
            limit=limit,
        )

    return {
        "status": "error",
        "result": None,
        "error": (
            f"Invalid webforms mode: {mode}. Use one of: enabled, definitions, "
            "fills."
        ),
    }


def handle_connect_synergy_job_extras(params: Dict[str, Any]) -> Dict[str, Any]:
    """Heavier job/entity-scoped extras (READ ONLY): Teams, Reports,
    ClashDetection, and job-header reads.

    Required ``section``: ``team`` | ``roles`` | ``reports`` | ``report`` |
    ``report_inputs`` | ``clashes`` | ``clash_items`` | ``clash_report`` |
    ``dashboard`` | ``job-roles`` | ``categories`` | ``job-file-attributes``.
    ``clash_report`` returns a staged BINARY file payload (never inline JSON),
    exactly like the workflow diagram.

    Job-header sections (all ``jobs/{id}/...``, need a ``job_id``):
      - ``dashboard`` — the job's dashboard header.
      - ``job-roles`` — the people in roles ON this job (``users_only`` filters
        to users). NOTE: distinct from ``roles`` (the GLOBAL role-definition
        reference), kept separate so the existing section is unbroken.
      - ``categories`` — the job's categories.
      - ``job-file-attributes`` — the file attributes defined for this job.

    All schemas are [UNKNOWN] → defensive parse + ``raw`` passthrough.
    ``entity_type`` / ``report_type`` enum encodings are UNVERIFIED → passed
    verbatim; a 404 surfaces a clear 'verify encoding' error (no silent retry)."""
    section = str(params.get("section") or "").strip().lower()
    if not section:
        return {
            "status": "error",
            "result": None,
            "error": (
                "Missing section. Use one of: team, roles, reports, report, "
                "report_inputs, clashes, clash_items, clash_report, dashboard, "
                "job-roles, categories, job-file-attributes."
            ),
        }
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    entity_id = str(params.get("entity_id") or "").strip()
    entity_type = str(params.get("entity_type") or "").strip()
    report_type = str(params.get("report_type") or "").strip()
    report_id = str(params.get("report_id") or "").strip()
    folder_id = _bare_synergy_id(params.get("folder_id"), "folder:", "job:")
    clash_id = str(params.get("clash_id") or "").strip()
    report_format = str(params.get("report_format") or "").strip() or "csv"
    delimiter = str(params.get("delimiter") or "").strip() or ","
    users_only = bool(params.get("users_only"))
    try:
        limit = int(params.get("limit") or 200)
    except (TypeError, ValueError):
        limit = 200

    if section == "team":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(params, get_job_team, job_id=job_id)

    if section == "roles":
        return _synergy_meta_call(params, get_role_definitions)

    # Job-header reads (all jobs/{id}/...).
    if section == "dashboard":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(params, get_job_dashboard, job_id=job_id)

    if section == "job-roles":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(
            params, get_job_roles, job_id=job_id, users_only=users_only
        )

    if section == "categories":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(params, get_job_categories, job_id=job_id)

    if section == "job-file-attributes":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(params, get_job_file_attributes, job_id=job_id)

    if section == "reports":
        return _synergy_meta_call(
            params,
            list_entity_reports,
            entity_id=entity_id or None,
            entity_type=entity_type or None,
            report_type=report_type or None,
        )

    if section == "report":
        if not report_id:
            return {"status": "error", "result": None, "error": "Missing report_id"}
        return _synergy_meta_call(params, get_report, report_id=report_id)

    if section == "report_inputs":
        if not report_id:
            return {"status": "error", "result": None, "error": "Missing report_id"}
        return _synergy_meta_call(params, get_report_inputs, report_id=report_id)

    if section == "clashes":
        if not folder_id:
            return {"status": "error", "result": None, "error": "Missing folder_id"}
        return _synergy_meta_call(params, get_clash_details, folder_id=folder_id)

    if section == "clash_items":
        if not clash_id:
            return {"status": "error", "result": None, "error": "Missing clash_id"}
        return _synergy_meta_call(
            params, get_clash_items, clash_id=clash_id, limit=limit
        )

    if section == "clash_report":
        if not clash_id:
            return {"status": "error", "result": None, "error": "Missing clash_id"}
        # Binary clash report — stage via build_download_payload like the workflow
        # diagram, NEVER inline JSON.
        try:
            user_sub = params.get("user_sub", "")
            if not user_sub:
                return {"status": "error", "result": None, "error": "Missing user_sub"}
            creds = get_synergy_credentials(user_sub)
            if not creds:
                return _needs_credential_response("synergy")
            server, token = creds
            content, filename = get_clash_report(
                server,
                token,
                clash_id,
                report_format=report_format,
                delimiter=delimiter,
            )
            if len(content) > MAX_DOWNLOAD_SIZE:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        f"Clash report too large ({len(content) // (1024 * 1024)}MB). "
                        f"Max is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB."
                    ),
                }
            safe_filename = os.path.basename(filename or "")
            safe_filename = re.sub(r"[^\w\s.-]", "_", safe_filename)
            safe_filename = (
                safe_filename.strip(". ")
                or f"synergy_clash_{clash_id[:8]}.{report_format}"
            )
            result: Dict[str, Any] = {
                "section": "clash_report",
                "clash_id": clash_id,
                "report_format": report_format,
                "filename": safe_filename,
                "workspace_path": f"/workdir/uploads/connect-synergy/{safe_filename}",
                "connector": "synergy",
                "size": len(content),
            }
            result.update(
                build_download_payload(content, safe_filename, user_sub, "synergy")
            )
            return {"status": "success", "result": result, "error": None}
        except SynergyAuthError:
            return _needs_credential_response("synergy")
        except (ValueError, httpx.HTTPError) as e:
            return {"status": "error", "result": None, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            logger.error(
                "Error in connect_synergy_job_extras clash_report",
                error=str(e),
                exc_info=True,
            )
            return {"status": "error", "result": None, "error": str(e)}

    return {
        "status": "error",
        "result": None,
        "error": (
            f"Invalid section: {section}. Use one of: team, roles, reports, "
            "report, report_inputs, clashes, clash_items, clash_report, "
            "dashboard, job-roles, categories, job-file-attributes."
        ),
    }


# scope -> target_type enum resolution for the cheap count / single-message
# endpoints, which (unlike the list helpers) have NO scoped convenience path —
# they take a target_type enum directly. The 12d enum ENCODING is [UNKNOWN], so
# we resolve to the canonical type NAME and pass it verbatim (a 404 then surfaces
# the helper's 'verify enum encoding' hint). The list helpers keep handling
# ``scope`` themselves; this map only feeds the count/message URL segment.
_SYNERGY_SCOPE_TO_TYPE = {
    "job": "Job",
    "file": "File",
    "folder": "Folder",
    "project": "12dProject",
}


def handle_connect_synergy_notes(params: Dict[str, Any]) -> Dict[str, Any]:
    """Notes + Associations on any Synergy entity (READ ONLY).

    Two cross-cutting entity-annotation families behind one ``section`` flag:
    ``notes`` (default) and ``associations`` — both keyed by (entity_type enum,
    entity_id). A ``scope`` (job|file|folder|project) routes to a convenience
    path so the caller need not know the type enum. ``count_only`` short-circuits
    to the cheap count endpoint. target_type/expected_type enum encodings are
    [UNKNOWN] → passed verbatim; a 404 surfaces a 'verify enum encoding' error.
    All response shapes are [UNKNOWN] → defensive parse + ``raw`` passthrough."""
    section = str(params.get("section") or "").strip().lower()
    target_id = _bare_synergy_id(params.get("target_id"), "job:", "folder:", "file:")
    if not target_id:
        return {"status": "error", "result": None, "error": "Missing target_id"}
    target_type = str(params.get("target_type") or "").strip()
    scope = str(params.get("scope") or "").strip().lower()
    note_id = str(params.get("note_id") or "").strip()
    expected_type = str(params.get("expected_type") or "").strip()
    include_message = (
        bool(params.get("include_message"))
        if params.get("include_message") is not None
        else True
    )
    count_only = bool(params.get("count_only"))

    if not section:
        section = "associations" if expected_type else "notes"

    # The cheap count + single-message endpoints take a target_type enum and have
    # NO scoped convenience path, so resolve scope -> type here. (The list helpers
    # below still accept ``scope`` directly and need no resolution.)
    resolved_type = target_type or _SYNERGY_SCOPE_TO_TYPE.get(scope, "")

    if section == "notes":
        if count_only:
            if not resolved_type:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        "notes count_only needs a target_type, or a scope "
                        "(job|file|folder|project) to resolve one."
                    ),
                }
            return _synergy_meta_call(
                params,
                get_note_count,
                target_type=resolved_type,
                target_id=target_id,
            )
        if note_id:
            if not resolved_type:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        "fetching a note message needs a target_type, or a scope "
                        "(job|file|folder|project) to resolve one."
                    ),
                }
            return _synergy_meta_call(
                params,
                get_note_message,
                target_type=resolved_type,
                note_id=note_id,
            )
        return _synergy_meta_call(
            params,
            get_entity_notes,
            target_id=target_id,
            target_type=target_type or None,
            scope=scope or None,
            include_message=include_message,
        )

    if section == "associations":
        if count_only:
            if not resolved_type:
                return {
                    "status": "error",
                    "result": None,
                    "error": (
                        "associations count_only needs a target_type, or a scope "
                        "(job|file|folder|project) to resolve one."
                    ),
                }
            return _synergy_meta_call(
                params,
                get_association_count,
                target_id=target_id,
                target_type=resolved_type,
            )
        return _synergy_meta_call(
            params,
            get_entity_associations,
            target_id=target_id,
            target_type=target_type or None,
            scope=scope or None,
            expected_type=expected_type or None,
        )

    return {
        "status": "error",
        "result": None,
        "error": (f"Invalid section: {section}. Use one of: notes, associations."),
    }


def handle_connect_synergy_status(params: Dict[str, Any]) -> Dict[str, Any]:
    """Synergy connection health / identity probe (READ ONLY).

    Combines four diagnostic signals into one verdict: instance reachability
    (no-auth /health), authenticated API version + server id, and PAT liveness +
    days-remaining (auth/getPersonalAccessTokens). ``healthy`` = reachable AND
    pat_valid.

    NOTE: this does NOT use _synergy_meta_call — the health probe must run even
    when the PAT is invalid, and a 401 from getPersonalAccessTokens must yield
    ``pat_valid=false`` in the RESULT (not bubble up as needs_credential), which
    is the whole point of a liveness probe. getVersion/getServerId/PAT bodies are
    [UNKNOWN] → defensive parse, degrade to null + note, never flip healthy on a
    best-effort secondary failure."""
    try:
        user_sub = params.get("user_sub", "")
        if not user_sub:
            return {"status": "error", "result": None, "error": "Missing user_sub"}
        creds = get_synergy_credentials(user_sub)
        if not creds:
            return _needs_credential_response("synergy")
        server, token = creds
        result = get_server_status(server, token)
        return {"status": "success", "result": result, "error": None}
    except (ValueError, httpx.HTTPError) as e:
        return {"status": "error", "result": None, "error": str(e)}
    except Exception as e:  # noqa: BLE001
        logger.error("Error in connect_synergy_status", error=str(e), exc_info=True)
        return {"status": "error", "result": None, "error": str(e)}


def handle_connect_synergy_users(params: Dict[str, Any]) -> Dict[str, Any]:
    """Synergy Users domain (READ ONLY).

    Modes (inferred when omitted): ``lookup`` (one user by id → name/email),
    ``checkouts`` (the CALLER's own active file/folder checkouts within a job —
    NOT an org-wide who-has-it-locked view), ``module`` (whether the caller's PAT
    has access to a named license module). UserModel / CheckOutInfo /
    HasAccessToModule shapes are [UNKNOWN] → defensive parse + ``raw`` passthrough."""
    mode = str(params.get("mode") or "").strip().lower()
    user_id = str(params.get("user_id") or "").strip()
    if user_id.startswith(("job:", "folder:")):
        return {
            "status": "error",
            "result": None,
            "error": (
                "user_id needs a user id (e.g. '8_1'), not a "
                f"'{user_id.split(':', 1)[0]}:' id."
            ),
        }
    job_id = _bare_synergy_id(params.get("job_id"), "job:", "folder:")
    module = str(params.get("module") or "").strip()
    retrieve_attributes = (
        bool(params.get("retrieve_attributes"))
        if params.get("retrieve_attributes") is not None
        else True
    )

    if not mode:
        if user_id:
            mode = "lookup"
        elif job_id:
            mode = "checkouts"
        elif module:
            mode = "module"
        else:
            return {
                "status": "error",
                "result": None,
                "error": (
                    "Provide a user_id (lookup), job_id (checkouts), or module "
                    "(module). Valid modes: lookup, checkouts, module."
                ),
            }

    if mode == "lookup":
        if not user_id:
            return {"status": "error", "result": None, "error": "Missing user_id"}
        return _synergy_meta_call(
            params,
            get_user,
            user_id=user_id,
            retrieve_attributes=retrieve_attributes,
        )

    if mode == "checkouts":
        if not job_id:
            return {"status": "error", "result": None, "error": "Missing job_id"}
        return _synergy_meta_call(params, get_active_checkouts, job_id=job_id)

    if mode == "module":
        if not module:
            return {"status": "error", "result": None, "error": "Missing module"}
        return _synergy_meta_call(params, get_user_module_access, module=module)

    return {
        "status": "error",
        "result": None,
        "error": (
            f"Invalid users mode: {mode}. Use one of: lookup, checkouts, module."
        ),
    }


# ---------------------------------------------------------------------------
# Synergy read-tools — Wave 3 (read-only, PAT-scoped, no Numa ACL, no metering)
# ---------------------------------------------------------------------------


def handle_connect_synergy_resolve(params: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve a pasted 12d link / path into an entity (+ a clickable web URL).

    Turns the kind of reference a user pastes into chat into something the agent
    can act on. Three modes (inferred when ``mode`` omitted):
      - ``link`` — parse a ``synergy://`` / web link into an entity ref, then
        best-effort fetch the canonical web URL for it.
      - ``path`` — find the entity (id + type) for a 12d path string.
      - ``weblink`` — build the canonical web URL for a known entity
        (``entity_id`` + ``entity_type``).

    These hit the admin controller, but every call here is a NON-MUTATING
    link/path lookup — safe and read-only. The admin endpoints' response shapes
    are [UNKNOWN] → defensive parse, degrade with a clear note rather than crash.
    """
    mode = str(params.get("mode") or "").strip().lower()
    link = str(params.get("link") or "").strip()
    path = str(params.get("path") or "").strip()
    entity_id = _bare_synergy_id(params.get("entity_id"), "job:", "folder:")
    entity_type = str(params.get("entity_type") or "").strip()

    # Infer the mode from the supplied params when not explicit.
    if not mode:
        if link:
            mode = "link"
        elif path:
            mode = "path"
        elif entity_id and entity_type:
            mode = "weblink"
        else:
            return {
                "status": "error",
                "result": None,
                "error": (
                    "Provide a link (link mode), a path (path mode), or "
                    "entity_id + entity_type (weblink mode)."
                ),
            }

    if mode == "link":
        if not link:
            return {"status": "error", "result": None, "error": "Missing link"}
        return _synergy_meta_call(params, resolve_synergy_link, link=link)

    if mode == "path":
        if not path:
            return {"status": "error", "result": None, "error": "Missing path"}
        return _synergy_meta_call(params, resolve_synergy_path, path=path)

    if mode == "weblink":
        if not (entity_id and entity_type):
            return {
                "status": "error",
                "result": None,
                "error": "weblink mode needs entity_id and entity_type.",
            }
        return _synergy_meta_call(
            params,
            get_entity_weblink,
            entity_id=entity_id,
            entity_type=entity_type,
        )

    return {
        "status": "error",
        "result": None,
        "error": (f"Invalid resolve mode: {mode}. Use one of: link, path, weblink."),
    }


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
                if auth_scheme.lower() == "access-token":
                    # SENTINEL (Total Synergy): the token rides in a header NAMED
                    # `access-token`, NOT inside Authorization. Emit it as a custom
                    # header and leave Authorization unset.
                    custom_auth_headers = {"access-token": access_token}
                else:
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
