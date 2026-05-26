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


def list_job_folders(
    server: str,
    token: str,
    job_id: str,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """Return top-level folders for a job, with pagination metadata.

    The upstream Synergy `/api/v1/jobs/{id}/items` endpoint always returns
    every folder in one shot — there's no `Page`/`PageSize` support on that
    route. We therefore fetch the whole list once and slice in-memory. This
    is still a win because:

    * For a job with thousands of folders, returning all of them in one
      API response causes the Files UI to render a huge tree at once,
      which is what causes the "loads forever" experience users see.
    * The total folder count for a job (`no_of_folders` from the job
      record) is usually modest, so the upstream call itself is fast.
    """
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
    all_folders = [
        _normalize_folder(folder) for folder in items if isinstance(folder, dict)
    ]
    total = len(all_folders)
    page = max(1, page)
    page_size = max(1, page_size)
    start = (page - 1) * page_size
    end = start + page_size
    page_folders = all_folders[start:end]
    total_pages = max(1, (total + page_size - 1) // page_size)
    return {
        "items": page_folders,
        "page": page,
        "page_size": page_size,
        "total_rows": total,
        "total_pages": total_pages,
    }


def get_folder_items(
    server: str,
    token: str,
    folder_id: str,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    """Return subfolders and files for a folder, with pagination metadata.

    Subfolders come back un-paginated from upstream — we slice them in
    memory once we've fetched everything (cheap; folders are small). Files
    *can* be large for a single folder, but the upstream
    `/api/v1/folders/{id}/items` route doesn't expose `Page`/`PageSize`
    either; we apply the same in-memory slicing strategy. The pagination
    cursors returned here describe the *combined* page index — the
    frontend advances a single `page` cursor that walks both arrays.
    """
    base_url = _build_base_url(server)
    url = f"{base_url}/api/v1/folders/{folder_id}/items"
    headers = {
        "Authorization": _normalize_token(token),
        "Content-Type": "application/json",
    }
    response = httpx.get(url, headers=headers, timeout=60)
    _check_response(response)
    data = response.json()
    all_subfolders = [
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
    all_files = [_normalize_file(f) for f in file_items if isinstance(f, dict)]

    page = max(1, page)
    page_size = max(1, page_size)
    # Folders first, then files — same ordering the UI renders.
    combined_total = len(all_subfolders) + len(all_files)
    start = (page - 1) * page_size
    end = start + page_size
    page_subfolders: List[Dict[str, Any]] = []
    page_files: List[Dict[str, Any]] = []
    if start < len(all_subfolders):
        page_subfolders = all_subfolders[start : min(end, len(all_subfolders))]
    file_start = max(0, start - len(all_subfolders))
    file_end = max(0, end - len(all_subfolders))
    if file_end > 0 and file_start < len(all_files):
        page_files = all_files[file_start:file_end]

    total_pages = max(1, (combined_total + page_size - 1) // page_size)

    return {
        "folder_id": folder_id,
        "subfolders": page_subfolders,
        "files": page_files,
        "files_total": files_data.get("TotalRows") or len(all_files),
        "page": page,
        "page_size": page_size,
        "total_rows": combined_total,
        "total_pages": total_pages,
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
