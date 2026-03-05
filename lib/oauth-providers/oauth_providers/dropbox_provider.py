"""Dropbox OAuth provider implementation using Dropbox API v2."""

from __future__ import annotations

import json
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


class DropboxProvider(OAuthProvider):
    """Dropbox API v2 OAuth provider implementation."""

    BASE_URL = "https://api.dropboxapi.com/2"
    CONTENT_URL = "https://content.dropboxapi.com/2"

    @property
    def provider_name(self) -> str:
        return "dropbox"

    async def list_files(
        self,
        access_token: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """List files and folders in Dropbox."""
        # Dropbox uses paths instead of folder IDs for most operations
        folder_path = folder_id if folder_id and folder_id != "root" else ""

        payload = {
            "path": folder_path,
            "recursive": False,
            "include_media_info": False,
            "include_deleted": False,
            "include_has_explicit_shared_members": False,
            "include_mounted_folders": True,
            "limit": min(page_size, 2000),  # Dropbox max is 2000
        }

        if page_token:
            # Use list_folder/continue for pagination
            url = f"{self.BASE_URL}/files/list_folder/continue"
            payload = {"cursor": page_token}
        else:
            url = f"{self.BASE_URL}/files/list_folder"

        response = await self._make_request_with_retry(
            "POST", url, access_token, json=payload
        )

        data = response.json()
        entries = data.get("entries", [])

        folders = []
        files = []

        for entry in entries:
            entry_type = entry.get(".tag")
            name = entry.get("name", "")
            path_lower = entry.get("path_lower", "")
            path_display = entry.get("path_display", path_lower)

            # Normalize path
            normalized_path = normalize_file_path(path_display)

            if entry_type == "folder":
                folders.append(
                    OAuthFolder(
                        folder_id=path_display,  # Dropbox uses paths as IDs
                        name=name,
                        parent_id=folder_path if folder_path else None,
                        path=normalized_path,
                        has_subfolders=False,  # Would need additional API call
                        no_of_subfolders=0,
                    )
                )

            elif entry_type == "file":
                size = entry.get("size", 0)

                # Determine content type from file extension
                content_type = self._get_content_type_from_name(name)

                # Parse dates
                client_modified = entry.get("client_modified")
                server_modified = entry.get("server_modified")

                files.append(
                    OAuthFile(
                        file_id=path_display,  # Dropbox uses paths as IDs
                        name=name,
                        is_folder=False,
                        path=normalized_path,
                        size=size,
                        content_type=content_type,
                        parent_id=folder_path if folder_path else None,
                        modified_at=parse_iso_datetime(server_modified),
                        created_at=parse_iso_datetime(client_modified),
                        web_view_link=None,  # Would need to generate sharing link
                    )
                )

        # Get next page token
        next_page_token = None
        if data.get("has_more", False):
            next_page_token = data.get("cursor")

        return OAuthFolderContents(
            folders=folders,
            files=files,
            total_count=len(folders) + len(files),
            next_page_token=next_page_token,
        )

    async def download_file(self, access_token: str, file_id: str) -> bytes:
        """Download file content from Dropbox."""
        # Dropbox uses a different URL and header format for downloads
        url = f"{self.CONTENT_URL}/files/download"

        # File path goes in the Dropbox-API-Arg header
        headers = {"Dropbox-API-Arg": json.dumps({"path": file_id})}

        response = await self._make_request_with_retry(
            "POST", url, access_token, headers=headers
        )

        return response.content

    async def get_file_metadata(
        self, access_token: str, file_id: str
    ) -> OAuthFileMetadata:
        """Get detailed metadata for a Dropbox file."""
        payload = {
            "path": file_id,
            "include_media_info": False,
            "include_deleted": False,
            "include_has_explicit_shared_members": False,
        }

        response = await self._make_request_with_retry(
            "POST", f"{self.BASE_URL}/files/get_metadata", access_token, json=payload
        )

        data = response.json()

        name = data.get("name", "")
        size = data.get("size", 0)
        content_type = self._get_content_type_from_name(name)

        # Get parent path
        path_display = data.get("path_display", "")
        parent_path = (
            "/".join(path_display.split("/")[:-1]) if "/" in path_display else None
        )

        # Get hash for checksum
        content_hash = data.get("content_hash")

        return OAuthFileMetadata(
            file_id=file_id,
            name=name,
            size=size,
            content_type=content_type,
            modified_at=parse_iso_datetime(data.get("server_modified")) or "",
            created_at=parse_iso_datetime(data.get("client_modified")) or "",
            parent_id=parent_path,
            path=normalize_file_path(path_display),
            checksum=content_hash,
            version=data.get("rev"),
            permissions={},  # Would need separate sharing info API call
        )

    async def search_files(
        self,
        access_token: str,
        query: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """Search for files in Dropbox."""
        payload = {
            "query": query,
            "options": {
                "path": folder_id if folder_id and folder_id != "root" else "",
                "max_results": min(page_size, 1000),  # Dropbox search max is 1000
                "file_status": "active",
                "filename_only": False,
            },
        }

        if page_token:
            # Use search/continue for pagination
            url = f"{self.BASE_URL}/files/search/continue_v2"
            payload = {"cursor": page_token}
        else:
            url = f"{self.BASE_URL}/files/search_v2"

        response = await self._make_request_with_retry(
            "POST", url, access_token, json=payload
        )

        data = response.json()
        matches = data.get("matches", [])

        folders = []
        files = []

        for match in matches:
            metadata = match.get("metadata", {})
            entry = metadata.get("metadata", {})
            entry_type = entry.get(".tag")

            if not entry:
                continue

            name = entry.get("name", "")
            path_display = entry.get("path_display", "")
            normalized_path = normalize_file_path(path_display)

            if entry_type == "folder":
                parent_path = (
                    "/".join(path_display.split("/")[:-1])
                    if "/" in path_display
                    else None
                )

                folders.append(
                    OAuthFolder(
                        folder_id=path_display,
                        name=name,
                        parent_id=parent_path,
                        path=normalized_path,
                    )
                )

            elif entry_type == "file":
                size = entry.get("size", 0)
                content_type = self._get_content_type_from_name(name)
                parent_path = (
                    "/".join(path_display.split("/")[:-1])
                    if "/" in path_display
                    else None
                )

                files.append(
                    OAuthFile(
                        file_id=path_display,
                        name=name,
                        is_folder=False,
                        path=normalized_path,
                        size=size,
                        content_type=content_type,
                        parent_id=parent_path,
                        modified_at=parse_iso_datetime(entry.get("server_modified")),
                        created_at=parse_iso_datetime(entry.get("client_modified")),
                    )
                )

        # Get next page token
        next_page_token = None
        if data.get("has_more", False):
            next_page_token = data.get("cursor")

        return OAuthFolderContents(
            folders=folders,
            files=files,
            total_count=len(folders) + len(files),
            next_page_token=next_page_token,
        )

    def _get_content_type_from_name(self, filename: str) -> str:
        """Determine MIME type from file extension."""
        if not filename:
            return "application/octet-stream"

        extension = filename.lower().split(".")[-1] if "." in filename else ""

        mime_type_map = {
            # Documents
            "pdf": "application/pdf",
            "doc": "application/msword",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls": "application/vnd.ms-excel",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "ppt": "application/vnd.ms-powerpoint",
            "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            # Text
            "txt": "text/plain",
            "rtf": "application/rtf",
            "csv": "text/csv",
            # Images
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "bmp": "image/bmp",
            "svg": "image/svg+xml",
            # Archives
            "zip": "application/zip",
            "rar": "application/x-rar-compressed",
            "7z": "application/x-7z-compressed",
            "tar": "application/x-tar",
            "gz": "application/gzip",
            # Audio/Video
            "mp3": "audio/mpeg",
            "wav": "audio/wav",
            "mp4": "video/mp4",
            "avi": "video/x-msvideo",
            "mkv": "video/x-matroska",
            # Code
            "html": "text/html",
            "css": "text/css",
            "js": "text/javascript",
            "json": "application/json",
            "xml": "application/xml",
            "py": "text/x-python",
            "java": "text/x-java-source",
            "cpp": "text/x-c++src",
            "c": "text/x-csrc",
        }

        return mime_type_map.get(extension, "application/octet-stream")
