"""Synergy API helpers for browsing jobs and folders."""

from __future__ import annotations

from typing import Any, Dict, List

import httpx

from connectors.synergy import _build_base_url, _normalize_token


class SynergyAuthError(ValueError):
    """Raised when Synergy returns 401/403 — token expired, revoked, or insufficient permissions."""

    def __init__(self, status_code: int, detail: str = ""):
        self.status_code = status_code
        super().__init__(
            f"Synergy authentication failed (HTTP {status_code}). {detail}".strip()
        )


def _check_response(response: httpx.Response) -> None:
    """Raise SynergyAuthError on 401/403, otherwise raise_for_status."""
    if response.status_code in (401, 403):
        detail = response.text[:200] if response.text else ""
        raise SynergyAuthError(response.status_code, detail)
    response.raise_for_status()


def search_jobs(  # pylint: disable=too-many-arguments
    server: str,
    token: str,
    name: str,
    page: int,
    page_size: int,
) -> Dict[str, Any]:
    """Search top-level jobs in Synergy."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/search"
    payload = {
        "QuickSearchTerm": "",
        "Name": name or "",
        "Page": page,
        "PageSize": page_size,
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
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.post(url, json=payload, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    items = data.get("Result") or data.get("Items") or data.get("items") or []
    jobs = [_normalize_job(job) for job in items if isinstance(job, dict)]
    return {
        "page": data.get("PageNumber") or data.get("pageNumber"),
        "page_size": data.get("PageSize") or data.get("pageSize"),
        "total_rows": data.get("TotalRows") or data.get("Total") or data.get("total"),
        "total_pages": data.get("TotalPages") or data.get("totalPages"),
        "items": jobs,
    }


def list_job_folders(server: str, token: str, job_id: str) -> List[Dict[str, Any]]:
    """Return top-level folders for a job."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/jobs/{job_id}/items"
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(url, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    items = (
        data.get("SubFolders")
        or data.get("Result")
        or data.get("Items")
        or data.get("items")
        or []
    )
    return [_normalize_folder(folder) for folder in items if isinstance(folder, dict)]


def get_folder_items(server: str, token: str, folder_id: str) -> Dict[str, Any]:
    """Return subfolders and files for a folder."""
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/folders/{folder_id}/items"
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(url, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    subfolders = [
        _normalize_folder(folder)
        for folder in data.get("SubFolders", [])
        if isinstance(folder, dict)
    ]
    files_data = data.get("Files") or {}
    file_items = (
        files_data.get("Result")
        or files_data.get("Items")
        or files_data.get("items")
        or []
    )
    files = [_normalize_file(f) for f in file_items if isinstance(f, dict)]
    return {
        "folder_id": folder_id,
        "subfolders": subfolders,
        "files": files,
        "files_total": files_data.get("TotalRows"),
    }


def _normalize_job(job: Dict[str, Any]) -> Dict[str, Any]:
    job_id = (job.get("ID") or {}).get("IDString")
    return {
        "job_id": job_id or job.get("IDString"),
        "name": job.get("Name"),
        "description": job.get("Description"),
        "path": job.get("Path"),
        "no_of_folders": job.get("NoOfFolders"),
        "no_of_children": job.get("NoOfChildren"),
    }


def _normalize_file(file: Dict[str, Any]) -> Dict[str, Any]:
    file_id = (file.get("ID") or {}).get("IDString")
    return {
        "file_id": file_id or file.get("IDString"),
        "name": file.get("FileName") or file.get("Name"),
        "size": file.get("FileSize") or file.get("Size"),
        "content_type": file.get("ContentType") or file.get("MimeType"),
        "modified_at": file.get("ModifiedDate") or file.get("LastModified"),
    }


def _normalize_folder(folder: Dict[str, Any]) -> Dict[str, Any]:
    folder_id = (folder.get("ID") or {}).get("IDString")
    return {
        "folder_id": folder_id or folder.get("IDString"),
        "name": folder.get("Name"),
        "has_subfolders": folder.get("HasSubFolders")
        or (folder.get("NoOfSubFolders") or 0) > 0,
        "no_of_subfolders": folder.get("NoOfSubFolders"),
        "folder_type": folder.get("FolderType"),
    }
