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
from base64 import b64decode
from typing import Any, Dict, List, Optional

import structlog

from oauth_providers import (
    PROVIDERS,
    OAuthAuthenticationError,
    OAuthError,
    create_provider,
)
from prm import client

logger = structlog.get_logger()

# Initialize AWS clients with PRM
secrets_manager = client("secretsmanager")

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
VAULT_SECRETS_PREFIX = os.environ.get("VAULT_SECRETS_PREFIX", f"{CLIENT_NAME}/vault")
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")

# Maximum file download size (50MB)
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024

# Caches with TTL
_available_providers_cache: Optional[tuple[list[str], float]] = None
_company_vault_cache: tuple[dict | None, float] = (None, 0.0)
_CACHE_TTL = 5 * 60  # 5 minutes

FRIENDLY_NAMES = {
    "googledrive": "GoogleDrive",
    "onedrive": "OneDrive",
    "dropbox": "Dropbox",
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


# ---------------------------------------------------------------------------
# Provider discovery and credentials
# ---------------------------------------------------------------------------


def get_available_providers() -> list[str]:
    """Query consolidated COMPANY vault for all configured OAuth providers.

    Returns list of provider IDs (e.g. ['googledrive', 'onedrive', 'dropbox']).
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

        provider_ids = []
        for secret_name in secrets.keys():
            if secret_name.startswith("oauth-client-"):
                provider_ids.append(secret_name.replace("oauth-client-", ""))

        _available_providers_cache = (provider_ids, time.time())
        return provider_ids

    except Exception as e:
        logger.warning(f"Failed to list available OAuth providers: {e}")
        return []


def _get_provider_credentials(provider: str) -> Optional[Dict[str, str]]:
    """Get OAuth client credentials from consolidated COMPANY vault.

    Returns dict with client_id (and optionally client_secret) or None.
    """
    try:
        secrets = _get_consolidated_company_vault()
        if secrets:
            secret_name = f"oauth-client-{provider}"
            entry = secrets.get(secret_name)
            if entry:
                fields = entry.get("fields") or entry
                client_id = fields.get("client_id")
                if client_id:
                    return {
                        "client_id": client_id,
                        "client_secret": fields.get("client_secret", ""),
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
# Token retrieval from consolidated user vault
# ---------------------------------------------------------------------------


async def get_oauth_token(provider: str, user_sub: str) -> Optional[str]:
    """Get valid OAuth access token from consolidated user vault.

    Reads from {CLIENT_NAME}/vault/users/{user_sub},
    looking up secrets["oauth-{provider}"].fields for token data.
    """
    secret_key = f"oauth-{provider}"

    try:
        vault_data = _get_user_consolidated_vault(user_sub)
        if not vault_data:
            logger.info(f"No consolidated vault found for user {user_sub}")
            return None

        secrets = vault_data.get("secrets", {})
        entry = secrets.get(secret_key)
        if not entry:
            logger.info(
                f"No OAuth secret found for {provider} user {user_sub} "
                f'(looked for "{secret_key}" in consolidated vault)'
            )
            return None

        fields = entry.get("fields") or entry
        access_token = fields.get("access_token", "")
        expires_at = fields.get("expires_at", "")

        if not access_token:
            return None

        # Check expiry
        if expires_at:
            from datetime import datetime
            from datetime import timezone as tz

            try:
                expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                now_dt = datetime.now(tz.utc)
                buffer_seconds = 5 * 60  # 5 minutes

                if (expires_dt - now_dt).total_seconds() <= buffer_seconds:
                    logger.warning(
                        f"OAuth token expired for {provider} user {user_sub}"
                    )
                    # TODO: implement token refresh via consolidated vault
                    return None
            except (ValueError, TypeError):
                logger.warning(
                    f"Invalid expires_at format for {provider} user {user_sub}"
                )
                return None

        return access_token

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
                    "file_content": file_content.hex(),
                    "filename": safe_filename,
                    "workspace_path": workspace_path,
                    "provider": provider,
                    "original_file_id": file_id,
                    "size": len(file_content),
                }

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
