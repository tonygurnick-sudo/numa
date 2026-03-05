"""Google Drive OAuth provider implementation."""

from __future__ import annotations

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


class GoogleDriveProvider(OAuthProvider):
    """Google Drive API v3 OAuth provider implementation."""

    BASE_URL = "https://www.googleapis.com/drive/v3"

    @property
    def provider_name(self) -> str:
        return "googledrive"

    # Prefix used to distinguish shared drive IDs from regular folder IDs
    SHARED_DRIVE_PREFIX = "shared-drive:"

    async def _list_shared_drives(self, access_token: str) -> List[OAuthFolder]:
        """Return all shared drives the user has access to as OAuthFolder objects."""
        try:
            response = await self._make_request_with_retry(
                "GET",
                f"{self.BASE_URL}/drives",
                access_token,
                params={"pageSize": 100, "fields": "drives(id,name)"},
            )
            drives = response.json().get("drives", [])
            return [
                OAuthFolder(
                    folder_id=f"{self.SHARED_DRIVE_PREFIX}{d['id']}",
                    name=d["name"],
                    parent_id=None,
                    path=normalize_file_path(f"/{d['name']}"),
                    has_subfolders=True,
                    no_of_subfolders=0,
                )
                for d in drives
            ]
        except Exception:
            return []

    async def list_files(
        self,
        access_token: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """List files and folders in Google Drive including shared drives."""
        # Shared drives support params (required for cross-drive listing)
        shared_drive_params = {
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }

        # Detect shared drive root navigation
        drive_id: Optional[str] = None
        if folder_id and folder_id.startswith(self.SHARED_DRIVE_PREFIX):
            drive_id = folder_id[len(self.SHARED_DRIVE_PREFIX) :]
            safe_id = drive_id.replace("\\", "\\\\").replace("'", "\\'")
            query = f"'{safe_id}' in parents and trashed=false"
            shared_drive_params["corpora"] = "drive"
            shared_drive_params["driveId"] = drive_id
        elif folder_id:
            safe_folder_id = folder_id.replace("\\", "\\\\").replace("'", "\\'")
            query = f"'{safe_folder_id}' in parents and trashed=false"
            shared_drive_params["corpora"] = "allDrives"
        else:
            query = "'root' in parents and trashed=false"
            shared_drive_params["corpora"] = "allDrives"

        params = {
            "q": query,
            "pageSize": min(page_size, 1000),
            "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink)",
            "orderBy": "folder,name",
            **shared_drive_params,
        }

        if page_token:
            params["pageToken"] = page_token

        response = await self._make_request_with_retry(
            "GET", f"{self.BASE_URL}/files", access_token, params=params
        )

        data = response.json()
        files_data = data.get("files", [])

        folders = []
        files = []

        # At root level (no folder_id), prepend shared drives as folders
        if not folder_id and not page_token:
            shared_drives = await self._list_shared_drives(access_token)
            folders.extend(shared_drives)

        for item in files_data:
            is_folder = item.get("mimeType") == "application/vnd.google-apps.folder"
            name = item.get("name", "")
            path = normalize_file_path(f"/{name}")

            if is_folder:
                folders.append(
                    OAuthFolder(
                        folder_id=item["id"],
                        name=name,
                        parent_id=folder_id,
                        path=path,
                        has_subfolders=False,
                        no_of_subfolders=0,
                    )
                )
            else:
                size = None
                if item.get("size"):
                    try:
                        size = int(item["size"])
                    except (ValueError, TypeError):
                        pass

                content_type = item.get("mimeType")
                if content_type and content_type.startswith(
                    "application/vnd.google-apps."
                ):
                    if "document" in content_type:
                        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    elif "spreadsheet" in content_type:
                        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    elif "presentation" in content_type:
                        content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                    else:
                        content_type = "application/pdf"

                files.append(
                    OAuthFile(
                        file_id=item["id"],
                        name=name,
                        is_folder=False,
                        path=path,
                        size=size,
                        content_type=content_type,
                        parent_id=folder_id,
                        modified_at=parse_iso_datetime(item.get("modifiedTime")),
                        created_at=parse_iso_datetime(item.get("createdTime")),
                        web_view_link=item.get("webViewLink"),
                    )
                )

        return OAuthFolderContents(
            folders=folders,
            files=files,
            total_count=len(folders) + len(files),
            next_page_token=data.get("nextPageToken"),
        )

    async def download_file(
        self, access_token: str, file_id: str, max_download_size: Optional[int] = None
    ) -> bytes:
        """Download file content from Google Drive."""
        size_limit = (
            max_download_size
            if max_download_size is not None
            else self.MAX_DOWNLOAD_SIZE
        )

        # First get file metadata to determine if it's a Google Workspace file
        file_response = await self._make_request_with_retry(
            "GET",
            f"{self.BASE_URL}/files/{file_id}",
            access_token,
            params={"fields": "mimeType,name,size"},
        )

        file_data = file_response.json()
        mime_type = file_data.get("mimeType", "")

        # Check file size before downloading (if size is available)
        file_size = file_data.get("size")
        if file_size is not None:
            try:
                if int(file_size) > size_limit:
                    raise OAuthError(
                        f"File size {int(file_size)} bytes exceeds maximum allowed size of {size_limit} bytes",
                        error_code="FILE_TOO_LARGE",
                    )
            except (ValueError, TypeError):
                pass

        # Handle Google Workspace files (need to export)
        if mime_type.startswith("application/vnd.google-apps."):
            export_mime_type = self._get_export_mime_type(mime_type)
            response = await self._make_request_with_retry(
                "GET",
                f"{self.BASE_URL}/files/{file_id}/export",
                access_token,
                params={"mimeType": export_mime_type},
            )
        else:
            # Regular file download
            response = await self._make_request_with_retry(
                "GET",
                f"{self.BASE_URL}/files/{file_id}",
                access_token,
                params={"alt": "media"},
            )

        # Check Content-Length header as a secondary safeguard
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
        """Get detailed metadata for a Google Drive file."""
        params = {
            "fields": "id,name,mimeType,size,modifiedTime,createdTime,parents,md5Checksum,version,permissions"
        }

        response = await self._make_request_with_retry(
            "GET", f"{self.BASE_URL}/files/{file_id}", access_token, params=params
        )

        data = response.json()

        # Parse size
        size = 0
        if data.get("size"):
            try:
                size = int(data["size"])
            except (ValueError, TypeError):
                pass

        # Get parent folder ID
        parents = data.get("parents", [])
        parent_id = parents[0] if parents else None

        # Convert Google Workspace mime types
        content_type = data.get("mimeType", "")
        if content_type.startswith("application/vnd.google-apps."):
            content_type = self._get_export_mime_type(content_type)

        return OAuthFileMetadata(
            file_id=data["id"],
            name=data.get("name", ""),
            size=size,
            content_type=content_type,
            modified_at=parse_iso_datetime(data.get("modifiedTime")) or "",
            created_at=parse_iso_datetime(data.get("createdTime")) or "",
            parent_id=parent_id,
            path=normalize_file_path(f"/{data.get('name', '')}"),
            checksum=data.get("md5Checksum"),
            version=str(data.get("version", "")),
            permissions=data.get("permissions", []),
        )

    async def search_files(
        self,
        access_token: str,
        query: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """Search for files in Google Drive."""
        # Escape single quotes to prevent query injection
        safe_query = query.replace("\\", "\\\\").replace("'", "\\'")

        # Build search query
        search_query = f"name contains '{safe_query}' and trashed=false"

        if folder_id:
            safe_folder_id = folder_id.replace("\\", "\\\\").replace("'", "\\'")
            search_query += f" and '{safe_folder_id}' in parents"

        params = {
            "q": search_query,
            "pageSize": min(page_size, 1000),
            "fields": "nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink)",
            "orderBy": "folder,name",
        }

        if page_token:
            params["pageToken"] = page_token

        response = await self._make_request_with_retry(
            "GET", f"{self.BASE_URL}/files", access_token, params=params
        )

        data = response.json()
        files_data = data.get("files", [])

        folders = []
        files = []

        for item in files_data:
            is_folder = item.get("mimeType") == "application/vnd.google-apps.folder"
            name = item.get("name", "")
            path = normalize_file_path(f"/{name}")

            if is_folder:
                folders.append(
                    OAuthFolder(
                        folder_id=item["id"],
                        name=name,
                        parent_id=item.get("parents", [None])[0],
                        path=path,
                    )
                )
            else:
                size = None
                if item.get("size"):
                    try:
                        size = int(item["size"])
                    except (ValueError, TypeError):
                        pass

                content_type = item.get("mimeType")
                if content_type and content_type.startswith(
                    "application/vnd.google-apps."
                ):
                    content_type = self._get_export_mime_type(content_type)

                files.append(
                    OAuthFile(
                        file_id=item["id"],
                        name=name,
                        is_folder=False,
                        path=path,
                        size=size,
                        content_type=content_type,
                        parent_id=item.get("parents", [None])[0],
                        modified_at=parse_iso_datetime(item.get("modifiedTime")),
                        created_at=parse_iso_datetime(item.get("createdTime")),
                        web_view_link=item.get("webViewLink"),
                    )
                )

        return OAuthFolderContents(
            folders=folders,
            files=files,
            total_count=len(folders) + len(files),
            next_page_token=data.get("nextPageToken"),
        )

    def _get_export_mime_type(self, google_mime_type: str) -> str:
        """Convert Google Workspace mime types to standard export formats."""
        mime_type_map = {
            "application/vnd.google-apps.document": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.google-apps.spreadsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.google-apps.presentation": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.google-apps.drawing": "application/pdf",
            "application/vnd.google-apps.script": "application/vnd.google-apps.script+json",
            "application/vnd.google-apps.form": "application/zip",
        }

        return mime_type_map.get(google_mime_type, "application/pdf")
