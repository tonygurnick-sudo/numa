"""Abstract base provider for OAuth cloud storage integrations."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx


@dataclass
class OAuthFile:
    """Represents a file from an OAuth provider."""

    file_id: str
    name: str
    is_folder: bool
    path: str
    size: Optional[int] = None
    content_type: Optional[str] = None
    parent_id: Optional[str] = None
    modified_at: Optional[str] = None
    created_at: Optional[str] = None
    web_view_link: Optional[str] = None
    download_url: Optional[str] = None


@dataclass
class OAuthFolder:
    """Represents a folder from an OAuth provider."""

    folder_id: str
    name: str
    parent_id: Optional[str] = None
    path: str = ""
    has_subfolders: bool = False
    no_of_subfolders: int = 0


@dataclass
class OAuthFolderContents:
    """Represents the contents of a folder."""

    folders: List[OAuthFolder]
    files: List[OAuthFile]
    total_count: int
    next_page_token: Optional[str] = None


@dataclass
class OAuthFileMetadata:
    """Detailed metadata for a file."""

    file_id: str
    name: str
    size: int
    content_type: str
    modified_at: str
    created_at: str
    parent_id: Optional[str] = None
    path: str = ""
    checksum: Optional[str] = None
    version: Optional[str] = None
    permissions: Optional[Dict[str, Any]] = None


class OAuthError(Exception):
    """Base exception for OAuth provider errors."""

    def __init__(
        self,
        message: str,
        error_code: Optional[str] = None,
        status_code: Optional[int] = None,
    ):
        super().__init__(message)
        self.error_code = error_code
        self.status_code = status_code


class OAuthRateLimitError(OAuthError):
    """Raised when API rate limit is exceeded."""

    def __init__(self, message: str, retry_after: Optional[int] = None):
        super().__init__(message, error_code="RATE_LIMIT")
        self.retry_after = retry_after


class OAuthAuthenticationError(OAuthError):
    """Raised when authentication fails (invalid/expired token)."""

    def __init__(self, message: str):
        super().__init__(message, error_code="AUTH_ERROR", status_code=401)


class OAuthProvider(ABC):
    """Abstract base class for OAuth cloud storage providers."""

    MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024  # 100MB

    def __init__(self, client_id: str, client_secret: Optional[str] = None):
        """Initialize the provider.

        Args:
            client_id: OAuth client ID for the provider
            client_secret: OAuth client secret (if required)
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self.http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(30.0),
            limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
        )

    async def close(self):
        """Close the HTTP client."""
        await self.http_client.aclose()

    async def __aenter__(self):
        """Enter async context manager."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit async context manager and close HTTP client."""
        await self.close()
        return False

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Get the provider name (e.g., 'googledrive', 'onedrive', 'dropbox')."""
        pass

    @abstractmethod
    async def list_files(
        self,
        access_token: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """List files and folders in the specified folder.

        Args:
            access_token: Valid OAuth access token
            folder_id: Folder ID to list (None for root folder)
            page_size: Number of items per page
            page_token: Token for pagination

        Returns:
            OAuthFolderContents containing files and folders

        Raises:
            OAuthAuthenticationError: If token is invalid
            OAuthRateLimitError: If rate limit exceeded
            OAuthError: For other API errors
        """
        pass

    @abstractmethod
    async def download_file(
        self, access_token: str, file_id: str, max_download_size: Optional[int] = None
    ) -> bytes:
        """Download file content.

        Args:
            access_token: Valid OAuth access token
            file_id: ID of the file to download
            max_download_size: Maximum allowed file size in bytes (defaults to MAX_DOWNLOAD_SIZE)

        Returns:
            File content as bytes

        Raises:
            OAuthAuthenticationError: If token is invalid
            OAuthRateLimitError: If rate limit exceeded
            OAuthError: For other API errors or if file exceeds size limit
        """
        pass

    @abstractmethod
    async def get_file_metadata(
        self, access_token: str, file_id: str
    ) -> OAuthFileMetadata:
        """Get detailed metadata for a file.

        Args:
            access_token: Valid OAuth access token
            file_id: ID of the file

        Returns:
            OAuthFileMetadata with detailed file information

        Raises:
            OAuthAuthenticationError: If token is invalid
            OAuthRateLimitError: If rate limit exceeded
            OAuthError: For other API errors
        """
        pass

    @abstractmethod
    async def search_files(
        self,
        access_token: str,
        query: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """Search for files matching the query.

        Args:
            access_token: Valid OAuth access token
            query: Search query string
            folder_id: Limit search to specific folder (None for all)
            page_size: Number of results per page
            page_token: Token for pagination

        Returns:
            OAuthFolderContents with matching files and folders

        Raises:
            OAuthAuthenticationError: If token is invalid
            OAuthRateLimitError: If rate limit exceeded
            OAuthError: For other API errors
        """
        pass

    async def refresh_token(self, access_token: str) -> Optional[str]:
        """Refresh or regenerate an access token. Override for providers that support it.

        Returns:
            New access token string, or None if not supported.
        """
        return None

    async def _handle_http_error(self, response: httpx.Response) -> None:
        """Handle HTTP errors and raise appropriate exceptions.

        Args:
            response: HTTP response object

        Raises:
            OAuthAuthenticationError: For 401 responses
            OAuthRateLimitError: For 429 responses
            OAuthError: For other error responses
        """
        if response.status_code == 401:
            raise OAuthAuthenticationError(
                "Authentication failed - token may be expired or invalid"
            )
        elif response.status_code == 429:
            # Extract retry-after header if available
            retry_after = response.headers.get("retry-after")
            retry_seconds = (
                int(retry_after) if retry_after and retry_after.isdigit() else None
            )
            raise OAuthRateLimitError("Rate limit exceeded", retry_after=retry_seconds)
        elif response.status_code >= 400:
            try:
                error_data = response.json()
                error_message = error_data.get("error", {}).get(
                    "message", f"HTTP {response.status_code}"
                )
            except Exception:
                error_message = f"HTTP {response.status_code}: {response.text}"

            raise OAuthError(error_message, status_code=response.status_code)

    async def _make_request_with_retry(
        self, method: str, url: str, access_token: str, **kwargs
    ) -> httpx.Response:
        """Make HTTP request with exponential backoff retry logic.

        Args:
            method: HTTP method (GET, POST, etc.)
            url: Request URL
            access_token: OAuth access token
            **kwargs: Additional arguments for httpx request

        Returns:
            HTTP response object

        Raises:
            OAuthError: If all retry attempts fail
        """
        headers = kwargs.pop("headers", {})
        headers.update(
            {
                "Authorization": f"Bearer {access_token}",
                "User-Agent": "Numa-OAuth-Client/1.0",
            }
        )

        max_retries = 3
        base_delay = 1.0

        for attempt in range(max_retries + 1):
            try:
                response = await self.http_client.request(
                    method=method, url=url, headers=headers, **kwargs
                )

                # Handle rate limiting with exponential backoff
                if response.status_code == 429:
                    if attempt < max_retries:
                        # Try to get retry-after header, otherwise use exponential backoff
                        retry_after = response.headers.get("retry-after")
                        if retry_after and retry_after.isdigit():
                            delay = int(retry_after)
                        else:
                            delay = base_delay * (2**attempt)

                        await asyncio.sleep(delay)
                        continue
                    else:
                        await self._handle_http_error(response)

                # Handle other errors
                if response.status_code >= 400:
                    await self._handle_http_error(response)

                return response

            except httpx.RequestError as e:
                if attempt < max_retries:
                    delay = base_delay * (2**attempt)
                    await asyncio.sleep(delay)
                    continue
                else:
                    raise OAuthError(
                        f"Network error after {max_retries} retries: {str(e)}"
                    ) from e

        # Should never reach here due to the exception handling above
        raise OAuthError("Unexpected error in request retry logic")


# Helper functions for common operations


async def test_provider_connection(provider: OAuthProvider, access_token: str) -> bool:
    """Test if a provider connection is working.

    Args:
        provider: OAuth provider instance
        access_token: Access token to test

    Returns:
        True if connection is working, False otherwise
    """
    try:
        await provider.list_files(access_token, folder_id=None, page_size=1)
        return True
    except OAuthError:
        return False
    finally:
        await provider.close()


def normalize_file_path(path: str) -> str:
    """Normalize file paths across providers.

    Args:
        path: Raw file path from provider

    Returns:
        Normalized path with consistent format
    """
    if not path:
        return "/"

    # Ensure path starts with /
    if not path.startswith("/"):
        path = "/" + path

    # Remove trailing slash unless it's root
    if len(path) > 1 and path.endswith("/"):
        path = path[:-1]

    return path


def parse_iso_datetime(date_str: Optional[str]) -> Optional[str]:
    """Parse and normalize ISO datetime strings from providers.

    Args:
        date_str: ISO datetime string from provider

    Returns:
        Normalized ISO datetime string or None
    """
    if not date_str:
        return None

    try:
        # Parse and reformat to ensure consistent format
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        return dt.isoformat()
    except (ValueError, TypeError):
        return date_str  # Return original if parsing fails
