"""Lambda handlers for OAuth files API endpoints."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
from typing import Any, Dict, Optional

import structlog
from aws_lambda_powertools.utilities.typing import LambdaContext

from oauth_providers import (
    PROVIDERS,
    OAuthAuthenticationError,
    OAuthError,
    OAuthProvider,
    OAuthRateLimitError,
    create_provider,
)
from vault_integration import (
    get_company_provider_config,
    get_oauth_token,
    refresh_access_token,
)

logger = structlog.get_logger()

CLIENT_NAME = os.environ.get("CLIENT_NAME")
VAULT_SECRETS_PREFIX = os.environ.get("VAULT_SECRETS_PREFIX")


def _response(status: int, body: Dict[str, Any]) -> Dict[str, Any]:
    """Return a JSON API response with CORS headers."""
    return {
        "statusCode": status,
        "headers": {
            "Access-Control-Allow-Origin": os.environ.get(
                "FRONTEND_BASE_URL", "https://localhost:5173"
            ),
            "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
            "Access-Control-Allow-Headers": "Content-Type,Authorization",
            "Content-Type": "application/json",
        },
        "body": json.dumps(body),
    }


def _get_user_id(event: Dict[str, Any]) -> Optional[str]:
    """Extract a user id from the request context or JWT token."""
    auth = event.get("requestContext", {}).get("authorizer", {})
    jwt = auth.get("jwt", {})
    claims = jwt.get("claims", {}) or {}
    if isinstance(claims, dict) and claims.get("sub"):
        return claims.get("sub")

    headers = event.get("headers") or {}
    token = headers.get("authorization") or headers.get("Authorization")
    if not token:
        return None
    try:
        payload = token.split(".")[1]
        decoded = json.loads(base64.b64decode(payload + "===").decode("utf-8"))
        return decoded.get("sub")
    except (
        IndexError,
        ValueError,
        json.JSONDecodeError,
        UnicodeDecodeError,
        binascii.Error,
    ):
        return None


def _get_path(event: Dict[str, Any]) -> str:
    """Return the request path from the event."""
    return event.get("requestContext", {}).get("http", {}).get("path", "")


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    """Parse JSON request body, handling optional base64 encoding."""
    body = event.get("body") or ""
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {}


def _extract_path_segments(path: str) -> tuple[Optional[str], Optional[str]]:
    """Extract provider and action from path like /[api/]oauth-files/{provider}/{action}."""
    # Strip optional /api prefix added by API Gateway stage
    stripped = path.lstrip("/")
    if stripped.startswith("api/"):
        stripped = stripped[4:]
    parts = stripped.split("/")
    if len(parts) >= 3 and parts[0] == "oauth-files":
        provider = parts[1]
        action = parts[2]
        return provider, action
    return None, None


async def _get_provider_with_token(
    provider_name: str, user_id: str
) -> tuple[OAuthProvider, str]:
    """Get provider instance with valid access token.

    Reads client credentials from COMPANY vault dynamically, with env var fallback.

    Returns:
        Tuple of (provider_instance, access_token)

    Raises:
        OAuthAuthenticationError: If no valid token available
        ValueError: If provider not supported or not configured
    """
    # Try COMPANY vault first, then env var fallback
    company_config = get_company_provider_config(provider_name)

    if company_config:
        client_id = company_config["client_id"]
        client_secret = company_config.get("client_secret")
    else:
        client_id = os.environ.get(f"{provider_name.upper()}_CLIENT_ID")
        client_secret = os.environ.get(f"{provider_name.upper()}_CLIENT_SECRET")

    if not client_id:
        raise ValueError(f"OAuth not configured for {provider_name}")

    # Create provider instance
    provider = create_provider(provider_name, client_id, client_secret)

    # Get valid access token (handles refresh automatically)
    access_token = await get_oauth_token(provider_name, user_id)
    if not access_token:
        raise OAuthAuthenticationError(f"No valid OAuth token for {provider_name}")

    return provider, access_token


# ---------------------------------------------------------------------------
# Route handlers
# ---------------------------------------------------------------------------


async def _handle_list_files(
    provider_name: str, user_id: str, event: Dict[str, Any]
) -> Dict[str, Any]:
    """List files and folders from OAuth provider."""
    try:
        provider, access_token = await _get_provider_with_token(provider_name, user_id)

        # Parse query parameters
        query_params = event.get("queryStringParameters") or {}
        folder_id = query_params.get("folder_id")
        page_size = int(query_params.get("page_size", "100"))
        page_token = query_params.get("page_token")

        # Validate page size
        page_size = min(max(page_size, 1), 1000)

        # List files
        contents = await provider.list_files(
            access_token=access_token,
            folder_id=folder_id,
            page_size=page_size,
            page_token=page_token,
        )

        # Convert to serializable format
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
        }

        await provider.close()
        return _response(200, result)

    except OAuthAuthenticationError as e:
        return _response(401, {"error": str(e)})
    except OAuthRateLimitError as e:
        return _response(429, {"error": str(e), "retry_after": e.retry_after})
    except OAuthError as e:
        logger.error(f"OAuth error listing files: {e}")
        return _response(500, {"error": str(e)})
    except ValueError as e:
        return _response(400, {"error": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error listing files: {e}")
        return _response(500, {"error": "Internal server error"})


async def _handle_download_file(
    provider_name: str, user_id: str, event: Dict[str, Any]
) -> Dict[str, Any]:
    """Download file content from OAuth provider."""
    try:
        # Extract file ID from path: /[api/]oauth-files/{provider}/download/{file_id}
        raw_path = event.get("requestContext", {}).get("http", {}).get("path", "")
        path_parts = raw_path.strip("/").split("/")
        try:
            idx = path_parts.index("download")
            file_id = path_parts[idx + 1] if len(path_parts) > idx + 1 else None
        except ValueError:
            file_id = None
        if not file_id:
            return _response(400, {"error": "File ID required"})

        provider, access_token = await _get_provider_with_token(provider_name, user_id)

        # Download file content
        file_content = await provider.download_file(access_token, file_id)

        await provider.close()

        # Return file content as base64
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": os.environ.get(
                    "FRONTEND_BASE_URL", "https://localhost:5173"
                ),
                "Content-Type": "application/octet-stream",
            },
            "body": base64.b64encode(file_content).decode("utf-8"),
            "isBase64Encoded": True,
        }

    except OAuthAuthenticationError as e:
        return _response(401, {"error": str(e)})
    except OAuthRateLimitError as e:
        return _response(429, {"error": str(e), "retry_after": e.retry_after})
    except OAuthError as e:
        logger.error(f"OAuth error downloading file: {e}")
        return _response(500, {"error": str(e)})
    except ValueError as e:
        return _response(400, {"error": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error downloading file: {e}")
        return _response(500, {"error": "Internal server error"})


async def _handle_get_metadata(
    provider_name: str, user_id: str, event: Dict[str, Any]
) -> Dict[str, Any]:
    """Get file metadata from OAuth provider."""
    try:
        # Extract file ID from path: /[api/]oauth-files/{provider}/metadata/{file_id}
        raw_path = event.get("requestContext", {}).get("http", {}).get("path", "")
        path_parts = raw_path.strip("/").split("/")
        try:
            idx = path_parts.index("metadata")
            file_id = path_parts[idx + 1] if len(path_parts) > idx + 1 else None
        except ValueError:
            file_id = None
        if not file_id:
            return _response(400, {"error": "File ID required"})

        provider, access_token = await _get_provider_with_token(provider_name, user_id)

        # Get file metadata
        metadata = await provider.get_file_metadata(access_token, file_id)

        # Convert to serializable format
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
        }

        await provider.close()
        return _response(200, result)

    except OAuthAuthenticationError as e:
        return _response(401, {"error": str(e)})
    except OAuthRateLimitError as e:
        return _response(429, {"error": str(e), "retry_after": e.retry_after})
    except OAuthError as e:
        logger.error(f"OAuth error getting metadata: {e}")
        return _response(500, {"error": str(e)})
    except ValueError as e:
        return _response(400, {"error": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error getting metadata: {e}")
        return _response(500, {"error": "Internal server error"})


async def _handle_search_files(
    provider_name: str, user_id: str, event: Dict[str, Any]
) -> Dict[str, Any]:
    """Search files in OAuth provider."""
    try:
        provider, access_token = await _get_provider_with_token(provider_name, user_id)

        # Parse query parameters
        query_params = event.get("queryStringParameters") or {}
        query = query_params.get("q", "").strip()

        if not query:
            return _response(400, {"error": "Search query required"})

        folder_id = query_params.get("folder_id")
        page_size = int(query_params.get("page_size", "100"))
        page_token = query_params.get("page_token")

        # Validate page size
        page_size = min(max(page_size, 1), 1000)

        # Search files
        results = await provider.search_files(
            access_token=access_token,
            query=query,
            folder_id=folder_id,
            page_size=page_size,
            page_token=page_token,
        )

        # Convert to serializable format (same as list_files)
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
            "query": query,
        }

        await provider.close()
        return _response(200, result)

    except OAuthAuthenticationError as e:
        return _response(401, {"error": str(e)})
    except OAuthRateLimitError as e:
        return _response(429, {"error": str(e), "retry_after": e.retry_after})
    except OAuthError as e:
        logger.error(f"OAuth error searching files: {e}")
        return _response(500, {"error": str(e)})
    except ValueError as e:
        return _response(400, {"error": str(e)})
    except Exception as e:
        logger.error(f"Unexpected error searching files: {e}")
        return _response(500, {"error": "Internal server error"})


# ---------------------------------------------------------------------------
# Main Handler
# ---------------------------------------------------------------------------


def lambda_handler(event: Dict[str, Any], context: LambdaContext) -> Dict[str, Any]:
    """Main Lambda handler for OAuth Files API."""
    logger.info(
        "OAuth Files API handler",
        extra={
            "method": event.get("requestContext", {}).get("http", {}).get("method"),
            "path": event.get("requestContext", {}).get("http", {}).get("path"),
        },
    )

    # CORS preflight
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return _response(200, {})

    try:
        # Extract user ID
        user_id = _get_user_id(event)
        if not user_id:
            return _response(401, {"error": "Authentication required"})

        # Extract path segments
        path = _get_path(event)
        provider, action = _extract_path_segments(path)

        if not provider or not action:
            return _response(404, {"error": "Invalid OAuth files path"})

        # Validate provider: must have a file browsing implementation in PROVIDERS registry
        if provider not in PROVIDERS:
            # Check if the provider exists in COMPANY vault (connected but no file browsing)
            company_config = get_company_provider_config(provider)
            if company_config:
                return _response(
                    200,
                    {
                        "error": "File browsing not available for this provider",
                        "connected": True,
                    },
                )
            return _response(400, {"error": f"Unknown OAuth provider: {provider}"})

        # Route to appropriate handler
        method = event.get("requestContext", {}).get("http", {}).get("method", "")

        if method == "GET":
            if action == "list":
                return asyncio.run(_handle_list_files(provider, user_id, event))
            elif action.startswith("download"):
                return asyncio.run(_handle_download_file(provider, user_id, event))
            elif action.startswith("metadata"):
                return asyncio.run(_handle_get_metadata(provider, user_id, event))
            elif action == "search":
                return asyncio.run(_handle_search_files(provider, user_id, event))
            else:
                return _response(404, {"error": "Action not found"})
        else:
            return _response(405, {"error": "Method not allowed"})

    except Exception as e:
        logger.error(f"Unexpected error in OAuth Files API: {e}")
        return _response(500, {"error": "Internal server error"})
