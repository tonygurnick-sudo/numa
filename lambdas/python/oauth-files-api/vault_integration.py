"""Vault integration for OAuth token management.

Reads from consolidated Secrets Manager vaults:
  - COMPANY config:  {CLIENT_NAME}/vault/company  -> secrets["oauth-client-{provider}"].fields
  - User tokens:     {CLIENT_NAME}/vault/users/{user_sub} -> secrets["oauth-{provider}"].fields
"""

from __future__ import annotations

import gzip
import json
import os
import time
from base64 import b64decode
from datetime import datetime, timezone
from typing import Optional

import structlog

from prm import client

logger = structlog.get_logger()

# Initialize AWS clients with PRM
secrets_manager = client("secretsmanager")

VAULT_SECRETS_PREFIX = os.environ.get("VAULT_SECRETS_PREFIX", "numa-demo/vault")
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")

# Fallback token URLs for backward compatibility
FALLBACK_TOKEN_URLS = {
    "googledrive": "https://oauth2.googleapis.com/token",
    "onedrive": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "dropbox": "https://api.dropboxapi.com/oauth2/token",
}

# In-memory caches with TTL
_company_config_cache: dict[str, tuple[dict, float]] = {}
_company_vault_cache: tuple[dict | None, float] = (None, 0.0)
_CACHE_TTL = 5 * 60  # 5 minutes


class VaultOAuthSecret:
    """OAuth secret stored in vault."""

    def __init__(self, data: dict):
        self.provider = data.get("provider", "")
        self.access_token = data.get("access_token", "")
        self.refresh_token = data.get("refresh_token", "")
        self.expires_at = data.get("expires_at", "")
        self.user_email = data.get("user_email", "")
        self.scope = data.get("scope", "")
        self.connected_at = data.get("connected_at", "")

    @property
    def is_expired(self) -> bool:
        """Check if access token is expired or expires within 5 minutes."""
        if not self.expires_at:
            return True

        try:
            expires_dt = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
            now_dt = datetime.now(timezone.utc)
            buffer_seconds = 5 * 60  # 5 minutes

            return (expires_dt - now_dt).total_seconds() <= buffer_seconds
        except (ValueError, TypeError):
            return True

    @property
    def is_valid(self) -> bool:
        """Check if secret has required fields and valid token."""
        return bool(self.access_token and self.provider and not self.is_expired)

    def to_dict(self) -> dict:
        """Convert to dictionary for storage."""
        return {
            "provider": self.provider,
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "user_email": self.user_email,
            "scope": self.scope,
            "connected_at": self.connected_at,
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

        # Handle gzip compression (matches Node auth handler pattern)
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
    """Read the consolidated COMPANY vault from Secrets Manager.

    Located at {CLIENT_NAME}/vault/company. Cached for 5 minutes.
    Returns the secrets dict or None.
    """
    global _company_vault_cache
    cached_data, fetched_at = _company_vault_cache
    if cached_data is not None and time.time() - fetched_at < _CACHE_TTL:
        return cached_data

    vault_secret_name = f"{CLIENT_NAME}/vault/company"
    vault_data = _read_sm_secret(vault_secret_name)
    if not vault_data:
        logger.warning(f"Consolidated COMPANY vault not found at {vault_secret_name}")
        return None

    secrets = vault_data.get("secrets", {})
    _company_vault_cache = (secrets, time.time())
    return secrets


def _get_user_consolidated_vault(user_id: str) -> dict | None:
    """Read a user's consolidated vault from Secrets Manager.

    Located at {CLIENT_NAME}/vault/users/{user_id}.
    Returns the full vault data or None.
    """
    vault_secret_name = f"{CLIENT_NAME}/vault/users/{user_id}"
    return _read_sm_secret(vault_secret_name)


def _put_user_consolidated_vault(user_id: str, vault_data: dict) -> bool:
    """Write a user's consolidated vault back to Secrets Manager.

    Creates the secret if it doesn't exist yet.
    """
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
# Public API
# ---------------------------------------------------------------------------


def get_company_provider_config(provider: str) -> Optional[dict]:
    """Read OAuth provider config (client_id, client_secret, token_url) from COMPANY vault.

    Reads from consolidated Secrets Manager vault at {CLIENT_NAME}/vault/company,
    looks up secrets["oauth-client-{provider}"].fields for credentials.
    Uses an in-memory cache with 5-min TTL.
    """
    # Check per-provider cache
    cached = _company_config_cache.get(provider)
    if cached:
        config, fetched_at = cached
        if time.time() - fetched_at < _CACHE_TTL:
            return config

    try:
        secrets = _get_consolidated_company_vault()
        if not secrets:
            return None

        secret_name = f"oauth-client-{provider}"
        secret_entry = secrets.get(secret_name)
        if not secret_entry:
            logger.warning(
                f"No COMPANY vault secret found for {provider} "
                f'(looked for "{secret_name}" in consolidated vault)'
            )
            return None

        # Extract credentials from the secret entry's fields
        fields = secret_entry.get("fields") or secret_entry
        client_id = fields.get("client_id")
        client_secret = fields.get("client_secret")

        if not client_id or not client_secret:
            logger.warning(
                f"COMPANY vault secret for {provider} missing client_id or client_secret"
            )
            return None

        # Build config: prefer vault fields, fall back for backward compat
        token_url = fields.get("token_url") or FALLBACK_TOKEN_URLS.get(provider)
        if not token_url:
            logger.warning(f"No token_url for {provider} in vault or fallback")
            return None

        config = {
            "client_id": client_id,
            "client_secret": client_secret,
            "token_url": token_url,
        }

        _company_config_cache[provider] = (config, time.time())
        return config

    except Exception as e:
        logger.error(
            f"Failed to read COMPANY config for {provider}", extra={"error": str(e)}
        )
        return None


async def refresh_access_token(provider: str, refresh_token: str) -> Optional[dict]:
    """Refresh OAuth access token using refresh token.

    Reads client credentials from COMPANY consolidated vault.
    Falls back to env vars for backward compatibility.
    """
    import httpx

    company_config = get_company_provider_config(provider)

    if company_config:
        token_url = company_config["token_url"]
        client_id = company_config["client_id"]
        client_secret = company_config.get("client_secret")
    else:
        # Fallback: env vars + hardcoded token URLs
        token_url = FALLBACK_TOKEN_URLS.get(provider)
        if not token_url:
            logger.error(f"Unsupported provider for token refresh: {provider}")
            return None

        client_id = os.environ.get(f"{provider.upper()}_CLIENT_ID")
        client_secret = os.environ.get(f"{provider.upper()}_CLIENT_SECRET")

        if not client_id:
            logger.error(f"Missing client ID for {provider}")
            return None

    params = {
        "grant_type": "refresh_token",
        "client_id": client_id,
        "refresh_token": refresh_token,
    }

    if client_secret:
        params["client_secret"] = client_secret

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


async def get_oauth_token(provider: str, user_id: str) -> Optional[str]:
    """Get valid OAuth access token for user and provider.

    Reads from consolidated user vault at {CLIENT_NAME}/vault/users/{user_id},
    looking up secrets["oauth-{provider}"].fields for token data.
    Automatically refreshes token if expired.
    """
    secret_key = f"oauth-{provider}"

    # Read from consolidated user vault
    vault_data = _get_user_consolidated_vault(user_id)
    if not vault_data:
        logger.info(f"No consolidated vault found for user {user_id}")
        return None

    secrets = vault_data.get("secrets", {})
    entry = secrets.get(secret_key)
    if not entry:
        logger.info(
            f"No OAuth secret found for {provider} user {user_id} "
            f'(looked for "{secret_key}" in consolidated vault)'
        )
        return None

    # Extract token fields from the nested structure
    fields = entry.get("fields") or entry
    secret = VaultOAuthSecret(fields)

    if not secret.access_token:
        logger.info(f"No access_token in vault entry for {provider} user {user_id}")
        return None

    # Return token if still valid
    if secret.is_valid:
        return secret.access_token

    # Try to refresh if we have a refresh token
    if secret.refresh_token:
        logger.info(f"Refreshing OAuth token for {provider} user {user_id}")

        new_token_data = await refresh_access_token(provider, secret.refresh_token)
        if new_token_data:
            # Update fields with new token data
            secret.access_token = new_token_data.get("access_token", "")
            secret.refresh_token = new_token_data.get(
                "refresh_token", secret.refresh_token
            )

            # Calculate new expiry
            expires_in = new_token_data.get("expires_in", 3600)
            new_expires_at = datetime.now(timezone.utc).timestamp() + expires_in
            secret.expires_at = datetime.fromtimestamp(
                new_expires_at, timezone.utc
            ).isoformat()

            # Write updated token back to consolidated vault
            now = datetime.now(timezone.utc).isoformat()
            entry["fields"] = secret.to_dict()
            if "metadata" in entry:
                entry["metadata"]["updated_at"] = now
            secrets[secret_key] = entry
            vault_data["secrets"] = secrets
            if "metadata" in vault_data:
                vault_data["metadata"]["updated_at"] = now

            if _put_user_consolidated_vault(user_id, vault_data):
                logger.info(
                    f"Successfully refreshed OAuth token for {provider} user {user_id}"
                )
                return secret.access_token
            else:
                logger.error(
                    f"Failed to store refreshed token for {provider} user {user_id}"
                )

    logger.warning(f"No valid OAuth token available for {provider} user {user_id}")
    return None


async def revoke_oauth_token(provider: str, user_id: str) -> bool:
    """Revoke OAuth tokens for user and provider.

    Clears the token entry in the user's consolidated vault.
    """
    secret_key = f"oauth-{provider}"

    vault_data = _get_user_consolidated_vault(user_id)
    if not vault_data:
        logger.warning(f"No vault found for user {user_id} during revocation")
        return False

    secrets = vault_data.get("secrets", {})
    if secret_key not in secrets:
        logger.info(f"No OAuth entry to revoke for {provider} user {user_id}")
        return True

    # Clear the token fields
    entry = secrets[secret_key]
    now = datetime.now(timezone.utc).isoformat()
    entry["fields"] = {
        "provider": provider,
        "access_token": "",
        "refresh_token": "",
        "expires_at": "1970-01-01T00:00:00Z",
        "user_email": "",
        "scope": "",
        "connected_at": "",
    }
    if "metadata" in entry:
        entry["metadata"]["updated_at"] = now

    secrets[secret_key] = entry
    vault_data["secrets"] = secrets
    if "metadata" in vault_data:
        vault_data["metadata"]["updated_at"] = now

    success = _put_user_consolidated_vault(user_id, vault_data)
    if success:
        logger.info(f"Successfully revoked OAuth tokens for {provider} user {user_id}")
    else:
        logger.error(f"Failed to revoke OAuth tokens for {provider} user {user_id}")

    return success
