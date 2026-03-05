"""Enhanced OAuth tools for consolidated vault with multiple connector support."""

import os

# Import consolidated vault functions
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import structlog

from prm import client

sys.path.append("/opt/python")

try:
    from consolidated_storage import (
        COMPANY_USER_ID,
        add_secret_to_vault,
        create_secret_from_template,
        get_consolidated_vault,
        get_template,
        get_vault_secret,
        remove_secret_from_vault,
    )
    from template_engine import (
        FreeFormValidator,  # type: ignore[assignment]  # pyright: ignore[reportAssignmentType]
    )
    from template_engine import (
        TemplateManager,  # type: ignore[assignment]  # pyright: ignore[reportAssignmentType]
    )
    from template_engine import (
        TemplateValidator,  # type: ignore[assignment]  # pyright: ignore[reportAssignmentType]
    )
except ImportError as e:
    # Fallback for development/testing
    logger = structlog.get_logger()
    logger.warning("Could not import consolidated storage modules", error=str(e))

    def get_consolidated_vault(*_args: Any, **_kwargs: Any) -> Any:  # type: ignore[misc]
        return {"secrets": {}}

    def get_vault_secret(*_args: Any, **_kwargs: Any) -> Any:  # type: ignore[misc]
        return None

    def add_secret_to_vault(*_args: Any, **_kwargs: Any) -> Any:  # type: ignore[misc]
        return {}

    def remove_secret_from_vault(*_args: Any, **_kwargs: Any) -> Any:  # type: ignore[misc]
        return False

    def create_secret_from_template(*_args: Any, **_kwargs: Any) -> Any:  # type: ignore[misc]
        return {}

    def get_template(*_args: Any, **_kwargs: Any) -> Any:  # type: ignore[misc]
        return None

    COMPANY_USER_ID = "COMPANY"

    class TemplateValidator:  # type: ignore[no-redef]
        def __init__(self, *args: Any) -> None:
            pass

        def validate_complete_secret(self, *_args: Any) -> tuple:
            return True, []

    class FreeFormValidator:  # type: ignore[no-redef]
        def validate_complete_freeform(self, *_args: Any) -> tuple:
            return True, []

    class TemplateManager:  # type: ignore[no-redef]
        def __init__(self, *args: Any) -> None:
            pass

        def track_template_usage(self, *args: Any) -> None:
            pass


logger = structlog.get_logger()

# Initialize AWS clients with PRM
secrets_manager = client("secretsmanager")

# Environment configuration
CLIENT_NAME = os.environ.get("CLIENT_NAME", "demo")
VAULT_SECRETS_PREFIX = os.environ.get("VAULT_SECRETS_PREFIX", f"{CLIENT_NAME}/vault")
OUTPUTS_BUCKET = os.environ.get("OUTPUTS_BUCKET_NAME", "")

# Maximum file download size (50MB)
MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024

# Cache for available providers from COMPANY vault
_available_providers_cache: Optional[Tuple[List[str], float]] = None
_CACHE_TTL = 5 * 60  # 5 minutes

FRIENDLY_NAMES = {
    "googledrive": "GoogleDrive",
    "gmail": "Gmail",
    "onedrive": "OneDrive",
    "dropbox": "Dropbox",
    "sharepoint": "SharePoint",
    "slack": "Slack",
    "notion": "Notion",
    "jira": "Jira",
    "hubspot": "HubSpot",
    "salesforce": "Salesforce",
    "xero": "Xero",
}


def get_available_providers() -> List[str]:
    """Query consolidated COMPANY vault for all configured OAuth providers.

    Returns list of provider IDs (e.g. ['googledrive', 'gmail', 'slack']).
    Uses an in-memory cache with 5-min TTL.
    """
    global _available_providers_cache
    if _available_providers_cache:
        providers, fetched_at = _available_providers_cache
        if time.time() - fetched_at < _CACHE_TTL:
            return providers

    try:
        company_vault = get_consolidated_vault(COMPANY_USER_ID, CLIENT_NAME)
        provider_ids = []

        # Check both secrets and templates for OAuth providers
        secrets = company_vault.get("secrets", {})
        templates = company_vault.get("templates", {})

        # From company secrets (oauth-client-{provider})
        for secret_name in secrets:
            if secret_name.startswith("oauth-client-"):
                provider_id = secret_name.replace("oauth-client-", "")
                if provider_id not in provider_ids:
                    provider_ids.append(provider_id)

        # From OAuth templates ({provider}-oauth)
        for template_name in templates:
            if template_name.endswith("-oauth"):
                provider_id = template_name.replace("-oauth", "")
                if provider_id not in provider_ids:
                    provider_ids.append(provider_id)

        _available_providers_cache = (provider_ids, time.time())
        return provider_ids

    except Exception as e:
        logger.warning("Failed to list available OAuth providers", error=str(e))
        return []


def _get_provider_credentials(provider: str) -> Optional[Dict[str, str]]:
    """Get OAuth client credentials from consolidated COMPANY vault or env vars.

    Returns dict with client_id (and optionally client_secret) or None.
    """
    try:
        # Try consolidated COMPANY vault first
        company_vault = get_consolidated_vault(COMPANY_USER_ID, CLIENT_NAME)
        secret_name = f"oauth-client-{provider}"

        oauth_client_secret = company_vault.get("secrets", {}).get(secret_name)
        if oauth_client_secret:
            fields = oauth_client_secret.get("fields", {})
            client_id = fields.get("client_id")
            if client_id:
                return {
                    "client_id": client_id,
                    "client_secret": fields.get("client_secret", ""),
                    "redirect_uri": fields.get("redirect_uri", ""),
                    "scopes": fields.get("scopes", ""),
                }
    except Exception as e:
        logger.warning(
            "Failed to get COMPANY credentials", provider=provider, error=str(e)
        )

    # Fallback to environment variables
    client_id = os.environ.get(f"{provider.upper()}_CLIENT_ID")
    if client_id:
        return {
            "client_id": client_id,
            "client_secret": os.environ.get(f"{provider.upper()}_CLIENT_SECRET", ""),
            "redirect_uri": os.environ.get(f"{provider.upper()}_REDIRECT_URI", ""),
            "scopes": os.environ.get(f"{provider.upper()}_SCOPES", ""),
        }

    return None


def _get_friendly_secret_name(
    provider: str, connector_name: Optional[str] = None
) -> str:
    """Generate user-friendly secret name for OAuth connector."""
    friendly_provider = FRIENDLY_NAMES.get(provider, provider.capitalize())

    if connector_name and connector_name != provider:
        # User provided custom name
        return connector_name

    # Auto-generate based on provider
    return f"{friendly_provider}-Connection"


def get_user_oauth_connectors(provider: str, user_sub: str) -> List[Dict[str, Any]]:
    """Get all OAuth connectors of specific provider type for user.

    Args:
        provider: OAuth provider name (e.g., 'googledrive', 'gmail')
        user_sub: User ID from JWT

    Returns:
        List of connector info dicts with name, display_name, user_email, etc.
    """
    try:
        user_vault = get_consolidated_vault(user_sub, CLIENT_NAME)
        connectors = []

        for secret_name, secret_data in user_vault.get("secrets", {}).items():
            secret_type = secret_data.get("type", "")
            template = secret_data.get("template")

            # Check if this secret is for the requested provider
            is_provider_match = (
                secret_type == provider
                or template == f"{provider}-oauth"
                or (template is None and provider.lower() in secret_name.lower())
            )

            if is_provider_match:
                fields = secret_data.get("fields", {})
                metadata = secret_data.get("metadata", {})

                connector_info = {
                    "name": secret_name,
                    "display_name": secret_data.get("display_name", secret_name),
                    "type": secret_type,
                    "template": template,
                    "user_email": fields.get("user_email", ""),
                    "expires_at": fields.get("expires_at"),
                    "scope": fields.get("scope", ""),
                    "created_at": metadata.get("created_at"),
                    "updated_at": metadata.get("updated_at"),
                    "last_accessed_at": metadata.get("last_accessed_at"),
                    "template_version": metadata.get("template_version"),
                    "validation_passed": metadata.get("validation_passed", True),
                    "is_valid": _is_token_valid(fields),
                    "provider": provider,
                }
                connectors.append(connector_info)

        # Sort by creation date (most recent first)
        return sorted(connectors, key=lambda x: x.get("created_at", ""), reverse=True)

    except Exception as e:
        logger.error(
            "Failed to get user OAuth connectors",
            provider=provider,
            user_sub=user_sub,
            error=str(e),
        )
        return []


def get_all_user_oauth_connectors(user_sub: str) -> Dict[str, List[Dict[str, Any]]]:
    """Get all OAuth connectors for user, grouped by provider.

    Args:
        user_sub: User ID from JWT

    Returns:
        Dict mapping provider names to lists of connector info
    """
    try:
        user_vault = get_consolidated_vault(user_sub, CLIENT_NAME)
        connectors_by_provider: Dict[str, List[Dict[str, Any]]] = {}

        for secret_name, secret_data in user_vault.get("secrets", {}).items():
            secret_type = secret_data.get("type", "")
            template = secret_data.get("template")

            # Determine provider from type or template
            provider = None
            if template and template.endswith("-oauth"):
                provider = template.replace("-oauth", "")
            elif secret_type in FRIENDLY_NAMES:
                provider = secret_type
            elif any(p in secret_name.lower() for p in FRIENDLY_NAMES):
                # Try to match provider from secret name
                for p in FRIENDLY_NAMES:
                    if p in secret_name.lower():
                        provider = p
                        break

            if provider:
                fields = secret_data.get("fields", {})
                metadata = secret_data.get("metadata", {})

                connector_info = {
                    "name": secret_name,
                    "display_name": secret_data.get("display_name", secret_name),
                    "type": secret_type,
                    "template": template,
                    "user_email": fields.get("user_email", ""),
                    "expires_at": fields.get("expires_at"),
                    "scope": fields.get("scope", ""),
                    "created_at": metadata.get("created_at"),
                    "updated_at": metadata.get("updated_at"),
                    "last_accessed_at": metadata.get("last_accessed_at"),
                    "is_valid": _is_token_valid(fields),
                    "provider": provider,
                }

                if provider not in connectors_by_provider:
                    connectors_by_provider[provider] = []
                connectors_by_provider[provider].append(connector_info)

        # Sort each provider's connectors by creation date
        for provider, conns in connectors_by_provider.items():
            conns.sort(key=lambda x: x.get("created_at", ""), reverse=True)

        return connectors_by_provider

    except Exception as e:
        logger.error(
            "Failed to get all user OAuth connectors", user_sub=user_sub, error=str(e)
        )
        return {}


def _is_token_valid(fields: Dict[str, Any]) -> bool:
    """Check if OAuth token is still valid based on expiration."""
    access_token = fields.get("access_token")
    if not access_token:
        return False

    expires_at = fields.get("expires_at")
    if expires_at:
        try:
            expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            return datetime.now(expiry.tzinfo) < expiry
        except (ValueError, TypeError):
            pass

    # If no expiry info, assume valid if token exists
    return True


async def get_oauth_token(
    provider: str, user_sub: str, connector_name: Optional[str] = None
) -> Optional[str]:
    """Get valid OAuth access token for user and provider from consolidated vault.

    Args:
        provider: OAuth provider name (e.g., 'googledrive', 'gmail')
        user_sub: User ID from JWT
        connector_name: Specific connector name (optional, uses first available if None)

    Returns:
        Valid access token or None if not available
    """
    try:
        if connector_name:
            # Get specific connector
            secret = get_vault_secret(user_sub, connector_name, CLIENT_NAME)
            if secret and secret.get("type") == provider:
                fields = secret.get("fields", {})
                access_token = fields.get("access_token")

                # Check if token is expired and try to refresh
                if access_token and not _is_token_valid(fields):
                    refreshed_token = await _refresh_oauth_token(
                        user_sub, connector_name, fields
                    )
                    if refreshed_token:
                        return refreshed_token

                return access_token
        else:
            # Get first available connector for this provider
            connectors = get_user_oauth_connectors(provider, user_sub)
            for connector in connectors:
                if connector.get("is_valid"):
                    secret = get_vault_secret(user_sub, connector["name"], CLIENT_NAME)
                    if secret:
                        return secret.get("fields", {}).get("access_token")

            # Try to refresh expired tokens
            for connector in connectors:
                secret = get_vault_secret(user_sub, connector["name"], CLIENT_NAME)
                if secret:
                    fields = secret.get("fields", {})
                    refreshed_token = await _refresh_oauth_token(
                        user_sub, connector["name"], fields
                    )
                    if refreshed_token:
                        return refreshed_token

        return None

    except Exception as e:
        logger.error(
            "Failed to get OAuth token",
            provider=provider,
            user_sub=user_sub,
            connector_name=connector_name,
            error=str(e),
        )
        return None


async def _refresh_oauth_token(
    user_sub: str, connector_name: str, fields: Dict[str, Any]
) -> Optional[str]:
    """Attempt to refresh an expired OAuth token."""
    refresh_token = fields.get("refresh_token")
    if not refresh_token:
        return None

    try:
        # This would integrate with the oauth-auth-handler to refresh tokens
        # For now, return None to indicate refresh is needed
        logger.info(
            "Token refresh needed", user_sub=user_sub, connector_name=connector_name
        )
        return None
    except Exception as e:
        logger.error(
            "Failed to refresh OAuth token",
            user_sub=user_sub,
            connector_name=connector_name,
            error=str(e),
        )
        return None


def create_oauth_connector_from_template(
    provider: str,
    user_sub: str,
    oauth_data: Dict[str, Any],
    connector_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Create OAuth connection using template.

    Args:
        provider: OAuth provider name (e.g., 'googledrive', 'gmail')
        user_sub: User ID from JWT
        oauth_data: OAuth token data (access_token, refresh_token, etc.)
        connector_name: Optional custom connector name

    Returns:
        Created connector info dict
    """
    try:
        template_name = f"{provider}-oauth"

        # Check if template exists
        template = get_template(template_name, CLIENT_NAME)
        if not template:
            raise ValueError(
                f"OAuth template '{template_name}' not found for provider '{provider}'"
            )

        # Generate connector name if not provided
        if not connector_name:
            existing_connectors = get_user_oauth_connectors(provider, user_sub)
            connector_name = f"{provider}-{len(existing_connectors) + 1}"

        # Prepare secret data for template
        secret_data = {
            "display_name": oauth_data.get(
                "display_name", _get_friendly_secret_name(provider, connector_name)
            ),
            "description": oauth_data.get(
                "description",
                f"{FRIENDLY_NAMES.get(provider, provider)} OAuth connection",
            ),
            "fields": oauth_data.get(
                "fields", oauth_data
            ),  # Support both nested and flat structure
            "category": "OAuth Clients",
            "template": template_name,
        }

        # Validate against template
        validator = TemplateValidator(CLIENT_NAME)
        is_valid, errors = validator.validate_complete_secret(
            template_name, secret_data
        )
        if not is_valid:
            raise ValueError(f"OAuth data validation failed: {', '.join(errors)}")

        # Create secret from template
        validated_data = create_secret_from_template(
            template_name, secret_data, CLIENT_NAME
        )

        # Add to user vault
        created_secret = add_secret_to_vault(
            user_sub, connector_name, validated_data, template_name, CLIENT_NAME
        )

        # Track template usage
        template_manager = TemplateManager(CLIENT_NAME)
        template_manager.track_template_usage(template_name, user_sub)

        logger.info(
            "Created OAuth connector from template",
            provider=provider,
            user_sub=user_sub,
            connector_name=connector_name,
            template=template_name,
        )

        return {
            "name": connector_name,
            "display_name": created_secret.get("display_name"),
            "provider": provider,
            "template": template_name,
            "created": True,
        }

    except Exception as e:
        logger.error(
            "Failed to create OAuth connector from template",
            provider=provider,
            user_sub=user_sub,
            connector_name=connector_name,
            error=str(e),
        )
        raise


def create_custom_oauth_connector(
    user_sub: str, oauth_data: Dict[str, Any], connector_name: Optional[str] = None
) -> Dict[str, Any]:
    """Create custom OAuth connection without template (free-form).

    Args:
        user_sub: User ID from JWT
        oauth_data: Complete OAuth connector data
        connector_name: Optional custom connector name

    Returns:
        Created connector info dict
    """
    try:
        # Generate connector name if not provided
        if not connector_name:
            provider = oauth_data.get("type", "custom")
            existing_count = len(get_user_oauth_connectors(provider, user_sub))
            connector_name = f"{provider}-custom-{existing_count + 1}"

        # Prepare free-form secret data
        secret_data = {
            "display_name": oauth_data.get("display_name", connector_name),
            "type": oauth_data.get("type", "custom"),
            "description": oauth_data.get("description", "Custom OAuth connection"),
            "fields": oauth_data.get("fields", oauth_data),
            "category": oauth_data.get("category", "OAuth Clients"),
            "template": None,  # Free-form
        }

        # Validate free-form data
        validator = FreeFormValidator()
        is_valid, errors = validator.validate_complete_freeform(secret_data)
        if not is_valid:
            raise ValueError(f"Free-form validation failed: {', '.join(errors)}")

        # Add to user vault
        created_secret = add_secret_to_vault(
            user_sub, connector_name, secret_data, None, CLIENT_NAME
        )

        logger.info(
            "Created custom OAuth connector",
            user_sub=user_sub,
            connector_name=connector_name,
            type=secret_data["type"],
        )

        return {
            "name": connector_name,
            "display_name": created_secret.get("display_name"),
            "type": secret_data["type"],
            "template": None,
            "created": True,
        }

    except Exception as e:
        logger.error(
            "Failed to create custom OAuth connector",
            user_sub=user_sub,
            connector_name=connector_name,
            error=str(e),
        )
        raise


def delete_oauth_connector(user_sub: str, connector_name: str) -> bool:
    """Delete an OAuth connector.

    Args:
        user_sub: User ID from JWT
        connector_name: Name of connector to delete

    Returns:
        True if deleted successfully, False if not found
    """
    try:
        success = remove_secret_from_vault(user_sub, connector_name, CLIENT_NAME)
        if success:
            logger.info(
                "Deleted OAuth connector",
                user_sub=user_sub,
                connector_name=connector_name,
            )
        return success
    except Exception as e:
        logger.error(
            "Failed to delete OAuth connector",
            user_sub=user_sub,
            connector_name=connector_name,
            error=str(e),
        )
        return False


def get_oauth_connector_by_name(
    user_sub: str, connector_name: str
) -> Optional[Dict[str, Any]]:
    """Get specific OAuth connector by name.

    Args:
        user_sub: User ID from JWT
        connector_name: Name of connector

    Returns:
        Connector info dict or None if not found
    """
    try:
        secret = get_vault_secret(user_sub, connector_name, CLIENT_NAME)
        if not secret:
            return None

        fields = secret.get("fields", {})
        metadata = secret.get("metadata", {})

        return {
            "name": connector_name,
            "display_name": secret.get("display_name", connector_name),
            "type": secret.get("type"),
            "template": secret.get("template"),
            "user_email": fields.get("user_email", ""),
            "expires_at": fields.get("expires_at"),
            "scope": fields.get("scope", ""),
            "created_at": metadata.get("created_at"),
            "updated_at": metadata.get("updated_at"),
            "last_accessed_at": metadata.get("last_accessed_at"),
            "is_valid": _is_token_valid(fields),
            "fields": fields,
        }

    except Exception as e:
        logger.error(
            "Failed to get OAuth connector by name",
            user_sub=user_sub,
            connector_name=connector_name,
            error=str(e),
        )
        return None


# Legacy compatibility functions for existing integrations
async def get_oauth_token_legacy(provider: str, user_sub: str) -> Optional[str]:
    """Legacy function for backward compatibility - gets first available token."""
    return await get_oauth_token(provider, user_sub)


def get_user_oauth_connectors_legacy(provider: str, user_sub: str) -> List[Dict]:
    """Legacy function that returns simplified connector list."""
    connectors = get_user_oauth_connectors(provider, user_sub)
    return [
        {
            "name": c["name"],
            "user_email": c["user_email"],
            "expires_at": c["expires_at"],
            "is_valid": c["is_valid"],
        }
        for c in connectors
    ]
