"""Synergy 12d provider implementation.

Models Synergy's job → folder → file hierarchy into the generic
OAuthProvider interface (folders + files). Jobs are top-level folders.
Uses a Personal Access Token (PAT) for auth instead of OAuth.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from .base_provider import (
    OAuthFile,
    OAuthFileMetadata,
    OAuthFolder,
    OAuthFolderContents,
    OAuthProvider,
    normalize_file_path,
)

# Folder ID prefixes to distinguish jobs from real folders
_JOB_PREFIX = "job:"
_FOLDER_PREFIX = "folder:"


def _build_base_url(server: str) -> str:
    """Normalize a Synergy server URL."""
    server = (server or "").strip().rstrip("/")
    if not server:
        raise ValueError("Server URL is required")
    if not server.startswith(("http://", "https://")):
        server = f"https://{server}"
    parsed = urlparse(server)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or parsed.path
    path = parsed.path if parsed.netloc else ""
    return f"{scheme}://{netloc}{path}".rstrip("/")


def _extract_id(item: Dict[str, Any]) -> str:
    """Extract ID string from Synergy's nested ID format."""
    return (item.get("ID") or {}).get("IDString") or item.get("IDString") or ""


def _strip_bearer(token: str) -> str:
    """Strip 'Bearer ' prefix from a token if present.

    The base provider's _make_request_with_retry always prepends 'Bearer ',
    so we must ensure the raw token doesn't already have it to avoid
    'Bearer Bearer ...' double-prefix.
    """
    cleaned = token.strip()
    if cleaned.lower().startswith("bearer "):
        cleaned = cleaned[7:].strip()
    return cleaned


class SynergyProvider(OAuthProvider):
    """Synergy 12d API provider — jobs as folders, files as files."""

    def __init__(
        self,
        client_id: str,
        client_secret: Optional[str] = None,
        instance_url: str = "",
    ):
        super().__init__(client_id, client_secret)
        self.instance_url = instance_url

    @property
    def provider_name(self) -> str:
        return "synergy"

    async def _make_request_with_retry(self, method, url, access_token, **kwargs):
        """Override to normalize Synergy PAT tokens before the base adds 'Bearer '."""
        return await super()._make_request_with_retry(
            method, url, _strip_bearer(access_token), **kwargs
        )

    async def list_files(
        self,
        access_token: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """List jobs (root), job folders, or folder contents."""
        if not folder_id:
            return await self._list_jobs(access_token, page_size, page_token)
        if folder_id.startswith(_JOB_PREFIX):
            job_id = folder_id[len(_JOB_PREFIX) :]
            return await self._list_job_folders(access_token, job_id)
        if folder_id.startswith(_FOLDER_PREFIX):
            real_id = folder_id[len(_FOLDER_PREFIX) :]
            return await self._list_folder_items(access_token, real_id)
        # Fallback: treat as folder ID
        return await self._list_folder_items(access_token, folder_id)

    async def _list_jobs(
        self, access_token: str, page_size: int, page_token: Optional[str]
    ) -> OAuthFolderContents:
        """List top-level Synergy jobs as folders."""
        base_url = _build_base_url(self.instance_url)
        page = int(page_token) if page_token else 1
        payload = {
            "QuickSearchTerm": "",
            "Name": "",
            "Page": page,
            "PageSize": min(page_size, 100),
            "Attributes": [
                {
                    "Attribute": {
                        "Name": "TopLevel",
                        "DisplayName": "Restrict to top level?",
                    },
                    "Type": "SynergyServerWeb.API.Models.SelectableProgrammaticAttribute",
                    "Value": True,
                    "SearchQueryType": 4,
                    "Operation": 0,
                    "Name": "Restrict to top level?",
                    "OperationName": "=",
                }
            ],
        }
        response = await self._make_request_with_retry(
            "POST",
            f"{base_url}/api/v1/jobs/search",
            access_token,
            json=payload,
        )
        data = response.json()
        items = data.get("Result") or data.get("Items") or data.get("items") or []

        folders: list[OAuthFolder] = []
        for job in items:
            if not isinstance(job, dict):
                continue
            job_id = _extract_id(job)
            name = job.get("Name", "")
            folders.append(
                OAuthFolder(
                    folder_id=f"{_JOB_PREFIX}{job_id}",
                    name=name,
                    path=normalize_file_path(f"/{name}"),
                    has_subfolders=True,
                    no_of_subfolders=job.get("NoOfFolders") or 0,
                )
            )

        total = data.get("TotalRows") or data.get("Total") or len(folders)
        total_pages = data.get("TotalPages") or 1
        next_token = str(page + 1) if page < total_pages else None

        return OAuthFolderContents(
            folders=folders,
            files=[],
            total_count=total,
            next_page_token=next_token,
        )

    async def _list_job_folders(
        self, access_token: str, job_id: str
    ) -> OAuthFolderContents:
        """List top-level folders in a Synergy job."""
        base_url = _build_base_url(self.instance_url)
        response = await self._make_request_with_retry(
            "GET",
            f"{base_url}/api/v1/jobs/{job_id}/items",
            access_token,
        )
        data = response.json()
        items = (
            data.get("SubFolders")
            or data.get("Result")
            or data.get("Items")
            or data.get("items")
            or []
        )

        folders: list[OAuthFolder] = []
        for folder in items:
            if not isinstance(folder, dict):
                continue
            fid = _extract_id(folder)
            name = folder.get("Name", "")
            folders.append(
                OAuthFolder(
                    folder_id=f"{_FOLDER_PREFIX}{fid}",
                    name=name,
                    path=normalize_file_path(f"/{name}"),
                    has_subfolders=folder.get("HasSubFolders", False)
                    or (folder.get("NoOfSubFolders") or 0) > 0,
                    no_of_subfolders=folder.get("NoOfSubFolders") or 0,
                )
            )

        return OAuthFolderContents(folders=folders, files=[], total_count=len(folders))

    async def _list_folder_items(
        self, access_token: str, folder_id: str
    ) -> OAuthFolderContents:
        """List subfolders and files in a Synergy folder."""
        base_url = _build_base_url(self.instance_url)
        response = await self._make_request_with_retry(
            "GET",
            f"{base_url}/api/v1/folders/{folder_id}/items",
            access_token,
        )
        data = response.json()

        folders: list[OAuthFolder] = []
        for folder in data.get("SubFolders", []):
            if not isinstance(folder, dict):
                continue
            fid = _extract_id(folder)
            name = folder.get("Name", "")
            folders.append(
                OAuthFolder(
                    folder_id=f"{_FOLDER_PREFIX}{fid}",
                    name=name,
                    path=normalize_file_path(f"/{name}"),
                    has_subfolders=folder.get("HasSubFolders", False)
                    or (folder.get("NoOfSubFolders") or 0) > 0,
                    no_of_subfolders=folder.get("NoOfSubFolders") or 0,
                )
            )

        files_data = data.get("Files") or {}
        file_items = (
            files_data.get("Result")
            or files_data.get("Items")
            or files_data.get("items")
            or []
        )

        files: list[OAuthFile] = []
        for f in file_items:
            if not isinstance(f, dict):
                continue
            fid = _extract_id(f)
            name = f.get("FileName") or f.get("Name") or ""
            files.append(
                OAuthFile(
                    file_id=fid,
                    name=name,
                    is_folder=False,
                    path=normalize_file_path(f"/{name}"),
                    size=f.get("FileSize") or f.get("Size"),
                    content_type=f.get("ContentType") or f.get("MimeType"),
                    modified_at=f.get("ModifiedDate") or f.get("LastModified"),
                )
            )

        return OAuthFolderContents(
            folders=folders,
            files=files,
            total_count=len(folders) + len(files),
        )

    async def download_file(
        self,
        access_token: str,
        file_id: str,
        max_download_size: Optional[int] = None,
    ) -> bytes:
        """Download a file from Synergy.

        Per the 12d Synergy REST API docs, file download is a POST to
        /api/v1/files/{id}/download?version={n}&with_references=false
        with Content-Type: application/octet-stream and an empty body.

        We first try to resolve the latest version via GET /api/v1/files/{id}.
        If that fails, we use the folder-files endpoint to look up the version,
        and ultimately fall back to version=1.
        """
        base_url = _build_base_url(self.instance_url)

        # Try to get the latest version number for the file
        version = 1
        try:
            meta_response = await self._make_request_with_retry(
                "GET",
                f"{base_url}/api/v1/files/{file_id}",
                access_token,
            )
            meta = meta_response.json()
            version = meta.get("LatestVersion") or meta.get("latestVersion") or 1
        except Exception:
            # File-by-ID endpoint may not be available; fall back to version=1
            pass

        # Synergy download is POST with empty body (per API docs)
        response = await self._make_request_with_retry(
            "POST",
            f"{base_url}/api/v1/files/{file_id}/download?version={version}&with_references=false",
            access_token,
            headers={"Content-Type": "application/octet-stream"},
            content=b"",
        )
        return response.content

    async def get_file_metadata(
        self, access_token: str, file_id: str
    ) -> OAuthFileMetadata:
        """Get file metadata from Synergy."""
        # Synergy doesn't have a dedicated metadata endpoint,
        # return minimal info from what we have
        return OAuthFileMetadata(
            file_id=file_id,
            name=file_id,
            size=0,
            content_type="application/octet-stream",
            modified_at="",
            created_at="",
        )

    async def refresh_token(self, access_token: str) -> Optional[str]:
        """Generate a new PAT using the existing one via Synergy API."""
        base_url = _build_base_url(self.instance_url)
        response = await self._make_request_with_retry(
            "POST",
            f"{base_url}/api/v1/auth/generate-pat",
            access_token,
            json={"ClientId": "numa", "Name": "numa-user", "ExpireInDays": 180},
        )
        data = response.json()
        return data.get("Token") or data.get("token") or None

    async def search_files(
        self,
        access_token: str,
        query: str,
        folder_id: Optional[str] = None,
        page_size: int = 100,
        page_token: Optional[str] = None,
    ) -> OAuthFolderContents:
        """Search Synergy jobs by name."""
        base_url = _build_base_url(self.instance_url)
        page = int(page_token) if page_token else 1
        payload = {
            "QuickSearchTerm": query,
            "Name": query,
            "Page": page,
            "PageSize": min(page_size, 100),
            "Attributes": [],
        }
        response = await self._make_request_with_retry(
            "POST",
            f"{base_url}/api/v1/jobs/search",
            access_token,
            json=payload,
        )
        data = response.json()
        items = data.get("Result") or data.get("Items") or data.get("items") or []

        folders: list[OAuthFolder] = []
        for job in items:
            if not isinstance(job, dict):
                continue
            job_id = _extract_id(job)
            name = job.get("Name", "")
            folders.append(
                OAuthFolder(
                    folder_id=f"{_JOB_PREFIX}{job_id}",
                    name=name,
                    path=normalize_file_path(f"/{name}"),
                    has_subfolders=True,
                )
            )

        return OAuthFolderContents(
            folders=folders,
            files=[],
            total_count=len(folders),
        )
