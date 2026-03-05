"""OneDrive OAuth provider implementation using Microsoft Graph API."""

from __future__ import annotations

import re
import urllib.parse
from typing import Any, Dict, List, Optional

from .base_provider import (
    OAuthError,
    OAuthFile,
    OAuthFileMetadata,
    OAuthFolder,
    OAuthFolderContents,
    OAuthProvider,
    normalize_file_path,
    parse_iso_datetime,
)

# Pattern to detect path traversal characters in IDs
_UNSAFE_ID_PATTERN = re.compile(r"[/\\\.]{2,}|[/\\]")


def _validate_item_id(item_id: str, label: str = "item_id") -> None:
    """Validate that an item ID does not contain path traversal characters.

    Args:
        item_id: The ID value to validate
        label: Label for error messages (e.g. 'folder_id', 'file_id')

    Raises:
        OAuthError: If the ID contains path traversal characters
    """
    if _UNSAFE_ID_PATTERN.search(item_id):
        raise OAuthError(
            f"Invalid {label}: contains path traversal characters",
            error_code="INVALID_ID",
        )


class OneDriveProvider(OAuthProvider):
    """OneDrive Microsoft Graph API OAuth provider implementation."""

    BASE_URL = "https://graph.microsoft.com/v1.0"

    @property
    def provider_name(self) -> str:
        return "onedrive"

    async def list_files(
        self,
        access_token: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """List files and folders in OneDrive."""
        # Build URL for folder contents
        if folder_id:
            _validate_item_id(folder_id, "folder_id")
            url = f"{self.BASE_URL}/me/drive/items/{folder_id}/children"
        else:
            url = f"{self.BASE_URL}/me/drive/root/children"

        params = {
            "$top": min(page_size, 999),  # Microsoft Graph max is 999
            "$select": "id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file",
        }

        if page_token:
            # Microsoft Graph uses skip token for pagination
            params["$skiptoken"] = page_token

        response = await self._make_request_with_retry(
            "GET", url, access_token, params=params
        )

        data = response.json()
        items_data = data.get("value", [])

        folders = []
        files = []

        for item in items_data:
            name = item.get("name", "")
            item_id = item.get("id", "")
            is_folder = "folder" in item

            # Build path
            path = normalize_file_path(f"/{name}")

            # Get parent reference
            parent_ref = item.get("parentReference", {})
            parent_id = (
                parent_ref.get("id") if parent_ref.get("id") != folder_id else folder_id
            )

            if is_folder:
                folder_info = item.get("folder", {})
                child_count = folder_info.get("childCount", 0)

                folders.append(
                    OAuthFolder(
                        folder_id=item_id,
                        name=name,
                        parent_id=parent_id,
                        path=path,
                        has_subfolders=child_count > 0,
                        no_of_subfolders=child_count,
                    )
                )
            else:
                # Parse file information
                size = item.get("size", 0)
                file_info = item.get("file", {})

                # Get MIME type from file info
                content_type = file_info.get("mimeType", "application/octet-stream")

                files.append(
                    OAuthFile(
                        file_id=item_id,
                        name=name,
                        is_folder=False,
                        path=path,
                        size=size,
                        content_type=content_type,
                        parent_id=parent_id,
                        modified_at=parse_iso_datetime(
                            item.get("lastModifiedDateTime")
                        ),
                        created_at=parse_iso_datetime(item.get("createdDateTime")),
                        web_view_link=item.get("webUrl"),
                    )
                )

        # Extract next page token from @odata.nextLink
        next_page_token = None
        if "@odata.nextLink" in data:
            next_link = data["@odata.nextLink"]
            # Extract skiptoken from URL
            parsed_url = urllib.parse.urlparse(next_link)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            if "$skiptoken" in query_params:
                next_page_token = query_params["$skiptoken"][0]

        return OAuthFolderContents(
            folders=folders,
            files=files,
            total_count=len(folders) + len(files),
            next_page_token=next_page_token,
        )

    async def download_file(
        self, access_token: str, file_id: str, max_download_size: Optional[int] = None
    ) -> bytes:
        """Download file content from OneDrive.

        Uses follow_redirects=False to avoid leaking the Bearer token
        to the pre-authenticated download URL that Microsoft returns via 302.
        """
        _validate_item_id(file_id, "file_id")
        size_limit = (
            max_download_size
            if max_download_size is not None
            else self.MAX_DOWNLOAD_SIZE
        )

        url = f"{self.BASE_URL}/me/drive/items/{file_id}/content"

        # Make initial request without following redirects to avoid
        # sending the Authorization header to the redirect target
        response = await self._make_request_with_retry(
            "GET", url, access_token, follow_redirects=False
        )

        # Microsoft Graph returns 302 with a pre-authenticated download URL
        if response.status_code == 302:
            redirect_url = response.headers.get("Location")
            if not redirect_url:
                raise OAuthError("Download redirect missing Location header")

            # Check Content-Length from redirect response if available
            content_length = response.headers.get("content-length")
            if content_length is not None:
                try:
                    if int(content_length) > size_limit:
                        raise OAuthError(
                            f"File size {int(content_length)} bytes exceeds maximum allowed size of {size_limit} bytes",
                            error_code="FILE_TOO_LARGE",
                        )
                except (ValueError, TypeError):
                    pass

            # Follow the redirect WITHOUT the Authorization header
            download_response = await self.http_client.request(
                method="GET",
                url=redirect_url,
                headers={"User-Agent": "Numa-OAuth-Client/1.0"},
            )

            if download_response.status_code >= 400:
                raise OAuthError(
                    f"Download failed with HTTP {download_response.status_code}",
                    status_code=download_response.status_code,
                )

            # Check Content-Length on the actual download response
            content_length = download_response.headers.get("content-length")
            if content_length is not None:
                try:
                    if int(content_length) > size_limit:
                        raise OAuthError(
                            f"File size {int(content_length)} bytes exceeds maximum allowed size of {size_limit} bytes",
                            error_code="FILE_TOO_LARGE",
                        )
                except (ValueError, TypeError):
                    pass

            return download_response.content

        # If no redirect, check Content-Length and return directly
        content_length = response.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > size_limit:
                    raise OAuthError(
                        f"File size {int(content_length)} bytes exceeds maximum allowed size of {size_limit} bytes",
                        error_code="FILE_TOO_LARGE",
                    )
            except (ValueError, TypeError):
                pass

        return response.content

    async def get_file_metadata(
        self, access_token: str, file_id: str
    ) -> OAuthFileMetadata:
        """Get detailed metadata for a OneDrive file."""
        _validate_item_id(file_id, "file_id")
        params = {
            "$select": "id,name,size,createdDateTime,lastModifiedDateTime,parentReference,file,cTag,eTag,webUrl"
        }

        response = await self._make_request_with_retry(
            "GET",
            f"{self.BASE_URL}/me/drive/items/{file_id}",
            access_token,
            params=params,
        )

        data = response.json()

        # Parse file information
        size = data.get("size", 0)
        file_info = data.get("file", {})
        content_type = file_info.get("mimeType", "application/octet-stream")

        # Get parent information
        parent_ref = data.get("parentReference", {})
        parent_id = parent_ref.get("id")

        # Get hashes for checksum
        hashes = file_info.get("hashes", {})
        checksum = hashes.get("sha1Hash") or hashes.get("quickXorHash")

        return OAuthFileMetadata(
            file_id=data["id"],
            name=data.get("name", ""),
            size=size,
            content_type=content_type,
            modified_at=parse_iso_datetime(data.get("lastModifiedDateTime")) or "",
            created_at=parse_iso_datetime(data.get("createdDateTime")) or "",
            parent_id=parent_id,
            path=normalize_file_path(f"/{data.get('name', '')}"),
            checksum=checksum,
            version=data.get("eTag"),
            permissions={},  # Would need separate API call for detailed permissions
        )

    async def search_files(
        self,
        access_token: str,
        query: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """Search for files in OneDrive."""
        # URL-encode the query to prevent injection
        encoded_query = urllib.parse.quote(query, safe="")

        # Build search URL
        if folder_id:
            _validate_item_id(folder_id, "folder_id")
            url = f"{self.BASE_URL}/me/drive/items/{folder_id}/search(q='{encoded_query}')"
        else:
            url = f"{self.BASE_URL}/me/drive/root/search(q='{encoded_query}')"

        params = {
            "$top": min(page_size, 999),
            "$select": "id,name,size,createdDateTime,lastModifiedDateTime,parentReference,webUrl,folder,file",
        }

        if page_token:
            params["$skiptoken"] = page_token

        response = await self._make_request_with_retry(
            "GET", url, access_token, params=params
        )

        data = response.json()
        items_data = data.get("value", [])

        folders = []
        files = []

        for item in items_data:
            name = item.get("name", "")
            item_id = item.get("id", "")
            is_folder = "folder" in item

            path = normalize_file_path(f"/{name}")
            parent_ref = item.get("parentReference", {})
            parent_id = parent_ref.get("id")

            if is_folder:
                folder_info = item.get("folder", {})
                child_count = folder_info.get("childCount", 0)

                folders.append(
                    OAuthFolder(
                        folder_id=item_id,
                        name=name,
                        parent_id=parent_id,
                        path=path,
                        has_subfolders=child_count > 0,
                        no_of_subfolders=child_count,
                    )
                )
            else:
                size = item.get("size", 0)
                file_info = item.get("file", {})
                content_type = file_info.get("mimeType", "application/octet-stream")

                files.append(
                    OAuthFile(
                        file_id=item_id,
                        name=name,
                        is_folder=False,
                        path=path,
                        size=size,
                        content_type=content_type,
                        parent_id=parent_id,
                        modified_at=parse_iso_datetime(
                            item.get("lastModifiedDateTime")
                        ),
                        created_at=parse_iso_datetime(item.get("createdDateTime")),
                        web_view_link=item.get("webUrl"),
                    )
                )

        # Extract next page token
        next_page_token = None
        if "@odata.nextLink" in data:
            next_link = data["@odata.nextLink"]
            parsed_url = urllib.parse.urlparse(next_link)
            query_params = urllib.parse.parse_qs(parsed_url.query)
            if "$skiptoken" in query_params:
                next_page_token = query_params["$skiptoken"][0]

        return OAuthFolderContents(
            folders=folders,
            files=files,
            total_count=len(folders) + len(files),
            next_page_token=next_page_token,
        )
