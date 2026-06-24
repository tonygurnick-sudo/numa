"""OAuth tools for workspace agent integration.

Uses consolidated Secrets Manager vaults:
  - COMPANY config:  {CLIENT_NAME}/vault/company  -> secrets["oauth-client-{provider}"].fields
  - User tokens:     {CLIENT_NAME}/vault/users/{user_sub} -> secrets["oauth-{provider}"].fields
"""

import asyncio
import gzip
import json
import os
import time
import uuid
from base64 import b64decode
from typing import Any, Dict, List, Optional, Tuple

import structlog

from oauth_providers import (
    PROVIDERS,
    OAuthAuthenticationError,
    OAuthError,
    create_provider,
)
from prm import client

from .file_transfer import (  # noqa: F401  (re-exported for connect_tools)
    OAUTH_INLINE_MAX,
    OAUTH_PRESIGNED_EXPIRY,
    OUTPUTS_BUCKET,
    build_download_payload,
    stage_download_to_s3,
)

logger = structlog.get_logger()

# Initialize AWS clients with PRM
secrets_manager = client("secretsmanager")

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
VAULT_SECRETS_PREFIX = os.environ.get("VAULT_SECRETS_PREFIX", f"{CLIENT_NAME}/vault")
# OUTPUTS_BUCKET is imported from file_transfer (shared staging bucket).
VAULT_AUDIT_LOG_TABLE_NAME = os.environ.get("VAULT_AUDIT_LOG_TABLE_NAME", "")

# Audit dedup: a chat turn that calls Gmail 20 times shouldn't write 20 audit
# rows. Track last write per (user, secret) and skip if within window.
# Module-level so it survives across calls within the same Lambda container.
# Cold starts will re-audit — acceptable trade for visibility (TASK-146).
_LAST_OAUTH_AUDIT_TS: Dict[Tuple[str, str], float] = {}
_OAUTH_AUDIT_DEDUP_SECONDS = 60

# Maximum file download size (50MB)
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024

# Inline-vs-S3 staging (OAUTH_INLINE_MAX / OAUTH_PRESIGNED_EXPIRY) and the
# stage_download_to_s3 helper now live in file_transfer.py and are shared with
# connect_tools.py — see imports above.

# Caches with TTL
_available_providers_cache: Optional[tuple[list[str], float]] = None
_company_vault_cache: tuple[dict | None, float] = (None, 0.0)
_CACHE_TTL = 5 * 60  # 5 minutes

FRIENDLY_NAMES = {
    "googledrive": "GoogleDrive",
    "onedrive": "OneDrive",
    "dropbox": "Dropbox",
}

# Fallback token URLs for token refresh
FALLBACK_TOKEN_URLS = {
    "googledrive": "https://oauth2.googleapis.com/token",
    "gmail": "https://oauth2.googleapis.com/token",
    "onedrive": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "dropbox": "https://api.dropboxapi.com/oauth2/token",
}

# Platform connectors sharing a single OAuth client
_OAUTH_PLATFORM_MAP: dict[str, str] = {
    "gmail": "google",
    "googledrive": "google",
    "onedrive": "microsoft",
}


# ---------------------------------------------------------------------------
# Consolidated vault helpers
# ---------------------------------------------------------------------------


def _read_sm_secret(secret_id: str) -> dict | None:
    """Read and parse a Secrets Manager secret, handling gzip compression."""
    try:
        response = secrets_manager.get_secret_value(SecretId=secret_id)
        if not response.get("SecretString"):
            return None

        data = json.loads(response["SecretString"])

        if data.get("_compressed") and data.get("_data"):
            compressed_bytes = b64decode(data["_data"])
            decompressed = gzip.decompress(compressed_bytes).decode("utf-8")
            data = json.loads(decompressed)

        return data
    except Exception as e:
        if "ResourceNotFoundException" in str(
            type(e).__name__
        ) or "ResourceNotFoundException" in str(e):
            return None
        logger.warning(f"Failed to read secret {secret_id}", extra={"error": str(e)})
        return None


def _get_consolidated_company_vault() -> dict | None:
    """Read consolidated COMPANY vault from {CLIENT_NAME}/vault/company. Cached 5 min."""
    global _company_vault_cache
    cached_data, fetched_at = _company_vault_cache
    if cached_data is not None and time.time() - fetched_at < _CACHE_TTL:
        return cached_data

    vault_data = _read_sm_secret(f"{CLIENT_NAME}/vault/company")
    if not vault_data:
        return None

    secrets = vault_data.get("secrets", {})
    _company_vault_cache = (secrets, time.time())
    return secrets


def _get_user_consolidated_vault(user_id: str) -> dict | None:
    """Read user's consolidated vault from {CLIENT_NAME}/vault/users/{user_id}."""
    return _read_sm_secret(f"{CLIENT_NAME}/vault/users/{user_id}")


def _put_user_consolidated_vault(user_id: str, vault_data: dict) -> bool:
    """Write a user's consolidated vault back to Secrets Manager."""
    vault_secret_name = f"{CLIENT_NAME}/vault/users/{user_id}"
    json_str = json.dumps(vault_data)

    try:
        try:
            secrets_manager.put_secret_value(
                SecretId=vault_secret_name,
                SecretString=json_str,
            )
        except Exception as e:
            if "ResourceNotFoundException" in str(
                type(e).__name__
            ) or "ResourceNotFoundException" in str(e):
                secrets_manager.create_secret(
                    Name=vault_secret_name,
                    SecretString=json_str,
                    Description=f"Consolidated vault for user {user_id}",
                )
            else:
                raise
        return True
    except Exception as e:
        logger.error(
            f"Failed to write user vault for {user_id}", extra={"error": str(e)}
        )
        return False


# ---------------------------------------------------------------------------
# Provider discovery and credentials
# ---------------------------------------------------------------------------


def get_available_providers() -> list[str]:
    """Query consolidated COMPANY vault for all configured OAuth providers.

    Returns list of individual connector IDs (e.g. ['googledrive', 'gmail', 'onedrive']).
    Platform secrets like 'oauth-client-google' are expanded into individual connectors
    using the 'enabled_connectors' field (e.g. 'googledrive,gmail').
    Also includes 'connector-*' secrets (token/API-key connectors like Synergy).
    Uses an in-memory cache with 5-min TTL.
    """
    global _available_providers_cache
    if _available_providers_cache:
        providers, fetched_at = _available_providers_cache
        if time.time() - fetched_at < _CACHE_TTL:
            return providers

    try:
        secrets = _get_consolidated_company_vault()
        if not secrets:
            return []

        provider_ids: list[str] = []
        seen: set[str] = set()

        def _add(connector_id: str) -> None:
            if connector_id and connector_id not in seen:
                seen.add(connector_id)
                provider_ids.append(connector_id)

        for secret_name, entry in secrets.items():
            if secret_name.startswith("oauth-client-"):
                fields = (
                    (entry.get("fields") or entry) if isinstance(entry, dict) else {}
                )
                enabled = fields.get("enabled_connectors", "")
                if enabled:
                    for connector_id in enabled.split(","):
                        _add(connector_id.strip())
                else:
                    _add(secret_name.replace("oauth-client-", ""))
            elif secret_name.startswith("connector-config-"):
                _add(secret_name.replace("connector-config-", ""))
            elif secret_name.startswith("connector-"):
                _add(secret_name.replace("connector-", ""))

        _available_providers_cache = (provider_ids, time.time())
        return provider_ids

    except Exception as e:
        logger.warning(f"Failed to list available OAuth providers: {e}")
        return []


def _get_provider_credentials(provider: str) -> Optional[Dict[str, str]]:
    """Get OAuth client credentials from consolidated COMPANY vault.

    Handles platform mapping: connector IDs like 'googledrive' or 'gmail'
    map to platform secret 'oauth-client-google'. Also checks 'connector-*'
    for token/API-key connectors.

    Returns dict with client_id (and optionally client_secret) or None.
    """
    # Platform mapping: connector ID → platform secret name
    _platform_map: dict[str, str] = {
        "gmail": "google",
        "googledrive": "google",
        "onedrive": "microsoft",
    }

    try:
        secrets = _get_consolidated_company_vault()
        if secrets:
            # Try direct match first, then platform mapping.
            # Prefer connector-config-{id} (new metadata-only) over connector-{id}
            # (legacy may hold credentials that were wrongly admin-entered).
            platform = _platform_map.get(provider, provider)
            for candidate in [
                f"oauth-client-{provider}",
                f"oauth-client-{platform}",
                f"connector-config-{provider}",
                f"connector-{provider}",
            ]:
                entry = secrets.get(candidate)
                if not entry:
                    continue
                fields = entry.get("fields") or entry
                client_id = fields.get("client_id")
                instance_url = fields.get("instance_url")
                if client_id or instance_url:
                    return {
                        "client_id": client_id or "",
                        "client_secret": fields.get("client_secret", ""),
                        "instance_url": instance_url or "",
                    }
    except Exception as e:
        logger.warning(f"Failed to get COMPANY credentials for {provider}: {e}")

    # Fallback to env vars
    client_id = os.environ.get(f"{provider.upper()}_CLIENT_ID")
    if client_id:
        return {
            "client_id": client_id,
            "client_secret": os.environ.get(f"{provider.upper()}_CLIENT_SECRET", ""),
        }

    return None


def _get_friendly_secret_name(provider: str) -> str:
    """Map provider ID to user-friendly vault secret name."""
    return FRIENDLY_NAMES.get(provider, provider.capitalize())


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------


async def _refresh_access_token(provider: str, refresh_token: str) -> Optional[dict]:
    """Refresh an OAuth access token using the refresh token.

    Reads client credentials from COMPANY vault (via _get_provider_credentials).
    Falls back to FALLBACK_TOKEN_URLS for the token endpoint.
    Returns the new token data dict or None.
    """
    import httpx

    creds = _get_provider_credentials(provider)
    if not creds or not creds.get("client_id"):
        logger.error(f"No client credentials found for token refresh: {provider}")
        return None

    # Resolve token URL: prefer vault config, fall back to hardcoded
    platform = _OAUTH_PLATFORM_MAP.get(provider, provider)
    token_url = FALLBACK_TOKEN_URLS.get(provider)

    # Also check company vault for a token_url field
    secrets = _get_consolidated_company_vault()
    if secrets:
        for candidate in [
            f"oauth-client-{provider}",
            f"oauth-client-{platform}",
        ]:
            entry = secrets.get(candidate)
            if entry:
                fields = entry.get("fields") or entry
                if fields.get("token_url"):
                    token_url = fields["token_url"]
                    break

    if not token_url:
        logger.error(f"No token URL available for refresh: {provider}")
        return None

    # ── Total Synergy adapter: vendor-custom refresh body + response casing ──
    # The company vault entry carries oauth_adapter='totalsynergy' (persisted by
    # the OAuth wizard from the registry). Synergy's refresh lives on
    # .../Oauth2/RefreshAccessToken with applicationKey/ApplicationSecret/
    # refreshToken/grant_type=authorization_code and returns custom-cased fields.
    adapter = ""
    if secrets:
        for candidate in (f"oauth-client-{provider}", f"oauth-client-{platform}"):
            entry = secrets.get(candidate)
            if entry:
                fields = entry.get("fields") or entry
                adapter = str(fields.get("oauth_adapter") or "").strip()
                if adapter:
                    break

    if adapter == "totalsynergy":
        import re as _re

        refresh_url = _re.sub(r"GetAccessToken$", "RefreshAccessToken", token_url)
        ts_params = {
            "applicationKey": creds["client_id"],
            "ApplicationSecret": creds.get("client_secret", ""),
            "refreshToken": refresh_token,
            "grant_type": "authorization_code",
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as http_client:
                ts_response = await http_client.post(
                    refresh_url,
                    data=ts_params,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "application/json",
                    },
                )
            if ts_response.status_code == 200:
                raw = ts_response.json()
                access = raw.get("accessToken") or raw.get("access_token") or ""
                if not access:
                    logger.warning(
                        f"Total Synergy refresh returned no access token for {provider}"
                    )
                    return None
                # Normalise to the snake_case shape get_oauth_token expects.
                # Coerce expires_in to int: Synergy is a form-style API and may
                # return the TTL as a string ("3600"); get_oauth_token does
                # `now + expires_in`, which raises TypeError on a str and would
                # silently turn a successful refresh into a failure.
                _exp_raw = raw.get("expiresIn")
                if _exp_raw is None:
                    _exp_raw = raw.get("expires_in")
                try:
                    _expires_in = int(_exp_raw)
                except (TypeError, ValueError):
                    _expires_in = 3600
                return {
                    "access_token": access,
                    "refresh_token": (
                        raw.get("refreshToken")
                        or raw.get("refresh_token")
                        or refresh_token
                    ),
                    "expires_in": _expires_in,
                }
            logger.warning(
                f"Total Synergy token refresh failed for {provider}",
                extra={
                    "status_code": ts_response.status_code,
                    "response": ts_response.text[:500],
                },
            )
            return None
        except Exception as e:
            logger.error(
                f"Total Synergy refresh request failed for {provider}",
                extra={"error": str(e)},
            )
            return None

    params = {
        "grant_type": "refresh_token",
        "client_id": creds["client_id"],
        "refresh_token": refresh_token,
    }
    if creds.get("client_secret"):
        params["client_secret"] = creds["client_secret"]

    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            response = await http_client.post(
                token_url,
                data=params,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Accept": "application/json",
                },
            )

            if response.status_code == 200:
                logger.info(f"Token refresh succeeded for {provider}")
                return response.json()
            else:
                logger.warning(
                    f"Token refresh failed for {provider}",
                    extra={
                        "status_code": response.status_code,
                        "response": response.text[:500],
                    },
                )
                return None

    except Exception as e:
        logger.error(
            f"Token refresh request failed for {provider}", extra={"error": str(e)}
        )
        return None


# ---------------------------------------------------------------------------
# Token retrieval from consolidated user vault
# ---------------------------------------------------------------------------


def _audit_oauth_fetch(user_sub: str, secret_name: str, provider: str) -> None:
    """Write an ai_access audit row for a chat OAuth token fetch.

    Connector tools historically pulled OAuth tokens straight from the vault
    with no audit trail. This records each fetch as ai_access so the user's
    "My Secrets > Activity" view reflects chat usage. Deduped within
    `_OAUTH_AUDIT_DEDUP_SECONDS` per (user, secret) to avoid spamming for
    chat sessions that call the same connector many times in a row.

    `accessor="workspace_agent"` lets the frontend recognise this row as
    chat-driven and label it "Numa chat" instead of resolving against the
    user list.
    """
    if not VAULT_AUDIT_LOG_TABLE_NAME:
        return

    key = (user_sub, secret_name)
    now = time.time()
    last = _LAST_OAUTH_AUDIT_TS.get(key, 0.0)
    if now - last < _OAUTH_AUDIT_DEDUP_SECONDS:
        return
    _LAST_OAUTH_AUDIT_TS[key] = now

    try:
        dynamodb = client("dynamodb")
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
            "purpose": f"Connector OAuth fetch: {provider}",
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
            "Failed to write OAuth audit log",
            user_sub=user_sub,
            secret_name=secret_name,
            error=str(e),
        )


async def get_oauth_token(provider: str, user_sub: str) -> Optional[str]:
    """Get valid OAuth access token from consolidated user vault.

    Reads from {CLIENT_NAME}/vault/users/{user_sub},
    looking up secrets["oauth-{provider}"].fields for token data.
    Automatically refreshes expired tokens using the refresh token.

    Resolution order — new location wins:
      1. connector-{provider}  — PAT/API key (new flow). Truth for PAT
         connectors. Returned as-is; no refresh.
      2. oauth-{provider}      — OAuth tokens OR legacy single-token PAT
         entries written by the pre-split Files > Remote Connect modal.
         Refreshed if expired.

    Reading connector-{provider} first means a user with both entries
    (transitioning from the legacy flow) always gets the fresh PAT, not
    the stale oauth-{provider} leftover.
    """
    from datetime import datetime
    from datetime import timezone as tz

    try:
        vault_data = _get_user_consolidated_vault(user_sub)
        if not vault_data:
            logger.info(f"No consolidated vault found for user {user_sub}")
            return None

        secrets = vault_data.get("secrets", {})

        # Preferred location: connector-{provider} (new PAT flow).
        connector_entry = secrets.get(f"connector-{provider}")
        if connector_entry:
            cfields = connector_entry.get("fields") or connector_entry
            if isinstance(cfields, dict):
                for k in ("api_key", "bearer_token", "access_token", "token"):
                    v = cfields.get(k)
                    if v:
                        _audit_oauth_fetch(user_sub, f"connector-{provider}", provider)
                        return str(v)

        # Fallback: oauth-{provider} (OAuth tokens, or legacy single-token PAT).
        secret_key = f"oauth-{provider}"
        entry = secrets.get(secret_key)
        if not entry:
            logger.info(
                f"No credential found for {provider} user {user_sub} "
                f'(looked for "connector-{provider}" / "{secret_key}" in consolidated vault)'
            )
            return None

        fields = entry.get("fields") or entry
        access_token = fields.get("access_token", "")
        refresh_token = fields.get("refresh_token", "")
        expires_at = fields.get("expires_at", "")

        if not access_token:
            return None

        # Check expiry
        token_expired = False
        if expires_at:
            try:
                expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                now_dt = datetime.now(tz.utc)
                buffer_seconds = 5 * 60  # 5 minutes
                token_expired = (expires_dt - now_dt).total_seconds() <= buffer_seconds
            except (ValueError, TypeError):
                logger.warning(
                    f"Invalid expires_at format for {provider} user {user_sub}"
                )
                token_expired = True

        # Return immediately if token is still valid
        if not token_expired:
            _audit_oauth_fetch(user_sub, secret_key, provider)
            return access_token

        # Token expired — attempt refresh
        if not refresh_token:
            logger.warning(
                f"OAuth token expired for {provider} user {user_sub} "
                "and no refresh_token available"
            )
            return None

        logger.info(f"Refreshing expired OAuth token for {provider} user {user_sub}")
        new_token_data = await _refresh_access_token(provider, refresh_token)

        if not new_token_data:
            logger.warning(f"Token refresh failed for {provider} user {user_sub}")
            return None

        # Update fields with new token data
        new_access_token = new_token_data.get("access_token", "")
        new_refresh_token = new_token_data.get("refresh_token", refresh_token)
        expires_in = new_token_data.get("expires_in", 3600)
        new_expires_at = datetime.fromtimestamp(
            datetime.now(tz.utc).timestamp() + expires_in, tz.utc
        ).isoformat()

        fields["access_token"] = new_access_token
        fields["refresh_token"] = new_refresh_token
        fields["expires_at"] = new_expires_at

        # Write updated token back to vault
        now = datetime.now(tz.utc).isoformat()
        entry["fields"] = fields
        if "metadata" in entry:
            entry["metadata"]["updated_at"] = now
        secrets[secret_key] = entry
        vault_data["secrets"] = secrets
        if "metadata" in vault_data:
            vault_data["metadata"]["updated_at"] = now

        if _put_user_consolidated_vault(user_sub, vault_data):
            logger.info(
                f"Successfully refreshed OAuth token for {provider} user {user_sub}"
            )
            _audit_oauth_fetch(user_sub, secret_key, provider)
            return new_access_token
        else:
            logger.error(
                f"Failed to persist refreshed token for {provider} user {user_sub}"
            )
            # Still return the token — it's valid even if persistence failed
            return new_access_token

    except Exception as e:
        logger.warning(f"Failed to get OAuth token for {provider} user {user_sub}: {e}")
        return None


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------


def handle_oauth_list_files(params: Dict[str, Any]) -> Dict[str, Any]:
    """List files and folders from OAuth provider."""
    try:
        provider = params.get("provider", "").strip()
        folder_id = params.get("folder_id")
        page_size = int(params.get("page_size", 100))
        page_token = params.get("page_token")
        user_sub = params.get("user_sub", "")

        if not provider:
            return {
                "status": "error",
                "result": None,
                "error": "Missing provider parameter",
            }

        if provider not in PROVIDERS:
            available = get_available_providers()
            if provider in available:
                return {
                    "status": "error",
                    "result": None,
                    "error": f"File browsing not available for {provider}. OAuth tokens work but no file provider implementation exists.",
                }
            return {
                "status": "error",
                "result": None,
                "error": f"Unknown provider: {provider}. Use oauth_connection_status to see available providers.",
            }

        if not user_sub:
            return {
                "status": "error",
                "result": None,
                "error": "Missing user_sub parameter",
            }

        creds = _get_provider_credentials(provider)
        if not creds:
            return {
                "status": "error",
                "result": None,
                "error": f"OAuth not configured for {provider}",
            }
        client_id = creds["client_id"]

        async def list_files_async():
            access_token = await get_oauth_token(provider, user_sub)
            if not access_token:
                return {
                    "status": "error",
                    "result": None,
                    "error": f"No valid OAuth token for {provider}. Please reconnect your account.",
                }

            oauth_provider = create_provider(provider, client_id)
            try:
                contents = await oauth_provider.list_files(
                    access_token=access_token,
                    folder_id=folder_id,
                    page_size=min(page_size, 100),
                    page_token=page_token,
                )

                result = {
                    "folders": [
                        {
                            "folder_id": folder.folder_id,
                            "name": folder.name,
                            "parent_id": folder.parent_id,
                            "path": folder.path,
                            "has_subfolders": folder.has_subfolders,
                            "no_of_subfolders": folder.no_of_subfolders,
                        }
                        for folder in contents.folders
                    ],
                    "files": [
                        {
                            "file_id": file.file_id,
                            "name": file.name,
                            "is_folder": file.is_folder,
                            "path": file.path,
                            "size": file.size,
                            "content_type": file.content_type,
                            "parent_id": file.parent_id,
                            "modified_at": file.modified_at,
                            "created_at": file.created_at,
                            "web_view_link": file.web_view_link,
                        }
                        for file in contents.files
                    ],
                    "total_count": contents.total_count,
                    "next_page_token": contents.next_page_token,
                    "provider": provider,
                }

                return {"status": "success", "result": result, "error": None}
            finally:
                await oauth_provider.close()

        return asyncio.run(list_files_async())

    except OAuthAuthenticationError as e:
        logger.error(f"OAuth authentication error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Authentication failed: {str(e)}. Please reconnect your {provider} account.",
        }
    except OAuthError as e:
        logger.error(f"OAuth error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"OAuth provider error: {str(e)}",
        }
    except Exception as e:
        logger.error(f"Unexpected error in oauth_list_files: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Failed to list files: {str(e)}",
        }


def handle_oauth_download_file(params: Dict[str, Any]) -> Dict[str, Any]:
    """Download file from OAuth provider to workspace."""
    try:
        provider = params.get("provider", "").strip()
        file_id = params.get("file_id", "").strip()
        filename = params.get("filename", "").strip()
        user_sub = params.get("user_sub", "")

        if not provider or provider not in PROVIDERS:
            return {
                "status": "error",
                "result": None,
                "error": f"Invalid or unsupported provider: {provider}. Use oauth_connection_status to see available providers.",
            }

        if not file_id:
            return {
                "status": "error",
                "result": None,
                "error": "Missing file_id parameter",
            }

        if not user_sub:
            return {
                "status": "error",
                "result": None,
                "error": "Missing user_sub parameter",
            }

        creds = _get_provider_credentials(provider)
        if not creds:
            return {
                "status": "error",
                "result": None,
                "error": f"OAuth not configured for {provider}",
            }
        client_id = creds["client_id"]

        async def download_file_async():
            access_token = await get_oauth_token(provider, user_sub)
            if not access_token:
                return {
                    "status": "error",
                    "result": None,
                    "error": f"No valid OAuth token for {provider}. Please reconnect your account.",
                }

            oauth_provider = create_provider(provider, client_id)
            try:
                # Check file size before downloading
                metadata = None
                try:
                    metadata = await oauth_provider.get_file_metadata(
                        access_token, file_id
                    )
                    if metadata.size and metadata.size > MAX_DOWNLOAD_SIZE:
                        return {
                            "status": "error",
                            "result": None,
                            "error": f"File too large ({metadata.size // (1024 * 1024)}MB). Maximum download size is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB.",
                        }
                except Exception:
                    pass

                file_content = await oauth_provider.download_file(access_token, file_id)

                if len(file_content) > MAX_DOWNLOAD_SIZE:
                    return {
                        "status": "error",
                        "result": None,
                        "error": f"Downloaded file too large ({len(file_content) // (1024 * 1024)}MB). Maximum download size is {MAX_DOWNLOAD_SIZE // (1024 * 1024)}MB.",
                    }

                nonlocal filename
                if not filename:
                    if metadata and metadata.name:
                        filename = metadata.name
                    else:
                        try:
                            metadata = await oauth_provider.get_file_metadata(
                                access_token, file_id
                            )
                            filename = metadata.name
                        except Exception:
                            filename = (
                                file_id.split("/")[-1] if "/" in file_id else file_id
                            )

                import re

                safe_filename = os.path.basename(filename)
                safe_filename = re.sub(r"[^\w\s.-]", "_", safe_filename)
                safe_filename = safe_filename.strip(". ")
                if not safe_filename:
                    safe_filename = f"download_{file_id[:8]}"
                if len(safe_filename) > 255:
                    safe_filename = safe_filename[:255]

                workspace_path = f"/workdir/uploads/oauth-{provider}/{safe_filename}"

                result = {
                    "filename": safe_filename,
                    "workspace_path": workspace_path,
                    "provider": provider,
                    "original_file_id": file_id,
                    "size": len(file_content),
                }

                # Small files stay inline as hex (fast path, backward compatible
                # with older workspace-agent readers). Larger files are staged to
                # S3 and returned as a presigned URL so they survive the 6 MB
                # Lambda response cap without truncation/corruption.
                result.update(
                    build_download_payload(
                        file_content, safe_filename, user_sub, provider
                    )
                )

                return {"status": "success", "result": result, "error": None}
            finally:
                await oauth_provider.close()

        return asyncio.run(download_file_async())

    except OAuthAuthenticationError as e:
        logger.error(f"OAuth authentication error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Authentication failed: {str(e)}. Please reconnect your {provider} account.",
        }
    except OAuthError as e:
        logger.error(f"OAuth error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"OAuth provider error: {str(e)}",
        }
    except Exception as e:
        logger.error(f"Unexpected error in oauth_download_file: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Failed to download file: {str(e)}",
        }


def handle_oauth_search_files(params: Dict[str, Any]) -> Dict[str, Any]:
    """Search files in OAuth provider."""
    try:
        provider = params.get("provider", "").strip()
        query = params.get("query", "").strip()
        folder_id = params.get("folder_id")
        page_size = int(params.get("page_size", 100))
        page_token = params.get("page_token")
        user_sub = params.get("user_sub", "")

        if not provider or provider not in PROVIDERS:
            return {
                "status": "error",
                "result": None,
                "error": f"Invalid or unsupported provider: {provider}. Use oauth_connection_status to see available providers.",
            }

        if not query:
            return {
                "status": "error",
                "result": None,
                "error": "Missing query parameter",
            }

        if not user_sub:
            return {
                "status": "error",
                "result": None,
                "error": "Missing user_sub parameter",
            }

        creds = _get_provider_credentials(provider)
        if not creds:
            return {
                "status": "error",
                "result": None,
                "error": f"OAuth not configured for {provider}",
            }
        client_id = creds["client_id"]

        async def search_files_async():
            access_token = await get_oauth_token(provider, user_sub)
            if not access_token:
                return {
                    "status": "error",
                    "result": None,
                    "error": f"No valid OAuth token for {provider}. Please reconnect your account.",
                }

            oauth_provider = create_provider(provider, client_id)
            try:
                results = await oauth_provider.search_files(
                    access_token=access_token,
                    query=query,
                    folder_id=folder_id,
                    page_size=min(page_size, 100),
                    page_token=page_token,
                )

                result = {
                    "folders": [
                        {
                            "folder_id": folder.folder_id,
                            "name": folder.name,
                            "parent_id": folder.parent_id,
                            "path": folder.path,
                            "has_subfolders": folder.has_subfolders,
                            "no_of_subfolders": folder.no_of_subfolders,
                        }
                        for folder in results.folders
                    ],
                    "files": [
                        {
                            "file_id": file.file_id,
                            "name": file.name,
                            "is_folder": file.is_folder,
                            "path": file.path,
                            "size": file.size,
                            "content_type": file.content_type,
                            "parent_id": file.parent_id,
                            "modified_at": file.modified_at,
                            "created_at": file.created_at,
                            "web_view_link": file.web_view_link,
                        }
                        for file in results.files
                    ],
                    "total_count": results.total_count,
                    "next_page_token": results.next_page_token,
                    "provider": provider,
                    "query": query,
                }

                return {"status": "success", "result": result, "error": None}
            finally:
                await oauth_provider.close()

        return asyncio.run(search_files_async())

    except OAuthAuthenticationError as e:
        logger.error(f"OAuth authentication error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Authentication failed: {str(e)}. Please reconnect your {provider} account.",
        }
    except OAuthError as e:
        logger.error(f"OAuth error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"OAuth provider error: {str(e)}",
        }
    except Exception as e:
        logger.error(f"Unexpected error in oauth_search_files: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Failed to search files: {str(e)}",
        }


def handle_oauth_get_file_metadata(params: Dict[str, Any]) -> Dict[str, Any]:
    """Get detailed metadata for a file from OAuth provider."""
    try:
        provider = params.get("provider", "").strip()
        file_id = params.get("file_id", "").strip()
        user_sub = params.get("user_sub", "")

        if not provider or provider not in PROVIDERS:
            return {
                "status": "error",
                "result": None,
                "error": f"Invalid or unsupported provider: {provider}. Use oauth_connection_status to see available providers.",
            }

        if not file_id:
            return {
                "status": "error",
                "result": None,
                "error": "Missing file_id parameter",
            }

        if not user_sub:
            return {
                "status": "error",
                "result": None,
                "error": "Missing user_sub parameter",
            }

        creds = _get_provider_credentials(provider)
        if not creds:
            return {
                "status": "error",
                "result": None,
                "error": f"OAuth not configured for {provider}",
            }
        client_id = creds["client_id"]

        async def get_metadata_async():
            access_token = await get_oauth_token(provider, user_sub)
            if not access_token:
                return {
                    "status": "error",
                    "result": None,
                    "error": f"No valid OAuth token for {provider}. Please reconnect your account.",
                }

            oauth_provider = create_provider(provider, client_id)
            try:
                metadata = await oauth_provider.get_file_metadata(access_token, file_id)

                result = {
                    "file_id": metadata.file_id,
                    "name": metadata.name,
                    "size": metadata.size,
                    "content_type": metadata.content_type,
                    "modified_at": metadata.modified_at,
                    "created_at": metadata.created_at,
                    "parent_id": metadata.parent_id,
                    "path": metadata.path,
                    "checksum": metadata.checksum,
                    "version": metadata.version,
                    "permissions": metadata.permissions,
                    "provider": provider,
                }

                return {"status": "success", "result": result, "error": None}
            finally:
                await oauth_provider.close()

        return asyncio.run(get_metadata_async())

    except OAuthAuthenticationError as e:
        logger.error(f"OAuth authentication error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Authentication failed: {str(e)}. Please reconnect your {provider} account.",
        }
    except OAuthError as e:
        logger.error(f"OAuth error: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"OAuth provider error: {str(e)}",
        }
    except Exception as e:
        logger.error(f"Unexpected error in oauth_get_file_metadata: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Failed to get file metadata: {str(e)}",
        }


def handle_oauth_connection_status(params: Dict[str, Any]) -> Dict[str, Any]:
    """Check OAuth connection status for all or specific providers.

    Reads from consolidated user vault to check for valid tokens.
    """
    try:
        provider = params.get("provider", "").strip()
        user_sub = params.get("user_sub", "")

        if not user_sub:
            return {
                "status": "error",
                "result": None,
                "error": "Missing user_sub parameter",
            }

        # Determine which providers to check
        if provider:
            providers_to_check = [provider]
        else:
            providers_to_check = get_available_providers()
            if not providers_to_check:
                return {"status": "success", "result": {}, "error": None}

        # Read user vault once for all provider checks
        vault_data = _get_user_consolidated_vault(user_sub)
        user_secrets = vault_data.get("secrets", {}) if vault_data else {}

        result = {}
        for prov in providers_to_check:
            try:
                secret_key = f"oauth-{prov}"
                entry = user_secrets.get(secret_key)

                if entry:
                    fields = entry.get("fields") or entry
                    access_token = fields.get("access_token", "")

                    if access_token:
                        result[prov] = {
                            "status": "connected",
                            "user_email": fields.get("user_email"),
                            "connected_at": fields.get("connected_at"),
                            "expires_at": fields.get("expires_at"),
                        }
                    else:
                        result[prov] = {"status": "disconnected"}
                else:
                    result[prov] = {"status": "disconnected"}

            except Exception as e:
                logger.warning(f"Error checking {prov} status: {e}")
                result[prov] = {"status": "error", "error": str(e)}

        return {"status": "success", "result": result, "error": None}

    except Exception as e:
        logger.error(f"Unexpected error in oauth_connection_status: {e}")
        return {
            "status": "error",
            "result": None,
            "error": f"Failed to check connection status: {str(e)}",
        }
